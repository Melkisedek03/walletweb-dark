import { useEffect } from 'react';
import { nusanToNux } from '../lib/transaction';
import type { AddressBalance } from '../lib/electrs';
import { useIncomingNotice } from '../hooks/useIncomingNotice';

interface DashboardProps {
  address: string;
  bech32address: string;
  balance: AddressBalance | null;
  isBech32: boolean;
  onInit: () => void;
  onRefresh: () => void;
  onSend: () => void;
  onReceive: () => void;
  onAddressBook: () => void;
}

export function Dashboard({ bech32address, balance, onInit, onRefresh, onSend, onReceive, onAddressBook }: DashboardProps) {
  useEffect(() => {
    onInit();
    onRefresh();
    const interval = setInterval(onRefresh, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [onRefresh]);


  const { noticeNusan, dismissNotice } = useIncomingNotice(bech32address, balance);

  const balancenux = balance ? nusanToNux(balance.available) : '---';
  const confirmedNux = balance ? nusanToNux(balance.confirmed) : '---';
  const pendingNux = balance ? nusanToNux(balance.mempool) : '---';



  return (
    <div className="space-y-6">
      {noticeNusan !== null && (
        <div className="card bg-green-500/20 border border-green-700 flex items-center justify-between gap-4">
          <p className="text-green-300 text-sm">
            Incoming coins: +{nusanToNux(noticeNusan)} NUX
          </p>
          <button onClick={dismissNotice} className="text-green-300 text-sm hover:text-ink shrink-0">
            Dismiss
          </button>
        </div>
      )}
      {/* Balance hero */}
      <div className="hero-balance">
        <p className="hero-label">Total Balance</p>
        <h2 className="hero-value">
          {balancenux}
          <span className="hero-unit">NUX</span>
        </h2>
        {balance && (
          <div className="hero-pills">
            <div className="hero-pill">Confirmed<b>{confirmedNux} NUX</b></div>
            <div className="hero-pill">Pending<b>{pendingNux} NUX</b></div>
          </div>
        )}
        {balance && balance.received > 0 && (
          <p className="hero-note">
            Total received: {nusanToNux(balance.received)} NUX
          </p>
        )}
      </div>

      {/* Address Book: kept off the top navigation so the nav bar
          stays within narrow phone screens without horizontal scroll,
          and placed here, directly below the Balance card. */}
      <button onClick={onAddressBook} className="btn-secondary w-full text-center py-4">
        Address Book
      </button>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-4">
        <button onClick={onSend} className="btn-primary text-center py-4 rounded-full">
          Send
        </button>
        <button onClick={onReceive} className="btn-secondary text-center py-4 rounded-full">
          Receive
        </button>
      </div>

      {/* Address Info */}
      <div className="card">
        <p className="text-dark-400 text-sm mb-2">Bech32 Address</p>
        <p className="font-mono text-sm break-all text-dark-200">{bech32address}</p>
        <button
          onClick={() => navigator.clipboard.writeText(bech32address)}
          className="text-nux-400 text-sm mt-2 hover:text-nux-300 transition-colors"
        >
          Copy address
        </button>
      </div>
    </div>
  );
}
