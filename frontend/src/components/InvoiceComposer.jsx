import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  CurrencyDollar, PaintBrush, UploadSimple, Trash, Globe, XLogo, InstagramLogo, TelegramLogo,
  DiscordLogo, Lightning, Receipt,
} from "@phosphor-icons/react";
import KeygenAnimation from "@/components/KeygenAnimation";
import BrandedQR from "@/components/BrandedQR";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import {
  EMPTY_BRANDING, normalizeBranding, loadLocalBranding, saveLocalBranding, resizeLogo, hasBranding, readableText,
} from "@/lib/branding";

const EXPIRY_OPTS = [
  { v: 30, l: "30 min" }, { v: 60, l: "1 hr" }, { v: 240, l: "4 hr" }, { v: 1440, l: "24 hr" },
];
const SWATCHES = ["#14F195", "#9945FF", "#00C2FF", "#FF5C00", "#FF2E88", "#FFD600", "#FFFFFF"];
const SOCIALS = [
  { k: "x", Icon: XLogo, ph: "x.com/yourbrand" },
  { k: "instagram", Icon: InstagramLogo, ph: "instagram.com/yourbrand" },
  { k: "telegram", Icon: TelegramLogo, ph: "t.me/yourbrand" },
  { k: "discord", Icon: DiscordLogo, ph: "discord.gg/invite" },
];

const lbl = "font-plex-mono text-xs uppercase tracking-wider text-white/60";
const inp = "mt-1.5 rounded-none border-white/15 bg-black font-plex-mono text-sm";

export default function InvoiceComposer({ onCreated, solUsd }) {
  const { merchant, requireAuth, setMerchant } = useAuth();
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [expiry, setExpiry] = useState(60);
  const [allowTips, setAllowTips] = useState(true);
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitAddress, setSplitAddress] = useState("");
  const [splitType, setSplitType] = useState("percent");
  const [splitValue, setSplitValue] = useState("");
  const [branding, setBranding] = useState(() => loadLocalBranding() || normalizeBranding(EMPTY_BRANDING));
  const [generating, setGenerating] = useState(false);
  const fileRef = useRef(null);
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;

  // Adopt the merchant's saved branding after connecting, if nothing was filled locally.
  useEffect(() => {
    if (merchant?.branding && hasBranding(merchant.branding) && !hasBranding(loadLocalBranding())) {
      setBranding(normalizeBranding(merchant.branding));
    }
  }, [merchant]);

  useEffect(() => { saveLocalBranding(branding); }, [branding]);

  const setB = (k, v) => setBranding((b) => ({ ...b, [k]: v }));
  const setSocial = (k, v) => setBranding((b) => ({ ...b, socials: { ...b.socials, [k]: v } }));

  const onLogo = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try { setB("logo", await resizeLogo(file)); } catch (err) { toast.error(err.message); }
  };

  const reset = () => {
    setAmount(""); setMemo(""); setExpiry(60); setAllowTips(true);
    setSplitEnabled(false); setSplitAddress(""); setSplitType("percent"); setSplitValue("");
  };

  const submit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid SOL amount"); return; }
    const payload = { amount_sol: amt, memo, expiry_minutes: expiry, allow_tips: allowTips, branding };
    if (splitEnabled) {
      const val = parseFloat(splitValue);
      if (!splitAddress.trim()) { toast.error("Enter a split payout address"); return; }
      if (!val || val <= 0) { toast.error("Enter a split amount"); return; }
      if (splitType === "percent" && val >= 100) { toast.error("Percent split must be < 100"); return; }
      payload.split_address = splitAddress.trim();
      payload.split_type = splitType;
      payload.split_value = val;
    }
    // Connect only now — everything above can be filled without a wallet.
    if (!merchant) {
      try {
        await requireAuth();
      } catch (e) {
        toast.error(e?.message || "Wallet connection cancelled");
        return;
      }
    }
    setGenerating(true);
    try {
      const [{ data }] = await Promise.all([
        api.post("/invoices", payload),
        new Promise((r) => setTimeout(r, 1600)),
      ]);
      toast.success("Quantum vault generated");
      api.get("/auth/me").then(({ data: m }) => setMerchant(m)).catch(() => {});
      reset();
      // ref: after a mid-submit wallet connect, call the freshest parent callback
      setTimeout(() => onCreatedRef.current?.(data), 0);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not create invoice");
    } finally {
      setGenerating(false);
    }
  };

  const usd = amount && solUsd ? (parseFloat(amount) * solUsd).toFixed(2) : null;
  const previewAmt = parseFloat(amount) > 0 ? parseFloat(amount) : 0;

  return (
    <section data-testid="invoice-composer" className="relative mb-6 border border-white/10 bg-quantum-ink">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-5 py-3">
        <h2 className="flex items-center gap-2 font-plex-mono text-xs uppercase tracking-[0.2em] text-white/50">
          <Receipt className="h-4 w-4 text-quantum-green" /> New invoice
        </h2>
        {!merchant && (
          <span data-testid="composer-connect-hint" className="font-plex-mono text-[10px] uppercase tracking-widest text-quantum-warning/80">
            fill it in now · connect Phantom only when you generate
          </span>
        )}
      </div>

      <div className="grid gap-px bg-white/10 lg:grid-cols-[1fr_1fr_auto]">
        {/* invoice fields */}
        <div className="space-y-4 bg-quantum-ink p-5">
          <div>
            <Label className={lbl}>Amount (SOL)</Label>
            <div className="relative mt-1.5">
              <Input data-testid="invoice-amount-input" type="number" step="0.0001" min="0"
                value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.25"
                className="rounded-none border-white/15 bg-black pr-16 font-mono text-lg" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-plex-mono text-xs text-white/40">SOL</span>
            </div>
            {usd && (
              <p className="mt-1.5 flex items-center gap-1 font-plex-mono text-[11px] text-white/40">
                <CurrencyDollar className="h-3 w-3" /> ≈ ${usd} USD (indicative)
              </p>
            )}
          </div>
          <div>
            <Label className={lbl}>Memo</Label>
            <Textarea data-testid="invoice-memo-input" value={memo} onChange={(e) => setMemo(e.target.value)}
              placeholder="Order #1234 — Latte" rows={2}
              className="mt-1.5 resize-none rounded-none border-white/15 bg-black font-plex-mono text-sm" />
          </div>
          <div>
            <Label className={lbl}>Expires in</Label>
            <div className="mt-1.5 grid grid-cols-4 gap-px border border-white/10 bg-white/10">
              {EXPIRY_OPTS.map((o) => (
                <button key={o.v} type="button" data-testid={`expiry-${o.v}`} onClick={() => setExpiry(o.v)}
                  className={`bg-quantum-ink py-2 font-plex-mono text-xs transition-colors ${expiry === o.v ? "text-quantum-green" : "text-white/40 hover:text-white"}`}>
                  {o.l}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between border border-white/10 p-3">
            <div>
              <Label className="font-plex-mono text-xs uppercase tracking-wider text-white/70">Allow tips</Label>
              <p className="text-[11px] text-white/40">Customer can add a tip at checkout</p>
            </div>
            <Switch data-testid="allow-tips-switch" checked={allowTips} onCheckedChange={setAllowTips} />
          </div>
          <div className="border border-white/10 p-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-plex-mono text-xs uppercase tracking-wider text-white/70">Split payout</Label>
                <p className="text-[11px] text-white/40">Send a share to a second wallet on settlement</p>
              </div>
              <Switch data-testid="split-toggle" checked={splitEnabled} onCheckedChange={setSplitEnabled} />
            </div>
            {splitEnabled && (
              <div className="mt-3 space-y-2">
                <Input data-testid="split-address-input" value={splitAddress}
                  onChange={(e) => setSplitAddress(e.target.value)} placeholder="Partner / staff SOL address"
                  className="rounded-none border-white/15 bg-black font-plex-mono text-xs" />
                <div className="flex gap-2">
                  <div className="grid flex-1 grid-cols-2 gap-px border border-white/10 bg-white/10">
                    {["percent", "fixed"].map((t) => (
                      <button key={t} type="button" data-testid={`split-type-${t}`} onClick={() => setSplitType(t)}
                        className={`bg-quantum-ink py-2 font-plex-mono text-xs transition-colors ${splitType === t ? "text-quantum-purple" : "text-white/40 hover:text-white"}`}>
                        {t === "percent" ? "Percent %" : "Fixed SOL"}
                      </button>
                    ))}
                  </div>
                  <Input data-testid="split-value-input" type="number" step="0.01" min="0" value={splitValue}
                    onChange={(e) => setSplitValue(e.target.value)}
                    placeholder={splitType === "percent" ? "30" : "0.5"}
                    className="w-24 rounded-none border-white/15 bg-black font-mono text-sm" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* branding */}
        <div data-testid="branding-section" className="space-y-4 bg-quantum-ink p-5">
          <p className="flex items-center gap-2 font-plex-mono text-[10px] uppercase tracking-[0.2em] text-quantum-purple">
            <PaintBrush className="h-3.5 w-3.5" /> Branding
          </p>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Label className={lbl}>Business name</Label>
              <Input data-testid="brand-name-input" value={branding.name} maxLength={80}
                onChange={(e) => setB("name", e.target.value)} placeholder="Quantum Coffee Co." className={inp} />
            </div>
            <div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" data-testid="brand-logo-input" onChange={onLogo} />
              {branding.logo ? (
                <div className="flex items-center gap-1">
                  <img data-testid="brand-logo-preview" src={branding.logo} alt="logo"
                    className="h-10 w-10 border border-white/15 bg-white object-contain p-0.5" />
                  <Button type="button" data-testid="brand-logo-remove" variant="ghost" size="icon" onClick={() => setB("logo", "")}
                    className="h-10 w-8 rounded-none text-white/50 hover:bg-red-500/10 hover:text-red-400">
                    <Trash className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Button type="button" data-testid="brand-logo-upload-btn" variant="outline" onClick={() => fileRef.current?.click()}
                  className="h-10 rounded-none border-white/15 bg-transparent font-plex-mono text-xs text-white/70 hover:bg-white/5">
                  <UploadSimple className="mr-1.5 h-4 w-4" /> Logo
                </Button>
              )}
            </div>
          </div>
          <div>
            <Label className={lbl}>Tagline</Label>
            <Input data-testid="brand-tagline-input" value={branding.tagline} maxLength={140}
              onChange={(e) => setB("tagline", e.target.value)} placeholder="Fresh roasts, quantum-safe payments" className={inp} />
          </div>
          <div>
            <Label className={lbl}>Brand colour</Label>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {SWATCHES.map((c) => (
                <button key={c} type="button" data-testid={`brand-swatch-${c.slice(1)}`} onClick={() => setB("accent_color", c)}
                  aria-label={c}
                  className={`h-7 w-7 border transition-transform hover:scale-110 ${branding.accent_color.toLowerCase() === c.toLowerCase() ? "border-white ring-1 ring-white" : "border-white/20"}`}
                  style={{ background: c }} />
              ))}
              <label className="flex h-7 items-center gap-1.5 border border-white/15 px-2 font-plex-mono text-[11px] text-white/60">
                <input data-testid="brand-color-input" type="color" value={branding.accent_color}
                  onChange={(e) => setB("accent_color", e.target.value)} className="h-4 w-5 cursor-pointer border-0 bg-transparent p-0" />
                {branding.accent_color}
              </label>
            </div>
          </div>
          <div>
            <Label className={lbl}>Website</Label>
            <div className="relative">
              <Globe className="absolute left-2.5 top-1/2 mt-[3px] h-4 w-4 -translate-y-1/2 text-white/30" />
              <Input data-testid="brand-website-input" value={branding.website}
                onChange={(e) => setB("website", e.target.value)} placeholder="yourbrand.com" className={`${inp} pl-8`} />
            </div>
          </div>
          <div>
            <Label className={lbl}>Social links</Label>
            <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SOCIALS.map(({ k, Icon, ph }) => (
                <div key={k} className="relative">
                  <Icon className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                  <Input data-testid={`brand-social-${k}-input`} value={branding.socials[k]}
                    onChange={(e) => setSocial(k, e.target.value)} placeholder={ph}
                    className="rounded-none border-white/15 bg-black pl-8 font-plex-mono text-xs" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* live preview + submit */}
        <div className="flex flex-col items-center justify-between gap-4 bg-black/40 p-5 lg:w-[300px]">
          <div className="w-full">
            <p className="mb-3 text-center font-plex-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Live QR preview</p>
            <BrandedQR testid="composer-qr-preview" value={`solana:QuantumPOSPreview?amount=${previewAmt}`}
              branding={branding} amountSol={previewAmt} size={168} />
          </div>
          <div className="w-full">
            <Button data-testid="submit-invoice-btn" onClick={submit} disabled={generating}
              className="btn-sheen h-12 w-full rounded-none font-mono font-bold transition-transform hover:-translate-y-0.5"
              style={{ background: branding.accent_color, color: readableText(branding.accent_color) }}>
              {!merchant && <Lightning weight="fill" className="mr-1.5 h-4 w-4" />}
              {merchant ? "Generate quantum vault" : "Connect & generate vault"}
            </Button>
            <p className="mt-2 text-center font-plex-mono text-[10px] text-white/30">
              {merchant ? "Branding is saved to your merchant profile" : "Your details stay here until you connect"}
            </p>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {generating && (
          <motion.div data-testid="composer-generating" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-quantum-ink/95 backdrop-blur">
            <div className="w-full max-w-md px-5"><KeygenAnimation /></div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
