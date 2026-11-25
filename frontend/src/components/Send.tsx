import React, { useState } from 'react';
import { buildTransaction, estimateSize, fetchUtxos, nuxToNusan, nusanToNux, toUtxo, type UTXO } from '../lib/transaction';
import { broadcastTx, fetchOwnMempoolUtxos, type AddressBalance } from '../lib/electrs';
import { getLockedOutpoints, getPendingTxs, getPendingUtxos, addPendingTx } from '../lib/pending';
import { cacheSpendableUtxos, loadUtxoCache, applySignedTxToCache } from '../lib/utxocache';
import { COIN, DEFAULT_FEE_RATE } from '../lib/network';
import {
  searchAddressBook,
  getAddressBookLabel,
  touchAddressBookEntry,
  isValidNusacoinAddress,
} from '../lib/addressbook';

interface SendProps {
  address: string;
  bech32address: string;
  privateKey: Uint8Array;
  privateKeyBech32: Uint8Array;
  isBech32: boolean,
  balance: AddressBalance | null;
  balanceBech32: AddressBalance | null;
  onDone: () => void;
  onAddressBook?: () => void;
  // Migration mode: the form starts pre-filled with the recipient
  // below and sweep on, and the recipient cannot be changed. Used
  // for the one-time legacy to bech32 move.
  migrationTo?: string;
  // Address book shortcut: the form starts with the recipient
  // pre-filled with this address, but it stays editable. Takes
  // effect only when migrationTo is not set.
  prefillTo?: string;
}

type SendStep = 'form' | 'confirm' | 'sending' | 'success';

// Amount input guard: only digits and one decimal separator may be
// entered. A comma typed as the decimal separator is normalized to a
// dot, and any minus sign or other stray character is dropped. This
// is the second layer of the guard; the first layer blocks invalid
// keys on key down. The sanitize also covers mobile keyboards and
// autofill, which do not always produce key events.
function sanitizeAmount(raw: string): string {
  const dotted = raw.replace(/,/g, '.');
  const cleaned = dotted.replace(/[^0-9.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  return cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
}

export function Send({ address, bech32address, privateKey, privateKeyBech32, balance, balanceBech32, isBech32, onDone, onAddressBook, migrationTo, prefillTo }: SendProps) {
  const migration = !!migrationTo;
  const [step, setStep] = useState<SendStep>('form');
  const [toAddress, setToAddress] = useState(migrationTo ?? prefillTo ?? '');
  const [amount, setAmount] = useState('');
  const [sweep, setSweep] = useState(migration);
  // Offline signing: build and sign from the cached UTXO set and
  // save the signed transaction without broadcasting, so the hex
  // or PSBT can be shared with a broadcaster. Not available in
  // migration mode: the one-time legacy move broadcasts at once.
  const [offlineMode, setOfflineMode] = useState(false);
  // BIP 125 opt-in RBF, off by default: nothing changes unless the
  // user opts in. The toggle works in normal and sweep mode, for
  // legacy and bech32 sends; the exported PSBT simply carries the
  // sequence when it is on.
  const [rbf, setRbf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txResult, setTxResult] = useState<{
    txid: string;
    fee: number;
    hex?: string;
    psbtBase64?: string;
    signedOffline?: boolean;
  } | null>(null);
  const [usesPending, setUsesPending] = useState(false);
  const [estimatedFee, setEstimatedFee] = useState<number | null>(null);
  const [copied, setCopied] = useState<'hex' | 'psbt' | null>(null);

  const activeBalance = isBech32 ? balanceBech32 : balance;
  const maxAmount = activeBalance ? activeBalance.available / COIN : 0;
  const savedLabel = toAddress ? getAddressBookLabel(toAddress) : null;
  const addressSuggestions = searchAddressBook(toAddress).filter(
    (e) => e.address !== toAddress,
  ).slice(0, 5);

  const isValidForm =
    isValidNusacoinAddress(toAddress) &&
    (sweep || (parseFloat(amount) > 0 && parseFloat(amount) <= maxAmount));

  // First layer of the amount input guard: reject any key that cannot
  // be part of a plain decimal amount ('-', '+', 'e', letters, ...).
  // Editing and navigation keys stay allowed, as do keyboard
  // shortcuts (copy, paste, select all). The decimal separator is
  // allowed and normalized to '.' by sanitizeAmount on change.
  const handleAmountKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (
      e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Tab' ||
      e.key === 'Enter' || e.key === 'Home' || e.key === 'End' ||
      e.key.startsWith('Arrow')
    ) return;
    if (/^[0-9]$/.test(e.key)) return;
    if (e.key === '.' || e.key === ',') return;
    e.preventDefault();
  };

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
    const spendable = [...available, ...pending, ...extra];
    // Keep the offline UTXO cache fresh while online, so the send
    // form can build and sign from it when the network is gone.
    // Fire-and-forget: a cache failure must never block sending.
    void cacheSpendableUtxos(sender, isBech32, spendable);
    return spendable;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidForm) return;
    // For a sweep, estimate the fee up front so the confirm step can
    // show it. The broadcast rebuilds the transaction from a fresh
    // UTXO set, so the estimate can differ if the set changed in
    // between; the exact fee is shown on the success screen.
    if (sweep) {
      try {
        const utxos = await loadSpendableUtxos();
        setEstimatedFee(
          estimateSize(utxos.map(() => ({ isBech32 })), [toAddress]) * DEFAULT_FEE_RATE,
        );
      } catch {
        setEstimatedFee(null);
      }
    }
    setStep('confirm');
  };

  const handleConfirm = async () => {
    setStep('sending');
    setError(null);

    try {
      const sender = isBech32 ? bech32address : address;
      // UTXO source: online by default. Offline mode (checkbox)
      // builds from the cached set; if the cache is empty it falls
      // back to a fresh online scan but still does not broadcast.
      // Without the checkbox, a failed online load (network gone,
      // electrs down) falls back to the cache and signs offline
      // instead of failing outright.
      let utxos: UTXO[];
      let offline = offlineMode;
      if (offlineMode) {
        const cached = loadUtxoCache(sender);
        if (cached && cached.utxos.length > 0) {
          utxos = cached.utxos;
        } else {
          utxos = await loadSpendableUtxos();
        }
      } else {
        try {
          utxos = await loadSpendableUtxos();
        } catch (err) {
          const cached = loadUtxoCache(sender);
          if (!cached || cached.utxos.length === 0) throw err;
          utxos = cached.utxos;
          offline = true;
        }
      }
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
        rbf,
      });

      if (offline) {
        // Signed, not broadcast: record it with the new status so
        // its inputs stay locked and its change stays tracked, and
        // the wallet offers to broadcast or discard it later.
        // The PSBT is stored with it for export to a broadcaster.
        addPendingTx(sender, {
          txid: tx.txid,
          hex: tx.hex,
          spent: tx.spent,
          change: tx.change,
          createdAt: Date.now(),
          status: 'signed',
          psbtBase64: tx.psbtBase64,
        });
        // Update the cached set (spent inputs out, change in) so
        // a later offline send does not reuse the same inputs.
        applySignedTxToCache(sender, tx.spent, tx.change, tx.hex);
        setUsesPending(tx.usesPendingInput);
        setTxResult({
          txid: tx.txid,
          fee: tx.fee,
          hex: tx.hex,
          psbtBase64: tx.psbtBase64,
          signedOffline: true,
        });
        setStep('success');
        return;
      }

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
      // Refresh the offline UTXO cache with the post-broadcast
      // state (spent inputs now locked, change pending), so a
      // later offline send does not reuse them.
      void loadSpendableUtxos().catch(() => {});
      setTxResult({ txid, fee: tx.fee });
      setStep('success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transaction failed';
      setError(msg);
      setStep('confirm');
    }
  };

  // Copy / download helpers for the offline-signed export. Both
  // artefacts are public signed data (hex and PSBT); sharing them
  // cannot move funds by itself — only broadcasting can.
  const copyExport = async (kind: 'hex' | 'psbt', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard unavailable (permissions, non-secure context):
      // the text stays selectable in the field below.
    }
  };

  const downloadExport = (filename: string, text: string) => {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (step === 'success' && txResult) {
    return (
      <div className="space-y-6 text-center">
        <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
          <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold">{txResult.signedOffline ? 'Signed!' : 'Sent!'}</h2>
        {txResult.signedOffline && (
          <div className="card bg-yellow-500/10 border border-yellow-600/40 text-left">
            <p className="text-yellow-300 text-sm font-medium">
              Signed — not broadcast yet
            </p>
            <p className="text-dark-300 text-sm mt-1">
              This transaction is fully signed and saved in this
              browser, but it has not been sent to the network. Share
              the signed hex or PSBT below with a broadcaster, or
              broadcast it later from the Wallet screen when back
              online.
            </p>
          </div>
        )}
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
        {txResult.signedOffline && txResult.hex && txResult.psbtBase64 && (
          <div className="space-y-4 text-left">
            <div>
              <p className="text-dark-400 text-xs mb-1">Signed raw hex</p>
              <textarea
                readOnly
                rows={4}
                value={txResult.hex}
                className="input-field font-mono text-xs break-all"
                onFocus={(e) => e.target.select()}
              />
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => void copyExport('hex', txResult.hex!)}
                  className="btn-secondary flex-1"
                >
                  {copied === 'hex' ? 'Copied!' : 'Copy hex'}
                </button>
                <button
                  type="button"
                  onClick={() => downloadExport(`nux-signed-${txResult.txid}.txt`, txResult.hex!)}
                  className="btn-secondary flex-1"
                >
                  Download .txt
                </button>
              </div>
            </div>
            <div>
              <p className="text-dark-400 text-xs mb-1">Signed PSBT (base64)</p>
              <textarea
                readOnly
                rows={4}
                value={txResult.psbtBase64}
                className="input-field font-mono text-xs break-all"
                onFocus={(e) => e.target.select()}
              />
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => void copyExport('psbt', txResult.psbtBase64!)}
                  className="btn-secondary flex-1"
                >
                  {copied === 'psbt' ? 'Copied!' : 'Copy PSBT'}
                </button>
                <button
                  type="button"
                  onClick={() => downloadExport(`nux-signed-${txResult.txid}.psbt`, txResult.psbtBase64!)}
                  className="btn-secondary flex-1"
                >
                  Download .psbt
                </button>
              </div>
            </div>
            <p className="text-dark-400 text-xs">
              Before broadcasting, check that every input is still
              unspent (electrs /tx/:txid/outspend/:vout). If an input
              is already spent, discard the signed transaction and
              build a new one.
            </p>
          </div>
        )}
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
            <p className="text-xl font-bold num">{sweep ? 'All available (sweep)' : `${amount} NUX`}</p>
          </div>
          {rbf && (
            <div>
              <p className="text-dark-400 text-xs">Replace-By-Fee</p>
              <p className="font-mono text-sm">Enabled — this transaction can be replaced later with a higher fee.</p>
            </div>
          )}
          {sweep && estimatedFee !== null && (
            <div>
              <p className="text-dark-400 text-xs">Estimated fee</p>
              <p className="font-mono text-sm num">{nusanToNux(estimatedFee)} NUX</p>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-xl p-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {offlineMode && (
          <div className="card bg-yellow-500/10 border border-yellow-600/40">
            <p className="text-yellow-300 text-sm">
              Offline signing: this transaction will be signed and
              saved in this browser, but not broadcast. Export the
              signed hex or PSBT to a broadcaster, or broadcast it
              later from the Wallet screen.
            </p>
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
            {step === 'sending' ? 'Signing...' : offlineMode ? 'Confirm & Sign offline' : 'Confirm & Send'}
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
        onSubmit={handleSubmit}
        className="space-y-4"
      >
        {migration && (
          <div className="card bg-orange-500/10 border border-orange-500/30">
            <p className="text-orange-400 text-sm font-medium">
              Moving the legacy balance to the bech32 wallet.
            </p>
            <p className="text-dark-300 text-sm mt-1">
              The full available balance is sent to the bech32 address below, minus the fee.
            </p>
          </div>
        )}
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
            autoFocus={!migration}
            readOnly={migration}
          />
          {toAddress && !isValidNusacoinAddress(toAddress) && (
            <p className="text-red-400 text-sm mt-1">Invalid Nusacoin address</p>
          )}
          {!migration && savedLabel && (
            <p className="text-nux-400 text-sm mt-1">Saved as: {savedLabel}</p>
          )}
          {!migration && addressSuggestions.length > 0 && (
            <div className="mt-2 space-y-1">
              {addressSuggestions.map((entry) => (
                <button
                  key={entry.address}
                  type="button"
                  onClick={() => {
                    touchAddressBookEntry(entry.address);
                    setToAddress(entry.address);
                  }}
                  className="block w-full text-left px-3 py-2 rounded-lg bg-dark-800 hover:bg-dark-700 text-sm"
                >
                  <span className="font-medium">{entry.label}</span>
                  <span className="block font-mono text-xs break-all text-dark-300">{entry.address}</span>
                </button>
              ))}
            </div>
          )}
          {!migration && onAddressBook && (
            <button
              type="button"
              onClick={onAddressBook}
              className="text-xs text-nux-400 hover:text-nux-300 mt-2"
            >
              Address Book
            </button>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-dark-300 mb-2">
            Amount (NUX)
          </label>
          <div className="relative">
            <input
              // Text input, not number: with type="number" Chrome
              // reports invalid input (e.g. "--9794664" typed from a
              // mobile keyboard, which bypasses key down) as an empty
              // value, so React never rewrites the field and the
              // invalid text stays visible. With type="text" the
              // typed text reaches sanitizeAmount and the display
              // updates. inputMode="decimal" keeps the numeric
              // keyboard on mobile. Validation stays with
              // isValidForm (amount > 0 and <= available).
              type="text"
              inputMode="decimal"
              className="input-field pr-16"
              placeholder="0.00"
              value={sweep ? maxAmount.toFixed(8) : amount}
              readOnly={sweep}
              onChange={(e) => setAmount(sanitizeAmount(e.target.value))}
              onKeyDown={handleAmountKeyDown}
              onPaste={(e) => {
                // Paste bypasses key presses, so sanitize the clipboard
                // text directly. A paste that sanitizes to nothing
                // leaves the current amount untouched.
                e.preventDefault();
                const pasted = sanitizeAmount(e.clipboardData.getData('text'));
                if (pasted) setAmount(pasted);
              }}
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
              disabled={migration}
            />
            Send all (sweep): spend the full available balance minus the fee, with no change output.
          </label>
          <label className="flex items-center gap-2 mt-3 text-sm text-dark-300">
            <input
              type="checkbox"
              checked={offlineMode}
              onChange={(e) => setOfflineMode(e.target.checked)}
              disabled={migration}
            />
            Sign offline: save the signed transaction without broadcasting, to share with a broadcaster.
          </label>
          <label className="flex items-center gap-2 mt-3 text-sm text-dark-300">
            <input
              type="checkbox"
              checked={rbf}
              onChange={(e) => setRbf(e.target.checked)}
            />
            Enable RBF (Replace-By-Fee): mark this transaction as replaceable, so it can later be replaced by a version with a higher fee.
          </label>
        </div>
        <button type="submit" disabled={!isValidForm} className="btn-primary w-full">
          Continue
        </button>
      </form>
    </div>
  );
}
