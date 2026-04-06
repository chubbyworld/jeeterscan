-- Jeeter: NFT Analytics DB Schema
-- Run this in Supabase SQL Editor (supabase.com → your project → SQL Editor)

CREATE TABLE IF NOT EXISTS "WalletAnalysis" (
  "id"               TEXT NOT NULL,
  "walletAddress"    TEXT NOT NULL,
  "totalMissedEth"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalRealizedEth" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "nftTradesCount"   INTEGER NOT NULL DEFAULT 0,
  "status"           TEXT NOT NULL DEFAULT 'pending',
  "errorMessage"     TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "NFTTrade" (
  "id"                 TEXT NOT NULL,
  "analysisId"         TEXT NOT NULL,
  "collectionName"     TEXT NOT NULL,
  "contractAddress"    TEXT NOT NULL,
  "tokenId"            TEXT NOT NULL,
  "buyPriceEth"        DOUBLE PRECISION NOT NULL,
  "sellPriceEth"       DOUBLE PRECISION NOT NULL,
  "sellTimestamp"      TIMESTAMP(3) NOT NULL,
  "peakPriceAfterSale" DOUBLE PRECISION NOT NULL,
  "missedProfitEth"    DOUBLE PRECISION NOT NULL,
  "imageUrl"           TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NFTTrade_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CollectionSaleCache" (
  "id"              TEXT NOT NULL,
  "contractAddress" TEXT NOT NULL,
  "fetchedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "salesData"       JSONB NOT NULL,
  CONSTRAINT "CollectionSaleCache_pkey" PRIMARY KEY ("id")
);

-- Foreign Key
ALTER TABLE "NFTTrade"
  ADD CONSTRAINT "NFTTrade_analysisId_fkey"
  FOREIGN KEY ("analysisId")
  REFERENCES "WalletAnalysis"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes
CREATE INDEX IF NOT EXISTS "WalletAnalysis_walletAddress_idx" ON "WalletAnalysis"("walletAddress");
CREATE INDEX IF NOT EXISTS "NFTTrade_analysisId_idx"           ON "NFTTrade"("analysisId");
CREATE INDEX IF NOT EXISTS "CollectionSaleCache_contractAddress_idx" ON "CollectionSaleCache"("contractAddress");
