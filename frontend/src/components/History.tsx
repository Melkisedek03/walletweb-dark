import { useEffect, useState } from 'react';
import { fetchAddressTxs, type ElectrsTx } from '../lib/electrs';
import { getPendingTxs, type PendingTx } from '../lib/pending';
import { TxDetailDialog } from './TxDetailDialog';

interface HistoryProps {
  address: string;
}

export interface HistoryRow {
  txid: string;
  incoming: number;
  outgoing: number;
  timestamp: number;
  confirmed: boolean;
  // Signed offline but not broadcast yet (from the local ledger).
  signed?: boolean;
}

export function formatTime(timestamp: number): string {
  if (!timestamp) return 'Pending';
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

export function History({ address }: HistoryProps) {
  const [txs, setTxs] = useState<HistoryRow[]>([]);
  // Full transactions behind each row, for the detail dialog: the
  // dialog reuses this already-fetched data instead of refetching.
  const [txById, setTxById] = useState<Map<string, ElectrsTx>>(new Map());
  const [pendingById, setPendingById] = useState<Map<string, PendingTx>>(new Map());
  const [selectedTxid, setSelectedTxid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const data: ElectrsTx[] = await fetchAddressTxs(address);
        if (cancelled) return;
        const known = new Set(data.map((t) => t.txid));
        const txMap = new Map<string, ElectrsTx>();
        for (const tx of data) txMap.set(tx.txid, tx);
        const pendingMap = new Map<string, PendingTx>();
        for (const pending of getPendingTxs(address)) pendingMap.set(pending.txid, pending);
        const ledgerRows: HistoryRow[] = [];
        for (const pending of getPendingTxs(address)) {
          if (known.has(pending.txid)) continue;
          ledgerRows.push({
            txid: pending.txid,
            incoming: pending.change && pending.change.address === address ? pending.change.value : 0,
            outgoing: pending.spent.reduce((sum, sp) => sum + sp.value, 0),
            timestamp: Math.floor(pending.createdAt / 1000),
            confirmed: false,
            signed: pending.status === 'signed',
          });
        }
        const rows: HistoryRow[] = data.map((tx) => {
          let incoming = 0;
          let outgoing = 0;
          for (const vout of tx.vout) {
            if (vout.scriptpubkey_address === address) incoming += vout.value;
          }
          for (const vin of tx.vin) {
            if (vin.prevout && vin.prevout.scriptpubkey_address === address) outgoing += vin.prevout.value;
          }
          return {
            txid: tx.txid,
            incoming,
            outgoing,
            timestamp: tx.status.block_time ?? 0,
            confirmed: tx.status.confirmed,
          };
        });
        setTxs([...ledgerRows, ...rows]);
        setTxById(txMap);
        setPendingById(pendingMap);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load history');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [address]);

  if (loading) {
    return (
      <div className="text-center py-12 text-dark-400">
        Loading transactions...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Transaction History</h2>
      <p className="text-dark-400 text-sm mb-2">{address}</p>

      {txs.length === 0 ? (
        <div className="card text-center py-12 text-dark-400">
          No transactions yet
        </div>
      ) : (
        <div className="space-y-2">
          {txs.map((tx) => {
            const isReceived = tx.incoming > tx.outgoing;
            const amount = isReceived ? tx.incoming - tx.outgoing : tx.outgoing - tx.incoming;

            return (
              <div
                key={tx.txid}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedTxid(tx.txid)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedTxid(tx.txid);
                  }
                }}
                className="card flex items-center justify-between py-4 w-full text-left cursor-pointer hover:border-nux-500 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${isReceived
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-red-500/20 text-red-400'
                      }`}
                  >
                    {isReceived ? (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                      </svg>
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-sm">
                      {isReceived ? 'Received' : 'Sent'}
                      {!tx.confirmed && (
                        <span className="ml-2 text-xs text-yellow-300">
                          {tx.signed ? 'Signed — not broadcast' : 'Pending'}
                        </span>
                      )}
                    </p>
                    <p className="text-dark-500 text-xs">
                      {formatTime(tx.timestamp)}
                    </p>
                    <p className="text-dark-400 text-xs">
                      {tx.txid.slice(8, 28)}...
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p
                    className={`font-mono font-medium ${isReceived ? 'text-green-400' : 'text-red-400'
                      }`}
                  >
                    {isReceived ? '+' : '-'}
                    {(amount / 100000000).toFixed(8)}
                  </p>
                  <p className="text-dark-500 text-xs">NUX</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {selectedTxid && (() => {
        const selected = txs.find((t) => t.txid === selectedTxid);
        if (!selected) return null;
        return (
          <TxDetailDialog
            row={selected}
            tx={txById.get(selectedTxid)}
            pending={pendingById.get(selectedTxid)}
            ownAddress={address}
            onClose={() => setSelectedTxid(null)}
          />
        );
      })()}
    </div>
  );
}
