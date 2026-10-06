import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMarket, observeTrend, analyzePortfolio, calculateRiskBudget } from "../analysis.ts";
import type { Instrument, PriceBar, RiskEvidence, RiskRule, Snapshot } from "../domain.ts";

const now = new Date("2026-10-06T12:00:00Z");
const source = { sourceName: "Test evidence", sourceUrl: "https://example.test/data" };
const stock: Instrument = { id: "stock", name: "Stock", market: "us-stocks", currency: "USD", kind: "stock" };
const bond: Instrument = { id: "bond", name: "10Y", market: "us-treasury", currency: "USD", kind: "bond-yield" };
const rule: RiskRule = { id: "r", market: "us-stocks", factor: "valuation", metric: "pe", unit: "ratio", operator: "gte", threshold: 30, version: "v1", enabled: true };
const evidence: RiskEvidence = { id: "e", market: "us-stocks", metric: "pe", value: 30, unit: "ratio", asOf: "2026-10-05T20:00:00Z", publishedAt: "2026-10-05T21:00:00Z", expiresAt: "2026-10-07T00:00:00Z", ...source };
const snapshot = (rules: RiskRule[] = [], evidence: RiskEvidence[] = []): Snapshot => ({ schemaVersion: 1, asOf: now.toISOString(), quotes: [], rules, evidence, history: [], ideas: [] });

test("risk: missing rules stay unknown, bond valuation/speculation are inapplicable", () => {
  assert.equal(evaluateMarket(snapshot(), "us-stocks", now).unknownCount, 4);
  const b = evaluateMarket(snapshot(), "us-treasury", now);
  assert.equal(b.notApplicableCount, 2);
  assert.equal(b.unknownCount, 2);
});

test("risk: declared inclusive threshold, provenance and unknown counts survive", () => {
  const result = evaluateMarket(snapshot([rule], [evidence]), "us-stocks", now);
  assert.equal(result.factors[0]!.state, "triggered");
  assert.equal(result.factors[0]!.ruleVersion, "v1");
  assert.deepEqual(result.factors[0]!.evidence.map(e => e.id), ["e"]);
  assert.equal(result.evaluatedCount, 1);
  assert.equal(result.unknownCount, 3);
  assert.equal(evaluateMarket(snapshot([{ ...rule, operator: "lte" }], [evidence]), "us-stocks", now).triggeredCount, 1);
  assert.equal(evaluateMarket(snapshot([rule], [{ ...evidence, value: 29.999 }]), "us-stocks", now).factors[0]!.state, "not_triggered");
});

test("risk: null, nonfinite, expiry boundary, future knowledge, wrong units and no source never clear risk", () => {
  for (const patch of [{ value: null }, { value: NaN }, { expiresAt: now.toISOString() }, { publishedAt: "2026-10-07T00:00:00Z" }, { asOf: "2026-10-07T00:00:00Z" }, { unit: "percent" }, { sourceUrl: "" }]) {
    assert.equal(evaluateMarket(snapshot([rule], [{ ...evidence, ...patch }]), "us-stocks", now).factors[0]!.state, "unknown");
  }
  assert.equal(evaluateMarket(snapshot([{ ...rule, threshold: null }], [evidence]), "us-stocks", now).evaluatedCount, 0);
  assert.equal(evaluateMarket(snapshot([rule, { ...rule, id: "r2" }], [evidence]), "us-stocks", now).evaluatedCount, 0);
});

test("risk: conflicting same-period sources cannot silently win; zero and negative are real values", () => {
  assert.equal(evaluateMarket(snapshot([rule], [evidence, { ...evidence, id: "e2", value: 50, sourceName: "Other" }]), "us-stocks", now).evaluatedCount, 0);
  for (const value of [0, -1]) assert.equal(evaluateMarket(snapshot([rule], [{ ...evidence, value }]), "us-stocks", now).factors[0]!.state, "not_triggered");
});

function bars(): PriceBar[] {
  const dates: string[] = [];
  for (let day = new Date("2026-10-05T00:00:00Z"); dates.length < 61; day = new Date(+day - 86400000)) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) dates.unshift(day.toISOString().slice(0, 10));
  }
  return dates.map((date, i) => ({ instrumentId: stock.id, date, close: i === 60 ? 200 : 100, publishedAt: `${date}T21:00:00Z`, priceBasis: "adjusted", ...source }));
}

test("trend: requires 61 unique available positive daily prices, preserves unbacktested label", () => {
  const history = bars();
  assert.equal(observeTrend(stock, history.slice(1), now).state, "unknown");
  assert.equal(observeTrend(stock, [...history.slice(1), history[60]!], now).state, "unknown");
  const result = observeTrend(stock, history, now);
  assert.equal(result.signal, "cross_above");
  assert.equal(result.ruleVersion, "ma20-60-v1-unbacktested");
  assert.equal(result.ma20, 105);
  assert.equal(observeTrend(stock, history, new Date("2026-11-01")).state, "unknown");
  assert.equal(observeTrend(stock, history.map((b, i) => i === 60 ? { ...b, publishedAt: "2026-10-07T00:00:00Z" } : b), now).state, "unknown");
  assert.equal(observeTrend(stock, history.map((b, i) => i === 60 ? { ...b, close: NaN } : b), now).state, "unknown");
  assert.equal(observeTrend(bond, history, now).state, "not_applicable");
});

test("trend: unadjusted stocks and sparse samples cannot create corporate-action or missing-session crosses", () => {
  const history = bars();
  assert.equal(observeTrend(stock, history.map(b => ({ ...b, priceBasis: undefined })), now).state, "unknown");
  assert.equal(observeTrend(stock, history.map((b, i) => i === 60 ? { ...b, priceBasis: "unadjusted" } : b), now).state, "unknown");
  const index = { ...stock, kind: "index" as const };
  assert.equal(observeTrend(index, history.map(b => ({ ...b, priceBasis: undefined })), now).state, "observed");
  const sparse = history.map((b, i) => {
    const date = new Date(Date.parse("2026-10-05") - (60 - i) * 86400000 * 3).toISOString().slice(0, 10);
    return { ...b, date, publishedAt: `${date}T21:00:00Z` };
  });
  assert.equal(observeTrend(stock, sparse, now).state, "unknown");
  const gap = history.map((b, i) => i < 30 ? { ...b, date: new Date(Date.parse(b.date) - 8 * 86400000).toISOString().slice(0, 10) } : b);
  assert.equal(observeTrend(stock, gap, now).state, "unknown");
});

test("portfolio: separates currencies, handles missing marks, never treats yield as a price", () => {
  const eur = { ...stock, id: "eur", currency: "EUR" };
  const quote = { instrumentId: stock.id, value: 12, previousClose: 11, asOf: evidence.asOf, publishedAt: evidence.publishedAt, frequency: "daily" as const, unit: "price" as const, ...source };
  const p = analyzePortfolio([{ instrumentId: stock.id, quantity: 10, averageCost: 10 }, { instrumentId: eur.id, quantity: 1, averageCost: 20 }, { instrumentId: bond.id, quantity: 1, averageCost: 100 }], [stock, eur, bond], [quote, { ...quote, instrumentId: eur.id, value: 25 }, { ...quote, instrumentId: bond.id, value: 4, unit: "percent" }], now);
  assert.equal(p.currencies.length, 2);
  assert.equal(p.holdings[0]!.unrealizedPnl, 20);
  assert.equal(p.holdings[2]!.marketValue, null);
  assert.equal(p.holdings[0]!.concentration, null, "unpriced USD exposure makes concentration unknown");
  assert.equal(p.currencies.find(c => c.currency === "USD")!.complete, false);
  assert.equal(analyzePortfolio([{ instrumentId: stock.id, quantity: 10, averageCost: 10 }], [stock], [quote], new Date("2026-11-01")).holdings[0]!.marketValue, null);
});

test("risk budget: all user inputs required; lot rounding and cash cap; no short/stop-above-entry", () => {
  const input = { currency: "USD", capital: 10000, maxRiskPercent: 1, entryPrice: 100, stopPrice: 95, lotSize: 1 };
  assert.equal(calculateRiskBudget(input).quantity, 20);
  assert.equal(calculateRiskBudget({ ...input, lotSize: 100 }).quantity, 0);
  assert.equal(calculateRiskBudget({ ...input, stopPrice: 99.9 }).quantity, 100, "cash caps nominal position");
  for (const patch of [{ capital: null }, { maxRiskPercent: null }, { maxRiskPercent: 101 }, { stopPrice: 100 }, { stopPrice: 110 }, { lotSize: 0 }, { entryPrice: Infinity }]) {
    assert.equal(calculateRiskBudget({ ...input, ...patch }).state, "unknown");
  }
});
