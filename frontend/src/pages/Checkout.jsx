import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import BrandedQR from "@/components/BrandedQR";
import BrandLinks from "@/components/BrandLinks";
import { normalizeBranding } from "@/lib/branding";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Vault, Wallet, CheckCircle, ArrowClockwise, ShieldCheck, Clock, ArrowSquareOut,
} from "@phosphor-icons/react";
import QuantumBackground from "@/components/QuantumBackground";
import QuantumBanner from "@/components/QuantumBanner";
import StatusBadge from "@/components/StatusBadge";
import api from "@/lib/api";
import { connectPhantom, hasPhantom, isMobile, phantomBrowseUrl } from "@/lib/phantom";
import { sendPayment } from "@/lib/solanaClient";

export default function Checkout() {
  const { id } = useParams();
  const [inv, setInv] = useState(null);
  const [err, setErr] = useState("");
  const [paying, setPaying] = useState(false);
  const [checking, setChecking] = useState(false);
  const [tipPct, setTipPct] = useState(0);
  const [customTip, setCustomTip] = useState("");

  const refresh = useCallback(async (silent = true) => {
    if (!silent) setChecking(true);
    try {
      const { data } = await api.post(`/checkout/${id}/check`);
      setInv(data);
    } catch (e) {
      if (e?.response?.status === 404) setErr("Invoice not found");
    } finally { if (!silent) setChecking(false); }
  }, [id]);

  useEffect(() => {
    api.get(`/checkout/${id}`).then(({ data }) => setInv(data)).catch(() => setErr("Invoice not found"));
    const t = setInterval(() => refresh(true), 9000);
    return () => clearInterval(t);
  }, [id, refresh]);

  const pay = async () => {
    setPaying(true);
    try {
      const from = await connectPhantom();
      const tipLamports = computeTipLamports();
      const total = inv.amount_lamports + tipLamports;
      toast.message("Approve in Phantom", { description: `Sending ${(total / 1e9).toFixed(4)} SOL to the quantum vault.` });
      const sig = await sendPayment(from, inv.vault_address, total);
      toast.success("Payment sent — confirming on-chain");
      await refresh(false);
      setTimeout(() => refresh(true), 4000);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Payment failed or cancelled");
    } finally { setPaying(false); }
  };

  if (err) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-quantum-ink">
        <p data-testid="checkout-error" className="font-plex-mono text-sm text-red-400">{err}</p>
      </div>
    );
  }
  if (!inv) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-quantum-ink">
        <p className="font-plex-mono text-sm text-quantum-green">loading checkout<span className="cursor-blink">▊</span></p>
      </div>
    );
  }

  const settled = inv.status === "settled";
  const paid = ["paid", "overpaid"].includes(inv.status) || settled;
  const payable = ["active", "underpaid"].includes(inv.status);
  const notActive = inv.status === "created";
  const expired = inv.status === "expired";

  const computeTipLamports = () => {
    if (!inv.allow_tips) return 0;
    if (tipPct === -1) {
      const c = parseFloat(customTip);
      return c > 0 ? Math.round(c * 1e9) : 0;
    }
    return Math.round((tipPct / 100) * inv.amount_lamports);
  };
  const tipLamports = computeTipLamports();
  const totalSol = (inv.amount_lamports + tipLamports) / 1e9;
  const payUrl = `solana:${inv.vault_address}?amount=${totalSol}`;
  const brand = normalizeBranding(inv.branding);
  const accent = brand.accent_color;
  const TIP_OPTS = [{ p: 0, l: "None" }, { p: 10, l: "10%" }, { p: 15, l: "15%" }, { p: 20, l: "20%" }, { p: -1, l: "Custom" }];

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="absolute inset-0 z-0">
        <img src="https://images.unsplash.com/photo-1639322537228-f710d846310a?crop=entropy&cs=srgb&fm=jpg&q=85&w=1600"
          alt="" className="h-full w-full object-cover opacity-20" />
        <div className="absolute inset-0 bg-quantum-ink/80" />
        <QuantumBackground density={50} opacity={0.5} />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="border bg-black/60 p-6 backdrop-blur-xl" style={{ borderColor: `${accent}55`, borderTop: `3px solid ${accent}` }}>
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              {brand.logo ? (
                <img data-testid="checkout-brand-logo" src={brand.logo} alt="" className="h-10 w-10 shrink-0 bg-white object-contain p-0.5" />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center" style={{ background: accent }}>
                  <Vault weight="fill" className="h-5 w-5 text-black" />
                </div>
              )}
              <div className="min-w-0">
                <p data-testid="checkout-brand-name" className="truncate font-mono text-base font-bold tracking-tighter">{inv.merchant_name}</p>
                {brand.tagline && <p data-testid="checkout-brand-tagline" className="truncate font-plex-mono text-[11px] text-white/50">{brand.tagline}</p>}
              </div>
            </div>
            <StatusBadge status={inv.status} testid="checkout-status" />
          </div>

          <div className="text-center">
            <p className="font-plex-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Amount due</p>
            <div className="mt-1 font-mono text-5xl font-black tracking-tighter" style={{ color: accent }}>
              {inv.amount_sol} <span className="text-xl text-white/40">SOL</span>
            </div>
            {inv.usd_rate && <p className="mt-1 font-plex-mono text-xs text-white/40">≈ ${(inv.amount_sol * inv.usd_rate).toFixed(2)} USD</p>}
            {inv.memo && <p className="mt-3 font-plex-mono text-sm text-white/60">{inv.memo}</p>}
          </div>

          <AnimatePresence mode="wait">
            {paid ? (
              <motion.div key="paid" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                className="mt-6 flex flex-col items-center gap-3 border border-quantum-green/40 bg-quantum-green/10 p-6">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", delay: 0.1 }}>
                  <CheckCircle weight="fill" className="h-14 w-14 text-quantum-green" />
                </motion.div>
                <p className="font-mono text-lg font-bold text-quantum-green">
                  {settled ? "Settled" : "Payment received"}
                </p>
                <p className="text-center font-plex-mono text-xs text-white/50">
                  {settled ? "Funds swept to the merchant's quantum-safe payout wallet."
                    : "Your SOL is secured in the Winternitz vault awaiting settlement."}
                </p>
                {inv.explorer_close && (
                  <a href={inv.explorer_close} target="_blank" rel="noreferrer"
                    data-testid="checkout-receipt-link"
                    className="flex items-center gap-1 font-plex-mono text-xs text-quantum-cyan hover:underline">
                    view receipt <ArrowSquareOut className="h-3 w-3" />
                  </a>
                )}
              </motion.div>
            ) : (
              <motion.div key="pay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-6">
                <BrandedQR testid="checkout-pay-qr" value={payUrl} branding={brand} fallbackName={inv.merchant_name}
                  amountSol={Number(totalSol.toFixed(6))} size={176} />
                <p className="mt-2 text-center font-plex-mono text-[10px] uppercase tracking-widest text-white/40">
                  Scan with any Solana wallet
                </p>

                {inv.allow_tips && payable && (
                  <div className="mt-4" data-testid="tip-selector">
                    <p className="mb-1.5 font-plex-mono text-[10px] uppercase tracking-widest text-white/40">Add a tip</p>
                    <div className="grid grid-cols-5 gap-px border border-white/10 bg-white/10">
                      {TIP_OPTS.map((o) => (
                        <button key={o.l} data-testid={`tip-${o.l}`} onClick={() => setTipPct(o.p)}
                          className={`bg-quantum-ink py-2 font-plex-mono text-[11px] transition-colors ${tipPct === o.p ? "text-quantum-cyan" : "text-white/40 hover:text-white"}`}>
                          {o.l}
                        </button>
                      ))}
                    </div>
                    {tipPct === -1 && (
                      <input data-testid="custom-tip-input" type="number" step="0.001" min="0" value={customTip}
                        onChange={(e) => setCustomTip(e.target.value)} placeholder="Tip in SOL"
                        className="mt-2 w-full border border-white/15 bg-black px-3 py-2 font-mono text-sm text-white outline-none focus:border-quantum-cyan" />
                    )}
                    {tipLamports > 0 && (
                      <p className="mt-2 text-center font-plex-mono text-xs text-quantum-cyan">
                        Total: {totalSol.toFixed(4)} SOL (incl. {(tipLamports / 1e9).toFixed(4)} tip)
                      </p>
                    )}
                  </div>
                )}

                {notActive && (
                  <div className="mt-4 flex items-center gap-2 border border-quantum-warning/30 bg-quantum-warning/5 p-3 font-plex-mono text-[11px] text-quantum-warning">
                    <Clock className="h-4 w-4 shrink-0" /> Vault is being activated by the merchant. Payment opens shortly.
                  </div>
                )}
                {expired && (
                  <div className="mt-4 border border-white/10 bg-white/5 p-3 text-center font-plex-mono text-xs text-white/50">
                    This invoice has expired.
                  </div>
                )}
                {inv.status === "underpaid" && (
                  <div className="mt-4 border border-orange-400/30 bg-orange-400/5 p-3 font-plex-mono text-[11px] text-orange-300">
                    Received {inv.received_sol} / {inv.amount_sol} SOL. Send the remainder to complete.
                  </div>
                )}

                <Button data-testid="pay-phantom-btn" onClick={pay} disabled={paying || !payable || !hasPhantom()}
                  className="btn-sheen mt-4 h-12 w-full rounded-none bg-quantum-purple font-mono font-bold text-white transition-transform hover:-translate-y-0.5 hover:bg-quantum-purple/80 disabled:opacity-40">
                  <Wallet weight="fill" className="mr-2 h-5 w-5" />
                  {paying ? "Confirm in Phantom…" : "Connect Phantom & Pay"}
                </Button>
                {!hasPhantom() && isMobile() && (
                  <a href={phantomBrowseUrl()} data-testid="checkout-open-in-phantom"
                    className="mt-2 block text-center font-plex-mono text-[11px] text-quantum-green underline">
                    Open this checkout in the Phantom app
                  </a>
                )}
                {!hasPhantom() && !isMobile() && (
                  <a href="https://phantom.app/" target="_blank" rel="noreferrer"
                    className="mt-2 block text-center font-plex-mono text-[11px] text-quantum-purple underline">
                    Install Phantom to pay in-browser
                  </a>
                )}
                <button data-testid="checkout-refresh-btn" onClick={() => refresh(false)} disabled={checking}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 font-plex-mono text-[11px] text-white/40 hover:text-white">
                  <ArrowClockwise className={`h-3 w-3 ${checking ? "animate-spin" : ""}`} /> refresh status
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <BrandLinks branding={brand} className="mt-6" />

          <div className="mt-4 flex items-center justify-center gap-1.5 font-plex-mono text-[10px] text-white/30">
            <ShieldCheck weight="fill" className="h-3.5 w-3.5 text-quantum-green" />
            Secured by a post-quantum Winternitz vault
          </div>
        </motion.div>

        <div className="mt-4"><QuantumBanner compact /></div>
      </div>
    </div>
  );
}
