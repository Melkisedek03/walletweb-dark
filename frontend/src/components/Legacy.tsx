import { useEffect } from 'react';
import { estimateSize, nusanToNux } from '../lib/transaction';
import { DEFAULT_FEE_RATE, DUST_NUSAN } from '../lib/network';
import type { AddressBalance } from '../lib/electrs';
import { useIncomingNotice } from '../hooks/useIncomingNotice';
import { SignedPending } from './SignedPending';

interface LegacyProps {
    address: string;
    bech32address: string;
    balance: AddressBalance | null;
    isBech32: boolean,
    onSend: () => void;
    onMigrate: () => void;
    onRefreshTwo: () => void;
    onHistory: () => void;
}

export function Legacy({ address, bech32address, balance, onRefreshTwo, onSend, onMigrate, onHistory }: LegacyProps) {
    useEffect(() => {
        onRefreshTwo();
        const interval = setInterval(onRefreshTwo, 60000); // Refresh every 60s
        return () => clearInterval(interval);
    }, [onRefreshTwo]);
    const { noticeNusan, dismissNotice } = useIncomingNotice(address, balance);
    const balancenux = balance ? nusanToNux(balance.available) : '---';
    const confirmedNux = balance ? nusanToNux(balance.confirmed) : '---';
    const pendingNux = balance ? nusanToNux(balance.mempool) : '---';
    // Minimum total for a one-input sweep: the fee of one legacy
    // input plus one bech32 output, plus dust for the payment
    // output. With more inputs the fee is higher; the send flow
    // validates the exact amount before broadcasting, so this is
    // only a lower bound for enabling the button.
    const minMovable =
        estimateSize([{ isBech32: false }], [bech32address]) * DEFAULT_FEE_RATE + DUST_NUSAN;
    const isEmpty = !!balance && balance.confirmed === 0 && balance.mempool === 0;
    const isLocked = !!balance && balance.available === 0 && !isEmpty;
    const tooSmall = !!balance && balance.available > 0 && balance.available < minMovable;
    const canMigrate = !!balance && balance.available >= minMovable;
    const shortBech32 = `${bech32address.slice(0, 14)}…${bech32address.slice(-8)}`;
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
            <SignedPending address={address} onChanged={onRefreshTwo} />
            {/* Deprecation notice: legacy support will be removed in a
                future release; balances should move to bech32 first. */}
            <div className="card bg-orange-500/10 border border-orange-500/30">
                <p className="text-orange-400 text-sm font-medium">
                    The Legacy wallet is deprecated and will be removed in a future release.
                </p>
                <p className="text-dark-300 text-sm mt-1">
                    Move the balance to the bech32 wallet to keep using it.
                </p>
            </div>

            {/* Balance hero (warm legacy variant) */}
            <div className="hero-balance hero-balance-legacy">
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

            {/* Quick Actions */}
            <div className="grid grid-cols-1 gap-4">
                <button onClick={onSend} className="btn-legacy text-center py-4 rounded-full">
                    SWEEP
                </button>
            </div>

            {/* One-time migration to bech32 */}
            <div className="card space-y-3">
                <p className="text-sm font-medium">Move to bech32</p>
                <p className="text-dark-300 text-sm">
                    Sends the full legacy balance to the bech32 wallet
                    (<span className="font-mono text-xs break-all">{shortBech32}</span>), minus the fee.
                </p>
                {isEmpty && (
                    <p className="text-dark-400 text-sm">The legacy balance is already empty. Nothing to move.</p>
                )}
                {isLocked && (
                    <p className="text-dark-400 text-sm">The legacy balance is locked by a pending transaction. Try again after it confirms.</p>
                )}
                {tooSmall && (
                    <p className="text-dark-400 text-sm">The remaining balance is too small to move: it does not cover the fee of the transfer.</p>
                )}
                <button
                    onClick={onMigrate}
                    disabled={!canMigrate}
                    className="btn-primary w-full"
                >
                    Move to bech32
                </button>
            </div>

            {/* Address Info */}
            <div className="card">
                <p className="text-dark-400 text-sm mb-2">Legacy Address</p>
                <p className="font-mono text-sm break-all text-dark-200">{address}</p>
                <button
                    onClick={() => navigator.clipboard.writeText(address)}
                    className="text-orange-400 text-sm mt-2 hover:text-orange-300 transition-colors"
                >
                    Copy address
                </button>
                <p></p>
                <button
                    onClick={onHistory}
                    className="text-orange-400 text-sm mt-2 hover:text-orange-300 transition-colors"
                >
                    History
                </button>
            </div>
        </div>
    );
}
