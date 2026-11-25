import { fetchTxHex } from './electrs';
import type { UTXO } from './transaction';

// Local UTXO cache. Stores only public transaction data (txids,
// outpoints, values, and parent hex for legacy inputs). It never
// stores mnemonics or private keys.
//
// Purpose: the send form can build and sign a transaction while
// offline, from the last spendable set seen while online. The cache
// is refreshed whenever the wallet is online (balance refresh and
// send-form UTXO load) and after every own broadcast, following the
// offline-cache pattern proven by the NUX Connect M9 work. It is
// only as fresh as the last online moment: there is no promise of
// absolute freshness while offline, and the outspend check before
// broadcast is what catches a stale input.
export interface CachedUtxoSet {
  savedAt: number;
  utxos: UTXO[];
}

const STORAGE_KEY = 'nux_utxo_cache_v1';

type Cache = Record<string, CachedUtxoSet>;

function loadCache(): Cache {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Cache;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveCache(cache: Cache): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Storage full or unavailable: the cache is best-effort. The
    // online UTXO set remains the source of truth.
  }
}

export function loadUtxoCache(address: string): CachedUtxoSet | null {
  return loadCache()[address] ?? null;
}

export function saveUtxoCache(address: string, utxos: UTXO[]): void {
  const cache = loadCache();
  cache[address] = { savedAt: Date.now(), utxos };
  saveCache(cache);
}

export function clearUtxoCache(address: string): void {
  const cache = loadCache();
  delete cache[address];
  saveCache(cache);
}

// Save the spendable set for offline use. Legacy (P2PKH) inputs need
// the full parent transaction hex to sign, so for legacy UTXOs that
// lack it the parent hex is fetched now, while online. Parent hex
// already in the cache is reused, so a refresh only fetches parents
// of genuinely new UTXOs. Best-effort throughout: a failed parent
// fetch keeps the UTXO without parent hex instead of failing the
// save, and this function never throws.
export async function cacheSpendableUtxos(
  address: string,
  isBech32: boolean,
  utxos: UTXO[],
): Promise<void> {
  try {
    let withParents = utxos;
    if (!isBech32) {
      const previous = loadUtxoCache(address);
      const knownParents = new Map<string, string>();
      for (const u of previous?.utxos ?? []) {
        if (u.parentHex) knownParents.set(`${u.txid}:${u.outputIndex}`, u.parentHex);
      }
      const filled = await Promise.all(
        utxos.map(async (u) => {
          if (u.parentHex) return u;
          const known = knownParents.get(`${u.txid}:${u.outputIndex}`);
          if (known) return { ...u, parentHex: known };
          try {
            const parentHex = await fetchTxHex(u.txid);
            return { ...u, parentHex };
          } catch {
            return u;
          }
        }),
      );
      withParents = filled;
    }
    saveUtxoCache(address, withParents);
  } catch {
    // Cache failure must never block sending or balance refresh.
  }
}

// Apply a signed (but not yet broadcast) transaction to the cached
// set, so a later offline send does not reuse its inputs: the spent
// outpoints are removed and the change output is added with the
// signed transaction as its parent hex. Used for chained offline
// sends; the online refresh rebuilds the cache from a fresh scan.
export function applySignedTxToCache(
  address: string,
  spent: Array<{ txid: string; vout: number }>,
  change: { txid: string; vout: number; value: number; address: string } | null,
  hex: string,
): void {
  const cached = loadUtxoCache(address);
  if (!cached) return;
  const spentKeys = new Set(spent.map((s) => `${s.txid}:${s.vout}`));
  const utxos = cached.utxos.filter((u) => !spentKeys.has(`${u.txid}:${u.outputIndex}`));
  if (change) {
    utxos.push({
      txid: change.txid,
      outputIndex: change.vout,
      satoshis: change.value,
      script: '',
      parentHex: hex,
      isPending: true,
    });
  }
  saveUtxoCache(address, utxos);
}
