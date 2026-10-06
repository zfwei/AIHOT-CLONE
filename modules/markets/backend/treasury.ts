import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { PriceBar, Quote } from "../domain.ts";

const TENORS = [2, 5, 10, 30] as const;
const SOURCE_URL = "https://home.treasury.gov/treasury-daily-interest-rate-xml-feed";
function elementText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const node = value as Record<string, unknown>;
    if (String(node["@_null"]) === "true") return null;
    return typeof node["#text"] === "string" ? node["#text"] : null;
  }
  return null;
}

/** Availability time is the retrieval time: the XML does not supply a reliable publication timestamp. */
export function parseTreasuryXml(xml: string, retrievedAt = new Date()): { quotes: Quote[]; history: PriceBar[] } {
  if (Buffer.byteLength(xml) > 4 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsupported Treasury XML");
  if (XMLValidator.validate(xml) !== true) throw new Error("Invalid Treasury XML");
  const parsed = new XMLParser({ removeNSPrefix: true, ignoreAttributes: false, parseTagValue: false }).parse(xml);
  const entries = parsed?.feed?.entry;
  if (!entries) throw new Error("Treasury response contains no observations");
  const days = new Map<string, Map<number, number>>();
  for (const entry of Array.isArray(entries) ? entries : [entries]) {
    const p = entry?.content?.properties;
    const date = (elementText(p?.NEW_DATE) ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("Invalid Treasury observation date");
    if (Date.parse(`${date}T00:00:00Z`) > retrievedAt.getTime()) throw new Error("Future Treasury observation");
    const values = days.get(date) ?? new Map<number, number>();
    for (const tenor of TENORS) {
      const raw = elementText(p[`BC_${tenor}YEAR`]);
      // A nil XML element, blank or N/A is missing, never a zero yield.
      if (typeof raw !== "string" || !raw.trim() || raw === "N/A") continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error("Invalid Treasury yield");
      if (values.has(tenor) && values.get(tenor) !== value) throw new Error("Conflicting Treasury yields for one date");
      values.set(tenor, value);
    }
    days.set(date, values);
  }
  const provenance = { sourceName: "美国财政部", sourceUrl: SOURCE_URL, availabilityBasis: "retrieved" as const, publishedAt: retrievedAt.toISOString() };
  const history: PriceBar[] = [];
  const dates = [...days.keys()].sort();
  for (const date of dates) for (const [tenor, value] of days.get(date)!) history.push({ instrumentId: `us-treasury-${tenor}y`, date, close: value, ...provenance, sourceUrl: treasuryFeedUrl(date.slice(0, 7).replace("-", "")) });
  const quotes: Quote[] = [];
  for (const tenor of TENORS) {
    const instrumentId = `us-treasury-${tenor}y`;
    const observations = history.filter((h) => h.instrumentId === instrumentId);
    const last = observations.at(-1);
    if (!last) continue;
    quotes.push({ instrumentId, value: last.close, previousClose: observations.at(-2)?.close ?? null, asOf: `${last.date}T00:00:00.000Z`, frequency: "daily", unit: "percent", ...provenance, sourceUrl: last.sourceUrl });
  }
  if (!quotes.length) throw new Error("Treasury response has no supported yields");
  return { quotes, history };
}

export function treasuryFeedUrl(month: string): string {
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid Treasury month");
  return `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=${month}`;
}
