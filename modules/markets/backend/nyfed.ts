import { SITE } from "@aihot/site";
import type { MacroObservation } from "../domain.ts";
import { macroDate } from "./macro.ts";

export type NyfedRate = "sofr" | "effr";
export const NYFED_TERMS = "https://www.newyorkfed.org/privacy/termsofuse";
export function nyfedFeedUrl(rate: NyfedRate): string {
  return `https://markets.newyorkfed.org/api/rates/${rate === "sofr" ? "secured" : "unsecured"}/${rate}/last/5.json`;
}

export function parseNyfedJson(json: string, rate: NyfedRate, retrievedAt = new Date()): MacroObservation[] {
  if (Buffer.byteLength(json) > 1024 * 1024) throw new Error("NYFed response exceeds 1 MB");
  const data: unknown = JSON.parse(json);
  const records = data && typeof data === "object" && "refRates" in data ? data.refRates : null;
  if (!Array.isArray(records) || !records.length || records.length > 100) throw new Error("NYFed response contains no reference rates");
  const rows = new Map<string, MacroObservation>();
  for (const record of records) {
    if (!record || record.type !== rate.toUpperCase() || typeof record.effectiveDate !== "string" || typeof record.percentRate !== "number" || !Number.isFinite(record.percentRate)) throw new Error("Invalid NYFed reference rate");
    const asOf = macroDate(record.effectiveDate, retrievedAt);
    const id = `${rate}.${record.effectiveDate}`;
    if (rows.has(id)) throw new Error("Duplicate NYFed observation");
    const label = rate === "sofr" ? "Secured Overnight Financing Rate (SOFR)" : "Effective Federal Funds Rate (EFFR)";
    const flags = [record.revisionIndicator ? `官方修订标记：${String(record.revisionIndicator).slice(0, 20)}` : "", record.footnoteId ? `官方脚注标记：${String(record.footnoteId).slice(0, 20)}，说明见原始来源` : ""].filter(Boolean).join("；");
    rows.set(id, { id, sourceId: "nyfed", metric: rate, label, value: record.percentRate, unit: "percent", frequency: "daily", asOf, publishedAt: retrievedAt.toISOString(), availabilityBasis: "retrieved", sourceName: "Federal Reserve Bank of New York", sourceUrl: nyfedFeedUrl(rate), sourceTermsUrl: NYFED_TERMS,
      sourceNotice: `© ${record.effectiveDate.slice(0, 4)} Federal Reserve Bank of New York. Content from the New York Fed subject to the Terms of Use at newyorkfed.org. The ${label} data is subject to the Terms of Use posted at newyorkfed.org. The New York Fed is not responsible for publication of the ${rate.toUpperCase()} data by ${SITE.name}, does not sanction or endorse any particular republication, and has no liability for your use. ${SITE.name} is not affiliated with the New York Fed. The New York Fed does not sanction, endorse, or recommend any products or services offered by ${SITE.name}. 数据从官方 API 提取，日期与格式由本站转换；参考利率不是实时融资报价。${flags}` });
  }
  return [...rows.values()].sort((a, b) => a.asOf.localeCompare(b.asOf));
}
