export const DEFAULT_ACCENT = "#14F195";

export const EMPTY_BRANDING = {
  name: "",
  logo: "",
  accent_color: DEFAULT_ACCENT,
  tagline: "",
  website: "",
  socials: { x: "", instagram: "", telegram: "", discord: "" },
};

const KEY = "qpos_branding";

export function normalizeBranding(b) {
  const src = b || {};
  return {
    ...EMPTY_BRANDING,
    ...src,
    accent_color: src.accent_color || DEFAULT_ACCENT,
    socials: { ...EMPTY_BRANDING.socials, ...(src.socials || {}) },
  };
}

export function hasBranding(b) {
  if (!b) return false;
  const s = b.socials || {};
  return !!(b.name || b.logo || b.tagline || b.website || Object.values(s).some(Boolean)
    || (b.accent_color && b.accent_color.toLowerCase() !== DEFAULT_ACCENT.toLowerCase()));
}

export function loadLocalBranding() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizeBranding(JSON.parse(raw)) : null;
  } catch (e) {
    return null;
  }
}

export function saveLocalBranding(b) {
  try { localStorage.setItem(KEY, JSON.stringify(b)); } catch (e) { /* quota */ }
}

/** Resize an uploaded image to a small square-ish PNG data URL (max 192px). */
export function resizeLogo(file, max = 192) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) { reject(new Error("Please choose an image file")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Unsupported image"));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/png"));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** Darken bright accents so QR modules keep enough contrast on white to scan. */
export function qrSafeColor(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#000000";
  let r = parseInt(m[1].slice(0, 2), 16);
  let g = parseInt(m[1].slice(2, 4), 16);
  let b = parseInt(m[1].slice(4, 6), 16);
  const lum = (rr, gg, bb) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(rr) + 0.7152 * f(gg) + 0.0722 * f(bb);
  };
  let i = 0;
  while (lum(r, g, b) > 0.18 && i < 20) {
    r = Math.round(r * 0.88); g = Math.round(g * 0.88); b = Math.round(b * 0.88); i += 1;
  }
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Black or white text, whichever reads better on the given accent. */
export function readableText(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#000000";
  const r = parseInt(m[1].slice(0, 2), 16), g = parseInt(m[1].slice(2, 4), 16), b = parseInt(m[1].slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#000000" : "#ffffff";
}
