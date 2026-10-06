import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { loadReportRetrospective } from "@aihot/backend/publication/retrospective";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { buildApp } from "../apps/api/src/app.ts";

const now = new Date("2026-10-06T00:00:00Z");
const sourceId = `retrospective-${tag()}`;
const app = await buildApp();
before(async () => {
  await sql`INSERT INTO sources(id,name,kind,tier,participation_mode) VALUES (${sourceId},'Historical publisher','rss','T1','editorial')`;
});
after(async () => { await app.close(); await stopBoss(); await closeDb(); });

async function selected(label: string, date: string | null) {
  const { articleId } = await upsertMaterial({ sourceId, title: label, url: `https://example.org/${sourceId}/${label}`,
    excerpt: `Source summary ${label}`, publishedAt: date ? new Date(date) : null, discoveredAt: now, backfill: "first-import", via: "fetch" });
  await sql`INSERT INTO analyses(article_id,input_revision,origin,relevance,title_zh,summary_zh,category,score,selected)
    VALUES (${articleId},1,'rule','pass',${`历史标题 ${label}`},${`历史摘要 ${label}`},'us-stocks',90,true)`;
  await publishArticle(articleId, { now, releasedAt: now });
  return articleId;
}

test("retrospectives group current public selections by original Beijing dates without manufacturing issues", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const september = await selected("september", "2026-09-30T15:59:00Z");
  const october = await selected("october", "2026-09-30T16:00:00Z");
  const monday = await selected("monday", "2026-10-04T16:00:00Z");
  const unknown = await selected("unknown-date", null);
  const withdrawn = await selected("withdrawn", "2026-10-04T12:00:00Z");
  const waiting = await selected("waiting", "2026-10-04T12:00:00Z");
  const future = await selected("future", "2026-10-04T12:00:00Z");
  const rejected = await selected("unselected", "2026-10-04T12:00:00Z");
  const ineligible = await selected("ineligible", "2026-10-04T12:00:00Z");
  const duplicate = await selected("duplicate-seat", "2026-10-04T12:00:00Z");
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${withdrawn}`;
  await sql`UPDATE publications SET visible_after='2026-10-07T00:00:00Z' WHERE article_id=${waiting}`;
  await sql`UPDATE publications SET published_at='2026-10-07T00:00:00Z' WHERE article_id=${future}`;
  await sql`UPDATE publications SET selected=false WHERE article_id=${rejected}`;
  await sql`UPDATE publications SET eligible=false WHERE article_id=${ineligible}`;
  await sql`UPDATE publications SET seat=false WHERE article_id=${duplicate}`;
  const before = await sql`SELECT id,published_at,discovered_at,timeline_at,backfill FROM articles WHERE source_id=${sourceId} ORDER BY id`;

  const daily = await loadReportRetrospective("daily", now);
  assert.equal(daily.asOf, now.toISOString());
  assert.deepEqual(daily.periods.map((p) => [p.key, p.items.map((i) => i.itemId)]), [
    ["2026-10-05", [monday]], ["2026-10-01", [october]], ["2026-09-30", [september]],
  ]);
  assert.equal(daily.periods[2]!.items[0]!.publishedAt, "2026-09-30T15:59:00.000Z");
  assert.equal(daily.periods[2]!.items[0]!.recordedAt, now.toISOString());
  assert.equal(daily.periods[2]!.items[0]!.summary, "历史摘要 september");
  for (const id of [unknown, withdrawn, waiting, future, rejected, ineligible, duplicate]) assert.ok(!JSON.stringify(daily).includes(id));
  const weekly = await loadReportRetrospective("weekly", now);
  assert.deepEqual(weekly.periods.map((p) => [p.key, p.startDate, p.endDate, p.total]), [
    ["2026-W41", "2026-10-05", "2026-10-11", 1], ["2026-W40", "2026-09-28", "2026-10-04", 2],
  ]);
  const monthly = await loadReportRetrospective("monthly", now);
  assert.deepEqual(monthly.periods.map((p) => [p.key, p.total]), [["2026-10", 2], ["2026-09", 1]]);
  assert.deepEqual(await sql`SELECT id,published_at,discovered_at,timeline_at,backfill FROM articles WHERE source_id=${sourceId} ORDER BY id`, before);
  assert.equal((await sql`SELECT 1 FROM reports`).length, 0);

  for (const kind of ["daily", "weekly", "monthly"]) {
    const response = await app.inject({ method: "GET", url: `/api/site/reports/${kind}/latest-page` });
    assert.equal(response.statusCode, 200);
    const data = response.json();
    assert.equal(data.report, null);
    assert.deepEqual(data.index, []);
    assert.ok(data.retrospective.periods.length > 0);
    assert.ok(!("issueNumber" in data.retrospective));
    assert.ok(!("generatedAt" in data.retrospective));
  }
  assert.equal((await app.inject({ method: "GET", url: "/api/site/reports/daily/2026-09-30" })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/daily/latest" })).statusCode, 404);
  assert.equal((await sql`SELECT 1 FROM reports`).length, 0);

  await sql`INSERT INTO reports(kind,key,window_start,window_end,content,generated_at,origin)
    VALUES ('daily','2026-10-06','2026-10-05T00:00:00Z','2026-10-06T00:00:00Z',${sql.json({ sections: [] })},${now},'manual')`;
  t.mock.timers.tick(600_001);
  const published = (await app.inject({ method: "GET", url: "/api/site/reports/daily/latest-page" })).json();
  assert.equal(published.report.key, "2026-10-06");
  assert.equal(published.report.issueNumber, 1);
  assert.equal(published.retrospective, null);
});
