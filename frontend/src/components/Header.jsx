import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Vault, Gear, SignOut, Copy, Check, XLogo, House } from "@phosphor-icons/react";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";

function short(a) {
  return a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "";
}

export default function Header() {
  const { merchant, logout: _logout, setMerchant, login, connecting } = useAuth();
  const navigate = useNavigate();
  const logout = async () => { await _logout(); navigate("/"); };
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(merchant?.business_name || "");
  const [payout, setPayout] = useState(merchant?.payout_address || "");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put("/merchant/profile", { business_name: name, payout_address: payout });
      setMerchant(data);
      toast.success("Profile updated");
      setOpen(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(merchant.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-black/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link to="/" data-testid="header-home-logo" className="flex items-center gap-2.5" aria-label="Home">
            <div className="flex h-7 w-7 items-center justify-center bg-quantum-green">
              <Vault weight="fill" className="h-4 w-4 text-black" />
            </div>
            <span className="hidden font-mono text-base font-bold tracking-tighter sm:inline">QuantumPOS</span>
          </Link>
          <Link to="/" data-testid="header-home-link"
            className="flex h-8 items-center gap-1.5 border border-white/10 px-2.5 font-plex-mono text-xs text-white/60 transition-colors hover:border-white/30 hover:text-white">
            <House className="h-4 w-4" /> <span className="hidden sm:inline">Home</span>
          </Link>
          <span className="ml-1 hidden font-plex-mono text-[10px] uppercase tracking-widest text-quantum-green/70 sm:inline">
            {merchant?.business_name || (merchant ? "merchant" : "preview")}
          </span>
        </div>

        <div className="flex items-center gap-2">
        <a data-testid="header-x-link" href="https://x.com/tryquantumpos" target="_blank" rel="noreferrer"
          aria-label="QuantumPOS on X"
          className="flex h-9 items-center gap-1.5 border border-white/10 px-3 font-plex-mono text-xs text-white/60 transition-colors hover:border-white/30 hover:text-white">
          <XLogo weight="bold" className="h-4 w-4" />
          <span className="hidden lg:inline">@tryquantumpos</span>
        </a>
        {!merchant ? (
          <div className="flex items-center gap-2">
            <span className="hidden font-plex-mono text-[10px] uppercase tracking-widest text-quantum-warning sm:inline">
              preview mode
            </span>
            <Button data-testid="header-connect-btn" onClick={() => login().catch(() => {})} disabled={connecting}
              className="btn-sheen h-9 rounded-none bg-quantum-green px-4 font-mono text-xs font-bold text-black hover:bg-quantum-greenDark">
              {connecting ? "Connecting…" : "Connect Phantom"}
            </Button>
          </div>
        ) : (
        <div className="flex items-center gap-2">
          <button data-testid="wallet-chip" onClick={copy}
            className="flex items-center gap-2 border border-quantum-purple/40 bg-quantum-purple/5 px-3 py-1.5 font-plex-mono text-xs text-quantum-purple transition-colors hover:bg-quantum-purple/10">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {short(merchant?.address)}
          </button>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="open-settings-btn" variant="ghost" size="icon"
                className="h-9 w-9 rounded-none text-white/60 hover:bg-white/5 hover:text-white">
                <Gear className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-none border-white/10 bg-quantum-ink">
              <DialogHeader>
                <DialogTitle className="font-mono tracking-tight">Merchant profile</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <Label className="font-plex-mono text-xs uppercase tracking-wider text-white/60">Business name</Label>
                  <Input data-testid="profile-name-input" value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="Quantum Coffee Co." className="mt-1.5 rounded-none border-white/15 bg-black font-plex-mono" />
                </div>
                <div>
                  <Label className="font-plex-mono text-xs uppercase tracking-wider text-white/60">Payout wallet (SOL)</Label>
                  <Input data-testid="profile-payout-input" value={payout} onChange={(e) => setPayout(e.target.value)}
                    className="mt-1.5 rounded-none border-white/15 bg-black font-plex-mono text-xs" />
                  <p className="mt-1.5 text-[11px] text-white/40">Settled SOL sweeps here. Defaults to your login wallet.</p>
                </div>
              </div>
              <DialogFooter>
                <Button data-testid="save-profile-btn" onClick={save} disabled={saving}
                  className="rounded-none bg-quantum-green font-mono text-black hover:bg-quantum-greenDark">
                  {saving ? "Saving…" : "Save profile"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Button data-testid="logout-btn" variant="ghost" size="icon" onClick={logout}
            className="h-9 w-9 rounded-none text-white/60 hover:bg-red-500/10 hover:text-red-400">
            <SignOut className="h-4 w-4" />
          </Button>
        </div>
        )}
        </div>
      </div>
    </header>
  );
}
