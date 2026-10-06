import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import Fastify from "fastify";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { readPublishedModuleSnapshot } from "@aihot/backend/publication/module-data";
import { registerMarketRoutes } from "../api/routes.ts";
import { emptySnapshot } from "../backend/validation.ts";
import type { Snapshot } from "../domain.ts";

// Deliberately synthetic, historical values, confined to the runner's disposable database.
const fixture: Snapshot = {
  ...emptySnapshot(), asOf: "2020-01-03T20:00:00Z",
  quotes: [{ instrumentId: "aapl", value: 100, previousClose: 99, asOf: "2020-01-02T20:00:00Z", publishedAt: "2020-01-03T20:00:00Z", frequency: "daily", unit: "price", sourceName: "Isolated test fixture", sourceUrl: "http://127.0.0.1/fixtures/market" }],
  history: [{ instrumentId: "aapl", date: "2020-01-02", close: 100, priceBasis: "adjusted", publishedAt: "2020-01-03T20:00:00Z", sourceName: "Isolated test fixture", sourceUrl: "http://127.0.0.1/fixtures/market" }],
};
const app = Fastify();
registerMarketRoutes(app);
const previous = { dev: config.devAdmin, environment: config.environmentName, collect: process.env.COLLECT_ENABLED, models: process.env.MODEL_CALLS_ENABLED };

beforeEach(async () => {
  config.environmentName = "development";
  config.devAdmin = { displayName: "Market publication test" };
  process.env.COLLECT_ENABLED = "false";
  process.env.MODEL_CALLS_ENABLED = "false";
  await sql`DELETE FROM settings WHERE key IN ('public.module.markets', 'private.module.marketprobe', 'marketprobe')`;
  await sql`DELETE FROM audit_log WHERE subject = 'module:markets'`;
});

after(async () => {
  config.devAdmin = previous.dev;
  config.environmentName = previous.environment;
  for (const [key, value] of [["COLLECT_ENABLED", previous.collect], ["MODEL_CALLS_ENABLED", previous.models]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
  await app.close();
  await stopBoss();
  await closeDb();
});

const publish = (snapshot: unknown, reason = "Publish isolated fixture", headers: Record<string, string> = { "x-csrf-token": "dev" }) =>
  app.inject({ method: "POST", url: "/api/admin/markets/snapshot", headers, payload: { snapshot, reason } });

test("admin publication round-trips through the shared public reader and anonymous HTTP with an audit", async () => {
  const published = await publish(fixture);
  assert.equal(published.statusCode, 200, published.body);
  assert.deepEqual(published.json().snapshot, fixture);
  const [stored] = await sql`SELECT value, updated_by FROM settings WHERE key = 'public.module.markets'`;
  assert.deepEqual(stored!.value, fixture);
  assert.equal(stored!.updated_by, "dev:Market publication test");
  assert.deepEqual(await readPublishedModuleSnapshot("markets"), fixture);

  const admin = await app.inject({ method: "GET", url: "/api/admin/markets" });
  assert.equal(admin.statusCode, 200);
  config.devAdmin = null;
  const anonymous = await app.inject({ method: "GET", url: "/api/v1/markets" });
  assert.equal(anonymous.statusCode, 200);
  assert.equal(anonymous.headers["cache-control"], "no-store");
  assert.deepEqual(anonymous.json(), admin.json());
  assert.deepEqual(anonymous.json().snapshot, fixture);
  assert.equal((await app.inject({ method: "GET", url: "/api/admin/markets" })).statusCode, 401);

  const audits = await sql`SELECT actor, action, reason, before, after FROM audit_log WHERE subject = 'module:markets'`;
  assert.equal(audits.length, 1);
  assert.deepEqual({ ...audits[0] }, { actor: "dev:Market publication test", action: "markets.publish", reason: "Publish isolated fixture", before: null, after: fixture });
});

test("public module reader cannot select private settings or accept paths and prefixes", async () => {
  await sql`INSERT INTO settings (key, value) VALUES ('private.module.marketprobe', '{"private":"fixture-only"}'), ('marketprobe', '{"private":"fixture-only"}')`;
  assert.equal(await readPublishedModuleSnapshot("marketprobe"), null);
  for (const name of ["private.module.marketprobe", "public.module.markets", "../marketprobe", "markets' OR true --", "", "Markets"]) {
    await assert.rejects(readPublishedModuleSnapshot(name), /Invalid public module name/);
  }
  const anonymous = await app.inject({ method: "GET", url: "/api/v1/markets?name=private.module.marketprobe" });
  assert.equal(anonymous.statusCode, 200);
  assert.deepEqual(anonymous.json().snapshot, emptySnapshot());
  assert.ok(!anonymous.body.includes("fixture-only"));
});

test("rejected holdings and invalid publication preserve the published snapshot and audit", async () => {
  assert.equal((await publish(fixture)).statusCode, 200);
  for (const invalid of [
    { ...fixture, portfolio: [{ instrumentId: "aapl", quantity: 123 }] },
    { ...fixture, holdings: [{ instrumentId: "aapl", quantity: 123 }] },
    { ...fixture, quotes: [{ ...fixture.quotes[0], quantity: 123 }] },
    { ...fixture, quotes: [{ ...fixture.quotes[0], unit: "percent" }] },
  ]) {
    const result = await publish(invalid);
    assert.equal(result.statusCode, 400, result.body);
    assert.equal(result.json().error, "invalid_snapshot");
  }
  assert.equal((await publish(fixture, " ")).statusCode, 400);
  assert.deepEqual(await readPublishedModuleSnapshot("markets"), fixture);
  const rows = await sql`SELECT after FROM audit_log WHERE subject = 'module:markets'`;
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]!.after, fixture);
});

test("missing session and CSRF cannot change persisted data", async () => {
  assert.equal((await publish(fixture)).statusCode, 200);
  const replacement = { ...fixture, quotes: [] };
  assert.equal((await publish(replacement, "Rejected CSRF", {})).statusCode, 403);
  config.devAdmin = null;
  assert.equal((await publish(replacement, "Rejected session")).statusCode, 401);
  assert.deepEqual(await readPublishedModuleSnapshot("markets"), fixture);
  assert.equal((await sql`SELECT 1 FROM audit_log WHERE subject = 'module:markets'`).length, 1);
});

test("admin collection selects an approved source queue and audits without executing providers", async () => {
  const request = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/admin/markets/collect", headers: { "x-csrf-token": "dev" }, payload });
  assert.equal((await request({ source: "japan-mof", reason: "Queue fixture only" })).statusCode, 409);
  process.env.COLLECT_ENABLED = "true";
  assert.equal((await request({ source: "other", reason: "Queue fixture only" })).statusCode, 400);
  for (const [payload, queue, source] of [
    [{ source: "japan-mof", reason: "Queue JGB fixture only" }, "markets.japan-mof", "japan-mof"],
    [{ source: "ecb", reason: "Queue ECB fixture only" }, "markets.ecb", "ecb"],
    [{ reason: "Queue Treasury fixture only" }, "markets.treasury", "treasury"],
  ] as const) {
    const response = await request(payload);
    assert.equal(response.statusCode, 202, response.body);
    const { jobId } = response.json();
    assert.ok(jobId);
    const [job] = await sql`SELECT name, data, state FROM pgboss.job WHERE id = ${jobId}`;
    assert.equal(job!.name, queue);
    assert.equal(job!.state, "created");
    assert.deepEqual(job!.data, { actor: "dev:Market publication test", reason: payload.reason });
    const [entry] = await sql`SELECT subject FROM audit_log WHERE action = 'markets.collect' AND after->>'jobId' = ${jobId}`;
    assert.equal(entry!.subject, `source:${source}`);
  }
  assert.equal(await readPublishedModuleSnapshot("markets"), null);
});
