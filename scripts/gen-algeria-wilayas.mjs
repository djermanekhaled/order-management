import https from "node:https";
import fs from "node:fs";

const url =
  "https://raw.githubusercontent.com/othmanus/algeria-cities/master/json/algeria_cities.json";

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(d));
      })
      .on("error", reject);
  });
}

const raw = await get(url);
const rows = JSON.parse(raw);
const firstNameByCode = new Map();
for (const r of rows) {
  const code = String(r.wilaya_code ?? "").padStart(2, "0");
  const wn = String(r.wilaya_name_ascii ?? "").trim();
  if (code && wn && !firstNameByCode.has(code)) firstNameByCode.set(code, wn);
}
const codes = [...firstNameByCode.keys()].sort();
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const lines = codes.map(
  (c) => `  { code: "${c}", name: "${esc(firstNameByCode.get(c))}" },`
);
const out = `/** 58 Algerian wilayas — labels match othmanus/algeria-cities (ASCII names). */
export type AlgeriaWilaya58 = { readonly code: string; readonly name: string };

export const ALGERIA_WILAYAS_58: readonly AlgeriaWilaya58[] = [
${lines.join("\n")}
] as const;

export function formatWilayaLabel58(w: AlgeriaWilaya58): string {
  return \`\${w.code} - \${w.name}\`;
}

export const WILAYAS_58_LABELS: readonly string[] = ALGERIA_WILAYAS_58.map((w) =>
  formatWilayaLabel58(w)
);

/** Parse leading wilaya code from stored order.wilaya ("01 - X" or "01 — X"). */
export function parseWilayaCodeFromLabel(s: string): string | null {
  const m = s.trim().match(/^(\\d{1,2})\\s*[—-]\\s*/);
  if (!m) return null;
  return m[1].padStart(2, "0");
}
`;
fs.writeFileSync(new URL("../src/constants/algeriaWilayas58.ts", import.meta.url), out);
console.log("wrote algeriaWilayas58.ts", codes.length, "wilayas");
