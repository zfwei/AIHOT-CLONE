import assert from "node:assert/strict";
import { test } from "node:test";
import { observeLiquidity } from "../liquidity.ts";
import { evaluateMarket } from "../analysis.ts";
import { emptySnapshot } from "../backend/validation.ts";
import type { MacroObservation } from "../domain.ts";

const NOW = new Date("2020-01-10T12:00:00Z");
function row(metric: string, date: string, value: number, patch: Partial<MacroObservation> = {}): MacroObservation {
  const weekly = metric.startsWith("fed-");
  return { id: `${metric}.${date}`, sourceId: weekly ? "fed" : "nyfed", metric, label: metric, value, unit: weekly ? "usd-million" : "percent", frequency: weekly ? "weekly" : "daily", asOf: `${date}T00:00:00Z`, publishedAt: `${date}T20:00:00Z`, availabilityBasis: "retrieved", sourceName: "Isolated official-format test fixture", sourceUrl: "https://example.test/fixture", ...patch };
}

test("same-day SOFR minus EFFR is expressed in bp with both inputs and the later availability", () => {
  const inputs = [row("sofr", "2020-01-09", 1.53), row("effr", "2020-01-09", 1.5, { publishedAt: "2020-01-10T01:00:00Z" }), row("sofr", "2020-01-10", 8)];
  const before = JSON.stringify(inputs);
  const result = observeLiquidity(inputs, NOW);
  assert.equal(result.spread.basisPoints, 3);
  assert.equal(result.spread.asOf, "2020-01-09");
  assert.equal(result.spread.publishedAt, "2020-01-10T01:00:00.000Z");
  assert.deepEqual(result.spread.inputs, inputs.slice(0, 2));
  assert.equal(JSON.stringify(inputs), before);
  assert.equal(observeLiquidity([row("sofr", "2020-01-09", 1.48), row("effr", "2020-01-09", 1.5)], NOW).spread.basisPoints, -2);
});

test("spread does not join different dates, unpublished values, wrong units or untrusted source metadata", () => {
  const sofr = row("sofr", "2020-01-09", 1.5);
  for (const counterpart of [
    row("effr", "2020-01-08", 1.5), row("effr", "2020-01-09", 1.5, { publishedAt: "2020-01-11T00:00:00Z" }),
    row("effr", "2020-01-09", 1.5, { unit: "usd-million" }), row("effr", "2020-01-09", 1.5, { sourceId: "other" }),
    row("effr", "2020-01-09", 1.5, { sourceUrl: "javascript:alert(1)" }), row("effr", "2020-01-09", NaN),
  ]) assert.equal(observeLiquidity([sofr, counterpart], NOW).spread.basisPoints, null);
});

test("equal-time conflicting inputs prevent calculation; a later published correction is used only when available", () => {
  const inputs = [row("sofr", "2020-01-09", 1.5), row("effr", "2020-01-09", 1.5), row("effr", "2020-01-09", 1.6)];
  assert.equal(observeLiquidity(inputs, NOW).spread.basisPoints, null);
  const correction = row("effr", "2020-01-09", 1.4, { publishedAt: "2020-01-10T10:00:00Z" });
  assert.equal(observeLiquidity([...inputs, correction], NOW).spread.basisPoints, 10);
  assert.equal(observeLiquidity([...inputs, correction], new Date("2020-01-10T09:00:00Z")).spread.basisPoints, null);
});

test("H41 changes require consecutive Wednesdays with matching series and units", () => {
  const inputs = [row("fed-total-assets", "2020-01-01", 1200), row("fed-total-assets", "2020-01-08", 1150), row("fed-reserve-balances", "2020-01-08", 300)];
  const result = observeLiquidity(inputs, NOW);
  assert.equal(result.balances[0]!.change, -50);
  assert.equal(result.balances[0]!.previous!.asOf.slice(0, 10), "2020-01-01");
  assert.equal(result.balances[1]!.current!.value, 300);
  assert.equal(result.balances[1]!.change, null);
  for (const previous of [row("fed-total-assets", "2019-12-25", 1200), row("fed-total-assets", "2020-01-01", 1200, { unit: "percent" }), row("fed-total-assets", "2020-01-02", 1200)]) {
    assert.equal(observeLiquidity([previous, inputs[1]!], NOW).balances[0]!.change, null);
  }
});

test("observation arithmetic creates no rules, risk verdicts or missing-equals-safe conclusions", () => {
  const snapshot = { ...emptySnapshot(), macro: [row("sofr", "2020-01-09", 1.5), row("effr", "2020-01-09", 1.5)] };
  const before = JSON.stringify(snapshot);
  assert.equal(observeLiquidity(snapshot.macro, NOW).spread.basisPoints, 0);
  assert.ok(evaluateMarket(snapshot, "us-stocks", NOW).factors.every((factor) => factor.state === "unknown"));
  assert.equal(JSON.stringify(snapshot), before);
  assert.equal(observeLiquidity([], NOW).spread.basisPoints, null);
  assert.ok(observeLiquidity([], NOW).balances.every((balance) => balance.current === null && balance.change === null));
});
