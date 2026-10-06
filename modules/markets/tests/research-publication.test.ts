import { stub, pointModels } from "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { readPublishedModuleSnapshot } from "@aihot/backend/publication/module-data";
import { invalidateModelCache } from "@aihot/backend/editorial/models";
import { persistPolicyResearch } from "../backend/research.ts";
import { readMarketData, writeSnapshot } from "../backend/snapshot.ts";
import { emptySnapshot, parseSnapshot } from "../backend/validation.ts";
import type { TradeIdea } from "../domain.ts";

const QUOTE = "政策声明将继续观察经济活动与融资条件的变化";
const manual: TradeIdea = { id: "manual", instrumentId: "cn-csi300", market: "a-shares", title: "人工研究夹具", hypothesis: "仅为隔离数据库的测试材料", condition: "仅为测试条件", invalidation: "仅为测试失效条件", horizon: null, asOf: "2020-01-01T00:00:00Z", expiresAt: "2020-01-08T00:00:00Z", sourceName: "Fixture", sourceUrl: "https://example.test/manual" };
let onResponse: (() => Promise<void>) | null = null;
const provider = await stub(async (hit, req) => {
  const body = JSON.parse(req.body);
  const materials = JSON.parse(body.messages.at(-1).content).materials;
  const input = materials[0];
  if (onResponse) await onResponse();
  return { id: `research-fixture-${hit}`, choices: [{ message: { content: JSON.stringify({ ideas: [{ articleId: input.articleId, instrumentId: input.instrumentIds[0], evidenceQuote: QUOTE, hypothesis: "若后续融资条件改善，则观察企业经营预期是否同步改善", condition: "如果后续政策披露与企业经营信息相互印证，则继续复核该情景", invalidation: "若后续政策撤回相关安排或经营披露不支持传导，则该情景失效", horizon: "下次相关政策或披露更新前复核" }] }) } }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } };
});
pointModels(provider.url, ["deepseek-flash"]);
process.env.DIGEST_MODEL = "deepseek-flash";
config.modelCallsEnabled = true;
let sequence = 0;
async function publishedArticle() {
  const sourceId = `research-fixture-${++sequence}`;
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES (${sourceId}, 'Research source fixture', 'rss', 'T1', 'editorial', '2100-01-01')`;
  const { articleId } = await upsertMaterial({ sourceId, url: `https://www.pbc.gov.cn/test-${sequence}`, title: "货币政策沟通与融资条件观察", bodyText: `${QUOTE}。`.repeat(30), bodyStatus: "ok", via: "fetch", publishedAt: new Date(Date.now() - 86400000) });
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, reason_zh, score, selected)
    VALUES (${articleId}, 1, 'rule', 'pass', 'macro', '货币政策沟通与融资条件观察', ${QUOTE + "。"}, 'Fixture', 90, true)`;
  await publishArticle(articleId, { releasedAt: new Date(Date.now() - 60000) });
  return articleId;
}

beforeEach(async () => {
  onResponse = null;
  await sql`UPDATE publications SET visibility = 'withdrawn'`;
  await sql`DELETE FROM settings WHERE key IN ('public.module.markets', 'models.digest')`;
  await sql`DELETE FROM audit_log WHERE subject = 'module:markets'`;
  invalidateModelCache();
  await writeSnapshot({ ...emptySnapshot(), ideas: [manual] }, "test", "Seed manual research fixture");
});
after(async () => { await provider.close(); await stopBoss(); await closeDb(); });

test("worker publishes policy research and completes its receipt atomically; replay keeps original dates and manual ideas", async () => {
  const articleId = await publishedArticle();
  const hits = provider.hits();
  const result = await persistPolicyResearch("test", "Publish generated fixture");
  assert.equal(result.status, "generated");
  assert.equal(result.ideas.length, 1);
  assert.equal(result.ideas[0]!.sourceArticleId, articleId);
  const [receipt] = await sql`SELECT status, received_at FROM receipts WHERE id = ${result.receiptId!}`;
  assert.equal(receipt!.status, "completed");
  assert.equal(result.ideas[0]!.asOf, receipt!.received_at.toISOString());
  const first = (await readMarketData()).snapshot;
  assert.deepEqual(first.ideas, [manual, ...result.ideas]);
  const replay = await persistPolicyResearch("test", "Replay generated fixture");
  assert.equal(replay.reused, true);
  assert.equal(provider.hits() - hits, 1);
  assert.deepEqual((await readMarketData()).snapshot, first);
  assert.equal((await sql`SELECT 1 FROM audit_log WHERE subject = 'module:markets'`).length, 2);
});

test("snapshot write failure rolls back receipt completion and recovery reuses its original received timestamp", async () => {
  await publishedArticle();
  const hits = provider.hits();
  await sql`ALTER TABLE settings ADD CONSTRAINT reject_research_fixture CHECK (key <> 'public.module.markets') NOT VALID`;
  try { await assert.rejects(persistPolicyResearch("test", "Fail publication fixture"), /reject_research_fixture/); }
  finally { await sql`ALTER TABLE settings DROP CONSTRAINT reject_research_fixture`; }
  const [receipt] = await sql`SELECT id, status, received_at FROM receipts WHERE purpose = 'markets_policy_research' ORDER BY id DESC LIMIT 1`;
  assert.equal(receipt!.status, "received");
  assert.deepEqual((await readMarketData()).snapshot.ideas, [manual]);
  const recovered = await persistPolicyResearch("test", "Recover publication fixture");
  assert.equal(recovered.receiptId, receipt!.id);
  assert.equal(recovered.reused, true);
  assert.equal(recovered.ideas[0]!.asOf, receipt!.received_at.toISOString());
  assert.equal(provider.hits() - hits, 1);
});

test("withdrawal during generation consumes the valid receipt without publishing, and absent inputs never replace existing ideas", async () => {
  const articleId = await publishedArticle();
  onResponse = async () => { await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${articleId}`; };
  const result = await persistPolicyResearch("test", "Withdrawn fixture");
  assert.equal(result.status, "inputs_changed");
  assert.deepEqual((await readMarketData()).snapshot.ideas, [manual]);
  const [receipt] = await sql`SELECT status FROM receipts WHERE id = ${result.receiptId!}`;
  assert.equal(receipt!.status, "completed");
  const hits = provider.hits();
  assert.equal((await persistPolicyResearch()).status, "no_inputs");
  assert.equal(provider.hits(), hits);
  assert.deepEqual((await readMarketData()).snapshot.ideas, [manual]);
});

test("public reads hide withdrawn, deselected, unseated, embargoed or edited evidence without rewriting saved research", async () => {
  const articleId = await publishedArticle();
  const result = await persistPolicyResearch("test", "Public evidence fixture");
  const saved = await readPublishedModuleSnapshot("markets");
  for (const patch of [
    { visibility: "withdrawn" }, { selected: false }, { seat: false }, { visible_after: new Date(Date.now() + 86400000) },
    { summary: "这个摘要已被编辑替换，原来的证据不再存在。" }, { url: "https://example.test/changed" },
  ]) {
    await sql`UPDATE publications SET ${sql(patch)} WHERE article_id = ${articleId}`;
    assert.deepEqual((await readMarketData()).snapshot.ideas, [manual], JSON.stringify(patch));
    assert.deepEqual(await readPublishedModuleSnapshot("markets"), saved);
    await sql`UPDATE publications SET visibility = 'public', selected = true, seat = true, visible_after = now() - interval '1 minute', summary = ${QUOTE + "。"}, url = ${result.ideas[0]!.sourceUrl} WHERE article_id = ${articleId}`;
    assert.equal((await readMarketData()).snapshot.ideas.length, 2);
  }
});

test("policy metadata is accepted only as a complete tuple; manual research remains valid", async () => {
  const policy = { ...manual, researchType: "policy-scenario" as const, sourceArticleId: "fixture", evidenceQuote: QUOTE };
  assert.equal(parseSnapshot({ ...emptySnapshot(), ideas: [policy] }).ideas.length, 1);
  for (const fields of [{ researchType: policy.researchType }, { sourceArticleId: "fixture" }, { evidenceQuote: QUOTE }, { researchType: policy.researchType, sourceArticleId: "fixture" }]) {
    assert.throws(() => parseSnapshot({ ...emptySnapshot(), ideas: [{ ...manual, ...fields }] }));
  }
});
