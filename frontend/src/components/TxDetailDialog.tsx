import { useEffect, useState } from 'react';
import { fetchTipHeight, fetchTxStatus, type ElectrsTx } from '../lib/electrs';
import { COIN } from '../lib/network';
import type { PendingTx } from '../lib/pending';
import { formatTime, type HistoryRow } from './History';

// In-app transaction detail dialog. Every value shown comes from
// electrs: the dialog reuses the transaction already fetched for the
// History list and only refreshes its status (plus the tip height
// for the confirmation count) when opened. The only way out to the
// web is the small explorer link at the bottom. The panel uses only
// the shared theme classes (.card, .btn-secondary, dark/nux text
// tokens), so it follows the dark/light theme like the rest of the
// app, with no theme code of its own.

export interface TxDetailDialogProps {
  row: HistoryRow;
  tx?: ElectrsTx;
  pending?: PendingTx;
  ownAddress: string;
  onClose: () => void;
}

function formatNux(nusan: number): string {
  return (nusan / COIN).toFixed(8);
}

// Clipboard write with a plain fallback for browsers without the
// async Clipboard API (older WebViews, non-secure contexts).
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

function AddressLine({ address, value, own }: { address: string; value: number; own: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-dark-700 last:border-b-0">
      <p className={`text-xs break-all ${own ? 'text-nux-400' : 'text-dark-300'}`}>
        {address}
        {own && <span className="ml-2 text-xs font-semibold text-nux-400">You</span>}
      </p>
      <p className="num font-mono text-xs whitespace-nowrap">{formatNux(value)} NUX</p>
    </div>
  );
}

export function TxDetailDialog({ row, tx, pending, ownAddress, onClose }: TxDetailDialogProps) {
  const [copied, setCopied] = useState(false);
  const [liveStatus, setLiveStatus] = useState<ElectrsTx['status'] | null>(tx?.status ?? null);
  const [tipHeight, setTipHeight] = useState<number | null>(null);

  const isReceived = row.incoming > row.outgoing;
  const amount = isReceived ? row.incoming - row.outgoing : row.outgoing - row.incoming;

  // Refresh the status (and the tip height for the confirmation
  // count) when the dialog opens. A failure keeps the list data:
  // the dialog never blocks on this refresh.
  useEffect(() => {
    if (!tx) return;
    let cancelled = false;
    fetchTxStatus(tx.txid)
      .then((s) => { if (!cancelled && s) setLiveStatus(s); })
      .catch(() => { /* keep the list data */ });
    fetchTipHeight()
      .then((h) => { if (!cancelled) setTipHeight(h); })
      .catch(() => { /* confirmations stay hidden */ });
    return () => { cancelled = true; };
  }, [tx]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const status = liveStatus ?? tx?.status ?? null;
  const confirmed = status?.confirmed ?? false;
  const confirmations =
    confirmed && status?.block_height != null && tipHeight != null
      ? Math.max(1, tipHeight - status.block_height + 1)
      : null;

  const onCopy = async () => {
    if (await copyText(row.txid)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Transaction details"
    >
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="card relative w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={`font-medium ${isReceived ? 'text-green-400' : 'text-red-400'}`}>
              {isReceived ? 'Received' : 'Sent'}
            </p>
            <p className="num font-mono text-2xl font-bold mt-1">
              {isReceived ? '+' : '-'}{formatNux(amount)} NUX
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-dark-400 hover:text-ink text-2xl leading-none px-2"
          >
            ×
          </button>
        </div>

        <p className="text-dark-400 text-xs mt-2">
          {confirmed
            ? `Confirmed · Block ${status?.block_height ?? '—'} · ${formatTime(status?.block_time ?? 0)}${confirmations !== null ? ` · ${confirmations} confirmation${confirmations === 1 ? '' : 's'}` : ''}`
            : row.signed
              ? 'Signed — not broadcast'
              : 'Pending — in mempool'}
        </p>
        {!tx && (
          <p className="text-dark-500 text-xs mt-1">
            Not yet seen by electrs — showing what the local ledger knows.
          </p>
        )}

        <div className="mt-4">
          <p className="text-dark-500 text-xs mb-1">Transaction ID</p>
          <div className="flex items-start gap-2">
            <p className="font-mono text-xs break-all flex-1">{row.txid}</p>
            <button type="button" onClick={onCopy} className="btn-secondary py-1 px-3 text-xs shrink-0">
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        {tx && (
          <div className="grid grid-cols-3 gap-3 mt-4 text-center">
            <div>
              <p className="text-dark-500 text-xs">Fee</p>
              <p className="num font-mono text-xs mt-1">
                {tx.fee != null ? `${tx.fee} nusan` : '—'}
              </p>
              <p className="num font-mono text-xs text-dark-400">
                {tx.fee != null ? `${formatNux(tx.fee)} NUX` : ''}
              </p>
            </div>
            <div>
              <p className="text-dark-500 text-xs">Size</p>
              <p className="num font-mono text-xs mt-1">{tx.size != null ? `${tx.size} bytes` : '—'}</p>
            </div>
            <div>
              <p className="text-dark-500 text-xs">Virtual size</p>
              <p className="num font-mono text-xs mt-1">{tx.vsize != null ? `${tx.vsize} vbytes` : '—'}</p>
            </div>
          </div>
        )}

        {tx ? (
          <>
            <div className="mt-5">
              <p className="text-dark-500 text-xs mb-1">Inputs ({tx.vin.length})</p>
              {tx.vin.map((vin, i) => (
                vin.prevout ? (
                  <AddressLine
                    key={`${vin.txid}:${vin.vout}`}
                    address={vin.prevout.scriptpubkey_address ?? 'No address'}
                    value={vin.prevout.value}
                    own={vin.prevout.scriptpubkey_address === ownAddress}
                  />
                ) : (
                  <div key={`coinbase-${i}`} className="flex items-start justify-between gap-3 py-2 border-b border-dark-700 last:border-b-0">
                    <p className="text-xs text-dark-300">Coinbase (newly minted coins)</p>
                    <p className="num font-mono text-xs whitespace-nowrap">—</p>
                  </div>
                )
              ))}
            </div>
            <div className="mt-4">
              <p className="text-dark-500 text-xs mb-1">Outputs ({tx.vout.length})</p>
              {tx.vout.map((vout, i) => (
                <AddressLine
                  key={i}
                  address={vout.scriptpubkey_address ?? 'No address (unspendable output)'}
                  value={vout.value}
                  own={vout.scriptpubkey_address === ownAddress}
                />
              ))}
            </div>
          </>
        ) : (
          pending && (
            <>
              <div className="mt-5">
                <p className="text-dark-500 text-xs mb-1">Inputs spent ({pending.spent.length})</p>
                {pending.spent.map((s) => (
                  <div key={`${s.txid}:${s.vout}`} className="flex items-start justify-between gap-3 py-2 border-b border-dark-700 last:border-b-0">
                    <p className="font-mono text-xs break-all text-dark-300">{s.txid}:{s.vout}</p>
                    <p className="num font-mono text-xs whitespace-nowrap">{formatNux(s.value)} NUX</p>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <p className="text-dark-500 text-xs mb-1">Change</p>
                {pending.change ? (
                  <AddressLine
                    address={pending.change.address}
                    value={pending.change.value}
                    own={pending.change.address === ownAddress}
                  />
                ) : (
                  <p className="text-xs text-dark-400">No change output.</p>
                )}
                <p className="text-dark-500 text-xs mt-2">
                  The payment output is not stored in the local ledger.
                </p>
              </div>
            </>
          )
        )}

        <p className="text-center text-xs mt-5">
          <a
            href={`https://explorer.taobot.org/tx/${row.txid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-nux-400 hover:text-nux-300"
          >
            View on explorer
          </a>
        </p>
      </div>
    </div>
  );
}
