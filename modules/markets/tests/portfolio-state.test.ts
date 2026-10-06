import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePortfolio, portfolioJson, type LocalHolding } from "../web/portfolio-state.ts";

const holding: LocalHolding = { id: "lot-one", instrumentId: "aapl", quantity: 2.5, averageCost: 190.25 };
const file = (holdings: unknown[]) => JSON.stringify({ version: 1, holdings });

test("an empty browser starts without invented holdings; fractional lots round-trip", () => {
  assert.deepEqual(parsePortfolio(null), []);
  assert.deepEqual(parsePortfolio(portfolioJson([holding])), [holding]);
  assert.deepEqual(parsePortfolio(file([{ ...holding, averageCost: 0 }])), [{ ...holding, averageCost: 0 }]);
});

test("damaged or unsupported local files fail rather than silently erase the portfolio", () => {
  for (const raw of ["", "{", "null", "[]", "{}", JSON.stringify({ version: 2, holdings: [holding] }), JSON.stringify({ version: 1, holdings: null })]) {
    assert.throws(() => parsePortfolio(raw));
  }
});

test("invalid amounts, duplicate lot identifiers and oversized files are rejected", () => {
  for (const row of [
    { ...holding, quantity: 0 }, { ...holding, quantity: -1 }, { ...holding, quantity: "2" },
    { ...holding, averageCost: -1 }, { ...holding, averageCost: null },
    { ...holding, quantity: Number.MAX_VALUE, averageCost: Number.MAX_VALUE },
    { ...holding, id: "" }, { ...holding, instrumentId: "" },
  ]) assert.throws(() => parsePortfolio(file([row])));
  assert.throws(() => parsePortfolio(file([holding, holding])));
  assert.throws(() => parsePortfolio(file(Array.from({ length: 201 }, (_, i) => ({ ...holding, id: String(i) })))));
});

test("unknown instruments survive configuration changes for review; extra fields are not exported", () => {
  const row = { ...holding, instrumentId: "retired-stock", injected: "ignore me" };
  assert.deepEqual(parsePortfolio(file([row])), [{ ...holding, instrumentId: "retired-stock" }]);
});
