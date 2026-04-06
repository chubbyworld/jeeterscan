import axios from 'axios';

const RESERVOIR_BASE = 'https://api.reservoir.tools';
const headers = {
    'X-API-KEY': process.env.RESERVOIR_API_KEY || 'demo-api-key', // Use demo key if none provided
    'accept': 'application/json'
};

export interface ReservoirActivity {
    type: 'ask' | 'bid' | 'transfer' | 'sale' | 'mint' | 'burn';
    fromAddress: string;
    toAddress: string;
    price: number;
    amount: number;
    timestamp: number;
    txHash: string;
    contract: string;
    tokenId: string;
    collectionId: string;
    collectionName: string;
    tokenImage: string;
}

/** 
 * High-Performance Deep Scan of User History
 * Fetches ALL-TIME activity for a wallet including sales, mints, and transfers.
 * Automatically handles pagination via continuation tokens.
 */
export async function getWalletActivityDeepScan(walletAddress: string, limit: number = 1000): Promise<ReservoirActivity[]> {
    const addr = walletAddress.toLowerCase();
    let allActivities: ReservoirActivity[] = [];
    let continuation: string | undefined = undefined;
    let fetchedCount = 0;

    console.log(`[reservoir] Starting deep scan for ${addr}...`);

    try {
        do {
            const resp: any = await axios.get(`${RESERVOIR_BASE}/users/${addr}/activity/v5`, {
                headers,
                params: {
                    limit: 1000, // Reservoir max is 1000 per page for activity
                    types: ['sale', 'mint', 'transfer'],
                    continuation: continuation
                },
                timeout: 15000
            });

            const activities = resp.data?.activities || [];
            if (activities.length === 0) break;

            const normalized = activities.map((a: any) => ({
                type: a.type,
                fromAddress: (a.fromAddress || '').toLowerCase(),
                toAddress: (a.toAddress || '').toLowerCase(),
                price: a.price?.amount?.decimal || 0,
                amount: Number(a.amount || 1),
                timestamp: a.timestamp, // in seconds
                txHash: a.txHash,
                block: a.block,
                contract: (a.contract || '').toLowerCase(),

                tokenId: a.token?.tokenId || '',
                collectionId: a.collection?.collectionId || '',
                collectionName: a.collection?.collectionName || 'Unknown',
                tokenImage: a.token?.tokenImage || ''
            }));

            allActivities = allActivities.concat(normalized);
            continuation = resp.data?.continuation;
            fetchedCount += normalized.length;

            console.log(`[reservoir] Fetched ${fetchedCount} activities (Continuation: ${continuation || 'None'})`);

            // Safety cap to prevent infinite loop or memory blowup on crazy whale wallets
            if (fetchedCount >= limit) {
                console.warn(`[reservoir] Hit activity limit (${limit}). History may be partial.`);
                break;
            }

        } while (continuation);

        return allActivities;
    } catch (err: any) {
        console.error(`[reservoir] Deep scan failed: ${err.message}`);
        // Fallback to empty list or throw depending on error handling preference
        return allActivities;
    }
}

/** 
 * Fetch Peak Price for a specific token AFTER a sale timestamp.
 * Used for high-precision "Confirmed Regret" analysis.
 */
/**
 * Fetch the highest resale price for a specific token AFTER a sale timestamp.
 * Only considers sales within `maxDays` of the sell event (default: 365 days).
 * This prevents a resale years later from being reported as a "Confirmed" regret.
 */
export async function getTokenPeakAfterSale(
    contract: string,
    tokenId: string,
    afterTsSec: number,
    maxDays: number = 365
): Promise<{ peak: number, timestamp: number }> {
    try {
        const resp = await axios.get(`${RESERVOIR_BASE}/tokens/${contract}:${tokenId}/activity/v3`, {
            headers,
            params: {
                types: 'sale',
                limit: 100
            },
            timeout: 8000
        });

        const sales = resp.data?.activities || [];
        let peak = 0;
        let peakTs = 0;

        // Hard cutoff: only sales within the window after the sell event
        const cutoffTsSec = afterTsSec + (maxDays * 86400);

        for (const s of sales) {
            const price = s.price?.amount?.decimal || 0;
            const ts = s.timestamp;
            if (ts > afterTsSec && ts <= cutoffTsSec && price > peak) {
                peak = price;
                peakTs = ts;
            }
        }

        return { peak, timestamp: peakTs };
    } catch {
        return { peak: 0, timestamp: 0 };
    }
}
