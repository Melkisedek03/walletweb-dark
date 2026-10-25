import React, { useState } from 'react';
import { buildTransaction, fetchUtxos, nuxToNusan, nusanToNux, toUtxo, type UTXO } from '../lib/transaction';
import { broadcastTx, fetchOwnMempoolUtxos, type AddressBalance } from '../lib/electrs';
import { getLockedOutpoints, getPendingTxs, getPendingUtxos, addPendingTx } from '../lib/pending';
import { COIN } from '../lib/network';

interface SendProps {
  address: string;
  bech32address: string;
  privateKey: Uint8Array;
  privateKeyBech32: Uint8Array;
  isBech32: boolean,
  balance: AddressBalance | null;
  balanceBech32: AddressBalance | null;
  onDone: () => void;
}

type SendStep = 'form' | 'confirm' | 'sending' | 'success';

export function Send({ address, bech32address, privateKey, privateKeyBech32, balance, balanceBech32, isBech32, onDone }: SendProps) {
  const [step, setStep] = useState<SendStep>('form');
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [sweep, setSweep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txResult, setTxResult] = useState<{ txid: string; fee: number } | null>(null);
  const [usesPending, setUsesPending] = useState(false);

  const activeBalance = isBech32 ? balanceBech32 : balance;
  const maxAmount = activeBalance ? activeBalance.available / COIN : 0;
  const ADDRESS_RE = /^[NX][1-9A-HJ-NP-Za-km-z]{25,34}$/;
  const ADDRESS_BECH = /\bnu1[qQ][a-zA-HJ-NP-Z0-9]{25,39}\b/

  const isValidForm =
    (ADDRESS_RE.test(toAddress) || ADDRESS_BECH.test(toAddress)) &&
    (sweep || (parseFloat(amount) > 0 && parseFloat(amount) <= maxAmount));

  async function loadSpendableUtxos(): Promise<UTXO[]> {
    const sender = isBech32 ? bech32address : address;
    const confirmed = await fetchUtxos(sender);
    const locked = getLockedOutpoints(sender);
    const available = confirmed.filter((u) => !locked.has(`${u.txid}:${u.outputIndex}`));
    const pending = getPendingUtxos(sender).map(toUtxo);
    // Pending change is spendable even though it is not confirmed yet.
    // Confirmed UTXOs already spent by a pending transaction stay locked.
    // Own unconfirmed outputs derived from mempool transactions are
    // also spendable, so a wallet is not stuck when its total UTXO
    // value is sufficient but its confirmed value alone is not. The
    // derivation filters to transactions created by this wallet, so
    // third-party incoming mempool outputs stay excluded.
    const ledgerTxids = new Set(getPendingTxs(sender).map((t) => t.txid));
    const ownMempool = (await fetchOwnMempoolUtxos(sender, ledgerTxids).catch(() => [])).map(
      (u): UTXO => ({
        txid: u.txid,
        outputIndex: u.outputIndex,
        satoshis: u.satoshis,
        script: '',
        isPending: true,
      }),
    );
    const seen = new Set(
      [...available, ...pending].map((u) => `${u.txid}:${u.outputIndex}`),
    );
    const extra = ownMempool.filter((u) => !seen.has(`${u.txid}:${u.outputIndex}`));
    return [...available, ...pending, ...extra];
  }

  const handleConfirm = async () => {
    setStep('sending');
    setError(null);

    try {
      const sender = isBech32 ? bech32address : address;
      const utxos = await loadSpendableUtxos();
      const amountNusan = sweep ? 0 : nuxToNusan(amount);
      const tx = await buildTransaction({
        fromAddress: address,
        fromBech32: bech32address,
        toAddress,
        amountNusan,
        privateKey,
        privateKeyBech32,
        isBech32,
        utxos,
        sweep,
      });

      const txid = await broadcastTx(tx.hex);
      setUsesPending(tx.usesPendingInput);
      // Record the pending transaction before reporting success, so a
      // second send in the same session sees the locked inputs and
      // the unconfirmed change.
      addPendingTx(sender, {
        txid,
        hex: tx.hex,
        spent: tx.spent,
        change: tx.change,
        createdAt: Date.now(),
      });
      setTxResult({ txid, fee: tx.fee });
      setStep('success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transaction failed';
      setError(msg);
      setStep('confirm');
    }
  };

  if (step === 'success' && txResult) {
    return (
      <div className="space-y-6 text-center">
        <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
          <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold">Sent!</h2>
        <div className="card text-left space-y-3">
          <div>
            <p className="text-dark-400 text-xs">Amount</p>
            <p className="font-mono">{sweep ? maxAmount - parseFloat(nusanToNux(txResult.fee)) : amount} NUX</p>
          </div>
          <div>
            <p className="text-dark-400 text-xs">Fee</p>
            <p className="font-mono text-sm">{nusanToNux(txResult.fee)} NUX</p>
          </div>
          <div>
            <p className="text-dark-400 text-xs">Transaction ID</p>
            <p className="font-mono text-xs break-all text-nux-400">{txResult.txid}</p>
          </div>
          {usesPending && (
            <p className="text-yellow-300 text-xs">
              This transaction spends unconfirmed change. It will confirm together with the previous transaction.
            </p>
          )}
        </div>
        <button onClick={onDone} className="btn-primary w-full">
          Done
        </button>
      </div>
    );
  }

  if (step === 'confirm' || step === 'sending') {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold">Confirm Transaction</h2>

        <div className="card space-y-4">
          <div>
            <p className="text-dark-400 text-xs">To</p>
            <p className="font-mono text-sm break-all">{toAddress}</p>
          </div>
          <div>
            <p className="text-dark-400 text-xs">Amount</p>
            <p className="text-xl font-bold">{sweep ? 'All available (sweep)' : `${amount} NUX`}</p>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-xl p-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => setStep('form')}
            className="btn-secondary flex-1"
            disabled={step === 'sending'}
          >
            Back
          </button>
          <button
            onClick={handleConfirm}
            className="btn-primary flex-1"
            disabled={step === 'sending'}
          >
            {step === 'sending' ? 'Sending...' : 'Confirm & Send'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">{isBech32 ? 'Send' : 'Send'} NUX</h2>
      <p className="text-dark-400 text-sm font-medium mb-2">{isBech32 ? bech32address : address}</p>

      <form
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault();
          if (isValidForm) setStep('confirm');
        }}
        className="space-y-4"
      >
        <div>
          <label className="block text-sm font-medium text-dark-300 mb-2">
            Recipient Address
          </label>
          <input
            type="text"
            className="input-field font-mono text-sm"
            placeholder="N/X/nu1q..."
            value={toAddress}
            onChange={(e) => setToAddress(e.target.value.trim())}
            autoFocus
          />
          {toAddress && !ADDRESS_RE.test(toAddress) && !ADDRESS_BECH.test(toAddress) && (
            <p className="text-red-400 text-sm mt-1">Invalid Nusacoin address</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-dark-300 mb-2">
            Amount (NUX)
          </label>
          <div className="relative">
            <input
              type="number"
              className="input-field pr-16"
              placeholder="0.00"
              value={sweep ? maxAmount.toFixed(8) : amount}
              readOnly={sweep}
              onChange={(e) => setAmount(e.target.value)}
              step="0.00000001"
              min="0.00000001"
              max={maxAmount}
            />
            <button
              type="button"
              onClick={() => setAmount(maxAmount.toFixed(8))}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-nux-400 hover:text-nux-300"
            >
              MAX
            </button>
          </div>
          <p className="text-dark-500 text-xs mt-1">
            Available: {maxAmount.toFixed(8)} NUX (confirmed plus own unconfirmed outputs, minus inputs locked by pending sends)
          </p>
          <label className="flex items-center gap-2 mt-3 text-sm text-dark-300">
            <input
              type="checkbox"
              checked={sweep}
              onChange={(e) => setSweep(e.target.checked)}
            />
            Send all (sweep): spend the full available balance minus the fee, with no change output.
          </label>
        </div>
        <button type="submit" disabled={!isValidForm} className="btn-primary w-full">
          Continue
        </button>
      </form>
    </div>
  );
}
