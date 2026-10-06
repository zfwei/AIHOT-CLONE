// Topic pages: which articles a topic takes, and their counts.
// Written before the code, from the ways it can go wrong:
// - a company topic takes an article about another company that only mentions it (several subjects,
//   its name nowhere in the title), or drops one about it whose title names it in English, in another
//   case, next to Chinese text, or only by a product (it is the article's only subject);
// - a Latin name matches inside another word ("Pineapple" is not Apple); a headline naming a company
//   that is not a subject of the article gets in;
// - a market-risk topic stops taking its tags;
// - withdrawn or not yet released articles appear in a list or a count;
// - an article or story page names a topic its reports do not belong to;
// - a topic without content has no page, or an unknown slug or a page past the end has one.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { loadTopicPage, listTopicSummaries, topicsOfStory, TOPICS } from "@aihot/backend/publication/topics";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const OFFICIAL = `test-topics-official-${T}`;
const MEDIA = `test-topics-media-${T}`;
const app = await buildApp();

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, first_party, next_fetch_at) VALUES
    (${OFFICIAL}, 'Official', 'rss', 'T1', 'editorial', true, '2100-01-01'),
    (${MEDIA}, 'Media', 'rss', 'T2', 'editorial', false, '2100-01-01')`;
});
after(async () => {
  await app.close();
  await stopBoss();
  await closeDb();
});

let n = 0;
interface Report {
  source?: string;
  at: Date;
  title: string;
  originalTitle?: string;
  subjects?: string[];
  tags?: string[];
  score?: number;
  selected?: boolean;
  fact?: number;
  category?: string;
}

/** A published report; `fact` links it to a fact before publishing, as grouping would. */
async function report(r: Report): Promise<string> {
  n += 1;
  const { articleId } = await upsertMaterial({
    sourceId: r.source ?? MEDIA, url: `https://example.com/topics-${T}-${n}`, title: r.originalTitle ?? r.title, bodyText: "body", bodyHtml: "<p>body</p>", bodyStatus: "ok", via: "fetch", publishedAt: r.at,
  });
  await sql`UPDATE articles SET discovered_at = ${r.at}, timeline_at = ${r.at}, grouped_at = now() WHERE id = ${articleId}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected, subjects, tags)
            VALUES (${articleId}, 1, 'rule', 'pass', ${r.category ?? "us-stocks"}, ${r.title}, ${`摘要 ${n}`}, ${r.score ?? 80}, ${r.selected ?? true}, ${r.subjects ?? []}, ${[r.category === "a-shares" ? "市场行情" : r.category === "global-bonds" ? "研究报告" : r.category === "trade-watch" ? "风险管理" : r.category === "macro" ? "公司动态" : r.category === "trade-ideas" ? "观点分析" : "财报/业绩", ...(r.tags ?? [])]})`;
  if (r.fact) await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${r.fact}, ${articleId}, 'report')`;
  await publishArticle(articleId, { releasedAt: new Date(r.at.getTime() + 60_000) });
  return articleId;
}

async function story(title: string): Promise<{ id: number; publicId: string }> {
  const publicId = randomUUID();
  const [s] = await sql<{ id: number }[]>`INSERT INTO stories (public_id, title, first_report_at, latest_at) VALUES (${publicId}, ${title}, now(), now()) RETURNING id`;
  return { id: s!.id, publicId };
}

async function fact(storyId: number | null, title: string): Promise<number> {
  const [f] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, story_id, title) VALUES (${`f-${T}-${randomUUID()}`}, ${storyId}, ${title}) RETURNING id`;
  return f!.id;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);
const page = async (slug: string, p = 1) => {
  const data = await loadTopicPage(slug, p, new Date());
  assert.ok(data, `${slug} page ${p}`);
  return data;
};
/** Every article of a topic, over all its pages. */
async function members(slug: string): Promise<string[]> {
  const first = await page(slug);
  const out = ids(first.items);
  for (let p = 2; p <= first.pageCount; p++) out.push(...ids((await page(slug, p)).items));
  return out;
}

test("a company topic takes the articles about it, not the ones that only mention it", async () => {
  const about = await report({ at: hoursAgo(30), title: `Microsoft 公布年度业绩 ${T}`, subjects: ["microsoft"] });
  const product = await report({ at: hoursAgo(31), title: `Azure 收入增长 ${T}`, subjects: ["microsoft"] });
  const english = await report({ at: hoursAgo(32), title: `新财报发布 ${T}`, originalTitle: `Microsoft reports quarterly earnings ${T}`, subjects: ["microsoft", "google"] });
  const subpoena = await report({ at: hoursAgo(33), title: `加州检察长向 Google 发出传票 ${T}`, subjects: ["google", "microsoft", "fed"] });
  const lowerCase = await report({ at: hoursAgo(34), title: `google 公布新的回购计划 ${T}`, subjects: ["google", "microsoft"] });
  const pact = await report({ at: hoursAgo(35), title: `二十余家科技公司签署资本投资协议 ${T}`, subjects: ["google", "microsoft", "fed"] });
  const metadata = await report({ at: hoursAgo(36), title: `Pineapple 标准发布，Google 参与 ${T}`, subjects: ["apple", "google"] });
  const adjacent = await report({ at: hoursAgo(37), title: `发布Apple的新财报 ${T}`, subjects: ["apple", "google"] });
  const headline = await report({ at: hoursAgo(38), title: `Microsoft 被一篇盘点提到 ${T}`, subjects: ["fed"] });
  const agent = await report({ at: hoursAgo(39), title: `流动性指标更新 ${T}`, tags: ["流动性"] });

  const microsoft = await members("microsoft");
  for (const id of [about, product, english]) assert.ok(microsoft.includes(id), "about Microsoft");
  for (const id of [subpoena, lowerCase, pact, headline]) assert.ok(!microsoft.includes(id), "only mentions Microsoft");
  const google = await members("google");
  for (const id of [subpoena, lowerCase, metadata]) assert.ok(google.includes(id), "about Google");
  for (const id of [english, pact]) assert.ok(!google.includes(id), "only mentions Google");
  const meta = await members("apple");
  assert.ok(meta.includes(adjacent), "Apple next to Chinese text");
  assert.ok(!meta.includes(metadata), "Pineapple is not Apple");
  assert.ok((await members("liquidity")).includes(agent), "a risk topic takes its tag");

  // The article page names the topics it belongs to.
  const topicsOf = async (id: string) => {
    const res = await app.inject({ method: "GET", url: `/api/site/items/${id}` });
    return (JSON.parse(res.body) as { topics: Array<{ slug: string }> }).topics.map((t) => t.slug);
  };
  assert.deepEqual(await topicsOf(about), ["microsoft", "earnings"]);
  assert.deepEqual(await topicsOf(subpoena), ["google", "earnings"]);
  assert.deepEqual(await topicsOf(pact), ["earnings"]);
  assert.deepEqual(await topicsOf(agent), ["liquidity", "earnings"]);
});

test("a story page names the topics of its reports", async () => {
  const launch = await story(`流动性统计口径更新 ${T}`);
  await report({ source: OFFICIAL, at: hoursAgo(26), title: `流动性统计口径更新 ${T}`, tags: ["流动性"], fact: await fact(launch.id, "统计口径更新") });
  assert.deepEqual(await topicsOfStory(launch.id), [{ slug: "liquidity", name: "流动性" }, { slug: "earnings", name: "财报业绩" }]);
});

test("withdrawn articles stay out of lists and counts", async () => {
  const kept = await report({ at: hoursAgo(5), title: `NVIDIA 发布财报 ${T}`, subjects: ["nvidia"] });
  const withdrawn = await report({ at: hoursAgo(4), title: `NVIDIA 撤回的消息 ${T}`, subjects: ["nvidia"] });
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${withdrawn}`;

  const data = await page("nvidia");
  assert.deepEqual(ids(data.items), [kept]);
  assert.equal(data.topic.total, 1);
  const summary = (await listTopicSummaries()).topics.find((t) => t.slug === "nvidia")!;
  assert.equal(summary.latest?.title, `NVIDIA 发布财报 ${T}`, "the index shows the newest public article");
});

test("every topic has a page; unknown topics and pages past the end have none", async () => {
  const empty = await page("pboc");
  assert.equal(empty.topic.indexable, false, "a topic without content is not indexed");
  assert.deepEqual(empty.items, []);
  assert.equal(await loadTopicPage("not-a-topic", 1, new Date()), null);
  assert.equal(await loadTopicPage("pboc", 2, new Date()), null);
  const index = await app.inject({ method: "GET", url: "/api/site/topics" });
  const body = JSON.parse(index.body) as { groups: Array<{ key: string }>; topics: Array<{ slug: string }> };
  assert.deepEqual(body.groups.map((g) => g.key), ["company", "field", "genre"]);
  assert.equal(body.topics.length, TOPICS.length);
  assert.ok(body.topics.some(t => t.slug === "liquidity"));
});

test("a topic without selections offers real non-selected reports and rechecks withdrawals", async () => {
  const collected = await report({ at: hoursAgo(4), title: `日本财务省 公布国债资料 ${T}`, subjects: ["japan-mof"], selected: false });
  const hidden = await report({ at: hoursAgo(3), title: `日本财务省 撤回资料 ${T}`, subjects: ["japan-mof"], selected: false });
  const future = await report({ at: hoursAgo(-24), title: `日本财务省 尚未发布 ${T}`, subjects: ["japan-mof"], selected: true });
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${hidden}`;
  const data = await page("japan-mof");
  assert.deepEqual(data.items, []);
  assert.equal(data.topic.total, 0);
  assert.equal(data.topic.poolTotal, 1);
  assert.deepEqual(ids(data.collectedItems), [collected]);
  assert.ok(data.collectedItems.every((item) => !item.selected));
  assert.ok(!ids(data.collectedItems).includes(future));
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${collected}`;
  assert.deepEqual((await loadTopicPage("japan-mof", 1))?.collectedItems, [], "no stale withdrawn report in the fallback");

  const selected = await report({ at: hoursAgo(1), title: `日本财务省 已精选资料 ${T}`, subjects: ["japan-mof"], selected: true });
  await report({ at: hoursAgo(2), title: `日本财务省 已收录资料 ${T}`, subjects: ["japan-mof"], selected: false });
  const withSelection = await page("japan-mof");
  assert.deepEqual(ids(withSelection.items), [selected]);
  assert.deepEqual(withSelection.collectedItems, [], "fallback does not replace or mingle with selections");
});
