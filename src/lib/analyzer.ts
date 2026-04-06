import { prisma } from './prisma';
import { getNFTTransfersForWallet, getNFTMetadataBatch, getTokenMarketSales, getTxValueEth, getWalletMarketSales, NFTTransfer } from './alchemy';
import { getTokenSales, getCollectionMarketHistory, collectionPeakAfter, collectionPeakForensic, normalizeTokenId, sleep } from './opensea';
import { getWalletActivityDeepScan, getTokenPeakAfterSale } from './reservoir';
import crypto from 'crypto';


interface TradeMatch {
    id: string;
    contractAddress: string;
    tokenId: string;
    buyTimestamp: Date;
    sellTimestamp: Date;
    collectionName?: string;
    imageUrl?: string | null;
    buyTransfer: NFTTransfer;
    sellTransfer: NFTTransfer;

    acquisitionType: string;
    acquisitionCostEth: number | null;
    sellPriceEth: number | null;
    heldDurationDays: number | null;

    peakPriceAfterSale: number | null;
    peakTimestamp: Date | null;
    daysToPeak: number | null;
    missedProfitEth: number | null;

    confidence: string; // High | Medium | Low
    pricingSource: string; // exact_resale | trait_comp | collection_floor | bundle_estimate
    pricingMode: string;
}

function reservoirSaleKey(contractAddress: string, tokenId: string, txHash: string): string {
    return `${txHash.toLowerCase()}:${contractAddress.toLowerCase()}:${normalizeTokenId(tokenId)}`;
}

function compareTransfers(a: NFTTransfer, b: NFTTransfer): number {
    if (a.blockNum !== b.blockNum) return a.blockNum - b.blockNum;
    const tsDiff = a.timestamp.getTime() - b.timestamp.getTime();
    if (tsDiff !== 0) return tsDiff;
    return a.logIndex - b.logIndex;
}

export async function analyzeWallet(analysisId: string, walletAddress: string) {
    const addr = walletAddress.toLowerCase();
    const START_TIME = Date.now();
    const BUDGET_MS = 300000; // Increased to 5 mins for whale wallets

    let ethPrice = 2500; // Fallback
    try {
        const pRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
        const pJson = await pRes.json();
        ethPrice = pJson?.ethereum?.usd || 2500;
        console.log(`[analyzer] Live ETH Price: $${ethPrice}`);
    } catch {
        // ignore fetch fail
    }

    try {
        await prisma.walletAnalysis.update({
            where: { id: analysisId },
            data: { status: 'processing' },
        });

        // 1. Fetch ALL transfers using robust Alchemy scanning (ERC721 + ERC1155 + Internal)
        const { received, sent, stats, earliest, latest } = await getNFTTransfersForWallet(addr);

        await prisma.walletAnalysis.update({
            where: { id: analysisId },
            data: {
                incomingTransfersScanned: stats.incomingTransfersScanned,
                outgoingTransfersScanned: stats.outgoingTransfersScanned,
                coverageLabel: stats.isPartial ? "Sampled history" : "Full history",
                earliestRelevantTradeDate: earliest,
                latestRelevantTradeDate: latest
            }
        });

        // 2. Identify sold NFTs and backtrack acquisition history
        const tokenGroups = new Map<string, { received: NFTTransfer[], sent: NFTTransfer[] }>();
        const mintTxCounts = new Map<string, number>();
        const sellTxCounts = new Map<string, number>();

        for (const s of sent) {
            const tokenId = normalizeTokenId(s.tokenId);
            const key = `${s.contractAddress}:${tokenId}`;
            if (!tokenGroups.has(key)) tokenGroups.set(key, { received: [], sent: [] });
            tokenGroups.get(key)!.sent.push(s);
            sellTxCounts.set(s.txHash, (sellTxCounts.get(s.txHash) || 0) + s.quantity);
        }

        // Count ALL received tokens for mint cost splitting, not just ones we sold.
        for (const r of received) {
            const fAddr = r.fromAddress.toLowerCase();
            const isMint = fAddr === '0x0000000000000000000000000000000000000000' || fAddr === r.contractAddress.toLowerCase();
            if (isMint) {
                mintTxCounts.set(r.txHash, (mintTxCounts.get(r.txHash) || 0) + r.quantity);
            }

            const tokenId = normalizeTokenId(r.tokenId);
            const key = `${r.contractAddress}:${tokenId}`;
            if (tokenGroups.has(key)) {
                tokenGroups.get(key)!.received.push(r);
            }
        }

        // 2a. High-Performance wallet marketplace scan via Alchemy sales.
        // This covers multiple on-chain marketplaces from one API and lets us
        // recover both buy-side and sell-side prices when marketplace activity exists.
        const alchemySales = await getWalletMarketSales(addr, 2000);
        const verifiedBuySales = new Map<string, number>();
        const verifiedSellSales = new Map<string, number>();
        for (const sale of alchemySales) {
            if (sale.priceEth > 0) {
                const saleKey = reservoirSaleKey(sale.contractAddress, sale.tokenId, sale.txHash);
                if (sale.sellerAddress === addr) {
                    verifiedSellSales.set(saleKey, sale.priceEth);
                }
                if (sale.buyerAddress === addr) {
                    verifiedBuySales.set(saleKey, sale.priceEth);
                }
            }
        }

        // Reservoir remains a fallback if Alchemy sales are unavailable or incomplete.
        if (verifiedSellSales.size === 0 && verifiedBuySales.size === 0) {
            const reservoirActivity = await getWalletActivityDeepScan(addr, 2000);
            for (const act of reservoirActivity) {
                if (act.type === 'sale' && act.price > 0) {
                    verifiedSellSales.set(
                        reservoirSaleKey(act.contract, act.tokenId, act.txHash),
                        act.price
                    );
                }
            }
        }

        const matchedTrades: TradeMatch[] = [];

        for (const [key, group] of Array.from(tokenGroups.entries())) {
            if (group.received.length === 0 || group.sent.length === 0) continue;

            const [contractAddress, tokenId] = key.split(':');
            const sortedReceived = group.received.sort(compareTransfers);
            const sortedSent = group.sent.sort(compareTransfers);

            // Match using FIFO queue approach for repeat buyers
            let availableBuys = [...sortedReceived];
            for (const s of sortedSent) {
                // Use transfer ordering so batched mints/sales in the same block are paired deterministically.
                const buyIdx = availableBuys.findIndex(r => compareTransfers(r, s) <= 0);

                if (buyIdx !== -1) {
                    const bestRec = availableBuys[buyIdx];
                    availableBuys.splice(buyIdx, 1);

                    // Check for verified price from Reservoir activity first
                    const verifiedSellPrice = verifiedSellSales.get(
                        reservoirSaleKey(s.contractAddress, s.tokenId, s.txHash)
                    );

                    matchedTrades.push({
                        id: crypto.randomUUID(),
                        contractAddress,
                        tokenId,
                        buyTimestamp: bestRec.timestamp,
                        sellTimestamp: s.timestamp,
                        buyTransfer: bestRec,
                        sellTransfer: s,
                        acquisitionType: 'unknown',
                        acquisitionCostEth: null,
                        sellPriceEth: verifiedSellPrice || null,
                        heldDurationDays: Math.floor((s.timestamp.getTime() - bestRec.timestamp.getTime()) / (1000 * 60 * 60 * 24)),
                        peakPriceAfterSale: null,
                        peakTimestamp: null,
                        daysToPeak: null,
                        missedProfitEth: null,
                        confidence: verifiedSellPrice ? 'Medium' : 'Low',
                        pricingSource: verifiedSellPrice ? 'exact_resale' : 'collection_floor',
                        pricingMode: verifiedSellPrice ? 'token' : 'collection'
                    });
                }
            }
        }




        // 3. Save analysis immediately (trades without full pricing yet)
        await prisma.walletAnalysis.update({
            where: { id: analysisId },
            data: { completedPairs: matchedTrades.length, status: 'pricing' },
        });

        if (matchedTrades.length > 0) {
            // Fast Metadata Prefetch
            const metadataTokens = matchedTrades.map(m => ({
                contractAddress: m.contractAddress,
                tokenId: m.tokenId
            }));
            const metadataMap = await getNFTMetadataBatch(metadataTokens);

            // Fetch Mint TX values fast
            const uniqueTxHashes = new Set<string>();
            for (const match of matchedTrades) {
                const fromAddr = match.buyTransfer.fromAddress.toLowerCase();
                const isMintCandidate = fromAddr === '0x0000000000000000000000000000000000000000' || fromAddr === match.contractAddress.toLowerCase();
                if (isMintCandidate) {
                    uniqueTxHashes.add(match.buyTransfer.txHash);
                }
                uniqueTxHashes.add(match.sellTransfer.txHash);
            }
            const txHashesArray = Array.from(uniqueTxHashes);
            for (let i = 0; i < txHashesArray.length; i += 20) {
                await Promise.all(txHashesArray.slice(i, i + 20).map(hash => getTxValueEth(hash)));
            }

            const collectionGroups = new Map<string, TradeMatch[]>();
            for (const match of matchedTrades) {
                if (!collectionGroups.has(match.contractAddress)) collectionGroups.set(match.contractAddress, []);
                collectionGroups.get(match.contractAddress)!.push(match);
            }

            // 4. Collection-First Pricing
            const collectionEntries = Array.from(collectionGroups.entries());
            let currentAnalyzedCollections = 0;

            for (let i = 0; i < collectionEntries.length; i += 5) {
                const chunk = collectionEntries.slice(i, i + 5);
                await Promise.all(chunk.map(async ([contractAddress, trades]) => {
                    const colHistory = await getCollectionMarketHistory(contractAddress);
                    console.log(`[analyzer] Analyzing collection: ${trades[0]?.collectionName || contractAddress}`);
                    currentAnalyzedCollections++;

                    for (const trade of trades) {
                        const meta = metadataMap.get(`${trade.contractAddress.toLowerCase()}:${trade.tokenId.toLowerCase()}`);
                        trade.collectionName = meta?.collection || "";
                        trade.imageUrl = meta?.image || null;

                        // Acquisition Logic
                        const fromAddr = trade.buyTransfer.fromAddress.toLowerCase();
                        const isMintCandidate = fromAddr === '0x0000000000000000000000000000000000000000' || fromAddr === trade.contractAddress.toLowerCase();

                        if (isMintCandidate) {
                            const valEth = await getTxValueEth(trade.buyTransfer.txHash);
                            if (valEth > 0) {
                                trade.acquisitionType = 'mint_paid';
                                trade.acquisitionCostEth = valEth / (mintTxCounts.get(trade.buyTransfer.txHash) || 1);
                            } else {
                                trade.acquisitionType = 'mint_free';
                                trade.acquisitionCostEth = 0;
                            }
                        } else {
                            trade.acquisitionType = 'secondary_buy';
                            const verifiedBuySale = verifiedBuySales.get(
                                reservoirSaleKey(trade.contractAddress, trade.tokenId, trade.buyTransfer.txHash)
                            );
                            if (verifiedBuySale && verifiedBuySale > 0) {
                                trade.acquisitionCostEth = verifiedBuySale;
                            }
                        }

                        const txVal = await getTxValueEth(trade.sellTransfer.txHash);
                        if ((trade.sellPriceEth === null || trade.sellPriceEth <= 0) && txVal > 0) {
                            trade.sellPriceEth = txVal / (sellTxCounts.get(trade.sellTransfer.txHash) || 1);
                        }

                        const forensic = collectionPeakForensic(colHistory.events, trade.sellTimestamp, 30);
                        trade.peakPriceAfterSale = forensic.peak > 0 ? forensic.peak : colHistory.recentPeak;

                        trade.peakTimestamp = forensic.timestamp;
                        trade.daysToPeak = forensic.timestamp ? Math.floor((forensic.timestamp.getTime() - trade.sellTimestamp.getTime()) / 86400000) : null;
                        if (
                            trade.sellPriceEth !== null &&
                            trade.sellPriceEth > 0 &&
                            trade.peakPriceAfterSale !== null &&
                            trade.peakPriceAfterSale > 0
                        ) {
                            const rawMissed = trade.peakPriceAfterSale - trade.sellPriceEth;
                            trade.missedProfitEth = rawMissed >= 0.01 ? rawMissed : 0;
                        } else {
                            trade.missedProfitEth = 0;
                        }
                        trade.pricingSource = 'collection_floor';
                        trade.confidence = (forensic.peak > 0) ? 'Medium' : 'Low';
                    }

                    // Remove processed trades that weren't sales
                    collectionGroups.set(contractAddress, trades.filter(t => !(t as any).__not_a_sale));
                }));

                await prisma.walletAnalysis.update({
                    where: { id: analysisId },
                    data: { collectionsAnalyzed: currentAnalyzedCollections }
                });
                await sleep(100);
            }

            // REGENERATE validated list from filtered groups
            const validatedTrades = Array.from(collectionGroups.values()).flat();

            // Sync count to analysis
            await prisma.walletAnalysis.update({
                where: { id: analysisId },
                data: { completedPairs: validatedTrades.length }
            });

            // INITIAL DB DUMP
            const createInserts = validatedTrades.map(match => {
                const shortAddr = `${match.contractAddress.slice(0, 6)}…${match.contractAddress.slice(-4)}`;
                return {
                    id: match.id,
                    analysisId: analysisId,
                    contractAddress: match.contractAddress,
                    tokenId: match.tokenId,
                    collectionName: match.collectionName || shortAddr,
                    imageUrl: match.imageUrl || null,
                    acquisitionType: match.acquisitionType,
                    acquisitionCostEth: match.acquisitionCostEth,
                    buyTimestamp: match.buyTimestamp,
                    sellPriceEth: match.sellPriceEth,
                    sellTimestamp: match.sellTimestamp,
                    heldDurationDays: match.heldDurationDays,
                    peakPriceAfterSale: match.peakPriceAfterSale,
                    peakTimestamp: match.peakTimestamp,
                    daysToPeak: match.daysToPeak,
                    missedProfitEth: match.missedProfitEth,
                    confidence: match.confidence,
                    pricingSource: match.pricingSource,
                    pricingMode: match.pricingMode
                };
            });

            const CHUNK_SIZE = 500;
            for (let i = 0; i < createInserts.length; i += CHUNK_SIZE) {
                await prisma.nFTTrade.createMany({
                    data: createInserts.slice(i, i + CHUNK_SIZE),
                });
            }

            // 5. Refine Top 150 Token History for accurate "Confirmed Fumbles"
            const refinementLimit = Math.min(validatedTrades.length, 150);
            const priorityTrades = validatedTrades
                .sort((a, b) => {
                    const missedDiff = (b.missedProfitEth || 0) - (a.missedProfitEth || 0);
                    if (missedDiff !== 0) return missedDiff;
                    return (b.peakPriceAfterSale || 0) - (a.peakPriceAfterSale || 0);
                })
                .slice(0, refinementLimit);

            for (let i = 0; i < priorityTrades.length; i += 3) {
                const chunk = priorityTrades.slice(i, i + 3);
                await Promise.all(chunk.map(match => enrichTradeExactTokenPricing(match, addr)));

                for (const match of chunk) {
                    await prisma.nFTTrade.update({
                        where: { id: match.id },
                        data: {
                            acquisitionCostEth: match.acquisitionCostEth,
                            sellPriceEth: match.sellPriceEth,
                            peakPriceAfterSale: match.peakPriceAfterSale,
                            peakTimestamp: match.peakTimestamp,
                            daysToPeak: match.daysToPeak,
                            missedProfitEth: match.missedProfitEth,
                            confidence: match.confidence,
                            pricingSource: match.pricingSource,
                            pricingMode: match.pricingMode
                        }
                    });
                }

                // Keep partial state updated
                await updateAnalysisTotals(analysisId, ethPrice);
                await sleep(150);
            }
        }

        // --- FINALIZE TOTALS ---
        await updateAnalysisTotals(analysisId, ethPrice, true);

    } catch (err: any) {
        console.error(`[analyzer] Fatal error processing wallet ${walletAddress}:`, err.message || err);
        await prisma.walletAnalysis.update({
            where: { id: analysisId },
            data: { status: 'failed' },
        });
    }
}

async function updateAnalysisTotals(analysisId: string, ethPrice: number, isFinal = false) {
    const allFinalTrades = await prisma.nFTTrade.findMany({ where: { analysisId } });

    let confirmedMissedEth = 0;
    let estimatedMissedEth = 0;
    let maxRegretEth = 0;
    let totalTradingVolume = 0;
    let pricedTradesCount = 0;

    for (const matchRaw of allFinalTrades) {
        const match = matchRaw as any;
        if (match.pricingMode === 'token') pricedTradesCount++;
        if (match.sellPriceEth && match.sellPriceEth > 0) totalTradingVolume += match.sellPriceEth;

        // Determine missed profit:
        // 1. Prefer the pre-calculated missedProfitEth stored on the record (set by enrichment).
        // 2. For collection-floor trades that were never token-enriched, calculate from peak —
        //    but ONLY if both sellPriceEth AND peakPriceAfterSale are real positive values,
        //    and the gain is at least 0.01 ETH (avoids dust / floating-point noise).
        let mp: number;
        if (match.missedProfitEth !== null && match.missedProfitEth !== undefined) {
            mp = match.missedProfitEth;
        } else if (
            match.peakPriceAfterSale > 0 &&
            match.sellPriceEth > 0
        ) {
            const rawGain = match.peakPriceAfterSale - match.sellPriceEth;
            mp = rawGain >= 0.01 ? rawGain : 0;
        } else {
            mp = 0;
        }

        if (mp > 0) {
            // A "Confirmed Missed" trade must have:
            //   • High confidence (token-level pricing confirmed)
            //   • A real resale found after the sale (pricingSource !== 'none')
            if (match.confidence === 'High' && match.pricingSource !== 'none') {
                confirmedMissedEth += mp;
            } else if (match.confidence === 'Medium') {
                estimatedMissedEth += mp;
            } else {
                maxRegretEth += mp;
            }
        }
    }


    const feesPaid = totalTradingVolume * 0.025;
    const estRoyaltyPaid = totalTradingVolume * 0.05; // 5% estimate for creator royalties
    console.log(`[analyzer] Counts: Confirmed: ${confirmedMissedEth.toFixed(2)} | Estimated: ${estimatedMissedEth.toFixed(2)} | Max: ${maxRegretEth.toFixed(2)}`);

    await prisma.walletAnalysis.update({
        where: { id: analysisId },
        data: {
            confirmedMissedEth,
            confirmedMissedUsd: confirmedMissedEth * ethPrice,
            estimatedMissedEth,
            estimatedMissedUsd: estimatedMissedEth * ethPrice,
            maxRegretEth,
            maxRegretUsd: maxRegretEth * ethPrice,
            walletTradingVolume: totalTradingVolume,
            walletTradingVolumeUsd: totalTradingVolume * ethPrice,
            openseaFeesPaid: feesPaid,
            openseaFeesUsd: feesPaid * ethPrice,
            estimatedRoyaltyFeesPaid: estRoyaltyPaid,
            estimatedRoyaltyFeesUsd: estRoyaltyPaid * ethPrice,
            pricedTrades: pricedTradesCount,
            ...(isFinal ? { status: 'complete', finishedAt: new Date() } : {})
        },
    });
}

export async function enrichTradeExactTokenPricing(trade: TradeMatch, walletAddr: string) {
    const [sales, alchemySales] = await Promise.all([
        getTokenSales(trade.contractAddress, trade.tokenId),
        getTokenMarketSales(trade.contractAddress, trade.tokenId)
    ]);

    let explicitBuyPrice: number | null = null;
    let explicitSellPrice: number | null = null;

    for (const sale of alchemySales) {
        if (sale.buyerAddress === walletAddr && sale.txHash === trade.buyTransfer.txHash) {
            explicitBuyPrice = sale.priceEth;
        }
        if (sale.sellerAddress === walletAddr && sale.txHash === trade.sellTransfer.txHash) {
            explicitSellPrice = sale.priceEth;
        }
    }

    for (const sale of sales) {
        const involved = [sale.buyer, sale.seller, sale.rawMaker, sale.rawTaker].map(s => s?.toLowerCase());
        if (involved.includes(walletAddr)) {
            const distToBuy = Math.abs(sale.timestamp.getTime() - trade.buyTimestamp.getTime());
            const distToSell = Math.abs(sale.timestamp.getTime() - trade.sellTimestamp.getTime());

            if (explicitBuyPrice === null && distToBuy <= distToSell && distToBuy < 86400000) {
                explicitBuyPrice = sale.priceEth;
            } else if (explicitSellPrice === null && distToSell < 86400000) {
                explicitSellPrice = sale.priceEth;
            }
        }
    }

    if (trade.acquisitionType === 'secondary_buy' && explicitBuyPrice !== null) {
        trade.acquisitionCostEth = explicitBuyPrice;
    }

    if (explicitSellPrice !== null) {
        trade.sellPriceEth = explicitSellPrice;

        // --- Guard: a confirmed fumble requires a real, non-zero sell price ---
        // If the marketplace reported 0 ETH (e.g. bundle / non-ETH sale), we can't
        // accurately measure missed profit — demote to Medium confidence.
        if (explicitSellPrice <= 0) {
            trade.pricingMode = 'token';
            trade.confidence = 'Medium';
            trade.pricingSource = 'collection_floor';
            return;
        }

        // HIGH PERFORMANCE FORENSIC PEAK (RESERVOIR FALLBACK TO OPENSEA)
        // Reservoir is queried first with a 365-day cap to avoid using a peak
        // that happened years after the original sale as "confirmed" regret.
        let peakData = { peak: 0, timestamp: 0 };
        try {
            peakData = await getTokenPeakAfterSale(
                trade.contractAddress,
                trade.tokenId,
                Math.floor(trade.sellTimestamp.getTime() / 1000),
                365 // Only consider peaks within 1 year of the sale
            );
        } catch {
            // Reservoir unavailable — fall through to OpenSea
        }

        if (peakData.peak > 0) {
            trade.peakPriceAfterSale = peakData.peak;
            trade.peakTimestamp = new Date(peakData.timestamp * 1000);
            trade.daysToPeak = Math.floor((trade.peakTimestamp.getTime() - trade.sellTimestamp.getTime()) / 86400000);

            // Require at least 0.01 ETH gain above sell price to count as "Confirmed Missed"
            // — prevents floating-point dust from inflating the confirmed bucket.
            const mp = peakData.peak - explicitSellPrice;
            trade.missedProfitEth = mp >= 0.01 ? mp : 0;
            trade.confidence = 'High';
            trade.pricingSource = 'exact_resale';
        } else {
            // Deep forensic peak from OpenSea (30-day window after sale)
            let peak = 0;
            let peakTs: Date | null = null;
            const cutoff = trade.sellTimestamp.getTime() + (30 * 86400000);

            for (const sale of sales) {
                const sTs = sale.timestamp.getTime();
                if (sTs > trade.sellTimestamp.getTime() && sTs <= cutoff) {
                    if (sale.priceEth > peak) {
                        peak = sale.priceEth;
                        peakTs = sale.timestamp;
                    }
                }
            }

            if (peak > 0) {
                trade.peakPriceAfterSale = peak;
                trade.peakTimestamp = peakTs;
                trade.daysToPeak = peakTs ? Math.floor((peakTs.getTime() - trade.sellTimestamp.getTime()) / 86400000) : null;

                // Same 0.01 ETH minimum margin for OpenSea confirmed peak
                const mp = peak - explicitSellPrice;
                trade.missedProfitEth = mp >= 0.01 ? mp : 0;
                trade.confidence = 'High';
                trade.pricingSource = 'exact_resale';
            } else {
                // We have a verified sell price but no subsequent peak data found.
                // Mark as High confidence (sell was real) with zero missed profit.
                // This is NOT a fumble — the user may have sold at the top.
                trade.missedProfitEth = 0;
                trade.confidence = 'High';
                trade.pricingSource = 'none';
            }
        }

        trade.pricingMode = 'token';
    }
    // If explicitSellPrice is null, the token-level data didn't confirm the user's
    // sale as a marketplace event — keep the collection-floor confidence rating
    // (Medium or Low) set during the initial collection-pass.
}
