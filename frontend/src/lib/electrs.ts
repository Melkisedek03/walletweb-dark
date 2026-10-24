import { ELECTRS_BASE } from './network';

// Esplora-compatible electrs client. This is the only data source for
// the wallet after Phase 2. The base is same-origin (/electrs) so the
// browser talks to nginx, which proxies to the electrs service.

export interface ElectrsStats {
  funded_txo_count: number;
  funded_txo_sum: number;
  spent_txo_count: number;
  spent_txo_sum: number;
  tx_count: number;
}

export interface ElectrsAddress {
  address: string;
  chain_stats: ElectrsStats;
  mempool_stats: ElectrsStats;
}

export interface ElectrsUtxo {
  txid: string;
  vout: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
  value: number;
}

export interface ElectrsVin {
  txid: string;
  vout: number;
  prevout?: {
    scriptpubkey_address?: string;
    value: number;
  };
  scriptsig?: string;
  witness?: string[];
}

export interface ElectrsVout {
  scriptpubkey_address?: string;
  value: number;
}

export interface ElectrsTx {
  txid: string;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_time?: number;
  };
  vin: ElectrsVin[];
  vout: ElectrsVout[];
  fee?: number;
}

// Balance in nusan (satoshis), derived from address stats.
export interface AddressBalance {
  confirmed: number;
  mempool: number;
  available: number;
  received: number;
  sent: number;
}

async function electrsFetch(path: string): Promise<Response> {
  return fetch(`${ELECTRS_BASE}${path}`);
}

async function electrsJson<T>(path: string): Promise<T> {
  const res = await electrsFetch(path);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Electrs error ${res.status} for ${path}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchAddress(address: string): Promise<ElectrsAddress> {
  return electrsJson<ElectrsAddress>(`/address/${encodeURIComponent(address)}`);
}

export async function fetchBalance(address: string): Promise<AddressBalance> {
  const info = await fetchAddress(address);
  const confirmed = info.chain_stats.funded_txo_sum - info.chain_stats.spent_txo_sum;
  const mempool = info.mempool_stats.funded_txo_sum - info.mempool_stats.spent_txo_sum;
  return {
    confirmed,
    mempool,
    available: confirmed + mempool,
    received: info.chain_stats.funded_txo_sum,
    sent: info.chain_stats.spent_txo_sum,
  };
}

export async function fetchUtxos(address: string): Promise<ElectrsUtxo[]> {
  return electrsJson<ElectrsUtxo[]>(`/address/${encodeURIComponent(address)}/utxo`);
}

export async function fetchAddressTxs(address: string): Promise<ElectrsTx[]> {
  const [confirmed, mempool] = await Promise.all([
    electrsJson<ElectrsTx[]>(`/address/${encodeURIComponent(address)}/txs`).catch(() => [] as ElectrsTx[]),
    electrsJson<ElectrsTx[]>(`/address/${encodeURIComponent(address)}/txs/mempool`).catch(() => [] as ElectrsTx[]),
  ]);
  const seen = new Set<string>();
  const merged: ElectrsTx[] = [];
  for (const tx of [...mempool, ...confirmed]) {
    if (!seen.has(tx.txid)) {
      seen.add(tx.txid);
      merged.push(tx);
    }
  }
  return merged;
}

export async function fetchTxHex(txid: string): Promise<string> {
  const res = await electrsFetch(`/tx/${encodeURIComponent(txid)}/hex`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Failed to fetch raw transaction ${txid}`);
  }
  return (await res.text()).trim();
}

export async function fetchTxStatus(txid: string): Promise<ElectrsTx['status'] | null> {
  const res = await electrsFetch(`/tx/${encodeURIComponent(txid)}/status`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Failed to fetch transaction status ${txid}`);
  }
  return res.json() as Promise<ElectrsTx['status']>;
}

// Broadcast: POST raw hex as plain text. The response is a plain-text
// txid on success, or plain-text error on failure. It is not JSON.
export async function broadcastTx(hex: string): Promise<string> {
  const res = await fetch(`${ELECTRS_BASE}/tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: hex,
  });
  const text = (await res.text()).trim();
  if (!res.ok) throw new Error(text || `Broadcast failed (${res.status})`);
  return text;
}
