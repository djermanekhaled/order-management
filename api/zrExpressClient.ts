export const ZR_BASE = "https://api.zrexpress.app";

export type ZrAuthVariant = "x_api_key" | "bearer" | "raw_secret";

export function zrAuthVariantDescription(variant: ZrAuthVariant): string {
  switch (variant) {
    case "x_api_key":
      return "X-Api-Key: {secretKey} (no Authorization header)";
    case "bearer":
      return "Authorization: Bearer {secretKey}";
    case "raw_secret":
      return "Authorization: {secretKey} (no Bearer prefix)";
  }
}

export function buildZrRequestHeaders(
  variant: ZrAuthVariant,
  tenantId: string,
  secretKey: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Tenant": tenantId,
  };
  if (variant === "x_api_key") {
    headers["X-Api-Key"] = secretKey;
    return headers;
  }
  if (variant === "bearer") {
    headers.Authorization = `Bearer ${secretKey}`;
    return headers;
  }
  headers.Authorization = secretKey;
  return headers;
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
  body: string,
  authVariant: ZrAuthVariant
): void {
  console.log(`${logPrefix} ZR Express FULL outbound request`);
  console.log(`${logPrefix}   Method:`, method);
  console.log(`${logPrefix}   URL:`, url);
  console.log(`${logPrefix}   Auth attempt:`, zrAuthVariantDescription(authVariant));
  console.log(`${logPrefix}   X-Tenant in use (first 10 chars):`, first10LogPreview(headers["X-Tenant"]));
  const apiKey = headers["X-Api-Key"];
  console.log(
    `${logPrefix}   X-Api-Key in use (first 10 chars):`,
    apiKey !== undefined
      ? first10LogPreview(apiKey)
      : "(not sent for this attempt — using Authorization header)"
  );
  const safeHeaders: Record<string, string> = { ...headers };
  if (safeHeaders["X-Tenant"] !== undefined) {
    safeHeaders["X-Tenant"] = first10LogPreview(safeHeaders["X-Tenant"]);
  }
  if (safeHeaders["X-Api-Key"] !== undefined) {
    safeHeaders["X-Api-Key"] = first10LogPreview(safeHeaders["X-Api-Key"]);
  }
  if (safeHeaders.Authorization !== undefined) {
    const a = safeHeaders.Authorization;
    const bearer = /^Bearer\s+/i.test(a);
    const secret = bearer ? a.replace(/^Bearer\s+/i, "") : a;
    safeHeaders.Authorization = bearer
      ? `Bearer ${first10LogPreview(secret)}`
      : first10LogPreview(a);
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

export async function zrRequestWithAuthVariants(
  url: string,
  init: { method?: string; body?: string | undefined },
  tenantId: string,
  secretKey: string,
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
  const variants: ZrAuthVariant[] = ["x_api_key", "bearer", "raw_secret"];
  let last!: {
    res: Response;
    text: string;
    json: unknown;
    variant: ZrAuthVariant;
  };

  const sendBody = method === "GET" || method === "HEAD" ? undefined : body;

  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    const headers = buildZrRequestHeaders(variant, tenantId, secretKey);
    logFullZrOutboundRequest(logPrefix, method, url, headers, body ?? "", variant);

    const res = await fetch(url, { method, headers, body: sendBody });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    console.log(`${logPrefix} ZR Express response status [${variant}]:`, res.status);
    console.log(`${logPrefix} ZR Express response body [${variant}]:`, text);

    last = { res, text, json, variant };

    if (res.ok) {
      console.log(
        `${logPrefix} ZR Express accepted auth method:`,
        zrAuthVariantDescription(variant)
      );
      return last;
    }

    const authRejected = res.status === 401 || res.status === 403;
    const hasNext = i < variants.length - 1;

    if (authRejected && hasNext) {
      const next = variants[i + 1];
      console.log(
        `${logPrefix} Auth rejected (HTTP ${res.status}); next attempt:`,
        zrAuthVariantDescription(next)
      );
      continue;
    }

    return last;
  }

  return last;
}
