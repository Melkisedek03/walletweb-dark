import { useState, useCallback, useEffect } from 'react';
import {
  WalletData,
  createWallet,
  importWallet,
  unlockWallet,
  saveWallet,
  loadWallet,
  deleteWallet,
} from '../lib/wallet';
import { fetchBalance, fetchUtxos, fetchTxStatus, type AddressBalance } from '../lib/electrs';
import { getPendingTxs, removePendingTx, getLockedOutpoints, getPendingUtxos } from '../lib/pending';

export type WalletView =
  | 'landing'
  | 'create'
  | 'create-backup'
  | 'import'
  | 'unlock'
  | 'dashboard'
  | 'legacy'
  | 'send'
  | 'receive'
  | 'history';

export interface WalletState {
  view: WalletView;
  walletData: WalletData | null;
  privateKey: Uint8Array | null;
  privateKeyBech32: Uint8Array | null;
  mnemonic: string | null;
  balance: AddressBalance | null;
  balancebech32: AddressBalance | null;
  trxType: boolean;
  loading: boolean;
  error: string | null;
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    view: 'landing',
    walletData: null,
    privateKey: null,
    privateKeyBech32: null,
    mnemonic: null,
    balance: null,
    balancebech32: null,
    trxType: true,
    loading: false,
    error: null,
  });

  // Check for existing wallet on mount
  useEffect(() => {
    const existing = loadWallet();
    if (existing) {
      setState((s) => ({ ...s, walletData: existing, view: 'unlock' }));
    }
  }, []);

  const setView = useCallback((view: WalletView) => {
    setState((s) => ({ ...s, view, error: null }));
  }, []);

  const setBech32 = useCallback((trxType: boolean) => {
    setState((s) => ({ ...s, trxType }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState((s) => ({ ...s, error }));
  }, []);

  const handleCreate = useCallback(async (password: string) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { walletData, mnemonic } = await createWallet(password);
      saveWallet(walletData);
      setState((s) => ({
        ...s,
        walletData,
        mnemonic,
        loading: false,
        view: 'create-backup',
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create wallet';
      setState((s) => ({ ...s, loading: false, error: msg }));
    }
  }, []);

  const handleImport = useCallback(async (mnemonic: string, password: string) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const walletData = await importWallet(mnemonic, password);
      saveWallet(walletData);
      setState((s) => ({
        ...s,
        walletData,
        loading: false,
        view: 'unlock',
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to import wallet';
      setState((s) => ({ ...s, loading: false, error: msg }));
    }
  }, []);

  const handleUnlock = useCallback(
    async (password: string) => {
      if (!state.walletData) return;
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const { privateKeyBech32, privateKey, mnemonic } = await unlockWallet(state.walletData, password);
        setState((s) => ({
          ...s,
          privateKeyBech32,
          privateKey,
          mnemonic,
          loading: false,
          view: 'dashboard',
        }));
      } catch {
        setState((s) => ({
          ...s,
          loading: false,
          error: 'Incorrect password',
        }));
      }
    },
    [state.walletData]
  );

  const handleLock = useCallback(() => {
    setState((s) => ({
      ...s,
      privateKeyBech32: null,
      privateKey: null,
      mnemonic: null,
      balance: null,
      balancebech32: null,
      view: 'unlock',
    }));
  }, []);

  const handleLogout = useCallback(() => {
    deleteWallet();
    setState({
      view: 'landing',
      walletData: null,
      privateKey: null,
      privateKeyBech32: null,
      mnemonic: null,
      balance: null,
      balancebech32: null,
      trxType: true,
      loading: false,
      error: null,
    });
  }, []);

  const refreshOne = useCallback(async (addr: string): Promise<AddressBalance | null> => {
    try {
      const stats = await fetchBalance(addr);
      // Reconcile the pending ledger: drop a pending transaction once
      // its change is confirmed, or once it is gone from the chain
      // (status lookup returns nothing). Otherwise keep it locked.
      try {
        const confirmedUtxos = await fetchUtxos(addr);
        const confirmedKeys = new Set(confirmedUtxos.map((u) => `${u.txid}:${u.vout}`));
        for (const pending of getPendingTxs(addr)) {
          if (pending.change && confirmedKeys.has(`${pending.change.txid}:${pending.change.vout}`)) {
            removePendingTx(addr, pending.txid);
            continue;
          }
          const status = await fetchTxStatus(pending.txid);
          if (status === null || status.confirmed) {
            removePendingTx(addr, pending.txid);
          }
        }
      } catch {
        // Reconciliation is best-effort; stats below still apply.
      }
      const locked = getLockedOutpoints(addr);
      const confirmedSpendable = (await fetchUtxos(addr).catch(() => []))
        .filter((u) => !locked.has(`${u.txid}:${u.vout}`))
        .reduce((sum, u) => sum + u.value, 0);
      const pendingChange = getPendingUtxos(addr).reduce((sum, u) => sum + u.satoshis, 0);
      return { ...stats, available: confirmedSpendable + pendingChange };
    } catch {
      return null;
    }
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!state.walletData) return;
    const balance = await refreshOne(state.walletData.address);
    if (balance) setState((s) => ({ ...s, balance }));
  }, [state.walletData, refreshOne]);

  const refreshBalanceBech32 = useCallback(async () => {
    if (!state.walletData) return;
    const balancebech32 = await refreshOne(state.walletData.bech32address);
    if (balancebech32) setState((s) => ({ ...s, balancebech32 }));
  }, [state.walletData, refreshOne]);

  return {
    ...state,
    setView,
    setError,
    setBech32,
    handleCreate,
    handleImport,
    handleUnlock,
    handleLock,
    handleLogout,
    refreshBalance,
    refreshBalanceBech32
  };
}
