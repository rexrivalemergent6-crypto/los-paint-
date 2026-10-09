import { QRCodeSVG } from "qrcode.react";
import { Vault } from "@phosphor-icons/react";
import { normalizeBranding, qrSafeColor } from "@/lib/branding";

/**
 * Branded Solana Pay QR: merchant logo in the centre, modules in the brand colour,
 * business name + tagline above and the amount below.
 */
export default function BrandedQR({ value, branding, amountSol, size = 176, testid = "branded-qr", fallbackName }) {
  const b = normalizeBranding(branding);
  const accent = b.accent_color;
  const qrColor = qrSafeColor(accent);
  const name = b.name || fallbackName || "Your business";
  const logoSize = Math.round(size * 0.22);

  return (
    <div data-testid={testid} className="mx-auto w-fit border bg-white p-4 text-center shadow-[0_0_40px_-12px] transition-colors"
      style={{ borderColor: accent, boxShadow: `0 0 40px -14px ${accent}` }}>
      <div className="mb-3 flex items-center justify-center gap-2">
        {b.logo ? (
          <img src={b.logo} alt="" className="h-7 w-7 object-contain" />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center" style={{ background: accent }}>
            <Vault weight="fill" className="h-4 w-4 text-black" />
          </div>
        )}
        <div className="max-w-[180px] text-left">
          <p data-testid={`${testid}-name`} className="truncate font-mono text-sm font-bold leading-tight tracking-tight text-black">{name}</p>
          {b.tagline && <p data-testid={`${testid}-tagline`} className="truncate font-plex-mono text-[10px] leading-tight text-black/50">{b.tagline}</p>}
        </div>
      </div>

      <QRCodeSVG
        value={value || "solana:"}
        size={size}
        level="H"
        fgColor={qrColor}
        bgColor="#ffffff"
        imageSettings={b.logo ? { src: b.logo, height: logoSize, width: logoSize, excavate: true } : undefined}
        className="mx-auto"
      />

      {amountSol != null && (
        <p data-testid={`${testid}-amount`} className="mt-3 font-mono text-xl font-black tracking-tighter" style={{ color: qrColor }}>
          {amountSol} <span className="text-xs text-black/40">SOL</span>
        </p>
      )}
      <p className="font-plex-mono text-[9px] uppercase tracking-[0.2em] text-black/40">Solana Pay · quantum vault</p>
    </div>
  );
}
