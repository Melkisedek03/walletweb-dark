// Local pending ledger. This stores only public transaction data:
// txids, outpoints, values, and raw hex of transactions this browser
// broadcast. It never stores mnemonics or private keys.
//
// Purpose: a change output from a broadcast transaction is not in the
// confirmed UTXO set until a block confirms it. Without this ledger
// the wallet would look empty after a send and could not be used
// again until the next block. With it, unconfirmed change can be
// spent again, and inputs already spent by a pending transaction
// stay locked so they are not spent twice.

export interface PendingSpent {
  txid: string;
  vout: number;
  value: number;
}

export interface PendingChange {
  txid: string;
  vout: number;
  value: number;
  address: string;
}

export interface PendingTx {
  txid: string;
  hex: string;
  spent: PendingSpent[];
  change: PendingChange | null;
  createdAt: number;
}

export interface PendingUtxo {
  txid: string;
  outputIndex: number;
  satoshis: number;
  parentHex: string;
  isPending: true;
}

const STORAGE_KEY = 'nux_pending_v1';

type Ledger = Record<string, PendingTx[]>;

function loadLedger(): Ledger {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Ledger;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveLedger(ledger: Ledger): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
  } catch {
    // Storage full or unavailable: pending tracking is best-effort.
    // The confirmed UTXO set remains the source of truth.
  }
}

export function getPendingTxs(address: string): PendingTx[] {
  return loadLedger()[address] ?? [];
}

export function addPendingTx(address: string, tx: PendingTx): void {
  const ledger = loadLedger();
  const list = ledger[address] ?? [];
  ledger[address] = [...list.filter((t) => t.txid !== tx.txid), tx];
  saveLedger(ledger);
}

export function removePendingTx(address: string, txid: string): void {
  const ledger = loadLedger();
  const list = ledger[address] ?? [];
  ledger[address] = list.filter((t) => t.txid !== txid);
  if (ledger[address].length === 0) delete ledger[address];
  saveLedger(ledger);
}

// Outpoints spent by pending transactions for this address.
export function getLockedOutpoints(address: string): Set<string> {
  const locked = new Set<string>();
  for (const tx of getPendingTxs(address)) {
    for (const s of tx.spent) locked.add(`${s.txid}:${s.vout}`);
  }
  return locked;
}

// Change outputs from pending transactions, usable as inputs.
export function getPendingUtxos(address: string): PendingUtxo[] {
  const utxos: PendingUtxo[] = [];
  for (const tx of getPendingTxs(address)) {
    if (tx.change) {
      utxos.push({
        txid: tx.change.txid,
        outputIndex: tx.change.vout,
        satoshis: tx.change.value,
        parentHex: tx.hex,
        isPending: true,
      });
    }
  }
  return utxos;
}
