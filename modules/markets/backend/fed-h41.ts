import { load } from "cheerio";
import type { MacroObservation } from "../domain.ts";
import { macroDate } from "./macro.ts";

export const FED_H41_URL = "https://www.federalreserve.gov/releases/h41/current/default.htm";

/** Uses the Wednesday levels, never the adjacent weekly average or change columns. */
export function parseFedH41(html: string, retrievedAt = new Date()): MacroObservation[] {
  if (Buffer.byteLength(html) > 4 * 1024 * 1024) throw new Error("H41 response exceeds 4 MB");
  const $ = load(html);
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  const definitions = [
    { metric: "fed-total-assets", label: "美联储总资产（周三余额）", row: "Total assets", marker: "Eliminations from consolidation", column: 2 },
    { metric: "fed-reserve-balances", label: "存款机构准备金（周三余额）", row: "Reserve balances with Federal Reserve Banks", marker: "Averages of daily figures", column: 4 },
  ];
  return definitions.map((definition): MacroObservation => {
    const cells = $("td").filter((_, cell) => clean($(cell).text()) === definition.row);
    const matching = cells.filter((_, cell) => clean($(cell).closest("table").text()).includes(definition.marker));
    if (matching.length !== 1) throw new Error(`Missing or ambiguous H41 ${definition.metric}`);
    const table = matching.closest("table");
    if (clean(table.prev().text()) !== "Millions of dollars") throw new Error("Unexpected H41 unit");
    const headers = table.find("tr").first().children("td,th");
    let position = 0;
    let dateMatch: RegExpExecArray | null = null;
    for (const cell of headers.toArray()) {
      const match = /^Wednesday\s*([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})$/.exec(clean($(cell).text()));
      if (match && position === definition.column) dateMatch = match;
      position += Number($(cell).attr("colspan") ?? 1);
    }
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    if (!dateMatch || !months.includes(dateMatch[1]!)) throw new Error("Missing H41 Wednesday date");
    const date = `${dateMatch[3]}-${String(months.indexOf(dateMatch[1]!) + 1).padStart(2, "0")}-${dateMatch[2]!.padStart(2, "0")}`;
    const asOf = macroDate(date, retrievedAt);
    if (new Date(asOf).getUTCDay() !== 3) throw new Error("H41 observation is not Wednesday");
    const fields = matching.closest("tr").children("td,th").map((_, cell) => clean($(cell).text())).get();
    if (fields.length !== 5 || !/^\d{1,3}(?:,\d{3})*$|^\d+$/.test(fields[definition.column] ?? "")) throw new Error("Invalid H41 balance row");
    const value = Number(fields[definition.column]!.replaceAll(",", ""));
    if (!Number.isSafeInteger(value)) throw new Error("Invalid H41 balance");
    return { id: `${definition.metric}.${date}`, sourceId: "fed", metric: definition.metric, label: definition.label, value, unit: "usd-million", frequency: "weekly", asOf, publishedAt: retrievedAt.toISOString(), availabilityBasis: "retrieved", sourceName: "Board of Governors of the Federal Reserve System · H.4.1", sourceUrl: FED_H41_URL, sourceTermsUrl: "https://www.federalreserve.gov/disclaimer.htm", sourceNotice: "来源：美联储 H.4.1。本站提取周三余额，单位为百万美元；不代表每日新增。可用时间按采集确认记录，未推定历史发布时刻。" };
  });
}
