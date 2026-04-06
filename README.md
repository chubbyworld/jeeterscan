# Jeeter — NFT Analytics MVP

**Scan any Ethereum wallet. Find every NFT sold too early. Calculate the missed profit.**

---

## 🗂 Project Structure

```
paperhand/
├── prisma/
│   └── schema.prisma          # DB schema (WalletAnalysis, NFTTrade, CollectionSaleCache)
├── src/
│   ├── app/
│   │   ├── layout.tsx         # Root layout (navbar)
│   │   ├── page.tsx           # Home — wallet input
│   │   ├── globals.css        # Full design system
│   │   ├── analysis/[id]/
│   │   │   └── page.tsx       # Results page (polling + table)
│   │   ├── leaderboard/
│   │   │   └── page.tsx       # Paperhand leaderboard
│   │   └── api/
│   │       ├── analyze-wallet/route.ts   # POST → start analysis
│   │       ├── analysis/[id]/route.ts    # GET → fetch results
│   │       └── leaderboard/route.ts      # GET → top wallets
│   └── lib/
│       ├── prisma.ts          # Prisma singleton
│       ├── firebase.ts        # Firebase init
│       ├── alchemy.ts         # NFT transfer fetching
│       ├── opensea.ts         # Peak price queries
│       └── analyzer.ts        # Core analysis engine
└── .env                       # All API keys (pre-filled)
```

---

## ⚙️ Setup

### 1. Database — PostgreSQL
You need a PostgreSQL database. Options:
- **Local**: Install PostgreSQL, create a DB called `jeeter`
- **Cloud**: [Supabase](https://supabase.com) (free), [Railway](https://railway.app), or [Neon](https://neon.tech)

Edit `.env` and update `DATABASE_URL`:
```
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/jeeter?schema=public"
```

### 2. Run Prisma migrations
```bash
npx prisma migrate dev --name init
npx prisma generate
```

### 3. Start the dev server
```bash
npm run dev
```

Then open **http://localhost:3000**

---

## 🔑 API Keys (already in .env)

| Key | Value |
|-----|-------|
| Alchemy | `YOUR_ALCHEMY_API_KEY` |
| OpenSea | `YOUR_OPENSEA_API_KEY` |
| Firebase | Pre-configured for YOUR_FIREBASE_PROJECT_ID |

---

## 🔄 How the Analysis Works

```
POST /api/analyze-wallet  { walletAddress }
        │
        ▼
  Alchemy: fetch all ERC-721/1155 transfers IN (buys) and OUT (sells)
        │
        ▼
  Match buy+sell pairs by contractAddress+tokenId
        │
        ▼
  For each pair: fetch ETH values from transaction hashes
        │
        ▼
  OpenSea: query sales events for that token AFTER the sell timestamp
        │
        ▼
  peak_price = max(sale prices after sell)
  missed_profit = max(0, peak_price - sell_price)
        │
        ▼
  Store in PostgreSQL, return via GET /api/analysis/{id}
```

---

## 📡 API Endpoints

### `POST /api/analyze-wallet`
```json
// Request
{ "walletAddress": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" }

// Response 202
{ "analysisId": "clxxx...", "cached": false }
```

### `GET /api/analysis/{id}`
```json
{
  "id": "clxxx...",
  "walletAddress": "0xd8...",
  "status": "done",
  "totalMissedEth": 12.4,
  "totalRealizedEth": 3.2,
  "nftTradesCount": 7,
  "trades": [
    {
      "collectionName": "Azuki",
      "tokenId": "1243",
      "buyPriceEth": 0.8,
      "sellPriceEth": 1.1,
      "peakPriceAfterSale": 3.6,
      "missedProfitEth": 2.5
    }
  ]
}
```

### `GET /api/leaderboard`
Returns top 20 wallets by missed ETH.

---

## 🚀 Deploy to Vercel

```bash
npm install -g vercel
vercel --prod
```

Set the same env vars in Vercel dashboard under **Settings → Environment Variables**.

---

## 🛣 Roadmap
- [ ] ENS name resolution
- [ ] ERC-1155 trade support  
- [ ] Multi-chain (Polygon, Base)
- [ ] Email alerts for watched wallets
- [ ] Mobile-optimized share images (OG card generation)
