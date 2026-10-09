import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { DownloadSimple, Receipt, TrendUp, Coins, Stack, Lightning } from "@phosphor-icons/react";
import Header from "@/components/Header";
import QuantumBanner from "@/components/QuantumBanner";
import StatusBadge from "@/components/StatusBadge";
import InvoiceComposer from "@/components/InvoiceComposer";
import InvoiceDetailDialog from "@/components/InvoiceDetailDialog";
import { useAuth } from "@/context/AuthContext";
import api, { API } from "@/lib/api";

const ZERO_STATS = { total_invoices: 0, by_status: {}, settled_sol: 0, pending_sol: 0 };

function StatCard({ icon: Icon, label, value, suffix, accent, delay }) {
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
      className="bg-quantum-ink p-5">
      <div className="flex items-center justify-between">
        <span className="font-plex-mono text-[10px] uppercase tracking-[0.2em] text-white/40">{label}</span>
        <Icon weight="duotone" className={`h-4 w-4 ${accent}`} />
      </div>
      <div className="mt-3 font-mono text-3xl font-bold tracking-tighter">
        {value}<span className="ml-1 text-sm text-white/40">{suffix}</span>
      </div>
    </motion.div>
  );
}

export default function Dashboard() {
  const { merchant, requireAuth } = useAuth();
  const demo = !merchant;
  const [invoices, setInvoices] = useState([]);
  const [stats, setStats] = useState(null);
  const [solUsd, setSolUsd] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const load = useCallback(async () => {
    if (demo) { setInvoices([]); setStats(ZERO_STATS); return; }
    try {
      const [inv, st] = await Promise.all([api.get("/invoices"), api.get("/stats")]);
      setInvoices(inv.data);
      setStats(st.data);
    } catch (e) { /* 401 handled by interceptor */ }
  }, [demo]);

  useEffect(() => {
    load();
    api.get("/price").then(({ data }) => setSolUsd(data.sol_usd)).catch(() => {});
    if (demo) return;
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load, demo]);

  const connect = async () => {
    try { await requireAuth(); } catch (e) { toast.error("Connection cancelled"); }
  };

  const openDetail = (inv) => { setSelected(inv); setDetailOpen(true); };

  const onUpdated = (data) => {
    setInvoices((prev) => prev.map((i) => (i.id === data.id ? data : i)));
    setSelected(data);
    load();
  };

  const exportCsv = async () => {
    if (demo) return connect();
    try {
      const token = localStorage.getItem("qpos_token");
      const res = await fetch(`${API}/invoices/export/csv`, { headers: { Authorization: `Bearer ${token}` } });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "quantumpos_invoices.csv"; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error("Export failed"); }
  };

  return (
    <div className="min-h-screen">
      <Header />

      {demo && (
        <div data-testid="preview-banner" className="border-b border-quantum-warning/30 bg-quantum-warning/5">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-5 py-2.5">
            <p className="font-plex-mono text-xs text-quantum-warning">
              ▲ Preview mode — fill in your invoice & branding below, then connect Phantom when you are ready to go live on mainnet.
            </p>
            <Button data-testid="preview-connect-btn" onClick={connect}
              className="h-8 rounded-none bg-quantum-green px-3 font-mono text-xs font-bold text-black hover:bg-quantum-greenDark">
              <Lightning weight="fill" className="mr-1 h-3.5 w-3.5" /> Connect Phantom
            </Button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-5 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-mono text-3xl font-bold tracking-tighter">Dashboard</h1>
            <p className="mt-1 font-plex-mono text-xs text-white/40">
              Live invoice & settlement activity {solUsd ? `· SOL ≈ $${solUsd}` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Button data-testid="export-csv-btn" onClick={exportCsv} variant="outline"
              className="h-10 rounded-none border-white/15 bg-transparent font-mono text-sm text-white hover:bg-white/5">
              <DownloadSimple className="mr-1.5 h-4 w-4" /> CSV
            </Button>
          </div>
        </div>

        <InvoiceComposer solUsd={solUsd} onCreated={(inv) => { load(); openDetail(inv); }} />

        <div className="mb-6 grid grid-cols-2 gap-px border border-white/10 bg-white/10 lg:grid-cols-4">
          <StatCard icon={Stack} label="Invoices" value={stats?.total_invoices ?? 0} accent="text-quantum-purple" delay={0.05} />
          <StatCard icon={Coins} label="Settled" value={stats?.settled_sol ?? 0} suffix="SOL" accent="text-quantum-green" delay={0.1} />
          <StatCard icon={TrendUp} label="In-flight" value={stats?.pending_sol ?? 0} suffix="SOL" accent="text-quantum-warning" delay={0.15} />
          <StatCard icon={Receipt} label="Settled count" value={stats?.by_status?.settled ?? 0} accent="text-quantum-cyan" delay={0.2} />
        </div>

        <div className="mb-6"><QuantumBanner /></div>

        <div className="border border-white/10 bg-quantum-ink">
          <div className="border-b border-white/10 px-5 py-3">
            <h2 className="font-plex-mono text-xs uppercase tracking-[0.2em] text-white/50">
              Invoices
            </h2>
          </div>
          {invoices.length === 0 ? (
            <div data-testid="empty-invoices" className="flex flex-col items-center gap-3 py-16 text-center">
              <Receipt weight="thin" className="h-10 w-10 text-white/20" />
              <p className="font-plex-mono text-sm text-white/40">No invoices yet. Create your first quantum vault.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  {["Amount", "Memo", "Vault", "Received", "Status", "Created"].map((h) => (
                    <TableHead key={h} className="font-plex-mono text-[10px] uppercase tracking-wider text-white/40">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id} data-testid={`invoice-row-${inv.id}`} onClick={() => openDetail(inv)}
                    className="cursor-pointer border-white/5 transition-colors hover:bg-white/5">
                    <TableCell className="font-mono text-sm font-bold text-quantum-green">{inv.amount_sol} SOL</TableCell>
                    <TableCell className="max-w-[160px] truncate font-plex-mono text-xs text-white/70">{inv.memo || "—"}</TableCell>
                    <TableCell className="font-plex-mono text-[11px] text-white/40">{inv.vault_address.slice(0, 4)}…{inv.vault_address.slice(-4)}</TableCell>
                    <TableCell className="font-plex-mono text-xs text-white/70">{inv.received_sol}</TableCell>
                    <TableCell><StatusBadge status={inv.status} /></TableCell>
                    <TableCell className="font-plex-mono text-[11px] text-white/40">{new Date(inv.created_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </main>

      <InvoiceDetailDialog invoice={selected} open={detailOpen} onOpenChange={setDetailOpen}
        onUpdated={onUpdated} demo={demo} onRequireAuth={connect} />
    </div>
  );
}
