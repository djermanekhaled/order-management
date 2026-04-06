const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function formatYyyyMmDd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** e.g. ORD-20260404-K7P2 — date stamp + random suffix (no ambiguous 0/O, 1/I). */
export function generateInternalTrackingId(d = new Date()): string {
  const datePrefix = formatYyyyMmDd(d);
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]!;
  }
  return `ORD-${datePrefix}-${suffix}`;
}
