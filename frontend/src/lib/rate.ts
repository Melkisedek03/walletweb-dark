// Fiat rate lookup (NUX/IDR) from CoinPaprika's public ticker API.
// One direct call, no API key, no two-hop conversion: the IDR quote
// comes straight from the ticker (quotes.IDR.price). The price is
// cached in memory for five minutes, so repeated balance refreshes
// do not hit the API. This is the wallet's only runtime request to a
// third-party host; it carries no wallet data (no address, no
// balance, nothing identifying the user). On any failure (offline,
// timed out, blocked, bad payload) the caller gets null or a stale
// cached price, and the UI simply hides the fiat line — the rate can
// never block the wallet or show an error state.

const COINPAPRIKA_TICKER_URL =
  'https://api.coinpaprika.com/v1/tickers/nux-nusacoin?quotes=IDR';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT_MS = 10_000; // 10 seconds

let cached: { price: number; fetchedAt: number } | null = null;

/** NUX price in IDR, or null when no price is available. */
export async function fetchNuxIdrRate(): Promise<number | null> {
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.price;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(COINPAPRIKA_TICKER_URL, { signal: controller.signal });
      if (!res.ok) return cached?.price ?? null;
      const data = await res.json();
      const price = data?.quotes?.IDR?.price;
      if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
        return cached?.price ?? null;
      }
      cached = { price, fetchedAt: now };
      return price;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Offline, timed out, or blocked: fall back to a stale cached
    // price when one exists, otherwise report no price.
    return cached?.price ?? null;
  }
}

/** Formats a rupiah amount the Indonesian way, e.g. 6263 -> "Rp6.263". */
export function formatIdr(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}
