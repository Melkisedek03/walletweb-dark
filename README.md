# Nusacoin Web Wallet v1.2.0

**Unofficial non-custodial (self-custody) web wallet for Nusacoin (NUX).**

Live at: [dompet.nusacoin.org](https://dompet.nusacoin.org)

---

## What is it?

Nusacoin Web Wallet is a browser-based, self-custody wallet that lets you create, manage, send, and receive NUX — all without trusting a third party with your private keys.

Your keys are generated and stored **only in your browser**, encrypted with your password using AES-256-GCM. The server never sees or stores any private keys, mnemonics, or passwords.

## Features

- **Create a new wallet** — generates a BIP39 12-word recovery phrase
- **Import an existing wallet** — restore from your 12-word recovery phrase
- **Wallet** — Provide Bech32 Address
- **Legacy** — Provide Legacy Address
- **Send NUX** — build and sign transactions entirely in the browser
- **Receive NUX** — display your address with a QR code for easy sharing
- **Transaction history** — view your recent incoming and outgoing transactions
- **Real-time balance** — fetched directly from the Nusacoin blockchain
- **Copy recovery phrase** — one-click copy for safe backup
- **Modern dark UI** — clean, responsive design inspired by MetaMask and Phantom

## Security

- **Non-custodial / Self-custody** — your private keys never leave your browser
- **AES-256-GCM encryption** — wallet data encrypted with your password (PBKDF2, 600,000 iterations)
- **BIP39 / BIP44 / BIP84 standard** — 12-word mnemonic, HD key derivation (`m/84'/662'/0'/0/0`)
- **No server-side accounts** — nothing to hack on the server
- **No tracking, no analytics** — your privacy is respected
- **Rate-limited API** — protection against abuse
- **HTTPS only** — all traffic encrypted in transit

> **Important:** This is a self-custody wallet. If you lose your 12-word recovery phrase and your password, **there is no way to recover your funds**. No one can help you — not even us. Always back up your recovery phrase in a safe place.

## How It Works

```
┌──────────────────────────┐          ┌──────────────────────────┐
│  Your Browser            │  HTTPS   │  Server                  │
│                          │◄────────►│                          │
│  - Generate keys (BIP39) │          │  API Proxy (read-only)   │
│  - Sign transactions     │          │  ├─ Balance              │
│  - Encrypt wallet (AES)  │          │  ├─ UTXOs                │
│  - Store in localStorage │          │  ├─ History              │
│                          │          │  └─ Broadcast signed TX  │
│  Keys NEVER leave here   │          │  No keys. No accounts.   │
└──────────────────────────┘          └──────────────────────────┘
```

There is no application backend. The static frontend talks to an
Esplora-compatible electrs service through the same-origin
`/electrs/` proxy in nginx, which provides:
- Balance lookups
- UTXO data for transaction building
- Transaction history
- Broadcasting of already-signed transactions
- Blockchain info

## Tech Stack

### Frontend
- React + TypeScript + Vite
- Tailwind CSS (dark mode)
- bitcoinjs-lib (transaction building & signing)
- bip39 / bip32 (key generation & derivation)
- Web Crypto API + AES-256-GCM (wallet encryption)
- qrcode.react (QR code generation)

### Data source
- Esplora-compatible electrs REST API, proxied same-origin at
  `/electrs/` by nginx (no application backend, no RPC credentials
  in the wallet deployment)

### Deployment
- Production build only: `npm run build` in `frontend/`, then serve
  `frontend/dist` with nginx (see `nginx/dompet.nusacoin.org.conf`).
  No Vite process and no application server run at runtime.
- Docker Compose (optional, static nginx only)
- Nginx with SSL (Let's Encrypt)

## Nusacoin Network Parameters

| Parameter | Value |
|-----------|-------|
| P2PKH prefix | `0x35` (addresses start with **N**) |
| P2SH prefix | `0x4b` (addresses start with **X**) |
| WIF prefix | `0x57` |
| bech32_hrp | `nu` |
| coin type | `662` |
| Derivation path BIP44 | `m/44'/662'/0'/0/0` |
| Derivation path BIP84 | `m/84'/662'/0'/0/0` |
| Smallest unit | 1 nusan = 0.00000001 NUX |

## Self-Hosting

### Prerequisites
- A running Nusacoin full node with RPC enabled
- Docker and Docker Compose
- Nginx with SSL (recommended)

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/TaobotX11/webwallet-dark.git
   cd webwallet-dark
   ```

2. Build the frontend:
   ```bash
   cd frontend
   npm install
   npm run build
   cd ..
   ```

3. Copy the build output to the nginx document root:

   ```bash
   # Example (adjust the path to the deployment)
   cp -r frontend/dist/* /usr/share/nginx/html/
   ```

4. Install `nginx/dompet.nusacoin.org.conf` as the site config and
   reload nginx. The config serves the static build and proxies
   `/electrs/` to the electrs service.

5. Configure SSL with Let's Encrypt (`certbot --nginx -d dompet.nusacoin.org`).

## License

MIT

## Links

- **Website:** [nusacoin.org](https://nusacoin.org)
- **Explorer 1:** [explorer.nusacoin.org](https://explorer.nusacoin.org)
- **Explorer 2:** [explorer.taobot.org](https://explorer.taobot.org)
- **Explorer 3:** [book.taobot.org](https://book.taobot.org)
- **Wallet:** [dompet.nusacoin.org](https://dompet.nusacoin.org)
- **Wallet 2:** [wallet.nusacoin.org](https://wallet.nusacoin.org)
- **Wallet 3:** [paper.nusacoin.org](https://paper.nusacoin.org)
- **Wallet Tool:** [dompet.taobot.org](https://dompet.taobot.org)
- **GitHub:** [github.com/TaobotX11/walletweb-dark](https://github.com/TaobotX11/walletweb-dark)
