import assert from "node:assert/strict";
import { test } from "node:test";
import { JAPAN_MOF_URL, parseJapanMofCsv } from "../backend/japan-mof.ts";
import { assertCollectionAllowed } from "../backend/collect.ts";
import { emptySnapshot, parseSnapshot } from "../backend/validation.ts";

const NOW = new Date("2020-01-07T01:00:00Z");
// Synthetic values only; follows the downloaded official English CSV layout.
const csv = `Interest Rate (January 2020),,,(Unit : %)\r
Date,1Y,10Y,30Y\r
2020/1/6,-0.2,-0.1,0.4\r
2020/1/2,-0.3,-0.2,0.3\r
2020/1/3,-0.25,,0.35\r
,,,\r
"  ※If you cannot download the latest csv data, please clear the browser's cache and download again.",,,\r
`;

test("JGB CSV maps the 10Y header, retains negative percent yields and missing dates, and timestamps availability conservatively", () => {
  const parsed = parseJapanMofCsv(csv, NOW);
  assert.deepEqual(parsed.history.map((row) => [row.date, row.close]), [["2020-01-02", -0.2], ["2020-01-06", -0.1]]);
  const quote = parsed.quotes[0]!;
  assert.equal(quote.instrumentId, "jp-jgb-10y");
  assert.equal(quote.value, -0.1);
  assert.equal(quote.previousClose, -0.2);
  assert.equal(quote.unit, "percent");
  assert.equal(quote.asOf, "2020-01-06T06:00:00.000Z");
  assert.equal(quote.publishedAt, NOW.toISOString());
  assert.equal(quote.availabilityBasis, "retrieved");
  assert.equal(quote.sourceUrl, JAPAN_MOF_URL);
  assert.doesNotThrow(() => parseSnapshot({ ...emptySnapshot(), asOf: NOW.toISOString(), ...parsed }, NOW));
});

test("JGB CSV rejects unexpected units, missing tenor, malformed rows, invalid dates and conflicting observations", () => {
  for (const invalid of [
    "<html>unavailable</html>", csv.replace("Unit : %", "Unit : bps"), csv.replace("10Y", "11Y"),
    csv.replace("2020/1/6", "2020/2/30"), csv.replace("2020/1/6", "2099/1/6"),
    csv.replace("-0.1", "Infinity"), csv.replace("-0.1", "1e3"), csv.replace("-0.1", "oops"),
    csv.replace("2020/1/6,-0.2,-0.1,0.4", "2020/1/6,-0.2,-0.1"),
    `${csv}2020/1/6,0,9,0\n`, "Interest Rate (January 2020),,,(Unit : %)\nDate,1Y,10Y,30Y\n2020/1/2,0,N/A,0\n",
  ]) assert.throws(() => parseJapanMofCsv(invalid, NOW));
  assert.throws(() => parseJapanMofCsv(csv, new Date("2020-01-06T05:59:59Z")), /Future/);
});

test("both official collectors require the same explicit collection switch", () => {
  const previous = process.env.COLLECT_ENABLED;
  try {
    for (const value of [undefined, "false", "1", "TRUE"]) {
      if (value === undefined) delete process.env.COLLECT_ENABLED; else process.env.COLLECT_ENABLED = value;
      for (const source of ["treasury", "japan-mof"] as const) assert.throws(() => assertCollectionAllowed(source), /COLLECT_ENABLED=true/);
    }
    process.env.COLLECT_ENABLED = "true";
    for (const source of ["treasury", "japan-mof"] as const) assert.doesNotThrow(() => assertCollectionAllowed(source));
  } finally {
    if (previous === undefined) delete process.env.COLLECT_ENABLED; else process.env.COLLECT_ENABLED = previous;
  }
});
