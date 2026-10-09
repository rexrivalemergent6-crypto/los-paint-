import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Wallet, Vault, Lightning, ArrowRight, GithubLogo, ShieldWarning, TreeStructure,
  Key, HandCoins, Atom, XLogo,
} from "@phosphor-icons/react";
import QuantumBackground from "@/components/QuantumBackground";
import QuantumBanner from "@/components/QuantumBanner";
import { useAuth } from "@/context/AuthContext";
import { isMobile, phantomBrowseUrl } from "@/lib/phantom";
import { ConfigContext } from "@/App";

const FEATURES = [
  { icon: Vault, title: "Per-invoice vault", body: "Every payment lands in a fresh Winternitz PDA derived from a one-time Keccak merkle root." },
  { icon: Lightning, title: "One-click settle", body: "Close the vault with a single-use WOTS signature; SOL sweeps straight to your Phantom wallet." },
  { icon: Wallet, title: "Phantom native", body: "Connect-and-sign auth. No passwords, no custody of your payout keys — ever." },
];

const TECH = [
  {
    icon: ShieldWarning, title: "The quantum threat is real",
    body: "A large quantum computer running Shor's algorithm can derive an Ed25519 private key from its public key. Every ordinary Solana wallet exposes its public key the moment it signs — so 'harvest now, decrypt later' puts future funds at risk.",
  },
  {
    icon: Atom, title: "Hash-based, not curve-based",
    body: "Winternitz One-Time Signatures rely only on the preimage resistance of Keccak-256 — not elliptic curves. Grover's algorithm only square-roots that cost, so the 224-bit truncated hash still leaves ~112-bit quantum security.",
  },
  {
    icon: TreeStructure, title: "Vault = PDA from a merkle root",
    body: "We generate a 32-chain WOTS keypair, hash the public key into a Keccak merkle root, and use it as the seed of a Program-Derived Address. The deposit address itself is the cryptographic commitment.",
  },
  {
    icon: Key, title: "Strictly one-time keys",
    body: "Signing a WOTS message reveals ~half the private key, so each vault is spent exactly once and then retired. The server holds these keys envelope-encrypted and enforces single-use — Phantom can't hold them.",
  },
  {
    icon: HandCoins, title: "Non-custodial by construction",
    body: "The backend only builds instructions and the one-time signature. Your Phantom wallet funds the vault rent and signs settlement as fee payer — the server never touches your payout keys or your SOL.",
  },
  {
    icon: Vault, title: "Honest scope",
    body: "The vault program is MIT & mainnet-live but unaudited and research-grade. Protection is at-rest during the settlement window; SOL-only; Ed25519 transport is not itself quantum-safe.",
  },
];

const STEPS = [
  { n: "01", t: "Create invoice", d: "Backend generates a WOTS keypair and derives a real vault PDA." },
  { n: "02", t: "Activate vault", d: "Phantom signs Open Vault — the PDA becomes program-owned." },
  { n: "03", t: "Customer pays", d: "SOL (plus optional tip) lands in the quantum vault via Solana Pay." },
  { n: "04", t: "Settle & sweep", d: "One-time WOTS signature closes the vault; SOL sweeps to you (and any split)." },
];

export default function Landing() {
  const { login, enterPreview: _enterPreview, connecting, hasPhantom, merchant } = useAuth();
  const navigate = useNavigate();
  const enterPreview = () => { _enterPreview(); navigate("/app"); };
  const [err, setErr] = useState("");
  const cfg = ConfigContext.current;

  const handleConnect = async () => {
    setErr("");
    try {
      await login();
      toast.success("Wallet verified — welcome to QuantumPOS");
      navigate("/app");
    } catch (e) {
      const msg = e?.message || "Connection failed";
      setErr(msg);
      toast.error(msg);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="absolute inset-0 z-0 opacity-70">
        <QuantumBackground density={70} opacity={0.6} />
      </div>
      <div className="pointer-events-none absolute inset-0 z-0 grid-tech opacity-40" />

      <div className="relative z-10 mx-auto max-w-6xl px-5 py-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center bg-quantum-green">
              <Vault weight="fill" className="h-5 w-5 text-black" />
            </div>
            <span className="font-mono text-lg font-bold tracking-tighter">QuantumPOS</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="https://github.com/blueshift-gg/solana-winternitz-vault" target="_blank" rel="noreferrer"
              className="hidden items-center gap-1.5 font-plex-mono text-xs text-white/50 transition-colors hover:text-quantum-green sm:flex">
              <GithubLogo className="h-4 w-4" /> vault program
            </a>
            <a data-testid="landing-x-link" href="https://x.com/tryquantumpos" target="_blank" rel="noreferrer"
              aria-label="QuantumPOS on X"
              className="flex items-center gap-1.5 border border-white/15 px-3 py-1.5 font-plex-mono text-xs text-white/70 transition-colors hover:border-white/40 hover:text-white">
              <XLogo weight="bold" className="h-4 w-4" /> @tryquantumpos
            </a>
          </div>
        </header>

        {/* hero */}
        <div className="flex flex-col justify-center py-16">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
            className="max-w-3xl">
            <div className="mb-5 inline-flex items-center gap-2 border border-quantum-purple/40 bg-quantum-purple/5 px-3 py-1 font-plex-mono text-[11px] uppercase tracking-[0.2em] text-quantum-purple">
              <span className="h-1.5 w-1.5 rounded-full bg-quantum-purple" /> Solana {cfg?.cluster || "mainnet-beta"} · live
            </div>
            <h1 className="font-mono text-5xl font-black leading-[0.95] tracking-tighter sm:text-6xl">
              Quantum-safe<br />
              <span className="text-quantum-green">crypto checkout</span><br />
              for merchants.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-white/60">
              A point-of-sale where every SOL payment settles through a post-quantum Winternitz
              vault. Create an invoice, share a checkout link, and sweep funds to your Phantom wallet
              with a one-time hash-based signature.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button data-testid="launch-app-btn" onClick={enterPreview}
                className="btn-sheen group h-12 rounded-none bg-quantum-green px-7 font-mono text-sm font-bold text-black transition-transform hover:-translate-y-0.5 hover:bg-quantum-greenDark">
                {merchant ? "Open dashboard" : "Launch app"}
                <ArrowRight weight="bold" className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
              {!merchant && (
              <Button data-testid="phantom-connect-btn" onClick={handleConnect} disabled={connecting}
                variant="outline"
                className="h-12 rounded-none border-quantum-purple/50 bg-quantum-purple/5 px-6 font-mono text-sm font-bold text-quantum-purple transition-transform hover:-translate-y-0.5 hover:bg-quantum-purple/10">
                <Wallet weight="fill" className="mr-2 h-4 w-4" />
                {connecting ? "Awaiting signature…" : "Connect Phantom"}
              </Button>
              )}
            </div>
            <p className="mt-3 font-plex-mono text-[11px] text-white/35">
              Explore the full dashboard first — connect a wallet only when you're ready to go live.
            </p>
            {!hasPhantom && isMobile() && (
              <a href={phantomBrowseUrl()} data-testid="open-in-phantom-link"
                className="mr-4 mt-1 inline-block font-plex-mono text-xs text-quantum-green underline underline-offset-4">
                Open in Phantom app →
              </a>
            )}
            {!hasPhantom && !isMobile() && (
              <a href="https://phantom.app/" target="_blank" rel="noreferrer"
                data-testid="install-phantom-link"
                className="mt-1 inline-block font-plex-mono text-xs text-quantum-purple underline underline-offset-4">
                Phantom not detected — install it →
              </a>
            )}
            {err && <p data-testid="landing-error" className="mt-3 font-plex-mono text-xs text-red-400">{err}</p>}
          </motion.div>

          <div className="mt-16 grid grid-cols-1 gap-px border border-white/10 bg-white/10 sm:grid-cols-3">
            {FEATURES.map((f, i) => (
              <motion.div key={f.title}
                initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.1 * i }}
                className="bg-quantum-ink p-6">
                <f.icon weight="duotone" className="h-7 w-7 text-quantum-green" />
                <h3 className="mt-4 font-mono text-sm font-bold tracking-tight">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/50">{f.body}</p>
              </motion.div>
            ))}
          </div>

          <div className="mt-8"><QuantumBanner /></div>
        </div>

        {/* technical: why it matters */}
        <section className="border-t border-white/10 py-16">
          <div className="mb-10 max-w-2xl">
            <p className="font-plex-mono text-[11px] uppercase tracking-[0.2em] text-quantum-cyan">// why this matters</p>
            <h2 className="mt-3 font-mono text-3xl font-bold tracking-tighter sm:text-4xl">
              Post-quantum security, without waiting for the base layer.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-white/50">
              Solana's accounts are secured by Ed25519 — strong today, breakable by a sufficiently
              large quantum computer. QuantumPOS routes merchant revenue through an opt-in,
              hash-based vault so funds are protected while they sit waiting to be settled.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-px border border-white/10 bg-white/10 md:grid-cols-2 lg:grid-cols-3">
            {TECH.map((t, i) => (
              <motion.div key={t.title}
                initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                transition={{ duration: 0.45, delay: 0.05 * i }}
                className="bg-quantum-ink p-6">
                <t.icon weight="duotone" className="h-6 w-6 text-quantum-cyan" />
                <h3 className="mt-4 font-mono text-sm font-bold tracking-tight">{t.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-white/50">{t.body}</p>
              </motion.div>
            ))}
          </div>

          {/* scheme snippet */}
          <div className="mt-8 border border-white/10 bg-black p-5 font-plex-mono text-[12px] leading-relaxed text-white/60">
            <p className="text-white/30"># Winternitz vault scheme (per invoice)</p>
            <p><span className="text-quantum-purple">priv</span>  = 32 chains × 28 random bytes</p>
            <p><span className="text-quantum-green">pub[i]</span> = keccak256₂₂₄⁽²⁵⁶⁾(priv[i])<span className="text-white/30">   // hash each chain 256×</span></p>
            <p><span className="text-quantum-cyan">root</span>  = merklize(pub)         <span className="text-white/30">// PDA seed → vault address</span></p>
            <p><span className="text-quantum-warning">sign</span>  = reveal partial preimages over message(payout)</p>
            <p className="text-white/30">// signature validates on-chain, closes vault, sweeps SOL. key retired.</p>
          </div>
        </section>

        {/* how it works */}
        <section className="border-t border-white/10 py-16">
          <p className="font-plex-mono text-[11px] uppercase tracking-[0.2em] text-quantum-green">// how it works</p>
          <div className="mt-8 grid grid-cols-1 gap-px border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <motion.div key={s.n}
                initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                transition={{ duration: 0.4, delay: 0.08 * i }}
                className="bg-quantum-ink p-6">
                <span className="font-mono text-3xl font-black tracking-tighter text-white/15">{s.n}</span>
                <h3 className="mt-3 font-mono text-sm font-bold tracking-tight text-quantum-green">{s.t}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-white/50">{s.d}</p>
              </motion.div>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Button data-testid="launch-app-btn-2" onClick={enterPreview}
              className="btn-sheen group h-12 rounded-none bg-quantum-green px-7 font-mono text-sm font-bold text-black transition-transform hover:-translate-y-0.5 hover:bg-quantum-greenDark">
              Launch the dashboard
              <ArrowRight weight="bold" className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
            <span className="font-plex-mono text-xs text-white/40">No wallet required to look around.</span>
          </div>
        </section>

        <footer className="border-t border-white/10 py-8 font-plex-mono text-[11px] text-white/30">
          QuantumPOS · Solana {cfg?.cluster || "mainnet-beta"} · vault program{" "}
          <span className="text-white/50">{(cfg?.program_id || "").slice(0, 8)}…QUANT</span> · research-grade, unaudited
        </footer>
      </div>
    </div>
  );
}
