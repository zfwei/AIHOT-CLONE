import { z } from "zod";
import type { Snapshot } from "../domain.ts";
import { INSTRUMENTS } from "../sources.ts";

const text = z.string().trim().min(1).max(500);
const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/);
const market = z.enum(["a-shares", "us-stocks", "us-treasury", "global-bonds"]);
const timestamp = z.iso.datetime({ offset: true });
const url = z.url().max(2000).refine((value) => { const u = new URL(value); return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password; }, "Evidence must use an HTTP(S) URL without credentials");
const provenance = { sourceName: text, sourceUrl: url };
const quote = z.object({ instrumentId: id, value: z.number().finite(), previousClose: z.number().finite().nullable(), asOf: timestamp, publishedAt: timestamp, ...provenance, availabilityBasis: z.enum(["published", "retrieved"]).optional(), frequency: z.enum(["daily", "delayed"]), unit: z.enum(["points", "price", "percent"]) }).strict();
const evidence = z.object({ id, market, metric: id, value: z.number().finite().nullable(), unit: z.string().trim().min(1).max(40), asOf: timestamp, publishedAt: timestamp, expiresAt: timestamp, ...provenance }).strict();
const rule = z.object({ id, market, factor: z.enum(["valuation", "crowding", "liquidity", "speculation"]), metric: id, unit: z.string().trim().min(1).max(40), operator: z.enum(["gte", "lte"]), threshold: z.number().finite().nullable(), version: text, enabled: z.boolean() }).strict();
const history = z.object({ priceBasis: z.enum(["adjusted", "unadjusted"]).optional(), instrumentId: id, date: z.iso.date(), close: z.number().finite(), publishedAt: timestamp, availabilityBasis: z.enum(["published", "retrieved"]).optional(), ...provenance }).strict();
const idea = z.object({ id, market, instrumentId: id, title: text, hypothesis: z.string().trim().min(1).max(3000), condition: z.string().trim().min(1).max(3000), invalidation: z.string().trim().min(1).max(3000), horizon: text.nullable(), asOf: timestamp, expiresAt: timestamp, ...provenance }).strict();
const schema = z.object({ schemaVersion: z.literal(1), asOf: timestamp, quotes: z.array(quote).max(100), evidence: z.array(evidence).max(200), rules: z.array(rule).max(100), history: z.array(history).max(10000), ideas: z.array(idea).max(100) }).strict();

export function parseSnapshot(input: unknown, now = new Date()): Snapshot {
  if (Buffer.byteLength(JSON.stringify(input) ?? "") > 1024 * 1024) throw new Error("Snapshot exceeds 1 MB");
  const snapshot = schema.parse(input);
  const fail = (message: string): never => { throw new Error(message); };
  const notFuture = (value: string) => { if (Date.parse(value) > now.getTime()) fail("Future observations or publication dates are not allowed"); };
  const instrument = (key: string) => INSTRUMENTS.find((item) => item.id === key) ?? fail(`Unknown instrument: ${key}`);
  const unique = (values: string[]) => { if (new Set(values).size !== values.length) fail("Duplicate snapshot identifiers"); };
  notFuture(snapshot.asOf);
  unique(snapshot.quotes.map((q) => q.instrumentId));
  unique(snapshot.evidence.map((e) => e.id));
  unique(snapshot.rules.map((r) => r.id));
  unique(snapshot.ideas.map((i) => i.id));
  unique(snapshot.history.map((h) => `${h.instrumentId}:${h.date}`));
  for (const q of snapshot.quotes) {
    const i = instrument(q.instrumentId);
    const unit = i.kind === "bond-yield" ? "percent" : i.kind === "index" ? "points" : "price";
    if (q.unit !== unit) fail(`Wrong unit for ${q.instrumentId}`);
    if (i.kind !== "bond-yield" && (q.value <= 0 || (q.previousClose !== null && q.previousClose <= 0))) fail("Prices must be positive");
    notFuture(q.asOf); notFuture(q.publishedAt);
    if (Date.parse(q.asOf) > Date.parse(q.publishedAt)) fail("Publication precedes observation");
  }
  for (const e of snapshot.evidence) {
    notFuture(e.asOf); notFuture(e.publishedAt);
    if (Date.parse(e.asOf) > Date.parse(e.publishedAt) || Date.parse(e.expiresAt) < Date.parse(e.publishedAt)) fail("Invalid evidence validity interval");
  }
  for (const h of snapshot.history) {
    const i = instrument(h.instrumentId);
    notFuture(`${h.date}T00:00:00Z`); notFuture(h.publishedAt);
    if (h.date > h.publishedAt.slice(0, 10)) fail("History publication precedes trading date");
    if (i.kind !== "bond-yield" && h.close <= 0) fail("Prices must be positive");
  }
  for (const i of snapshot.ideas) {
    if (i.instrumentId === "eu-aaa-10y") fail("ECB synthetic curve is macro information only and cannot be used for trade ideas");
    if (instrument(i.instrumentId).market !== i.market) fail("Trade idea market does not match its instrument");
    notFuture(i.asOf);
    if (Date.parse(i.expiresAt) <= Date.parse(i.asOf)) fail("Trade idea expiry must follow its observation");
  }
  return snapshot;
}

export function emptySnapshot(): Snapshot {
  return { schemaVersion: 1, asOf: "1970-01-01T00:00:00.000Z", quotes: [], evidence: [], rules: [], history: [], ideas: [] };
}
