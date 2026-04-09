import {
  getZrApiKeyFromEnv,
  zrExpressErrorMessage,
  zrRequestWithAuthVariants,
} from "./zrExpressClient.js";

/**
 * Public origin for callbacks (no trailing slash).
 * Prefer `ZR_WEBHOOK_PUBLIC_URL` on Vercel preview where `VERCEL_URL` is not the prod domain.
 */
export function resolveZrWebhookCallbackBaseUrl(): string | null {
  const explicit = (process.env.ZR_WEBHOOK_PUBLIC_URL ?? "").trim().replace(/\/$/, "");
  if (explicit) return explicit;
  const v = (process.env.VERCEL_URL ?? "").trim();
  if (!v) return null;
  const host = v.replace(/^https?:\/\//i, "");
  return `https://${host}`;
}

/** ZR OpenAPI: POST /api/v1/webhooks/endpoints (CreateEndpointRequest). */
export async function registerZrParcelStateWebhook(tenantId: string): Promise<
  | { ok: true; zrStatus: number; callbackUrl: string }
  | { ok: false; error: string; zrStatus?: number }
> {
  if (!getZrApiKeyFromEnv()) {
    return { ok: false, error: "ZR_API_KEY is not configured" };
  }
  const base = resolveZrWebhookCallbackBaseUrl();
  if (!base) {
    return {
      ok: false,
      error:
        "Set ZR_WEBHOOK_PUBLIC_URL (e.g. https://your-app.vercel.app) or rely on VERCEL_URL so the webhook URL can be built.",
    };
  }
  const callbackUrl = `${base}/api/handler?action=zr-webhook`;
  const body = JSON.stringify({
    url: callbackUrl,
    eventTypes: ["parcel.state.updated"],
    description: "COD Manager auto-registered",
  });
  const out = await zrRequestWithAuthVariants(
    "/webhooks/endpoints",
    { method: "POST", body },
    tenantId,
    { logPrefix: "[register-zr-webhook]" }
  );
  if (!out.res.ok) {
    return {
      ok: false,
      error: zrExpressErrorMessage(out.res.status, out.json, out.text),
      zrStatus: out.res.status,
    };
  }
  return { ok: true, zrStatus: out.res.status, callbackUrl };
}
