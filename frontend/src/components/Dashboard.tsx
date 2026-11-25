import { useEffect, useState } from 'react';
import { nusanToNux } from '../lib/transaction';
import { COIN } from '../lib/network';
import { fetchNuxIdrRate, formatIdr } from '../lib/rate';
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
  // Fiat rate (NUX/IDR). Null until a price is fetched; the fiat
  // line simply stays hidden while it is null, so a missing rate
  // never blocks anything.
  const [rate, setRate] = useState<number | null>(null);

  useEffect(() => {
    const loadRate = () => {
      void fetchNuxIdrRate().then(setRate);
    };
    loadRate();
    onInit();
    onRefresh();
    const interval = setInterval(() => {
      onRefresh();
      loadRate(); // Cheap: the rate module caches for five minutes.
    }, 30000); // Refresh every 30s
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
        {/* Fiat value of the displayed total balance. Hidden while
            no rate is available (offline or fetch failure). */}
        {rate !== null && balance && (
          <p className="hero-rate num">≈ {formatIdr((balance.available / COIN) * rate)}</p>
        )}
        {balance && (
          <div className="hero-pills">
            <div className="hero-pill"><span className="hero-dot" aria-hidden="true" />Confirmed<b>{confirmedNux} NUX</b></div>
            <div className="hero-pill"><span className="hero-dot hero-dot-pending" aria-hidden="true" />Pending<b>{pendingNux} NUX</b></div>
          </div>
        )}
        {balance && balance.received > 0 && (
          <p className="hero-note">
            Total received: {nusanToNux(balance.received)} NUX
          </p>
        )}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-4">
        <button onClick={onSend} className="btn-primary btn-primary-glow flex items-center justify-center gap-2 py-4 rounded-full">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          Send
        </button>
        <button onClick={onReceive} className="btn-secondary flex items-center justify-center gap-2 py-4 rounded-full">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
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

      {/* Address Book: kept off the top navigation so the nav bar
          stays within narrow phone screens without horizontal scroll,
          and placed here, at the bottom of the Wallet screen, below
          the address card. */}
      <button onClick={onAddressBook} className="btn-secondary w-full text-center py-4">
        Address Book
      </button>
    </div>
  );
}
