import { Psbt, Transaction, payments } from 'bitcoinjs-lib';
import ECPairFactory, { type ECPairAPI } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import { Buffer } from 'buffer';
import { nusacoin, COIN, DEFAULT_FEE_RATE } from './network';
import { fetchUtxos as fetchElectrsUtxos, fetchTxHex } from './electrs';
import type { PendingUtxo } from './pending';

let _ECPair: ECPairAPI | null = null;
function getECPair(): ECPairAPI {
  if (!_ECPair) _ECPair = ECPairFactory(ecc);
  return _ECPair;
}

// Normalized UTXO for internal use. Pending UTXOs carry the parent
// transaction hex so legacy (P2PKH) inputs can be signed before the
// parent confirms; bech32 inputs only need the script and value.
export interface UTXO {
  txid: string;
  outputIndex: number;
  satoshis: number;
  script: string;
  parentHex?: string;
  isPending?: boolean;
}

export async function fetchUtxos(address: string): Promise<UTXO[]> {
  const raw = await fetchElectrsUtxos(address);
  return raw
    .filter((u) => u.status.confirmed)
    .map((u) => ({
      txid: u.txid,
      outputIndex: u.vout,
      satoshis: u.value,
      script: '',
    }));
}

export function toUtxo(pending: PendingUtxo): UTXO {
  return {
    txid: pending.txid,
    outputIndex: pending.outputIndex,
    satoshis: pending.satoshis,
    script: '',
    parentHex: pending.parentHex,
    isPending: true,
  };
}

function isBech32Address(address: string): boolean {
  return address.startsWith('nu1');
}

// Size estimates in bytes (vbytes for witness data).
function estimateSize(
  inputs: Array<{ isBech32: boolean }>,
  outputs: string[],
): number {
  let size = 10;
  for (const input of inputs) size += input.isBech32 ? 68 : 148;
  for (const output of outputs) size += isBech32Address(output) ? 31 : 34;
  return size;
}

export interface BuiltTransaction {
  hex: string;
  fee: number;
  txid: string;
  spent: Array<{ txid: string; vout: number; value: number }>;
  change: { txid: string; vout: number; value: number; address: string } | null;
  usesPendingInput: boolean;
}

// Build and sign one transaction. Legacy and bech32 share this path:
// payment output = requested amount, change back to the sender when
// above dust, fee from per-type size estimates. Sweep is an explicit
// option (amount = total - fee, single output), never the default.
export async function buildTransaction(params: {
  fromAddress: string;
  fromBech32: string;
  toAddress: string;
  amountNusan: number;
  privateKey: Uint8Array;
  privateKeyBech32: Uint8Array;
  isBech32: boolean;
  utxos: UTXO[];
  sweep?: boolean;
  feeRate?: number;
}): Promise<BuiltTransaction> {
  const {
    fromAddress,
    fromBech32,
    toAddress,
    amountNusan,
    privateKey,
    privateKeyBech32,
    isBech32,
    utxos,
    sweep = false,
    feeRate = DEFAULT_FEE_RATE,
  } = params;

  const changeAddress = isBech32 ? fromBech32 : fromAddress;

  if (utxos.length === 0) {
    throw new Error('No spendable outputs found');
  }

  const sorted = [...utxos].sort((a, b) => b.satoshis - a.satoshis);
  const inputKind = { isBech32 };

  // Select inputs and compute the fee iteratively, because the fee
  // depends on the input count and on whether there is a change output.
  let selected: UTXO[] = [];
  let totalInput = 0;
  let fee = 0;
  let payment = amountNusan;

  if (sweep) {
    selected = sorted;
    totalInput = sorted.reduce((sum, u) => sum + u.satoshis, 0);
    fee = estimateSize(selected.map(() => inputKind), [toAddress]) * feeRate;
    payment = totalInput - fee;
    if (payment <= 546) {
      throw new Error('Insufficient funds to sweep after fees');
    }
  } else {
    for (const utxo of sorted) {
      selected.push(utxo);
      totalInput += utxo.satoshis;
      // Assume a change output first; corrected below if dust.
      fee = estimateSize(selected.map(() => inputKind), [toAddress, changeAddress]) * feeRate;
      if (totalInput >= amountNusan + fee) break;
    }
    if (totalInput < amountNusan + fee) {
      const available = totalInput / COIN;
      const needed = (amountNusan + fee) / COIN;
      throw new Error(
        `Insufficient funds. Available: ${available.toFixed(8)} NUX, Needed: ${needed.toFixed(8)} NUX (including fee)`
      );
    }
  }

  let changeValue = 0;
  if (!sweep) {
    changeValue = totalInput - amountNusan - fee;
    if (changeValue <= 546) {
      // Dust change is absorbed into the fee; no change output.
      fee = totalInput - amountNusan;
      changeValue = 0;
      // Recompute the fee with one output only for the reported value
      // when the dust case applies is not needed: fee is defined as
      // total - payment here, which is exact.
    }
  }

  // Raw hex for legacy inputs. Pending inputs use the stored parent
  // hex; confirmed inputs are fetched from electrs.
  const rawTxCache = new Map<string, Buffer>();
  if (!isBech32) {
    for (const utxo of selected) {
      if (rawTxCache.has(utxo.txid)) continue;
      if (utxo.parentHex) {
        rawTxCache.set(utxo.txid, Buffer.from(utxo.parentHex, 'hex'));
      } else {
        const hex = await fetchTxHex(utxo.txid);
        rawTxCache.set(utxo.txid, Buffer.from(hex, 'hex'));
      }
    }
  }

  const keyPair = getECPair().fromPrivateKey(Buffer.from(privateKey), {
    network: nusacoin,
  });
  const keyPair2 = getECPair().fromPrivateKey(Buffer.from(privateKeyBech32), {
    network: nusacoin,
  });
  const p2wpkh = payments.p2wpkh({ pubkey: keyPair2.publicKey, network: nusacoin });

  const psbt = new Psbt({ network: nusacoin });

  for (const utxo of selected) {
    if (!isBech32) {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.outputIndex,
        nonWitnessUtxo: rawTxCache.get(utxo.txid)!,
      });
    } else {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.outputIndex,
        witnessUtxo: { script: p2wpkh.output!, value: utxo.satoshis },
      });
    }
  }

  psbt.addOutput({ address: toAddress, value: payment });

  let changeOutput: BuiltTransaction['change'] = null;
  if (!sweep && changeValue > 0) {
    psbt.addOutput({ address: changeAddress, value: changeValue });
  }

  for (let i = 0; i < selected.length; i++) {
    if (!isBech32) psbt.signInput(i, keyPair);
    else psbt.signInput(i, keyPair2);
  }

  psbt.finalizeAllInputs();
  const tx: Transaction = psbt.extractTransaction();
  const txid = tx.getId();

  if (!sweep && changeValue > 0) {
    changeOutput = { txid, vout: 1, value: changeValue, address: changeAddress };
  }

  return {
    hex: tx.toHex(),
    fee,
    txid,
    spent: selected.map((u) => ({ txid: u.txid, vout: u.outputIndex, value: u.satoshis })),
    change: changeOutput,
    usesPendingInput: selected.some((u) => u.isPending),
  };
}

export function nusanToNux(nusan: number): string {
  return (nusan / COIN).toFixed(8);
}

export function nuxToNusan(nux: string): number {
  const value = parseFloat(nux);
  if (isNaN(value) || value < 0) throw new Error('Invalid amount');
  return Math.round(value * COIN);
}
