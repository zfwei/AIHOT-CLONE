import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEquityResult } from "../backend/equities.ts";
import { mergeMarketData } from "../backend/collect.ts";
import { emptySnapshot, parseSnapshot } from "../backend/validation.ts";
import type { PriceBar, Quote, Snapshot } from "../domain.ts";

const FIRST = new Date("2020-01-06T22:00:00Z");
const NOW = new Date("2020-01-07T22:00:00Z");
const provenance = { sourceName: "Yahoo Finance via yfinance", sourceUrl: "https://finance.yahoo.com/quote/AAPL/history/" };

function quote(patch: Partial<Quote> = {}): Quote {
  return { instrumentId: "aapl", value: 120, previousClose: 118, asOf: "2020-01-06T00:00:00Z", publishedAt: NOW.toISOString(), availabilityBasis: "retrieved", frequency: "daily", unit: "price", ...provenance, ...patch };
}

function bar(date: string, close: number, patch: Partial<PriceBar> = {}): PriceBar {
  return { instrumentId: "aapl", date, close, publishedAt: NOW.toISOString(), availabilityBasis: "retrieved", priceBasis: "adjusted", ...provenance, ...patch };
}

function collected() {
  return { quotes: [quote()], history: [bar("2020-01-03", 59), bar("2020-01-06", 60)], errors: [], macro: [] };
}

test("equity parser keeps raw quote values separate from adjusted stock history and accepts partial failures", () => {
  const input = { ...collected(), errors: [{ instrumentId: "msft", message: "Fixture upstream unavailable" }] };
  const result = parseEquityResult({ quotes: input.quotes, history: input.history, errors: input.errors }, "yfinance", NOW);
  assert.equal(result.quotes[0]!.value, 120);
  assert.equal(result.quotes[0]!.previousClose, 118);
  assert.deepEqual(result.history.map((row) => row.close), [59, 60]);
  assert.equal(result.history[0]!.priceBasis, "adjusted");
  assert.equal(result.quotes[0]!.publishedAt, NOW.toISOString());
  assert.deepEqual(result.errors, input.errors);
  assert.deepEqual(result.macro, []);
  const index = quote({ instrumentId: "cn-csi300", value: 4000, previousClose: 3990, unit: "points" });
  const history = [bar("2020-01-06", 4000, { instrumentId: index.instrumentId, priceBasis: "unadjusted" })];
  assert.equal(parseEquityResult({ quotes: [index], history, errors: [] }, "akshare", NOW).quotes[0]!.unit, "points");
});

test("equity parser rejects unexpected instruments, detached series, duplicate days and all-failed collections", () => {
  const { quotes, history } = collected();
  assert.throws(() => parseEquityResult({ quotes, history, errors: [] }, "akshare", NOW), /Unexpected equity instrument/);
  assert.throws(() => parseEquityResult({ quotes, history, errors: [{ instrumentId: "600519.sh", message: "wrong source" }] }, "yfinance", NOW));
  assert.throws(() => parseEquityResult({ quotes, history: [], errors: [] }, "yfinance", NOW), /dates disagree/);
  assert.throws(() => parseEquityResult({ quotes, history: [bar("2020-01-07", 60)], errors: [] }, "yfinance", NOW), /dates disagree/);
  assert.throws(() => parseEquityResult({ quotes, history: [...history, bar("2020-01-06", 80, { instrumentId: "msft" })], errors: [] }, "yfinance", NOW), /requires its quote/);
  assert.throws(() => parseEquityResult({ quotes, history: [...history, history[0]], errors: [] }, "yfinance", NOW), /Duplicate/);
  assert.throws(() => parseEquityResult({ quotes: [], history: [], errors: [{ instrumentId: "aapl", message: "Fixture failure" }] }, "yfinance", NOW), /No yfinance data collected/);
});

test("equity parser requires adjusted stocks, unadjusted indices, daily frequency and retrieved availability", () => {
  const { quotes, history } = collected();
  for (const priceBasis of [undefined, "unadjusted"] as const) {
    assert.throws(() => parseEquityResult({ quotes, history: history.map((row) => ({ ...row, priceBasis })), errors: [] }, "yfinance", NOW));
  }
  const index = quote({ instrumentId: "us-sp500", value: 3200, previousClose: 3190, unit: "points" });
  assert.throws(() => parseEquityResult({ quotes: [index], history: [bar("2020-01-06", 3200, { instrumentId: index.instrumentId })], errors: [] }, "yfinance", NOW));
  assert.throws(() => parseEquityResult({ quotes: [quote({ frequency: "delayed" })], history, errors: [] }, "yfinance", NOW));
  for (const availabilityBasis of [undefined, "published"] as const) {
    assert.throws(() => parseEquityResult({ quotes: [quote({ availabilityBasis })], history, errors: [] }, "yfinance", NOW));
    assert.throws(() => parseEquityResult({ quotes, history: history.map((row) => ({ ...row, availabilityBasis })), errors: [] }, "yfinance", NOW));
  }
});

test("equity parser refuses out-of-order history and a simultaneous success and error for one instrument", () => {
  const { quotes, history } = collected();
  assert.throws(() => parseEquityResult({ quotes, history: [bar("2020-01-03", 59), bar("2020-01-02", 58), bar("2020-01-06", 60)], errors: [] }, "yfinance", NOW));
  assert.throws(() => parseEquityResult({ quotes, history, errors: [{ instrumentId: "aapl", message: "conflicting result" }] }, "yfinance", NOW));
});

test("equity merge replaces the complete successful adjusted window, preserves raw previous close and leaves failed instruments intact", () => {
  const msft = quote({ instrumentId: "msft", value: 160, previousClose: 159, publishedAt: FIRST.toISOString() });
  const before: Snapshot = { ...emptySnapshot(), asOf: FIRST.toISOString(), quotes: [quote({ publishedAt: FIRST.toISOString() }), msft], history: [
    bar("2019-12-31", 115, { publishedAt: FIRST.toISOString() }),
    bar("2020-01-03", 118, { publishedAt: FIRST.toISOString() }),
    bar("2020-01-06", 120, { publishedAt: FIRST.toISOString() }),
    bar("2020-01-06", 155, { instrumentId: "msft", publishedAt: FIRST.toISOString() }),
  ] };
  const original = structuredClone(before);
  const next = mergeMarketData(before, { ...collected(), errors: [{ instrumentId: "msft", message: "Fixture failure" }] }, "yfinance", NOW);
  assert.deepEqual(next.history.filter((row) => row.instrumentId === "aapl").map((row) => [row.date, row.close]), [["2020-01-03", 59], ["2020-01-06", 60]]);
  assert.equal(next.quotes.find((row) => row.instrumentId === "aapl")!.previousClose, 118);
  assert.deepEqual(next.quotes.find((row) => row.instrumentId === "msft"), msft);
  assert.deepEqual(next.history.filter((row) => row.instrumentId === "msft"), before.history.filter((row) => row.instrumentId === "msft"));
  assert.ok(next.history.filter((row) => row.instrumentId === "aapl").every((row) => row.publishedAt === NOW.toISOString()));
  assert.deepEqual(before, original, "merging does not mutate the prior snapshot");
  assert.doesNotThrow(() => parseSnapshot(next, NOW));
});

test("equity merge keeps first availability for unchanged observations but dates corrections when retrieved", () => {
  const input = collected();
  const before: Snapshot = { ...emptySnapshot(), asOf: FIRST.toISOString(), quotes: input.quotes.map((row) => ({ ...row, publishedAt: FIRST.toISOString() })), history: input.history.map((row) => ({ ...row, publishedAt: FIRST.toISOString() })) };
  const unchanged = mergeMarketData(before, input, "yfinance", NOW);
  assert.ok(unchanged.history.every((row) => row.publishedAt === FIRST.toISOString()));
  assert.equal(unchanged.quotes[0]!.publishedAt, FIRST.toISOString());
  const corrected = mergeMarketData(before, { ...input, quotes: [quote({ previousClose: 117 })], history: [bar("2020-01-03", 58.5), input.history[1]!] }, "yfinance", NOW);
  assert.equal(corrected.quotes[0]!.publishedAt, NOW.toISOString());
  assert.equal(corrected.history[0]!.publishedAt, NOW.toISOString());
  assert.equal(corrected.history[1]!.publishedAt, FIRST.toISOString());
});

test("an older equity response cannot roll back the quote or replace its newer history window", () => {
  const before: Snapshot = { ...emptySnapshot(), asOf: NOW.toISOString(), quotes: [quote({ asOf: "2020-01-07T00:00:00Z", value: 121, previousClose: 120 })], history: [bar("2020-01-06", 60), bar("2020-01-07", 60.5)] };
  const next = mergeMarketData(before, collected(), "yfinance", NOW);
  assert.deepEqual(next.quotes, before.quotes);
  assert.deepEqual(next.history, before.history);
});

test("equity refresh preserves other sources and non-price snapshot content", () => {
  const treasury = quote({ instrumentId: "us-treasury-10y", value: 1.9, previousClose: 1.8, unit: "percent", sourceName: "Treasury", sourceUrl: "https://home.treasury.gov/fixture" });
  const treasuryHistory = bar("2020-01-06", 1.9, { instrumentId: treasury.instrumentId, priceBasis: "unadjusted", sourceName: treasury.sourceName, sourceUrl: treasury.sourceUrl });
  const before: Snapshot = { ...emptySnapshot(), quotes: [treasury], history: [treasuryHistory], rules: [{ id: "fixture", market: "us-stocks", factor: "valuation", metric: "pe", unit: "ratio", operator: "gte", threshold: null, version: "fixture", enabled: false }] };
  const next = mergeMarketData(before, collected(), "yfinance", NOW);
  assert.deepEqual(next.quotes.find((row) => row.instrumentId === treasury.instrumentId), treasury);
  assert.deepEqual(next.history.find((row) => row.instrumentId === treasury.instrumentId), treasuryHistory);
  assert.deepEqual(next.rules, before.rules);
  assert.deepEqual(next.evidence, before.evidence);
  assert.deepEqual(next.ideas, before.ideas);
});
