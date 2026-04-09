import type { IncomingMessage } from "node:http";

export type TerritoryApiRequest = IncomingMessage & {
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
};

export type TerritoryApiResponse = {
  status: (code: number) => { json: (body: unknown) => void };
};

/** Parse query string from `req.url` (Vercel / Node). */
export function parseRequestQuery(req: TerritoryApiRequest): Record<string, string> {
  const q = req.query;
  if (q && typeof q === "object") {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(q)) {
      if (typeof v === "string" && v) out[k] = v;
      else if (Array.isArray(v) && typeof v[0] === "string") out[k] = v[0];
    }
    if (Object.keys(out).length > 0) return out;
  }
  const raw = typeof req.url === "string" ? req.url : "";
  const i = raw.indexOf("?");
  if (i === -1) return {};
  const sp = new URLSearchParams(raw.slice(i + 1));
  const out: Record<string, string> = {};
  sp.forEach((v, k) => {
    if (v) out[k] = v;
  });
  return out;
}

export function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}
