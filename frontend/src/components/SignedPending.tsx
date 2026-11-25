import { useState } from 'react';
import { broadcastTx, fetchOutspend } from '../lib/electrs';
import {
  getSignedPendingTxs,
  markPendingTxBroadcast,
  removePendingTx,
  type PendingTx,
} from '../lib/pending';
import { clearUtxoCache } from '../lib/utxocache';
import { nusanToNux } from '../lib/transaction';

// Transactions signed offline but not broadcast yet, for one
// address, with Broadcast now / Discard actions. Rendered on the
// Wallet and Legacy screens, where the user lands when back online.
// Reads the pending ledger directly on every render, so it follows
// the parent's 30s/60s balance refresh without its own polling.
interface SignedPendingProps {
  address: string;
  onChanged: () => void;
}

export function SignedPending({ address, onChanged }: SignedPendingProps) {
  const [busyTxid, setBusyTxid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);

  const signed = getSignedPendingTxs(address);
  if (signed.length === 0) return null;

  const handleBroadcast = async (tx: PendingTx) => {
    setError(null);
    setBusyTxid(tx.txid);
    try {
      // Outspend guard: a spent input means the transaction can
      // never confirm. Tell the user to discard it (and clear the
      // cache built from it) instead of broadcasting a doomed
      // transaction.
      for (const input of tx.spent) {
        const outspend = await fetchOutspend(input.txid, input.vout);
        if (outspend.spent) {
          clearUtxoCache(address);
          throw new Error(
            'One input is already spent. Discard this signed transaction and build a new one.',
          );
        }
      }
      await broadcastTx(tx.hex);
      markPendingTxBroadcast(address, tx.txid);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Broadcast failed');
    } finally {
      setBusyTxid(null);
    }
  };

  const handleDiscard = (txid: string) => {
    // Discarding unlocks the inputs. The cache is cleared too: it
    // was updated for the signed transaction, and the next online
    // refresh rebuilds it from a fresh scan.
    removePendingTx(address, txid);
    clearUtxoCache(address);
    setConfirmDiscard(null);
    onChanged();
  };

  return (
    <div className="card bg-yellow-500/10 border border-yellow-600/40 space-y-3">
      <p className="text-sm font-medium text-yellow-300">Signed — not broadcast yet</p>
      {signed.map((tx) => (
        <div
          key={tx.txid}
          className="space-y-2 border-t border-yellow-600/20 pt-3 first:border-t-0 first:pt-0"
        >
          <p className="font-mono text-xs break-all text-dark-200">{tx.txid}</p>
          <p className="text-dark-400 text-xs">
            {new Date(tx.createdAt).toLocaleString()} · {tx.spent.length} input
            {tx.spent.length === 1 ? '' : 's'}
            {tx.change ? ` · change ${nusanToNux(tx.change.value)} NUX` : ''}
          </p>
          {confirmDiscard === tx.txid ? (
            <div className="flex gap-2">
              <button onClick={() => handleDiscard(tx.txid)} className="btn-secondary flex-1">
                Discard it
              </button>
              <button onClick={() => setConfirmDiscard(null)} className="btn-secondary flex-1">
                Keep it
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => void handleBroadcast(tx)}
                disabled={busyTxid === tx.txid}
                className="btn-primary flex-1"
              >
                {busyTxid === tx.txid ? 'Broadcasting…' : 'Broadcast now'}
              </button>
              <button
                onClick={() => setConfirmDiscard(tx.txid)}
                disabled={busyTxid !== null}
                className="btn-secondary flex-1"
              >
                Discard
              </button>
            </div>
          )}
        </div>
      ))}
      {error && <p className="text-red-400 text-sm">{error}</p>}
    </div>
  );
}
