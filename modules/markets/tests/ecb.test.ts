import test from "node:test";
import assert from "node:assert/strict";
import { ecbFeedUrl, parseEcbCsv } from "../backend/ecb.ts";
import { emptySnapshot, parseSnapshot } from "../backend/validation.ts";

const now = new Date("2026-10-06T12:00:00Z");
const key = "YC.B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y";
const header = "KEY,FREQ,REF_AREA,CURRENCY,PROVIDER_FM,INSTRUMENT_FM,PROVIDER_FM_ID,DATA_TYPE_FM,TIME_PERIOD,OBS_VALUE,OBS_STATUS,UNIT,UNIT_MULT,TITLE_COMPL";
const row = (date: string, value: string, k = key) => `${k},B,U2,EUR,4F,G_N_A,SV_C_YM,SR_10Y,${date},${value},A,PCPA,0,"AAA government bonds, 10-year spot rate"`;
const csv = [header, row("2026-10-01", "3.5921733451"), row("2026-10-02", "3.4639685465")].join("\r\n");

test("ECB CSV retains exact reported precision, provenance, and retrieval availability", () => {
  const result = parseEcbCsv(csv, now);
  assert.equal(result.quotes.length, 1);
  const q = result.quotes[0]!;
  assert.equal(q.instrumentId, "eu-aaa-10y");
  assert.equal(q.value, 3.4639685465);
  assert.equal(q.previousClose, 3.5921733451);
  assert.equal(q.unit, "percent");
  assert.equal(q.asOf, "2026-10-02T00:00:00.000Z");
  assert.equal(q.publishedAt, now.toISOString());
  assert.equal(q.availabilityBasis, "retrieved");
  assert.equal(q.sourceUrl, ecbFeedUrl());
  assert.equal(q.sourceName, "欧洲央行 · AAA 10 年即期合成曲线（连续复利）");
  assert.equal(result.history.length, 2);
  assert.doesNotThrow(() => parseSnapshot({ ...emptySnapshot(), asOf: now.toISOString(), ...result }, now));
});

test("ECB synthetic curve is accepted as macro observations but rejected as a trade idea", () => {
  const idea = { id: "ecb-trade", instrumentId: "eu-aaa-10y", market: "global-bonds", title: "Curve trade", hypothesis: "Yield changes", condition: "Yield rises", invalidation: "Yield falls", horizon: null, asOf: now.toISOString(), expiresAt: "2026-10-07T12:00:00Z", sourceName: "欧洲央行", sourceUrl: ecbFeedUrl() };
  assert.throws(() => parseSnapshot({ ...emptySnapshot(), ideas: [idea] }, now), /macro information only/);
});

test("ECB accepts negative/zero yields, quoted commas and duplicate identical observations; missing stays missing", () => {
  const result = parseEcbCsv([header, row("2026-09-29", "-0.123456789"), row("2026-09-30", "0"), row("2026-09-30", "0"), row("2026-10-01", ""), row("2026-10-02", "N/A")].join("\n"), now);
  assert.equal(result.quotes[0]!.value, 0);
  assert.equal(result.quotes[0]!.previousClose, -0.123456789);
  assert.equal(result.history.length, 2);
});

test("ECB rejects wrong series/units, corrupt values/dates, future observations and conflicting rows", () => {
  for (const invalid of ["<html>unavailable</html>", csv.replaceAll(key, key.replace("G_N_A", "G_N_C")),
    csv.replaceAll("PCPA", "BPS"), csv.replaceAll("PCPA,0", "PCPA,2"),
    csv.replaceAll("B,U2,EUR,4F", "B,U2,USD,4F"), csv.replaceAll("SR_10Y,2026", "IF_10Y,2026"),
    csv + "\n" + row("2026-10-02", "3.5", key.replace("G_N_A", "G_N_C")),
    csv.replace("2026-10-02", "2026-02-30"), csv.replace("2026-10-02", "2099-10-02"),
    csv.replace("3.4639685465", "Infinity"), csv.replace("3.4639685465", "0x10"),
    csv.replace('"AAA government bonds, 10-year spot rate"', '"unclosed'),
    csv + "\n" + row("2026-10-02", "4"), header + "\n" + row("2026-10-02", "")]) {
    assert.throws(() => parseEcbCsv(invalid, now));
  }
  assert.throws(() => parseEcbCsv(csv, new Date(NaN)));
});

test("ECB uses the verified official SDMX CSV path and bounded observation count", () => {
  assert.equal(ecbFeedUrl(), "https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y?format=csvdata&lastNObservations=5");
  for (const count of [0, -1, 1.5, NaN, 1001]) assert.throws(() => ecbFeedUrl(count));
});
