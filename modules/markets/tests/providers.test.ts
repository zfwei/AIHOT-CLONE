import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTreasuryXml, treasuryFeedUrl } from "../backend/treasury.ts";
import { emptySnapshot, parseSnapshot } from "../backend/validation.ts";

const NOW = new Date("2026-10-06T12:00:00Z");
const xml = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices">
<entry><content><m:properties><d:NEW_DATE m:type="Edm.DateTime">2026-10-05T00:00:00</d:NEW_DATE><d:BC_2YEAR m:type="Edm.Double">4.12</d:BC_2YEAR><d:BC_10YEAR m:null="true"/></m:properties></content></entry>
<entry><content><m:properties><d:NEW_DATE m:type="Edm.DateTime">2026-10-02T00:00:00</d:NEW_DATE><d:BC_2YEAR m:type="Edm.Double">4.08</d:BC_2YEAR><d:BC_10YEAR m:type="Edm.Double">4.30</d:BC_10YEAR></m:properties></content></entry>
</feed>`;

test("Treasury XML parses namespaced typed values and missing yields without inventing zero", () => {
  const data = parseTreasuryXml(xml, NOW);
  assert.equal(data.quotes.length, 2);
  assert.deepEqual(data.quotes.map((q) => [q.instrumentId, q.value, q.previousClose]), [["us-treasury-2y", 4.12, 4.08], ["us-treasury-10y", 4.3, null]]);
  assert.equal(data.quotes[1].asOf, "2026-10-02T00:00:00.000Z");
  assert.equal(data.quotes[0].publishedAt, NOW.toISOString());
  assert.equal(data.history.length, 3);
  assert.doesNotThrow(() => parseSnapshot({ ...emptySnapshot(), asOf: NOW.toISOString(), ...data }, NOW));
});

test("Treasury parser rejects malformed, entity, future, and non-data responses", () => {
  for (const invalid of ["<feed>", "<!DOCTYPE feed><feed/>", "<html>unavailable</html>", xml.replaceAll("2026-10-05", "2099-10-05"), xml.replace("4.12", "oops")]) assert.throws(() => parseTreasuryXml(invalid, NOW));
  assert.equal(new URL(treasuryFeedUrl("202610")).searchParams.get("field_tdr_date_value_month"), "202610");
  assert.throws(() => treasuryFeedUrl("202613"));
});

test("snapshot import rejects unknown identifiers, wrong units, future data and unsafe evidence", () => {
  const data = parseTreasuryXml(xml, NOW);
  const valid = { ...emptySnapshot(), asOf: NOW.toISOString(), ...data };
  for (const patch of [
    { instrumentId: "not-a-security" }, { unit: "price" }, { sourceUrl: "javascript:alert(1)" },
    { sourceUrl: "https://secret:password@example.com" }, { asOf: "2099-01-01T00:00:00Z" },
    { publishedAt: "2020-01-01T00:00:00Z" }, { value: Infinity },
  ]) assert.throws(() => parseSnapshot({ ...valid, quotes: [{ ...valid.quotes[0], ...patch }] }, NOW));
  assert.throws(() => parseSnapshot({ ...valid, portfolio: [{ secret: "private" }] }, NOW));
  assert.throws(() => parseSnapshot({ ...valid, quotes: [valid.quotes[0], valid.quotes[0]] }, NOW));
  assert.throws(() => parseSnapshot({ ...valid, extra: "x".repeat(1024 * 1024) }, NOW));
});

test("offline snapshot allows stale observations for explicit freshness evaluation, never initial market claims", () => {
  const empty = emptySnapshot();
  assert.deepEqual([empty.quotes, empty.evidence, empty.rules, empty.history, empty.ideas], [[], [], [], [], []]);
  const quote = parseTreasuryXml(xml, NOW).quotes[0];
  assert.doesNotThrow(() => parseSnapshot({ ...empty, quotes: [quote] }, new Date("2027-01-01T00:00:00Z")));
});

test("admin routes require authentication and CSRF; collection stays off unless explicitly enabled", async () => {
  const [{ default: Fastify }, { registerMarketRoutes }, { config }, { collectionState }] = await Promise.all([
    import("fastify"), import("../api/routes.ts"), import("@aihot/backend/config"), import("../backend/snapshot.ts"),
  ]);
  const previous = { dev: config.devAdmin, environment: config.environmentName, collect: process.env.COLLECT_ENABLED };
  const app = Fastify();
  registerMarketRoutes(app);
  try {
    config.devAdmin = null;
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/markets/snapshot", payload: {} })).statusCode, 401);
    config.environmentName = "development";
    config.devAdmin = { displayName: "Test" };
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/markets/snapshot", payload: {} })).statusCode, 403);
    process.env.COLLECT_ENABLED = "false";
    assert.equal(collectionState().enabled, false);
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/markets/collect", headers: { "x-csrf-token": "dev" }, payload: { reason: "test" } })).statusCode, 409);
    process.env.COLLECT_ENABLED = "true";
    assert.equal(collectionState().enabled, true);
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/markets/snapshot", headers: { "x-csrf-token": "dev" }, payload: { snapshot: { bad: true }, reason: "test" } })).statusCode, 400);
  } finally {
    config.devAdmin = previous.dev;
    config.environmentName = previous.environment;
    for (const [key, value] of [["COLLECT_ENABLED", previous.collect]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
    await app.close();
  }
});
