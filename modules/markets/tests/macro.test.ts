import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNyfedJson, nyfedFeedUrl } from "../backend/nyfed.ts";
import { parseFedH41 } from "../backend/fed-h41.ts";
import { mergeMacroObservations } from "../backend/macro.ts";
import { emptySnapshot, parseSnapshot } from "../backend/validation.ts";
import { MARKET_SERVER } from "../server.ts";

const NOW = new Date("2020-01-03T22:00:00Z");
const rate = { effectiveDate: "2020-01-02", type: "SOFR", percentRate: 1.5, revisionIndicator: "", volumeInBillions: 100 };
const json = JSON.stringify({ refRates: [rate] });
// Layout follows the official tables; values are intentionally synthetic and never published.
const html = `<p>Millions of dollars</p><table>
<tr><td>Assets, liabilities, and capital</td><td>Eliminations from consolidation</td><td>Wednesday Jan 1, 2020</td><td colspan="2">Change since</td></tr>
<tr><td>Total assets</td><td>(0)</td><td>1,234</td><td>+ 999</td><td>- 888</td></tr></table>
<p>Millions of dollars</p><table>
<tr><td>Reserve Bank credit</td><td colspan="3">Averages of daily figures</td><td>Wednesday Jan 1, 2020</td></tr>
<tr><td>Reserve balances with Federal Reserve Banks</td><td>567</td><td>+ 999</td><td>- 888</td><td>456</td></tr></table>`;

test("NYFed reference rates preserve percentage units, observed dates, attribution and retrieval availability", () => {
  const rows = parseNyfedJson(json, "sofr", NOW);
  assert.equal(rows[0]!.value, 1.5);
  assert.equal(rows[0]!.unit, "percent");
  assert.equal(rows[0]!.asOf, "2020-01-02T00:00:00.000Z");
  assert.equal(rows[0]!.publishedAt, NOW.toISOString());
  assert.equal(rows[0]!.availabilityBasis, "retrieved");
  assert.equal(rows[0]!.sourceUrl, nyfedFeedUrl("sofr"));
  assert.ok(rows[0]!.sourceNotice!.includes("does not sanction or endorse"));
  const effr = parseNyfedJson(JSON.stringify({ refRates: [{ ...rate, type: "EFFR", footnoteId: 2, revisionIndicator: "Y" }] }), "effr", NOW)[0]!;
  assert.equal(effr.metric, "effr");
  assert.ok(effr.sourceNotice!.includes("脚注标记：2"));
  assert.ok(effr.sourceNotice!.includes("修订标记：Y"));
});

test("NYFed refuses missing, wrong-series, malformed, future and duplicate rates", () => {
  for (const input of ["<html>error</html>", "{}", '{"refRates":[]}', ...[
    { ...rate, type: "EFFR" }, { ...rate, percentRate: null }, { ...rate, percentRate: "1.5" },
    { ...rate, effectiveDate: "2020-02-30" }, { ...rate, effectiveDate: "2099-01-01" },
  ].map((row) => JSON.stringify({ refRates: [row] })), JSON.stringify({ refRates: [rate, rate] })]) assert.throws(() => parseNyfedJson(input, "sofr", NOW));
});

test("H41 reads Wednesday levels rather than eliminations, weekly averages or changes", () => {
  const rows = parseFedH41(html, NOW);
  assert.deepEqual(rows.map((row) => [row.metric, row.value, row.unit, row.frequency]), [["fed-total-assets", 1234, "usd-million", "weekly"], ["fed-reserve-balances", 456, "usd-million", "weekly"]]);
  assert.ok(rows.every((row) => row.asOf === "2020-01-01T00:00:00.000Z" && row.publishedAt === NOW.toISOString()));
  for (const invalid of [html.replaceAll("Millions of dollars", "Billions of dollars"), html.replace("Total assets", "Other assets"), html.replace("1,234", "NaN"), html.replaceAll("Jan 1, 2020", "Jan 2, 2020"), html.replaceAll("Jan 1, 2020", "Jan 5, 2050"), html.replace('colspan="3"', 'colspan="2"')]) assert.throws(() => parseFedH41(invalid, NOW));
});

test("macro merge retains other sources and first availability while dating corrections when obtained", () => {
  const original = [...parseNyfedJson(json, "sofr", NOW), ...parseFedH41(html, NOW)];
  const later = new Date("2020-01-06T22:00:00Z");
  const unchanged = parseNyfedJson(json, "sofr", later);
  const retained = mergeMacroObservations(original, unchanged);
  assert.equal(retained.length, 3);
  assert.equal(retained.find((row) => row.metric === "sofr")!.publishedAt, NOW.toISOString());
  const corrected = mergeMacroObservations(retained, parseNyfedJson(JSON.stringify({ refRates: [{ ...rate, percentRate: 1.6 }] }), "sofr", later));
  assert.equal(corrected.find((row) => row.metric === "sofr")!.publishedAt, later.toISOString());
  assert.equal(corrected.filter((row) => row.sourceId === "fed").length, 2);
  const snapshot = { ...emptySnapshot(), asOf: later.toISOString(), macro: corrected };
  assert.doesNotThrow(() => parseSnapshot(snapshot, later));
  assert.throws(() => parseSnapshot({ ...snapshot, macro: [...corrected, corrected[0]] }, later));
  assert.throws(() => parseSnapshot({ ...snapshot, macro: [{ ...corrected[0], quantity: 1 }] }, later));
  assert.deepEqual(snapshot.quotes, []);
  assert.deepEqual(snapshot.rules, []);
});

test("market schedules run only twice daily and stay disabled without the literal collection switch", async () => {
  const old = process.env.COLLECT_ENABLED;
  try {
    const schedules = MARKET_SERVER.schedules!.filter((schedule) => schedule.name.startsWith("markets.collect."));
    assert.equal(schedules.length, 5);
    assert.ok(schedules.every((schedule) => schedule.cron === "0 8,18 * * *"));
    for (const value of ["false", "1", "TRUE"]) {
      process.env.COLLECT_ENABLED = value;
      for (const schedule of schedules) {
        assert.equal(schedule.when!(), false);
        assert.deepEqual(await schedule.run(), { skipped: "collection_disabled" });
      }
    }
    process.env.COLLECT_ENABLED = "true";
    assert.ok(schedules.every((schedule) => schedule.when!()));
  } finally {
    if (old === undefined) delete process.env.COLLECT_ENABLED; else process.env.COLLECT_ENABLED = old;
  }
});

test("policy research schedule requires the literal independent model switch", async () => {
  const old = process.env.MODEL_CALLS_ENABLED;
  const schedule = MARKET_SERVER.schedules!.find((entry) => entry.name === "markets.policy-research.daily")!;
  assert.equal(schedule.cron, "15 18 * * *");
  try {
    for (const value of ["false", "1", "TRUE"]) {
      process.env.MODEL_CALLS_ENABLED = value;
      assert.equal(schedule.when!(), false);
      assert.deepEqual(await schedule.run(), { skipped: "model_calls_disabled" });
    }
    process.env.MODEL_CALLS_ENABLED = "true";
    assert.equal(schedule.when!(), true);
  } finally {
    if (old === undefined) delete process.env.MODEL_CALLS_ENABLED; else process.env.MODEL_CALLS_ENABLED = old;
  }
});
