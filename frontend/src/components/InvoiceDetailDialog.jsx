import { useState, useEffect } from "react";
import BrandedQR from "@/components/BrandedQR";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Copy, Check, ArrowSquareOut, LockKey, LockKeyOpen, Lightning, ArrowClockwise,
  Vault, ShieldCheck, Link as LinkIcon,
} from "@phosphor-icons/react";
import StatusBadge from "@/components/StatusBadge";
import SignatureAnimation from "@/components/SignatureAnimation";
import api from "@/lib/api";
import { sendOpenVault, sendCloseVault } from "@/lib/solanaClient";

function Row({ label, children, testid }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-2">
      <span className="font-plex-mono text-[11px] uppercase tracking-wider text-white/40">{label}</span>
      <span data-testid={testid} className="font-plex-mono text-xs text-white">{children}</span>
    </div>
  );
}

function short(a) { return a ? `${a.slice(0, 6)}…${a.slice(-6)}` : ""; }

export default function InvoiceDetailDialog({ invoice, open, onOpenChange, onUpdated, demo, onRequireAuth }) {
  const [inv, setInv] = useState(invoice);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [settlePhase, setSettlePhase] = useState(null); // null | signing | broadcasting | done
  const [settleInfo, setSettleInfo] = useState(null);

  useEffect(() => { setInv(invoice); setSettlePhase(null); }, [invoice]);

  if (!inv) return null;

  const checkoutUrl = `${window.location.origin}/pay/${inv.id}`;
  const update = (data) => { setInv(data); onUpdated?.(data); };

  const copy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 1200);
  };

  const refresh = async () => {
    if (demo) return onRequireAuth?.();
    setBusy(true);
    try {
      const { data } = await api.post(`/invoices/${inv.id}/check-payment`);
      update(data);
      if (data.status === "paid" || data.status === "overpaid") toast.success("Payment confirmed on-chain");
      else if (data.status === "underpaid") toast.warning("Underpayment detected");
      else toast.info("No payment yet");
    } catch (e) {
      toast.error("Could not check payment");
    } finally { setBusy(false); }
  };

  const activate = async () => {
    if (demo) return onRequireAuth?.();
    setBusy(true);
    try {
      const { data: tx } = await api.get(`/invoices/${inv.id}/open-tx`);
      toast.message("Approve in Phantom", { description: "Opening the quantum vault on-chain (rent + fee)." });
      const sig = await sendOpenVault(tx, tx.fee_payer);
      const { data } = await api.post(`/invoices/${inv.id}/confirm-open`, { signature: sig });
      update(data);
      toast.success("Vault activated — now accepting payments");
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Activation failed");
    } finally { setBusy(false); }
  };

  const settle = async () => {
    if (demo) return onRequireAuth?.();
    setBusy(true);
    try {
      const { data: tx } = await api.get(`/invoices/${inv.id}/settle-tx`);
      setSettleInfo(tx);
      setSettlePhase("signing");
      await new Promise((r) => setTimeout(r, 2100)); // let the WOTS chain animation play
      setSettlePhase("broadcasting");
      const label = tx.mode === "split"
        ? `Broadcasting Split Vault — ${tx.split_sol} SOL to partner, ${tx.refund_sol} SOL to you.`
        : "Broadcasting Close Vault (one-time signature).";
      toast.message("Approve in Phantom", { description: label });
      const sig = await sendCloseVault(tx, tx.fee_payer);
      const { data } = await api.post(`/invoices/${inv.id}/confirm-settle`, { signature: sig });
      setSettlePhase("done");
      await new Promise((r) => setTimeout(r, 1400));
      update(data);
      setSettlePhase(null);
      toast.success("Settled — SOL swept to your payout wallet");
    } catch (e) {
      setSettlePhase(null);
      toast.error(e?.response?.data?.detail || e?.message || "Settlement failed");
    } finally { setBusy(false); }
  };

  const canSettle = ["paid", "overpaid"].includes(inv.status) ||
    (["active", "underpaid"].includes(inv.status) && inv.received_lamports > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!settlePhase) onOpenChange(o); }}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] min-w-0 overflow-y-auto overflow-x-hidden rounded-none border-white/10 bg-quantum-ink p-4 sm:max-w-lg sm:p-6 [&>*]:min-w-0">
        <AnimatePresence mode="wait">
          {settlePhase ? (
            <motion.div key="settle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="py-6">
              <DialogHeader>
                <DialogTitle className="mb-4 flex items-center gap-2 font-mono tracking-tight">
                  <Lightning weight="fill" className="h-5 w-5 text-quantum-green" /> Settling vault
                </DialogTitle>
              </DialogHeader>
              <SignatureAnimation phase={settlePhase}
                caption={settleInfo?.mode === "split"
                  ? `Split Vault · ${settleInfo.split_sol} SOL → partner, ${settleInfo.refund_sol} SOL → you`
                  : `Signing over payout key ${short(inv.vault_address)}`} />
            </motion.div>
          ) : (
            <motion.div key="detail" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <DialogHeader>
                <DialogTitle className="flex items-center justify-between gap-3 font-mono tracking-tight">
                  <span className="flex items-center gap-2">
                    <Vault weight="fill" className="h-5 w-5 text-quantum-green" />
                    {inv.amount_sol} SOL
                  </span>
                  <StatusBadge status={inv.status} testid="detail-status" />
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-5 py-2">
                {inv.memo && <p className="font-plex-mono text-sm text-white/60">{inv.memo}</p>}

                {/* QR + checkout */}
                <div className="flex flex-col items-center gap-3 border border-white/10 bg-black/40 p-5 backdrop-blur-xl">
                  <BrandedQR testid="checkout-qr" value={inv.solana_pay_url} branding={inv.branding}
                    fallbackName={inv.merchant_name} amountSol={inv.amount_sol} size={160} />
                  <p className="font-plex-mono text-[10px] uppercase tracking-widest text-white/40">Solana Pay · scan to pay</p>
                  <div className="flex w-full items-center gap-2">
                    <code className="min-w-0 flex-1 truncate border border-white/10 bg-black px-2 py-1.5 font-plex-mono text-[11px] text-quantum-cyan">
                      {checkoutUrl}
                    </code>
                    <Button data-testid="copy-checkout-link" size="icon" variant="ghost"
                      onClick={() => copy(checkoutUrl, "link")}
                      className="h-8 w-8 shrink-0 rounded-none text-white/60 hover:bg-white/5 hover:text-quantum-green">
                      {copied === "link" ? <Check className="h-4 w-4" /> : <LinkIcon className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                {/* details */}
                <div>
                  <Row label="Received" testid="detail-received">
                    <span className={inv.received_sol > 0 ? "text-quantum-green" : "text-white/50"}>
                      {inv.received_sol} / {inv.amount_sol} SOL
                    </span>
                  </Row>
                  {inv.tip_sol > 0 && (
                    <Row label="Tip" testid="detail-tip">
                      <span className="text-quantum-cyan">+{inv.tip_sol} SOL</span>
                    </Row>
                  )}
                  {inv.split_address && (
                    <Row label="Split payout" testid="detail-split">
                      <span className="text-quantum-purple">
                        {inv.split_type === "percent" ? `${inv.split_value}%` : `${inv.split_value} SOL`} → {short(inv.split_address)}
                      </span>
                    </Row>
                  )}
                  <Row label="Vault PDA">
                    <button onClick={() => copy(inv.vault_address, "vault")}
                      className="flex items-center gap-1.5 hover:text-quantum-green">
                      {short(inv.vault_address)}
                      {copied === "vault" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </Row>
                  <Row label="Merkle root">{short(inv.merkle_root)}</Row>
                  <Row label="One-time key">
                    {inv.key_used ? (
                      <span className="flex items-center gap-1 text-white/40"><LockKeyOpen className="h-3.5 w-3.5" /> retired</span>
                    ) : (
                      <span className="flex items-center gap-1 text-quantum-green"><LockKey className="h-3.5 w-3.5" /> armed · single-use</span>
                    )}
                  </Row>
                  {inv.explorer_open && (
                    <Row label="Open tx">
                      <a href={inv.explorer_open} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 text-quantum-cyan hover:underline">
                        explorer <ArrowSquareOut className="h-3 w-3" />
                      </a>
                    </Row>
                  )}
                  {inv.explorer_close && (
                    <Row label="Settle tx" testid="detail-settle-tx">
                      <a href={inv.explorer_close} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 text-quantum-cyan hover:underline">
                        explorer <ArrowSquareOut className="h-3 w-3" />
                      </a>
                    </Row>
                  )}
                </div>

                {/* actions */}
                <div className="flex flex-col gap-2">
                  {inv.status === "created" && (
                    <Button data-testid="activate-vault-btn" onClick={activate} disabled={busy}
                      className="btn-sheen w-full rounded-none bg-quantum-purple font-mono font-bold text-white hover:bg-quantum-purple/80">
                      <ShieldCheck weight="fill" className="mr-2 h-4 w-4" />
                      {busy ? "Opening vault…" : "Activate vault (sign with Phantom)"}
                    </Button>
                  )}
                  {inv.status !== "created" && inv.status !== "settled" && inv.status !== "expired" && (
                    <div className="grid grid-cols-2 gap-2">
                      <Button data-testid="check-payment-btn" onClick={refresh} disabled={busy}
                        variant="outline"
                        className="rounded-none border-white/15 bg-transparent font-mono text-white hover:bg-white/5">
                        <ArrowClockwise className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Check
                      </Button>
                      <Button data-testid="settle-btn" onClick={settle} disabled={busy || !canSettle}
                        className="btn-sheen rounded-none bg-quantum-green font-mono font-bold text-black hover:bg-quantum-greenDark disabled:opacity-40">
                        <Lightning weight="fill" className="mr-2 h-4 w-4" /> Settle & sweep
                      </Button>
                    </div>
                  )}
                  {inv.status === "settled" && (
                    <div className="flex items-center justify-center gap-2 border border-quantum-green/40 bg-quantum-green/10 py-3 font-mono text-sm text-quantum-green">
                      <ShieldCheck weight="fill" className="h-5 w-5" /> Settled · funds swept to payout wallet
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
