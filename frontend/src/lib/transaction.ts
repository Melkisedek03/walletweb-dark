import { Psbt, Transaction, payments } from 'bitcoinjs-lib';
import ECPairFactory, { type ECPairAPI } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import { Buffer } from 'buffer';
import { nusacoin, COIN, DEFAULT_FEE_RATE } from './network';
import { fetchUtxos as fetchElectrsUtxos, fetchTxHex } from './electrs';

let _ECPair: ECPairAPI | null = null;
function getECPair(): ECPairAPI {
  if (!_ECPair) _ECPair = ECPairFactory(ecc);
  return _ECPair;
}

// Normalized UTXO for internal use
export interface UTXO {
  txid: string;
  outputIndex: number;
  satoshis: number;
  script: string;
}

// Estimate transaction size for fee calculation
// P2PKH: ~148 bytes per input, ~34 bytes per output, ~10 bytes overhead
function estimateSize(inputCount: number, outputCount: number): number {
  return inputCount * 148 + outputCount * 34 + 10;
}

export async function fetchUtxos(address: string): Promise<UTXO[]> {
  const raw = await fetchElectrsUtxos(address);
  // Only confirmed UTXOs are returned by the electrs UTXO endpoint.
  // Unconfirmed change is handled by the pending ledger (Phase 3).
  return raw
    .filter((u) => u.status.confirmed)
    .map((u) => ({
      txid: u.txid,
      outputIndex: u.vout,
      satoshis: u.value,
      script: '',
    }));
}

// Build and sign a transaction.
// NOTE (Phase 2): legacy behaviour is preserved here and fixed in
// Phase 3 — legacy send is still a sweep (output = totalInput - fee,
// no change output). Bech32 send already returns change.
export async function buildTransaction(params: {
  fromAddress: string;
  fromBech32: string;
  toAddress: string;
  amountNusan: number;
  privateKey: Uint8Array;
  privateKeyBech32: Uint8Array;
  isBech32: boolean,
  feeRate?: number;
}): Promise<{ hex: string; fee: number; txid: string }> {
  const { fromAddress, fromBech32, toAddress, amountNusan, privateKey, privateKeyBech32, isBech32, feeRate = DEFAULT_FEE_RATE } = params;

  const utxos: UTXO[] = await fetchUtxos(isBech32 ? fromBech32 : fromAddress);

  if (utxos.length === 0) {
    throw new Error('No spendable outputs found');
  }

  utxos.sort((a, b) => b.satoshis - a.satoshis);

  const selected: UTXO[] = [];
  let totalInput = 0;
  let estimatedFee = estimateSize(1, 2) * feeRate;

  for (const utxo of utxos) {
    selected.push(utxo);
    totalInput += utxo.satoshis;
    estimatedFee = estimateSize(selected.length, 2) * feeRate;
    if (totalInput >= amountNusan + estimatedFee) {
      break;
    }
  }

  if (isBech32) {
    if (totalInput < amountNusan + estimatedFee) {
      const available = totalInput / COIN;
      const needed = (amountNusan + estimatedFee) / COIN;
      throw new Error(
        `Insufficient funds. Available: ${available.toFixed(8)} NUX, Needed: ${needed.toFixed(8)} NUX (including fee)`
      );
    }
  }

  const rawTxCache = new Map<string, Buffer>();
  for (const utxo of selected) {
    if (!rawTxCache.has(utxo.txid)) {
      const hex = await fetchTxHex(utxo.txid);
      rawTxCache.set(utxo.txid, Buffer.from(hex, 'hex'));
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

  if (!isBech32) {
    for (const utxo of selected) {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.outputIndex,
        nonWitnessUtxo: rawTxCache.get(utxo.txid)!,
      });
    }
  } else {
    for (const utxo of selected) {
      psbt.addInput({ hash: utxo.txid, index: utxo.outputIndex, witnessUtxo: { script: p2wpkh.output!, value: utxo.satoshis } })
    }
  }

  if (isBech32) {
    psbt.addOutput({
      address: toAddress,
      value: amountNusan,
    });
  } else {
    psbt.addOutput({
      address: toAddress,
      value: totalInput - estimatedFee,
    });
  }

  const change = totalInput - amountNusan - estimatedFee;
  const DUST_THRESHOLD = 546;

  if (change > DUST_THRESHOLD && isBech32) {
    psbt.addOutput({
      address: fromBech32,
      value: change,
    });
  } else {
    estimatedFee = totalInput - amountNusan;
  }

  for (let i = 0; i < selected.length; i++) {
    if (!isBech32)
      psbt.signInput(i, keyPair);
    else
      psbt.signInput(i, keyPair2);
  }

  psbt.finalizeAllInputs();

  const tx: Transaction = psbt.extractTransaction();

  return {
    hex: tx.toHex(),
    fee: estimatedFee,
    txid: tx.getId(),
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
