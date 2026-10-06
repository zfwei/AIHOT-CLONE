import type { PriceBar, Quote } from "../domain.ts";

export const JAPAN_MOF_URL = "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/jgbcme.csv";

/** MOF's monthly English CSV: percent, semiannual compounding, constant maturity at 15:00 JST. */
export function parseJapanMofCsv(csv: string, retrievedAt = new Date()): { quotes: Quote[]; history: PriceBar[] } {
  if (Buffer.byteLength(csv) > 1024 * 1024) throw new Error("Japan MOF CSV exceeds 1 MB");
  const lines = csv.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (!/^Interest Rate \([A-Za-z]+ \d{4}\),/.test(lines[0] ?? "") || !/\(Unit\s*:\s*%\)\s*$/.test(lines[0] ?? "")) throw new Error("Invalid Japan MOF CSV title or unit");
  const header = (lines[1] ?? "").split(",").map((field) => field.trim());
  const tenor = header.indexOf("10Y");
  if (header[0] !== "Date" || tenor < 1 || header.filter((field) => field === "10Y").length !== 1) throw new Error("Missing Japan MOF 10Y column");
  const days = new Map<string, number>();
  for (const line of lines.slice(2)) {
    if (/^[,\s]*$/.test(line)) continue;
    // The downloaded file ends with a quoted browser-cache notice, not a data row.
    if (/^"\s*[^"\r\n]*If you cannot download the latest csv data, please clear the browser's cache and download again\."[,]\s*[,]*$/.test(line)) continue;
    const fields = line.split(",").map((field) => field.trim());
    const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(fields[0] ?? "");
    if (!match || fields.length !== header.length) throw new Error("Invalid Japan MOF CSV row");
    const date = `${match[1]}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}`;
    const observation = new Date(`${date}T06:00:00Z`);
    if (!Number.isFinite(observation.getTime()) || observation.toISOString().slice(0, 10) !== date) throw new Error("Invalid Japan MOF observation date");
    if (observation > retrievedAt) throw new Error("Future Japan MOF observation");
    const raw = fields[tenor]!;
    if (["", "-", "N/A"].includes(raw)) continue;
    if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) throw new Error("Invalid Japan MOF yield");
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error("Invalid Japan MOF yield");
    if (days.has(date) && days.get(date) !== value) throw new Error("Conflicting Japan MOF yields for one date");
    days.set(date, value);
  }
  const provenance = { sourceName: "日本财务省（10年列提取）", sourceUrl: JAPAN_MOF_URL, availabilityBasis: "retrieved" as const, publishedAt: retrievedAt.toISOString() };
  const history: PriceBar[] = [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, close]) => ({ instrumentId: "jp-jgb-10y", date, close, ...provenance }));
  const last = history.at(-1);
  if (!last) throw new Error("Japan MOF response has no 10Y yields");
  const quotes: Quote[] = [{ instrumentId: "jp-jgb-10y", value: last.close, previousClose: history.at(-2)?.close ?? null, asOf: `${last.date}T06:00:00.000Z`, frequency: "daily", unit: "percent", ...provenance }];
  return { quotes, history };
}
