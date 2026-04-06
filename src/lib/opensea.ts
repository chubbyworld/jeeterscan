import axios from 'axios';

const OPENSEA_BASE = 'https://api.opensea.io/api/v2';
const headers = {
    'X-API-KEY': process.env.OPENSEA_API_KEY!,
    'accept': 'application/json'
};

export interface SaleEvent {
    priceEth: number;
    timestamp: Date;
    buyer: string;
    seller: string;
    txHash: string;
    rawMaker?: string;
    rawTaker?: string;
}

const salesCache = new Map<string, { events: SaleEvent[]; timestamp: number }>();
const colSalesCache = new Map<string, { peak: number; floor: number; timestamp: number }>();
const CACHE_TTL_MS = 1000 * 60 * 15; // 15 mins
const COLLECTION_FAILURE_THRESHOLD = 3;
const COLLECTION_CIRCUIT_COOLDOWN_MS = 1000 * 60 * 5;

let consecutiveCollectionFailures = 0;
let collectionCircuitOpenUntil = 0;

export function normalizeTokenId(rawTokenId: string): string {
    const raw = rawTokenId.trim().toLowerCase();
    if (raw.startsWith('0x')) {
        try {
            return BigInt(raw).toString(10);
        } catch {
            return raw;
        }
    }
    const cleaned = raw.replace(/^0+/, '');
    return cleaned === '' ? '0' : cleaned;
}

export interface PricingContext {
    wallet: string;
    buyTs: Date;
    sellTs: Date;
    index: number;
}

export async function getTokenSales(contractAddress: string, rawTokenId: string, ctx?: PricingContext): Promise<SaleEvent[]> {
    const tokenId = normalizeTokenId(rawTokenId);

    const shouldLog = ctx && ctx.index < 10;

    let url = '';
    let fetchedEvents = 0;

    const key = `${contractAddress.toLowerCase()}:${tokenId}`;

    let attempts = 0;
    while (attempts < 2) {
        try {
            url = `${OPENSEA_BASE}/events/chain/ethereum/contract/${contractAddress.toLowerCase()}/nfts/${tokenId}`;

            if (shouldLog) {
                console.log(`[pricing] contract address: ${contractAddress}`);
                console.log(`[pricing] raw token id: ${rawTokenId}`);
                console.log(`[pricing] normalized token id: ${tokenId}`);
                console.log(`[pricing] request url: ${url}`);
            }

            const resp = await axios.get(url, {
                headers,
                params: { event_type: 'sale', limit: 100 },
                timeout: 10000
            });

            const rawEvents: any[] = resp.data?.asset_events || [];
            fetchedEvents = rawEvents.length;

            if (shouldLog) {
                console.log(`[pricing] events returned: ${fetchedEvents}`);
            }

            const events = rawEvents.map((ev: any) => {
                const priceWei = BigInt(ev.payment?.quantity || ev.sale_price || '0');
                const decimals = ev.payment?.decimals ?? 18;
                const priceEth = Number(priceWei) / Math.pow(10, decimals);

                const tsStr = ev.closing_date || ev.event_timestamp;
                const timestamp = typeof tsStr === 'number' ? new Date(tsStr * 1000) : new Date(tsStr || 0);

                const rawBuyer = (ev.buyer || ev.taker || '').toLowerCase();
                const rawSeller = (ev.seller || ev.maker || '').toLowerCase();

                return {
                    priceEth,
                    timestamp,
                    buyer: rawBuyer,
                    seller: rawSeller,
                    rawMaker: (ev.maker || '').toLowerCase(),
                    rawTaker: (ev.taker || '').toLowerCase(),
                    txHash: ev.transaction?.transaction_hash || ev.transaction_hash || ''
                };
            }).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

            salesCache.set(key, { events, timestamp: Date.now() });
            return events;
        } catch (err: any) {
            attempts++;
            const status = err?.response?.status;
            if (shouldLog) {
                console.log(`[pricing] OS Fetch fail attempt ${attempts}:`, err.message, status);
            }
            if (status === 429) {
                await sleep(Math.pow(2, attempts) * 800 + Math.random() * 200);
            }
            if (attempts >= 3) return [];
        }
    }
    return [];
}

export async function getCollectionFloorPrice(slug: string): Promise<number> {
    try {
        const resp = await axios.get(`${OPENSEA_BASE}/collections/${slug}/stats`, { headers });
        return resp.data?.total?.floor_price ?? 0;
    } catch {
        return 0;
    }
}

export async function getCollectionSlug(contractAddress: string): Promise<string | null> {
    try {
        const resp = await axios.get(
            `${OPENSEA_BASE}/chain/ethereum/contract/${contractAddress}`,
            { headers }
        );
        return resp.data?.collection ?? null;
    } catch {
        return null;
    }
}

/** Fetches sale events for a whole collection contract once and returns top-level stats.
 *  Used as first-pass pricing so we don't need per-token requests for every NFT.
 *  pricingMode = "collection" on records that use this path.
 */
export interface CollectionMarketSummary {
    slug: string | null;
    floor: number;
    /** Peak single-sale price in the 100 most-recent sale events */
    recentPeak: number;
    /** All parsed sale events sorted ascending by timestamp */
    events: SaleEvent[];
}

function emptyCollectionMarketSummary(slug: string | null = null, floor = 0): CollectionMarketSummary {
    return { slug, floor, recentPeak: floor, events: [] };
}

export async function getCollectionMarketHistory(
    contractAddress: string
): Promise<CollectionMarketSummary> {
    const key = contractAddress.toLowerCase();
    const cached = colSalesCache.get(key);
    // Cache collection level for 1 hour (4 × 15 min TTL)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS * 4) {
        return { slug: null, floor: cached.floor, recentPeak: cached.peak, events: [] };
    }

    if (Date.now() < collectionCircuitOpenUntil) {
        return emptyCollectionMarketSummary();
    }

    let floor = 0;
    let recentPeak = 0;
    let slug: string | null = null;
    let events: SaleEvent[] = [];

    try {
        slug = await getCollectionSlug(contractAddress);
        if (slug) {
            floor = await getCollectionFloorPrice(slug);
        }
    } catch {
        // ignore slug fetch failures
    }

    let attempts = 0;
    while (attempts < 2) {
        try {
            const eventsUrl = `${OPENSEA_BASE}/events/chain/ethereum/contract/${key}`;
            const resp = await axios.get(eventsUrl, {
                headers,
                params: { event_type: 'sale', limit: 100 },
                timeout: 8000,
            });

            const rawEvents: any[] = resp.data?.asset_events || [];
            events = rawEvents.map((ev: any) => {
                const priceWei = BigInt(ev.payment?.quantity || ev.sale_price || '0');
                const decimals = ev.payment?.decimals ?? 18;
                const priceEth = Number(priceWei) / Math.pow(10, decimals);
                const tsStr = ev.closing_date || ev.event_timestamp;
                const timestamp = typeof tsStr === 'number' ? new Date(tsStr * 1000) : new Date(tsStr || 0);
                const rawBuyer = (ev.buyer || ev.taker || '').toLowerCase();
                const rawSeller = (ev.seller || ev.maker || '').toLowerCase();
                return {
                    priceEth,
                    timestamp,
                    buyer: rawBuyer,
                    seller: rawSeller,
                    rawMaker: (ev.maker || '').toLowerCase(),
                    rawTaker: (ev.taker || '').toLowerCase(),
                    txHash: ev.transaction?.transaction_hash || ev.transaction_hash || '',
                };
            }).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

            for (const ev of events) {
                if (ev.priceEth > recentPeak) recentPeak = ev.priceEth;
            }
            // If current floor is above recent peak, use floor as the peak estimate
            if (floor > recentPeak) recentPeak = floor;
            consecutiveCollectionFailures = 0;
            break;
        } catch (err: any) {
            attempts++;
            if (err?.response?.status === 429) {
                await sleep(1000 * attempts);
            }
            if (attempts >= 2) {
                consecutiveCollectionFailures++;
                if (consecutiveCollectionFailures >= COLLECTION_FAILURE_THRESHOLD) {
                    collectionCircuitOpenUntil = Date.now() + COLLECTION_CIRCUIT_COOLDOWN_MS;
                    console.warn(
                        `[opensea] Collection history circuit opened for ${Math.round(COLLECTION_CIRCUIT_COOLDOWN_MS / 1000)}s after ${consecutiveCollectionFailures} consecutive failures`
                    );
                }
                console.warn(`[opensea] Failed to fetch market history for ${key} after ${attempts} attempts`);
            }
        }
    }

    colSalesCache.set(key, { peak: recentPeak, floor, timestamp: Date.now() });
    return { slug, floor, recentPeak, events };
}

/** Returns the peak sale price that occurred WITHIN a window (maxDays) after sale.
 *  Includes simple outlier filtering to ignore obvious wash trades or data glitches.
 */
export interface PeakResult {
    peak: number;
    timestamp: Date | null;
}

export function collectionPeakForensic(events: SaleEvent[], afterTs: Date, maxDays: number = 30): PeakResult {
    if (!events || events.length === 0) return { peak: 0, timestamp: null };

    // 1. Basic outlier mitigation: calculate median
    const prices = events.map(e => e.priceEth).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];

    let peak = 0;
    let peakTs: Date | null = null;
    const startMs = afterTs.getTime();
    const endMs = maxDays === 0 ? Infinity : startMs + (maxDays * 86400000);

    for (const ev of events) {
        const evMs = ev.timestamp.getTime();
        if (evMs > startMs && evMs <= endMs) {
            // Filter: Ignore if > 25x median (extreme outlier / wash trade)
            if (median > 0 && ev.priceEth > median * 25) continue;

            if (ev.priceEth > peak) {
                peak = ev.priceEth;
                peakTs = ev.timestamp;
            }
        }
    }
    return { peak, timestamp: peakTs };
}

/** Legacy wrapper */
export function collectionPeakAfter(events: SaleEvent[], afterTs: Date): number {
    return collectionPeakForensic(events, afterTs, 0).peak;
}

/** Small async sleep helper for rate-limit backoff. */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
