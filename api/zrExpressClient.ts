/** ZR Express REST API base (versioned). All routes are under this path. */
export const ZR_API_V1_BASE = "https://api.zrexpress.app/api/v1";

/** Host only (no path). Prefer {@link ZR_API_V1_BASE} for API calls. */
export const ZR_BASE = "https://api.zrexpress.app";

export type ZrAuthVariant = "x_api_key";

/** ZR Express API key from the server environment (Vercel: Project → Settings → Environment Variables → `ZR_API_KEY`). */
export function getZrApiKeyFromEnv(): string {
  return (process.env.ZR_API_KEY ?? "").trim();
}

export function zrAuthVariantDescription(variant: ZrAuthVariant): string {
  if (variant === "x_api_key") {
    return "X-Api-Key from process.env.ZR_API_KEY";
  }
  return variant;
}

/** ZR Express uses X-Api-Key (from `ZR_API_KEY`) + X-Tenant. */
export function buildZrRequestHeaders(tenantId: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Tenant": tenantId,
    "X-Api-Key": getZrApiKeyFromEnv(),
  };
}

function first10LogPreview(value: string | undefined): string {
  if (value == null || value === "") return "(empty)";
  if (value.length <= 10) return value;
  return `${value.slice(0, 10)}…`;
}

function logFullZrOutboundRequest(
  logPrefix: string,
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string
): void {
  console.log(`${logPrefix} ZR Express FULL outbound request`);
  console.log(`${logPrefix}   Method:`, method);
  console.log(`${logPrefix}   URL:`, url);
  console.log(`${logPrefix}   Auth:`, zrAuthVariantDescription("x_api_key"));
  console.log(`${logPrefix}   X-Tenant in use (first 10 chars):`, first10LogPreview(headers["X-Tenant"]));
  const safeHeaders: Record<string, string> = { ...headers };
  if (safeHeaders["X-Tenant"] !== undefined) {
    safeHeaders["X-Tenant"] = first10LogPreview(safeHeaders["X-Tenant"]);
  }
  if (safeHeaders["X-Api-Key"] !== undefined) {
    safeHeaders["X-Api-Key"] = first10LogPreview(safeHeaders["X-Api-Key"]);
  }
  console.log(`${logPrefix}   Headers (sensitive values truncated to 10 chars):`, safeHeaders);
  console.log(`${logPrefix}   Body (complete):`, body);
}

export function zrExpressErrorMessage(
  httpStatus: number,
  zrJson: unknown,
  zrText: string
): string {
  if (zrJson && typeof zrJson === "object" && !Array.isArray(zrJson)) {
    const o = zrJson as Record<string, unknown>;
    const direct = o.message ?? o.detail ?? o.title;
    if (typeof direct === "string" && direct.trim()) return direct.trim();

    const errField = o.error;
    if (typeof errField === "string" && errField.trim()) return errField.trim();
    if (errField && typeof errField === "object" && !Array.isArray(errField)) {
      const nested = errField as Record<string, unknown>;
      const nm = nested.message ?? nested.error ?? nested.detail;
      if (typeof nm === "string" && nm.trim()) return nm.trim();
    }

    if (Array.isArray(o.errors)) {
      const parts = o.errors
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object") {
            const e = item as Record<string, unknown>;
            const m = e.message ?? e.error ?? e.detail;
            if (typeof m === "string" && m.trim()) return m.trim();
          }
          return null;
        })
        .filter((s): s is string => Boolean(s));
      if (parts.length) return parts.join("; ");
    }

    const data = o.data;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const d = data as Record<string, unknown>;
      const m = d.message ?? d.error ?? d.detail;
      if (typeof m === "string" && m.trim()) return m.trim();
    }
  }

  const trimmed = zrText.trim();
  if (trimmed) return trimmed.length > 2000 ? `${trimmed.slice(0, 2000)}…` : trimmed;
  return `ZR Express returned HTTP ${httpStatus}`;
}

/**
 * ZR Express request using `X-Api-Key: process.env.ZR_API_KEY` and `X-Tenant`.
 * `url` may be absolute or a path starting with `/` relative to {@link ZR_API_V1_BASE}.
 */
export async function zrRequestWithAuthVariants(
  urlOrPath: string,
  init: { method?: string; body?: string | undefined },
  tenantId: string,
  options?: { logPrefix?: string }
): Promise<{
  res: Response;
  text: string;
  json: unknown;
  variant: ZrAuthVariant;
}> {
  const logPrefix = options?.logPrefix ?? "[zr-express]";
  const method = (init.method ?? "POST").toUpperCase();
  const body = init.body;
  const url = urlOrPath.startsWith("http")
    ? urlOrPath
    : `${ZR_API_V1_BASE}${urlOrPath.startsWith("/") ? "" : "/"}${urlOrPath}`;

  const headers = buildZrRequestHeaders(tenantId);
  logFullZrOutboundRequest(logPrefix, method, url, headers, body ?? "");

  const sendBody = method === "GET" || method === "HEAD" ? undefined : body;

  const res = await fetch(url, { method, headers, body: sendBody });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  console.log(`${logPrefix} ZR Express response status:`, res.status);
  console.log(`${logPrefix} ZR Express response body:`, text);

  if (res.ok) {
    console.log(`${logPrefix} ZR Express request OK (${zrAuthVariantDescription("x_api_key")})`);
  }

  return { res, text, json, variant: "x_api_key" };
}
