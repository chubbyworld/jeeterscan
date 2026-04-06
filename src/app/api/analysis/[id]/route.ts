import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
    _req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const analysis = await prisma.walletAnalysis.findUnique({
            where: { id: params.id },
            include: { trades: { orderBy: { missedProfitEth: 'desc' } } },
        });

        if (!analysis) {
            return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
        }

        const analysisData = analysis as any;
        const trades = analysis.trades;
        const walletTradingVolume = analysisData.walletTradingVolume || 0;
        const openseaFeesPaid = analysisData.openseaFeesPaid || 0;

        const responseData = {
            analysis: {
                id: analysis.id,
                walletAddress: analysis.walletAddress,
                status: analysis.status,
                completedPairs: analysis.completedPairs,
                pricedTrades: analysis.pricedTrades,

                confirmedMissedEth: analysisData.confirmedMissedEth || 0,
                confirmedMissedUsd: analysisData.confirmedMissedUsd || 0,
                estimatedMissedEth: analysisData.estimatedMissedEth || 0,
                estimatedMissedUsd: analysisData.estimatedMissedUsd || 0,
                maxRegretEth: analysisData.maxRegretEth || 0,
                maxRegretUsd: analysisData.maxRegretUsd || 0,

                walletTradingVolume: analysisData.walletTradingVolume || 0,
                walletTradingVolumeUsd: analysisData.walletTradingVolumeUsd || 0,
                openseaFeesPaid: analysisData.openseaFeesPaid || 0,
                openseaFeesUsd: analysisData.openseaFeesUsd || 0,
                estimatedRoyaltyFeesPaid: analysisData.estimatedRoyaltyFeesPaid || 0,
                estimatedRoyaltyFeesUsd: analysisData.estimatedRoyaltyFeesUsd || 0,

                incomingTransfersScanned: (analysis as any).incomingTransfersScanned,
                outgoingTransfersScanned: (analysis as any).outgoingTransfersScanned,
                collectionsAnalyzed: (analysis as any).collectionsAnalyzed,
                coverageLabel: (analysis as any).coverageLabel,
                earliestRelevantTradeDate: (analysis as any).earliestRelevantTradeDate,
                latestRelevantTradeDate: (analysis as any).latestRelevantTradeDate,
                createdAt: (analysis as any).startedAt,
                finishedAt: (analysis as any).finishedAt
            },
            trades: trades.map((t: any) => ({
                id: t.id,
                contractAddress: t.contractAddress,
                tokenId: t.tokenId,
                collectionName: t.collectionName,
                imageUrl: t.imageUrl,
                acquisitionType: t.acquisitionType,
                acquisitionCostEth: t.acquisitionCostEth,
                buyTimestamp: t.buyTimestamp,
                sellPriceEth: t.sellPriceEth,
                sellTimestamp: t.sellTimestamp,
                heldDurationDays: t.heldDurationDays,
                peakPriceAfterSale: t.peakPriceAfterSale,
                peakTimestamp: t.peakTimestamp,
                daysToPeak: t.daysToPeak,
                missedProfitEth: t.missedProfitEth,
                confidence: t.confidence,
                pricingSource: t.pricingSource,
                pricingMode: t.pricingMode,
                openseaUrl: `https://opensea.io/assets/ethereum/${t.contractAddress}/${t.tokenId}`
            }))
        };

        return NextResponse.json(responseData);
    } catch (err: any) {
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
