const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** e.g. ORD-2026-K7P2 — avoids ambiguous 0/O and 1/I. */
export function generateInternalTrackingId(
  year = new Date().getFullYear()
): string {
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]!;
  }
  return `ORD-${year}-${suffix}`;
}
