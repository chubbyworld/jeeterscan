-- CreateTable
CREATE TABLE "WalletAnalysis" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "completedPairs" INTEGER NOT NULL DEFAULT 0,
    "pricedTrades" INTEGER NOT NULL DEFAULT 0,
    "confirmedMissedEth" DOUBLE PRECISION DEFAULT 0,
    "confirmedMissedUsd" DOUBLE PRECISION DEFAULT 0,
    "estimatedMissedEth" DOUBLE PRECISION DEFAULT 0,
    "estimatedMissedUsd" DOUBLE PRECISION DEFAULT 0,
    "maxRegretEth" DOUBLE PRECISION DEFAULT 0,
    "maxRegretUsd" DOUBLE PRECISION DEFAULT 0,
    "walletTradingVolume" DOUBLE PRECISION DEFAULT 0,
    "walletTradingVolumeUsd" DOUBLE PRECISION DEFAULT 0,
    "openseaFeesPaid" DOUBLE PRECISION DEFAULT 0,
    "openseaFeesUsd" DOUBLE PRECISION DEFAULT 0,
    "earliestRelevantTradeDate" TIMESTAMP(3),
    "latestRelevantTradeDate" TIMESTAMP(3),
    "incomingTransfersScanned" INTEGER NOT NULL DEFAULT 0,
    "outgoingTransfersScanned" INTEGER NOT NULL DEFAULT 0,
    "unmatchedInCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedOutCount" INTEGER NOT NULL DEFAULT 0,
    "diagnosticReport" JSONB,
    "collectionsAnalyzed" INTEGER NOT NULL DEFAULT 0,
    "coverageLabel" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "WalletAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NFTTrade" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION DEFAULT 1,
    "collectionName" TEXT,
    "imageUrl" TEXT,
    "acquisitionType" TEXT,
    "acquisitionEvidence" TEXT,
    "acquisitionCostEth" DOUBLE PRECISION,
    "buyTimestamp" TIMESTAMP(3),
    "sellPriceEth" DOUBLE PRECISION,
    "sellTimestamp" TIMESTAMP(3),
    "heldDurationDays" INTEGER,
    "dispositionType" TEXT,
    "dispositionEvidence" TEXT,
    "matchingReason" TEXT,
    "confidenceScore" DOUBLE PRECISION DEFAULT 0.5,
    "peakPriceAfterSale" DOUBLE PRECISION,
    "peakTimestamp" TIMESTAMP(3),
    "daysToPeak" INTEGER,
    "missedProfitEth" DOUBLE PRECISION,
    "confidence" TEXT NOT NULL DEFAULT 'Medium',
    "pricingSource" TEXT NOT NULL DEFAULT 'collection_floor',
    "pricingMode" TEXT NOT NULL DEFAULT 'collection',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NFTTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionSaleCache" (
    "id" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "salesData" JSONB NOT NULL,

    CONSTRAINT "CollectionSaleCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletAnalysis_walletAddress_idx" ON "WalletAnalysis"("walletAddress");

-- CreateIndex
CREATE INDEX "NFTTrade_analysisId_idx" ON "NFTTrade"("analysisId");

-- CreateIndex
CREATE INDEX "CollectionSaleCache_contractAddress_idx" ON "CollectionSaleCache"("contractAddress");

-- AddForeignKey
ALTER TABLE "NFTTrade" ADD CONSTRAINT "NFTTrade_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "WalletAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
