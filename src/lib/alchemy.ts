import axios from 'axios';

export interface NormalizedNFT {
    contract_address: string;
    token_id: string;
    collection_name: string;
    image_url: string | null;
}

export interface NFTTransfer {
    contractAddress: string;
    tokenId: string;
    quantity: number;
    timestamp: Date;
    txHash: string;
    blockNum: number;
    logIndex: number;
    fromAddress: string;
    toAddress: string;
}

export interface AlchemyMarketSale {
    contractAddress: string;
    tokenId: string;
    quantity: number;
    buyerAddress: string;
    sellerAddress: string;
    txHash: string;
    marketplace: string;
    taker: 'BUYER' | 'SELLER' | string;
    blockNum: number;
    logIndex: number;
    bundleIndex: number;
    priceEth: number;
}

const ALCHEMY_RPC = `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
const ALCHEMY_NFT_V3_BASE = `https://eth-mainnet.g.alchemy.com/nft/v3/${process.env.ALCHEMY_API_KEY}`;
const ALCHEMY_V3_URL = `https://eth-mainnet.g.alchemy.com/nft/v3/${process.env.ALCHEMY_API_KEY}/getNFTsForOwner`;

const transferCache = new Map<string, { received: NFTTransfer[]; sent: NFTTransfer[]; earliest: Date; latest: Date; stats: any; timestamp: number }>();
const marketSalesCache = new Map<string, { sales: AlchemyMarketSale[]; timestamp: number }>();
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

function feeAmountToEth(fee: any): number {
    const rawAmount = fee?.amount;
    const decimals = fee?.decimals ?? 18;
    if (!rawAmount) return 0;
    try {
        return Number(BigInt(rawAmount)) / Math.pow(10, decimals);
    } catch {
        return 0;
    }
}

function normalizeMarketSale(sale: any): AlchemyMarketSale | null {
    const contractAddress = (sale?.contractAddress || '').toLowerCase();
    const tokenId = sale?.tokenId || '';
    const txHash = sale?.transactionHash || '';

    if (!contractAddress || !tokenId || !txHash) return null;

    return {
        contractAddress,
        tokenId,
        quantity: Number(sale?.quantity || 1),
        buyerAddress: (sale?.buyerAddress || '').toLowerCase(),
        sellerAddress: (sale?.sellerAddress || '').toLowerCase(),
        txHash,
        marketplace: sale?.marketplace || 'unknown',
        taker: sale?.taker || '',
        blockNum: Number(sale?.blockNumber || 0),
        logIndex: Number(sale?.logIndex || 0),
        bundleIndex: Number(sale?.bundleIndex || 0),
        priceEth:
            feeAmountToEth(sale?.sellerFee) +
            feeAmountToEth(sale?.protocolFee) +
            feeAmountToEth(sale?.royaltyFee)
    };
}

async function fetchAllMarketSales(params: Record<string, string | number>, label: string, maxPages: number): Promise<AlchemyMarketSale[]> {
    const sales: AlchemyMarketSale[] = [];
    let pageKey: string | undefined;
    let pageCount = 0;

    do {
        try {
            const resp = await axios.get(`${ALCHEMY_NFT_V3_BASE}/getNFTSales`, {
                params: {
                    fromBlock: '0',
                    toBlock: 'latest',
                    order: 'asc',
                    limit: 1000,
                    ...params,
                    ...(pageKey ? { pageKey } : {})
                },
                timeout: 15000
            });

            const batch = (resp.data?.nftSales || [])
                .map((sale: any) => normalizeMarketSale(sale))
                .filter(Boolean) as AlchemyMarketSale[];

            sales.push(...batch);
            pageKey = resp.data?.pageKey;
            pageCount++;

            if (pageCount >= maxPages) {
                console.warn(`[alchemy] Hit maxPages limit (${maxPages}) for ${label}. Sales history may be partial.`);
                break;
            }
        } catch (err: any) {
            console.warn(`[alchemy] Failed to fetch NFT sales (${label}): ${err.message}`);
            break;
        }
    } while (pageKey);

    console.log(`[alchemy] ${label} NFT sales fetched: ${sales.length} across ${pageCount} pages`);
    return sales;
}

export async function getTokenMarketSales(contractAddress: string, tokenId: string, maxPages: number = 2): Promise<AlchemyMarketSale[]> {
    const normalizedContract = contractAddress.toLowerCase();
    const sales = await fetchAllMarketSales(
        { contractAddress: normalizedContract, tokenId, order: 'asc' },
        `token:${normalizedContract}:${tokenId}`,
        maxPages
    );

    return sales.sort((a, b) => {
        if (a.blockNum !== b.blockNum) return a.blockNum - b.blockNum;
        if (a.logIndex !== b.logIndex) return a.logIndex - b.logIndex;
        return a.bundleIndex - b.bundleIndex;
    });
}

function expandTransfer(t: any): NFTTransfer[] {
    const base = {
        contractAddress: t.rawContract?.address?.toLowerCase() || '',
        timestamp: t.metadata?.blockTimestamp ? new Date(t.metadata.blockTimestamp) : new Date(0),
        txHash: t.hash || '',
        blockNum: parseInt(t.blockNum || '0', 16),
        logIndex: Number(t.logIndex ?? 0),
        fromAddress: (t.from || '').toLowerCase(),
        toAddress: (t.to || '').toLowerCase()
    };

    // Alchemy can collapse ERC-1155 batch transfers into one transfer object with
    // `erc1155Metadata`; expand them so each token unit is counted independently.
    if (Array.isArray(t.erc1155Metadata) && t.erc1155Metadata.length > 0) {
        return t.erc1155Metadata.flatMap((entry: any, index: number) => {
            const tokenId = entry?.tokenId || '';
            const quantity = Number(entry?.value || 1);
            if (!tokenId || quantity <= 0) return [];

            return Array.from({ length: quantity }, (_, quantityIndex) => ({
                ...base,
                tokenId,
                quantity: 1,
                logIndex: base.logIndex + index + quantityIndex
            }));
        });
    }

    const tokenId = t.tokenId || t.erc721TokenId || '';
    if (!tokenId) return [];

    const quantity = Number(t.value || 1);
    return Array.from({ length: Math.max(quantity, 1) }, (_, quantityIndex) => ({
        ...base,
        tokenId,
        quantity: 1,
        logIndex: base.logIndex + quantityIndex
    }));
}

async function fetchAllTransfers(directionParams: any, label: string, maxPages: number): Promise<{ data: NFTTransfer[], hitCap: boolean, count: number }> {
    let allTransfers: any[] = [];
    let pageKey: string | undefined = undefined;
    let pageCount = 0;

    do {
        let attempts = 0;
        let success = false;

        while (attempts < 2 && !success) {
            try {
                const params = { ...directionParams };
                if (pageKey) params.pageKey = pageKey;

                const resp = await axios.post(ALCHEMY_RPC, {
                    jsonrpc: "2.0",
                    id: 1,
                    method: "alchemy_getAssetTransfers",
                    params: [params]
                }, { timeout: 10000 });

                if (resp.data.error) throw new Error(resp.data.error.message);

                const transfers = resp.data.result?.transfers || [];
                allTransfers = allTransfers.concat(transfers);

                pageKey = resp.data.result?.pageKey;
                success = true;
            } catch (err: any) {
                attempts++;
                console.warn(`[alchemy] Attempt ${attempts} failed (${label}):`, err.message);
                if (attempts >= 2) {
                    console.error(`[alchemy] Fatal fail fetching transfers (${label}) after 2 attempts.`);
                    pageKey = undefined; // abort loop on permanent failure
                }
            }
        }
        pageCount++;
        // Safety break at 1000 pages (1M transfers) to prevent infinite loops on crazy wallets
        if (pageCount >= maxPages) {
            console.warn(`[alchemy] Hit maxPages limit (${maxPages}) for ${label}. History may be partial.`);
        }
    } while (pageKey);

    const hitCap = !!pageKey;

    console.log(`[analyzer] ${label} transfers raw fetched: ${allTransfers.length} across ${pageCount} pages (hitCap: ${hitCap})`);

    return {
        data: allTransfers.flatMap((t: any) => expandTransfer(t)),
        hitCap,
        count: allTransfers.length
    };
}

export async function getNFTTransfersForWallet(walletAddress: string): Promise<{ received: NFTTransfer[]; sent: NFTTransfer[]; earliest: Date; latest: Date; stats: any }> {
    const addr = walletAddress.toLowerCase();
    const cacheKey = `${addr}`;

    if (transferCache.has(cacheKey)) {
        const cached = transferCache.get(cacheKey)!;
        if (Date.now() - cached.timestamp < CACHE_TTL_MS) return cached;
    }

    const baseParams = {
        fromBlock: "0x0",
        toBlock: "latest",
        category: ["erc721", "erc1155", "internal"], // Deep scan: include erc1155 and internal transfers
        withMetadata: true,
        maxCount: "0x3e8",
        order: "desc",
        excludeZeroValue: false // Include zero value transfers just in case
    };


    const [inRes, outRes] = await Promise.all([
        fetchAllTransfers({ ...baseParams, toAddress: addr }, "incoming", 10000),
        fetchAllTransfers({ ...baseParams, fromAddress: addr }, "outgoing", 10000)
    ]);

    const allFiltered = [...inRes.data, ...outRes.data].filter(t => t.contractAddress && t.tokenId);
    const earliest = allFiltered.length > 0 ? new Date(Math.min(...allFiltered.map(t => t.timestamp.getTime()))) : new Date();
    const latest = allFiltered.length > 0 ? new Date(Math.max(...allFiltered.map(t => t.timestamp.getTime()))) : new Date();

    const result = {
        received: inRes.data.filter(t => t.contractAddress && t.tokenId).sort((a, b) => a.blockNum - b.blockNum),
        sent: outRes.data.filter(t => t.contractAddress && t.tokenId).sort((a, b) => a.blockNum - b.blockNum),
        earliest,
        latest,
        stats: {
            isPartial: inRes.hitCap || outRes.hitCap,
            incomingTransfersScanned: inRes.count,
            outgoingTransfersScanned: outRes.count,
            hitIncomingCap: inRes.hitCap,
            hitOutgoingCap: outRes.hitCap
        }
    };

    transferCache.set(cacheKey, { ...result, timestamp: Date.now() });
    return result;
}

export async function getWalletMarketSales(walletAddress: string, limit: number = 2000): Promise<AlchemyMarketSale[]> {
    const addr = walletAddress.toLowerCase();
    const cached = marketSalesCache.get(addr);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.sales;
    }

    const pageCap = Math.max(1, Math.ceil(limit / 1000));

    // Alchemy returns all supported NFT marketplaces when no marketplace filter is set:
    // Seaport, Wyvern, X2Y2, Blur, LooksRare, and CryptoPunks.
    const [buySales, sellSales] = await Promise.all([
        fetchAllMarketSales({ buyerAddress: addr }, `buyer:${addr}`, pageCap),
        fetchAllMarketSales({ sellerAddress: addr }, `seller:${addr}`, pageCap)
    ]);

    const deduped = new Map<string, AlchemyMarketSale>();
    for (const sale of [...buySales, ...sellSales]) {
        const key = [
            sale.txHash.toLowerCase(),
            sale.logIndex,
            sale.bundleIndex,
            sale.contractAddress,
            sale.tokenId.toLowerCase(),
            sale.buyerAddress,
            sale.sellerAddress
        ].join(':');
        deduped.set(key, sale);
    }

    const sales = Array.from(deduped.values()).sort((a, b) => {
        if (a.blockNum !== b.blockNum) return a.blockNum - b.blockNum;
        if (a.logIndex !== b.logIndex) return a.logIndex - b.logIndex;
        return a.bundleIndex - b.bundleIndex;
    });

    marketSalesCache.set(addr, { sales, timestamp: Date.now() });
    return sales;
}

export async function getNFTsForOwner(walletAddress: string): Promise<NormalizedNFT[]> {
    try {
        const resp = await axios.get(ALCHEMY_V3_URL, {
            params: { owner: walletAddress, withMetadata: true },
            timeout: 10000
        });

        const nfts = resp.data.ownedNfts || [];
        return nfts.map((nft: any) => ({
            contract_address: nft.contract?.address?.toLowerCase() || '',
            token_id: nft.tokenId || '',
            collection_name: nft.collection?.name || nft.contract?.name || 'Unknown',
            image_url: nft.image?.cachedUrl || nft.rawMetadata?.image || null
        }));
    } catch {
        return [];
    }
}

export async function getNFTMetadataBatch(tokens: { contractAddress: string, tokenId: string }[]) {
    const results = new Map<string, { collection: string | null, image: string | null }>();
    if (tokens.length === 0) return results;

    try {
        const url = `https://eth-mainnet.g.alchemy.com/nft/v3/${process.env.ALCHEMY_API_KEY}/getNFTMetadataBatch`;

        const chunkSize = 100;
        const chunks = [];
        for (let i = 0; i < tokens.length; i += chunkSize) {
            chunks.push(tokens.slice(i, i + chunkSize));
        }

        await Promise.all(chunks.map(async (chunk) => {
            try {
                const resp = await axios.post(url, { tokens: chunk }, { timeout: 10000 });
                const nfts = resp.data?.nfts || [];
                for (const nft of nfts) {
                    const contract = nft.contract?.address?.toLowerCase();
                    const tokenId = nft.tokenId;

                    if (contract && tokenId) {
                        const fallbackName = nft.contract?.name || nft.collection?.name || null;
                        const fallbackImg = nft.image?.cachedUrl || nft.rawMetadata?.image || nft.contract?.openSeaMetadata?.imageUrl || null;

                        results.set(`${contract.toLowerCase()}:${tokenId.toLowerCase()}`, {
                            collection: fallbackName,
                            image: fallbackImg
                        });
                    }
                }
            } catch (err) {
                console.error("[alchemy] metadata chunk fetch failed");
            }
        }));
        return results;
    } catch (e: any) {
        console.error("[alchemy] metadata batch fetch failed", e.message);
        return results;
    }
}

const txValueCache = new Map<string, number>();

export async function getTxValueEth(txHash: string): Promise<number> {
    if (!txHash) return 0;
    if (txValueCache.has(txHash)) return txValueCache.get(txHash)!;
    try {
        const resp = await axios.post(ALCHEMY_RPC, {
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getTransactionByHash",
            params: [txHash]
        }, { timeout: 10000 });
        const valHex = resp.data?.result?.value;
        if (!valHex) return 0;
        const wei = BigInt(valHex);
        const valEth = Number(wei) / 1e18;
        txValueCache.set(txHash, valEth);
        return valEth;
    } catch (err: any) {
        console.warn(`[alchemy] Failed to fetch tx value for ${txHash}: ${err.message}`);
        return 0;
    }
}
