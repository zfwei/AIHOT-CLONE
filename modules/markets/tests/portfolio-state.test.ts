import assert from "node:assert/strict";
import { test } from "node:test";
import { createHoldingInstrument, parsePortfolio, portfolioInstruments, portfolioJson, type LocalHolding, type LocalStockInstrument } from "../web/portfolio-state.ts";
import { INSTRUMENTS } from "../sources.ts";
import { analyzePortfolio } from "../analysis.ts";

const holding: LocalHolding = { id: "lot-one", instrumentId: "aapl", quantity: 2.5, averageCost: 190.25 };
const file = (holdings: unknown[]) => JSON.stringify({ version: 1, holdings });
const instrument: LocalStockInstrument = { id: "local:hk-stocks:00700", name: "腾讯控股", market: "hk-stocks", currency: "HKD", kind: "stock", symbol: "00700" };
const custom: LocalHolding = { ...holding, instrumentId: instrument.id, instrument };

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
  assert.deepEqual(JSON.parse(portfolioJson([row])).holdings, [{ ...holding, instrumentId: "retired-stock" }]);
});

test("custom stocks round-trip with their identity and cost currency; export validates too", () => {
  assert.deepEqual(parsePortfolio(portfolioJson([custom])), [custom]);
  assert.throws(() => portfolioJson([{ ...custom, quantity: Infinity }]));
  const portfolio = analyzePortfolio([custom], portfolioInstruments([custom]), [], new Date("2026-10-06T00:00:00Z"));
  assert.equal(portfolio.holdings[0].currency, "HKD");
  assert.equal(portfolio.holdings[0].cost, 475.625);
  assert.equal(portfolio.holdings[0].marketValue, null);
  assert.equal(portfolio.holdings[0].unrealizedPnl, null);
  assert.equal(portfolio.holdings[0].concentration, null);
  assert.equal(portfolio.currencies[0].complete, false);
});

test("custom metadata rejects malformed identifiers, unsafe text and non-stock instruments", () => {
  for (const metadata of [null, [], {}, { ...instrument, kind: "index" }, { ...instrument, market: "us-treasury" },
    { ...instrument, currency: "UNKNOWN" }, { ...instrument, symbol: "" }, { ...instrument, symbol: "700/1" },
    { ...instrument, symbol: "x".repeat(41) }, { ...instrument, name: " " }, { ...instrument, name: "a".repeat(101) },
    { ...instrument, name: "腾讯\u202e控股" }, { ...instrument, tenorYears: 10 }, { ...instrument, country: "China" },
    { ...instrument, id: "other-stock" }, { ...instrument, symbol: "00701" }]) {
    assert.throws(() => parsePortfolio(file([{ ...custom, instrument: metadata }])));
  }
  for (const builtin of INSTRUMENTS) {
    assert.throws(() => parsePortfolio(file([{ ...custom, instrumentId: builtin.id, instrument: { ...instrument, id: builtin.id } }])));
  }
});

test("multiple lots merge one custom instrument and reject conflicting metadata or catalog overrides", () => {
  const lots = [custom, { ...custom, id: "lot-two" }];
  const before = [...INSTRUMENTS];
  assert.deepEqual(portfolioInstruments(lots), [...INSTRUMENTS, instrument]);
  assert.deepEqual(INSTRUMENTS, before);
  assert.throws(() => parsePortfolio(file([custom, { ...lots[1], instrument: { ...instrument, currency: "USD" } }])));
  assert.throws(() => parsePortfolio(file([custom, { ...lots[1], instrument: { ...instrument, name: "另一家公司" } }])));
  assert.throws(() => portfolioInstruments([custom], [instrument]));
  assert.deepEqual(portfolioInstruments([{ ...holding, instrumentId: "retired-stock" }]), INSTRUMENTS);
});

test("manual entry normalizes codes and only reuses matching catalog stocks", () => {
  assert.deepEqual(createHoldingInstrument({ symbol: " 00700 ", name: " 腾讯控股 ", market: "hk-stocks", currency: "HKD" }), instrument);
  assert.equal(createHoldingInstrument({ symbol: " aApL ", name: "苹果", market: "us-stocks", currency: "USD" }).id, "aapl");
  const own = createHoldingInstrument({ symbol: " TsLa ", name: "特斯拉", market: "us-stocks", currency: "USD" });
  assert.equal(own.id, "local:us-stocks:tsla");
  assert.equal("symbol" in own && own.symbol, "TSLA");
  assert.equal(createHoldingInstrument({ symbol: "aapl", name: "本地股票", market: "hk-stocks", currency: "HKD" }).id, "local:hk-stocks:aapl");
  assert.equal(createHoldingInstrument({ symbol: "hk-hsi", name: "自填股票", market: "hk-stocks", currency: "HKD" }).id, "local:hk-stocks:hk-hsi");
  assert.throws(() => createHoldingInstrument({ symbol: "00700", name: "腾讯控股", market: "invalid", currency: "HKD" }));
});
