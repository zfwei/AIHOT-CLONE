import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareResearchInputs, researchSchema, buildResearchIdeas } from "../backend/research.ts";
import type { V1ItemPayload } from "@aihot/backend/publication/publish";

const NOW = new Date("2020-02-01T12:00:00Z");
function item(patch: Partial<V1ItemPayload> = {}): V1ItemPayload {
  return { id: "policy", title: "货币政策沟通与融资条件观察", originalTitle: null, summary: "政策声明将继续观察经济活动与融资条件的变化。", source: { name: "Policy fixture" }, links: { aihot: "https://example.test/items/policy", original: "https://www.pbc.gov.cn/fixture" }, publishedAt: "2020-01-20T08:00:00Z", discoveredAt: "2020-01-20T09:00:00Z", category: "macro", score: 90, selected: true, reason: null, attribution: { name: "Fixture", url: "https://example.test" }, ...patch };
}
const INPUTS = prepareResearchInputs([item()], NOW);
const IDEA = { articleId: "policy", instrumentId: "cn-csi300", evidenceQuote: "政策声明将继续观察经济活动与融资条件的变化", hypothesis: "若后续融资条件改善，则观察企业经营预期是否同步改善", condition: "如果后续政策披露与企业经营信息相互印证，则继续复核该情景", invalidation: "若后续政策撤回相关安排或经营披露不支持传导，则该情景失效", horizon: "下次相关政策或披露更新前复核" };

test("research inputs require selected financial public summaries, source provenance and a 30-day original date", () => {
  assert.equal(INPUTS.length, 1);
  assert.equal(prepareResearchInputs([item({ publishedAt: "2020-01-02T12:00:00Z" })], NOW).length, 1);
  for (const patch of [
    { selected: false }, { category: "industry" }, { summary: null }, { summary: " " }, { publishedAt: null },
    { publishedAt: "bad" }, { publishedAt: "2020-01-02T11:59:59Z" }, { publishedAt: "2020-02-02T00:00:00Z" },
    { links: { aihot: "", original: "javascript:alert(1)" } }, { links: { aihot: "", original: "https://u:p@pbc.gov.cn/" } }, { source: { name: " " } },
  ]) assert.deepEqual(prepareResearchInputs([item(patch)], NOW), [], JSON.stringify(patch));
  assert.equal(prepareResearchInputs(Array.from({ length: 9 }, (_, i) => item({ id: String(i) })), NOW).length, 6);
});

test("broad scope follows source jurisdiction or financial category; unsupported ECB curve and new securities are excluded", () => {
  assert.deepEqual(INPUTS[0]!.instrumentIds, ["cn-csi300"]);
  assert.deepEqual(prepareResearchInputs([item({ links: { aihot: "", original: "https://www.federalreserve.gov/policy" } })], NOW)[0]!.instrumentIds, ["us-sp500", "us-treasury-2y"]);
  assert.deepEqual(prepareResearchInputs([item({ links: { aihot: "", original: "https://www.ecb.europa.eu/policy" } })], NOW), []);
  assert.deepEqual(prepareResearchInputs([item({ links: { aihot: "", original: "https://pbc.gov.cn.evil.test/policy" } })], NOW), []);
  assert.deepEqual(prepareResearchInputs([item({ category: "a-shares", links: { aihot: "", original: "https://example.test/policy" } })], NOW)[0]!.instrumentIds, ["cn-csi300"]);
  assert.deepEqual(prepareResearchInputs([item({ category: "trade-watch", title: "Apple announces financing disclosure" })], NOW)[0]!.instrumentIds, ["aapl"]);
  assert.deepEqual(prepareResearchInputs([item({ category: "trade-ideas", title: "Other security announces financing disclosure" })], NOW), []);
});

test("schema binds exact quotations and securities to cited inputs and rejects unsupported fields", () => {
  const schema = researchSchema(INPUTS);
  assert.equal(schema.safeParse({ ideas: [IDEA] }).success, true);
  assert.equal(schema.safeParse({ ideas: [] }).success, true);
  for (const patch of [
    { articleId: "private" }, { instrumentId: "aapl" }, { instrumentId: "eu-aaa-10y" }, { evidenceQuote: "这个引述在材料中并不存在" },
    { hypothesis: "若NVDA经营披露改善，则观察其融资条件是否同步改善" }, { hypothesis: "若微软经营披露改善，则观察其融资条件是否同步改善" },
    { horizon: "下周" }, { sourceUrl: "https://invented.test" }, { confidence: 0.9 },
  ]) assert.equal(schema.safeParse({ ideas: [{ ...IDEA, ...patch }] }).success, false, JSON.stringify(patch));
  assert.equal(schema.safeParse({ ideas: [IDEA, IDEA] }).success, false);
  assert.equal(schema.safeParse({ ideas: [], extra: true }).success, false);
});

test("schema allows future conditional reasoning, rejects figures, transactions and current factual assertions", () => {
  const schema = researchSchema(INPUTS);
  for (const text of [
    "后续融资条件改善将带来经营变化", "若经营改善则上升20%", "若经营改善则上升百分之五", "若经营改善则上升三成", "若经营改善则目标价上调", "若经营改善则可以买入该标的", "若经营改善则你的仓位可以调整", "若目前已经改善则经营继续恢复", "如果price持续改善则进一步观察",
  ]) for (const field of ["hypothesis", "condition", "invalidation"]) {
    assert.equal(schema.safeParse({ ideas: [{ ...IDEA, [field]: text }] }).success, false, `${field}: ${text}`);
  }
});

test("published research separates article evidence date from generation time and copies source provenance", () => {
  const before = JSON.stringify(INPUTS);
  const [result] = buildResearchIdeas({ ideas: [IDEA] }, INPUTS, NOW);
  assert.ok(result);
  assert.equal(result.asOf, NOW.toISOString());
  assert.equal(result.expiresAt, "2020-02-08T12:00:00.000Z");
  assert.equal(result.sourceName, INPUTS[0]!.sourceName);
  assert.equal(result.sourceUrl, INPUTS[0]!.sourceUrl);
  assert.equal(result.researchType, "policy-scenario");
  assert.equal(result.sourceArticleId, INPUTS[0]!.articleId);
  assert.equal(result.evidenceQuote, IDEA.evidenceQuote);
  assert.match(result.hypothesis, /非官方推荐/);
  assert.match(result.hypothesis, /原文日期 2020-01-20/);
  assert.ok(result.hypothesis.includes(IDEA.evidenceQuote));
  assert.equal(result.market, "a-shares");
  assert.equal(JSON.stringify(INPUTS), before);
  assert.equal(buildResearchIdeas({ ideas: [IDEA] }, INPUTS, new Date("2020-02-02T12:00:00Z"))[0]!.id, result.id);
  assert.throws(() => buildResearchIdeas({ ideas: [{ ...IDEA, evidenceQuote: "未经输入材料支持的事实引述" }] }, INPUTS, NOW));
});

test("article evidence dates use Beijing calendar dates across the UTC day boundary", () => {
  const inputs = [{ ...INPUTS[0]!, publishedAt: "2026-09-28T16:00:00.000Z" }];
  const generatedAt = new Date("2026-10-06T02:00:00.000Z");
  const [result] = buildResearchIdeas({ ideas: [IDEA] }, inputs, generatedAt);
  assert.match(result!.hypothesis, /原文日期 2026-09-29/);
  assert.doesNotMatch(result!.hypothesis, /原文日期 2026-09-28/);
  assert.equal(result!.asOf, generatedAt.toISOString());
  assert.equal(inputs[0]!.publishedAt, "2026-09-28T16:00:00.000Z");
});
