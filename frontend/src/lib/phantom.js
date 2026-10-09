import bs58 from "bs58";

export function getPhantom() {
  if (typeof window === "undefined") return null;
  const p = window.phantom?.solana || window.solana;
  if (p && p.isPhantom) return p;
  return null;
}

export function hasPhantom() {
  return !!getPhantom();
}

export async function connectPhantom() {
  const p = getPhantom();
  if (!p) throw new Error("Phantom wallet not found. Install it from phantom.app");
  const res = await p.connect();
  return res.publicKey.toString();
}

export async function disconnectPhantom() {
  const p = getPhantom();
  try { await p?.disconnect(); } catch (e) { /* noop */ }
}

export async function signMessagePhantom(message) {
  const p = getPhantom();
  if (!p) throw new Error("Phantom not found");
  const encoded = new TextEncoder().encode(message);
  const { signature } = await p.signMessage(encoded, "utf8");
  return bs58.encode(signature);
}

export function isMobile() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** Deep link that opens the current page inside Phantom's in-app browser (mobile). */
export function phantomBrowseUrl(url = window.location.href) {
  return `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(window.location.origin)}`;
}
