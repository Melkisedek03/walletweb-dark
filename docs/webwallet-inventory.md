# Web Wallet Inventory (Phase 0)

Baseline: upstream `main` at `b013f65`. This document records the state
found before slimming, so later phases can be reviewed against it.
No runtime, deployment, or user data was changed by this phase.

## Layout

- `frontend/` — React + TypeScript + Vite application. Build script is
  `tsc -b && vite build` with output `dist/`. Dependencies include
  `bitcoinjs-lib`, `bip39`, `bip32`, `ecpair`, `tiny-secp256k1`,
  `qrcode.react`, React 18, Tailwind CSS.
- `frontend/src/lib/wallet.ts` — BIP39 mnemonic, BIP44/BIP84 derivation,
  AES-GCM encryption (PBKDF2, 600,000 iterations), localStorage
  persistence. Keys are created and signed in the browser only.
- `frontend/src/lib/transaction.ts` — PSBT construction and signing.
- `frontend/src/components/` — landing, create, import, unlock, dashboard,
  legacy, send, receive, history.
- `backend/` — Express API proxy (port 3001). Routes: balance, UTXOs,
  history, raw transaction, broadcast, chain info. Data sources mixed
  an eIquidus explorer and daemon RPC.
- `nginx/` — two server-block files with different behaviour (see below).
- `docker-compose.yml` — API service plus an nginx frontend service.

## Network parameters (from `frontend/src/lib/network.ts`)

- P2PKH prefix `0x35`, P2SH prefix `0x4b`, WIF prefix `0x57`.
- Bech32 human-readable part `nu`, coin type `662`.
- Derivation paths `m/44'/662'/0'/0/0` and `m/84'/662'/0'/0/0`.
- Smallest unit: 1 NUX = 100,000,000 nusan. Dust threshold used: 546 nusan.

## Findings that drive the later phases

1. Legacy (P2PKH) send is a sweep by design, not a partial send:
   the send form ignores the entered amount for legacy addresses and
   the transaction builder outputs `totalInput - fee` with no change
   output. Bech32 send already returns change, but has no handling
   for change that is still unconfirmed.
2. Balance, UTXO, history, and broadcast came from different sources
   with different response shapes, including a legacy RPC API that is
   not Esplora-compatible. A single Esplora-compatible source removes
   that mismatch.
3. The nginx block for the wallet subdomain proxied `/` to port 3002,
   which is not the wallet frontend. The separate `frontend.conf`
   already contains the correct static pattern: document root, SPA
   fallback to `index.html`, no-cache for `index.html`, long cache
   for hashed assets.
4. The Vite development server was previously used at runtime on
   port 5173. The repository already supports a production build
   (`frontend/dist`), so runtime does not need a Vite process.
5. The public electrs REST service is Esplora-compatible and was
   verified live before this work (tip height endpoint responding).
   It provides address stats, UTXOs, address transactions, mempool
   transactions, raw transaction hex, transaction status, and
   raw-transaction broadcast.

## Phase plan (one commit per phase, one branch)

- Phase 0 (this document): inventory only.
- Phase 1: static nginx serving, Express backend removed, Vite
  build-time only.
- Phase 2: electrs as the single data source for balance, UTXOs,
  history, raw transactions, and broadcast.
- Phase 3: local pending ledger so change from an unconfirmed
  transaction can be spent again, with balances split into
  confirmed, pending, and available, and legacy send brought to
  parity with bech32 send (explicit sweep as an option, not the
  default).

## Out of scope for this branch

- No merge, no live deployment, no change to the live subdomain.
- No change to key handling: keys stay in the browser, encrypted,
  and are never sent to any server.
- No real-funds broadcast test is part of this branch; verification
  is the frontend production build plus the manual checklist in
  the phase summaries.
