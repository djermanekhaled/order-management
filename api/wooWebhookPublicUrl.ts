/**
 * Public origin for WooCommerce webhook delivery URLs (no trailing slash).
 * Prefer `WOO_WEBHOOK_PUBLIC_URL` when `VERCEL_URL` is not your production domain.
 */
export function resolveWooWebhookPublicBaseUrl(): string | null {
  const explicit = (process.env.WOO_WEBHOOK_PUBLIC_URL ?? "").trim().replace(/\/$/, "");
  if (explicit) return explicit;
  const v = (process.env.VERCEL_URL ?? "").trim();
  if (!v) return null;
  const host = v.replace(/^https?:\/\//i, "");
  return `https://${host}`;
}
