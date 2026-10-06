import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { sessionPrincipal, actorOf, type AdminPrincipal } from "@aihot/backend/admin/auth";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { sql } from "@aihot/backend/db";
import { audit } from "@aihot/backend/audit";
import { readMarketData, writeSnapshot, collectionState } from "../backend/snapshot.ts";
import { parseSnapshot } from "../backend/validation.ts";
import { MARKET_QUEUES, POLICY_RESEARCH_QUEUE } from "../server.ts";

async function admin(req: FastifyRequest, reply: FastifyReply): Promise<AdminPrincipal | null> {
  reply.header("Cache-Control", "no-store");
  const principal = await sessionPrincipal(req.headers.cookie);
  if (!principal) { reply.code(401).send({ error: "unauthorized" }); return null; }
  if (req.method !== "GET" && req.headers["x-csrf-token"] !== principal.csrf) { reply.code(403).send({ error: "forbidden" }); return null; }
  return principal;
}
const reasonSchema = z.string().trim().min(1).max(500);

export function registerMarketRoutes(app: FastifyInstance) {
  app.post("/api/admin/markets/research", { bodyLimit: 4096 }, async (req, reply) => {
    const principal = await admin(req, reply);
    if (!principal) return;
    if (process.env.MODEL_CALLS_ENABLED !== "true") return reply.code(409).send({ error: "model_calls_disabled", detail: "请先配置 MODEL_CALLS_ENABLED=true 并重启 API 与 worker。" });
    const parsed = z.object({ reason: reasonSchema }).strict().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const actor = actorOf(principal);
    const jobId = await sql.begin(async (tx) => {
      const id = await enqueueOn(POLICY_RESEARCH_QUEUE, { actor, reason: parsed.data.reason }, { singletonKey: "policy-research" }, tx);
      await audit(actor, "markets.research", "module:markets", parsed.data.reason, null, { jobId: id }, { db: tx });
      return id;
    });
    return reply.code(202).send({ queued: true, jobId });
  });
  app.get("/api/v1/markets", async (_req, reply) => reply.header("Cache-Control", "no-store").send(await readMarketData()));
  app.get("/api/admin/markets", async (req, reply) => {
    if (!await admin(req, reply)) return;
    return readMarketData();
  });
  app.post("/api/admin/markets/snapshot", { bodyLimit: 1024 * 1024 }, async (req, reply) => {
    const principal = await admin(req, reply);
    if (!principal) return;
    let snapshot;
    let reason;
    try {
      const input = z.object({ snapshot: z.unknown(), reason: reasonSchema }).strict().parse(req.body);
      snapshot = parseSnapshot(input.snapshot);
      reason = input.reason;
    } catch (error) {
      return reply.code(400).send({ error: "invalid_snapshot", detail: error instanceof z.ZodError ? error.issues.map((i) => i.message).join("; ").slice(0, 300) : String(error).slice(0, 300) });
    }
    await writeSnapshot(snapshot, actorOf(principal), reason);
    return { ok: true, ...(await readMarketData()) };
  });
  app.post("/api/admin/markets/collect", { bodyLimit: 4096 }, async (req, reply) => {
    const principal = await admin(req, reply);
    if (!principal) return;
    if (!collectionState().enabled) return reply.code(409).send({ error: "collection_disabled", detail: "来源已确认；请先配置 COLLECT_ENABLED=true 并重启 API 与 worker。" });
    const parsed = z.object({ reason: reasonSchema, source: z.enum(["treasury", "japan-mof", "ecb", "nyfed", "fed", "akshare", "yfinance"]).default("treasury") }).strict().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const actor = actorOf(principal);
    const source = parsed.data.source;
    const queue = MARKET_QUEUES[source];
    const jobId = await sql.begin(async (tx) => {
      const id = await enqueueOn(queue, { actor, reason: parsed.data.reason }, { singletonKey: source }, tx);
      await audit(actor, "markets.collect", `source:${source}`, parsed.data.reason, null, { jobId: id }, { db: tx });
      return id;
    });
    return reply.code(202).send({ ok: true, jobId });
  });
}
