# QuantumPOS — PRD & Engineering Memory

## Original Problem Statement
Quantum-safe crypto POS & invoicing. Every SOL payment lands in a fresh per-invoice
Winternitz (WOTS) quantum-resistant vault on Solana mainnet (program
`13EtnfYGUH8NaGAnUpDTVgSsXoewNnULp7ESwHzQUANT`). Phantom wallet merchant auth + payout,
invoice creation, hosted checkout (Solana Pay QR + Connect Phantom & Pay), on-chain payment
watcher, one-click settlement (Close Vault sweep), receipts + explorer links, CSV export,
key-lifecycle safety, quantum-safety disclosures.

## User Choices (locked)
- **Real on-chain layer, NO simulation.** Backend builds genuine mainnet instructions and real WOTS signatures.
- Public mainnet RPC (`api.mainnet-beta.solana.com`), swappable via `SOLANA_RPC_URL`.
- SOL-only invoicing (USD estimate via free CoinGecko, display-only).
- Phantom connect + sign-message → JWT session (no passwords).
- Client-side QR + receipt data in MongoDB (no external storage).

## Architecture
- **Frontend**: React (CRA+craco) + Tailwind + shadcn/ui + framer-motion + Phosphor icons.
  `@solana/web3.js` + Phantom injected provider (`window.solana`). Routes: `/` (landing/dashboard),
  `/pay/:id` (public checkout). Webpack polyfills (Buffer/process/crypto/stream) added in craco.
- **Backend**: FastAPI + Motor (MongoDB). `/api`-prefixed. Modules:
  - `winternitz.py` — byte-exact Python port of `solana-winternitz` v0.1.1 (28-byte truncated
    Keccak-256 chains, 32 chains, 896-byte sig, balanced-merkle root). Validated against the
    crate's published test vector (PUBKEY + ADDRESS `HntXz…`).
  - `solana_vault.py` — PDA derivation (mainnet program id) + Open (34-byte) / Close (898-byte)
    instruction builders via `solders`.
  - `server.py` — SIWS Ed25519 auth (PyNaCl), invoice engine, WOTS lifecycle (envelope-encrypted
    with Fernet), open-tx/settle-tx builders, background balance watcher, checkout, stats, CSV, config.
- **DB collections**: challenges (TTL), merchants, invoices.

## On-chain flow (real)
1. Create invoice → server generates WOTS key (encrypted), derives real vault PDA + merkle root.
2. Merchant "Activate vault" → server returns Open Vault instruction; **Phantom signs & funds rent/fee**.
3. Customer opens checkout → pays SOL to vault PDA (Solana Pay QR or Connect Phantom & Pay).
4. Watcher polls mainnet `getBalance(vault)` → marks paid/underpaid/overpaid/expired.
5. Settle → server builds Close Vault with a one-time WOTS signature over the payout key; **Phantom
   signs as fee payer**; all lamports sweep to merchant payout wallet. Key retired (one-time guard).

## Implemented (2026-06)
- Phantom SIWS auth (challenge/verify/me) + merchant profile/payout.
- Invoice create + full lifecycle, real vault PDA + WOTS keygen.
- Open/Close instruction builders (verified 34 / 898 bytes, correct account metas).
- Hosted checkout (QR + pay), payment watcher, settlement, receipts + explorer links, CSV, stats.
- Quantum/crypto animations: WOTS 32-chain signing animation, keygen merklize animation, particle
  quantum-network background, terminal disclosure banner.
- Backend: 20/20 automated tests pass; confirm-open status guard + consistent 400s applied.

## Known scope / honesty
- Vault program is MIT, mainnet-live, **unaudited, research-grade**; protection is at-rest during
  the settlement window; Ed25519 transport is not quantum-safe. SOL-only, refunds out of scope.
- **Actual tx submission is browser-side via Phantom with real mainnet SOL** — not executable
  headlessly, so the real open/pay/settle round-trip is not auto-tested (instruction bytes + WOTS
  self-verification are).

## Backlog
- P1: Devnet "safe-test" mode toggle to exercise the full on-chain flow without real SOL.
- P1: Email/webhook notification on payment (in-app only today).
- P2: Split Vault partial settlement / tips; multi-item cart; getMultipleAccounts batched watcher;
  CoinGecko price caching; split server.py into routers.

## Iteration 3 (2026-10)
- Fixed Phantom SIWS "signature failed": challenge domain/URI bound to request Origin; Chain ID solana:mainnet; step-specific wallet errors.
- Always-visible inline invoice composer on dashboard (no "New invoice" dialog); fill without wallet, Phantom connect only on "Connect & generate vault".
- Full merchant branding (name, logo data-URL ≤300KB, accent hex, tagline, website, socials x/instagram/telegram/discord) — saved to merchant.branding and snapshotted per invoice (`invoice.branding`); localStorage `qpos_branding` pre-connect.
- Branded QR (logo centre, brand-colour modules auto-darkened for scan contrast, name/tagline/amount) on composer preview, invoice detail, checkout; checkout header/links branded.
- Header + landing link to x.com/tryquantumpos.
