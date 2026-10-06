import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { collectionState, mutateSnapshot } from "./snapshot.ts";
import { parseTreasuryXml, treasuryFeedUrl } from "./treasury.ts";
import { JAPAN_MOF_URL, parseJapanMofCsv } from "./japan-mof.ts";
import { ecbFeedUrl, parseEcbCsv } from "./ecb.ts";
import { SOURCE_CANDIDATES } from "../sources.ts";
import { nyfedFeedUrl, parseNyfedJson } from "./nyfed.ts";
import { FED_H41_URL, parseFedH41 } from "./fed-h41.ts";
import { mergeMacroObservations } from "./macro.ts";
import type { MacroObservation, PriceBar, Quote } from "../domain.ts";

export type MarketSource = "treasury" | "japan-mof" | "ecb" | "nyfed" | "fed";

export function assertCollectionAllowed(source: MarketSource = "treasury") {
  if (!collectionState().enabled) throw new Error("Market collection requires COLLECT_ENABLED=true");
  if (!SOURCE_CANDIDATES.some((candidate) => candidate.id === source && candidate.status === "approved" && candidate.integration === "ready")) throw new Error("Market source is not available for collection");
}

async function response(url: string, source: string) {
  const res = await guardedFetch(url, { maxBytes: 4 * 1024 * 1024, timeoutMs: 30_000, route: "direct" });
  if (res.status !== 200) throw new Error(`${source} HTTP ${res.status}`);
  return res;
}

async function fetchMarket(source: MarketSource): Promise<{ quotes: Quote[]; history: PriceBar[]; macro: MacroObservation[] }> {
  if (source === "nyfed") {
    const rows = await Promise.all((["sofr", "effr"] as const).map(async (rate) => {
      const res = await response(nyfedFeedUrl(rate), source);
      return parseNyfedJson(res.text(), rate, new Date());
    }));
    return { quotes: [], history: [], macro: rows.flat() };
  }
  if (source === "fed") {
    const res = await response(FED_H41_URL, source);
    return { quotes: [], history: [], macro: parseFedH41(res.text(), new Date()) };
  }
  const month = new Date().toISOString().slice(0, 7).replace("-", "");
  const url = source === "treasury" ? treasuryFeedUrl(month) : source === "japan-mof" ? JAPAN_MOF_URL : ecbFeedUrl();
  const res = await response(url, source);
  const now = new Date();
  const collected = source === "treasury" ? parseTreasuryXml(res.text(), now)
    : source === "japan-mof" ? parseJapanMofCsv(new TextDecoder("shift_jis").decode(res.body), now) : parseEcbCsv(res.text(), now);
  return { ...collected, macro: [] };
}

export async function collectMarket(source: MarketSource, actor: string, reason: string) {
  assertCollectionAllowed(source);
  const collected = await fetchMarket(source);
  const now = new Date();
  const snapshot = await mutateSnapshot((before) => {
    const history = new Map(before.history.map((bar) => [`${bar.instrumentId}:${bar.date}`, bar]));
    for (const bar of collected.history) {
      const old = history.get(`${bar.instrumentId}:${bar.date}`);
      // Preserve the first confirmed availability timestamp when an observation is unchanged.
      history.set(`${bar.instrumentId}:${bar.date}`, old?.close === bar.close ? old : bar);
    }
    const quotes = new Map(before.quotes.map((quote) => [quote.instrumentId, quote]));
    for (const quote of collected.quotes) {
      const previous = quotes.get(quote.instrumentId);
      if (previous && Date.parse(previous.asOf) > Date.parse(quote.asOf)) continue;
      const observations = [...history.values()].filter((h) => h.instrumentId === quote.instrumentId && h.date < quote.asOf.slice(0, 10)).sort((a, b) => a.date.localeCompare(b.date));
      quotes.set(quote.instrumentId, { ...quote, publishedAt: history.get(`${quote.instrumentId}:${quote.asOf.slice(0, 10)}`)?.publishedAt ?? quote.publishedAt, previousClose: observations.at(-1)?.close ?? null });
    }
    return { ...before, asOf: now.toISOString(), quotes: [...quotes.values()], history: [...history.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-10000), macro: mergeMacroObservations(before.macro ?? [], collected.macro) };
  }, actor, reason);
  return { quotes: collected.quotes.length, macro: collected.macro.length, asOf: snapshot.asOf };
}
