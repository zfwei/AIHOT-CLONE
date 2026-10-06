// Run after `npm run build -w @aihot/web`. Real production server/router, synthetic HTTP API only.
// Failure cases: the masthead numbering the newest of 405 issues 400 (the navigation index's length); an
// issue older than the index losing its number; the calendar marking that issue as not published; the
// daily archive counting 400 issues beside a masthead that numbers 405.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ReportDetail, ReportKind, ReportNavigationEntry } from "@aihot/contracts/site";
import { isoWeekLabel } from "@aihot/contracts/time";
import { issueNumber, periodGrid } from "../app/features/report/format.ts";

const kinds: ReportKind[] = ["daily", "weekly", "monthly"];
const keys = Object.fromEntries(kinds.map((kind) => [kind, Array.from({ length: 405 }, (_, i) => {
  if (kind === "monthly") return new Date(Date.UTC(2020, i, 1)).toISOString().slice(0, 7);
  const day = new Date(Date.UTC(2020, 0, 6 + i * (kind === "weekly" ? 7 : 1))).toISOString().slice(0, 10);
  return kind === "weekly" ? isoWeekLabel(day) : day;
})])) as Record<ReportKind, string[]>;
/** The navigation as the api sends it: the newest 400 issues, each with its number in the whole series. */
const index = (kind: ReportKind): ReportNavigationEntry[] => keys[kind].map((key, i) => ({ key, issueNumber: i + 1, title: `第${i + 1}期` })).reverse().slice(0, 400);
function report(kind: ReportKind, key: string): ReportDetail {
  return {
    kind, key, issueNumber: keys[kind].indexOf(key) + 1, title: "测试刊物", generatedAt: "2020-01-02T00:00:00Z",
    lead: null, leadItemId: null, overview: null, highlights: [], sections: [], flashes: [], cover: null, metrics: {}, readingMinutes: 1, prev: null, next: null,
  };
}
let web: ChildProcess;
let origin: string;
let logs = "";
let showRetrospective = false;
const retrospective = (kind: ReportKind) => ({
  kind, asOf: "2026-10-06T00:00:00Z", limitPerPeriod: 12,
  periods: [{ key: kind === "daily" ? "2026-09-30" : kind === "weekly" ? "2026-W40" : "2026-09", startDate: "2026-09-30", endDate: "2026-09-30", total: 1,
    items: [{ itemId: "historical-item", title: "已核实的历史精选", summary: "真实来源的摘要仍可阅读。", sourceName: "官方来源", sourceUrl: "https://example.org/history", sourceIconUrl: null,
      firstParty: true, publishedAt: "2026-09-30T12:00:00Z", recordedAt: "2026-10-06T00:00:00Z", available: true }] }],
});
const api = createServer((req, res) => {
  const path = new URL(req.url!, "http://api.local").pathname;
  res.setHeader("Content-Type", "application/json");
  if (path === "/api/site/meta") return res.end(JSON.stringify({ changelogVersion: "2026-09-28T12:00" }));
  if (path === "/api/site/reports/daily") return res.end(JSON.stringify({ kind: "daily", items: showRetrospective ? [] : index("daily").map((entry) => ({ ...entry, count: 1 })) }));
  const match = /^\/api\/site\/reports\/(daily|weekly|monthly)\/(.+)$/.exec(path);
  if (match) {
    const kind = match[1] as ReportKind;
    const key = match[2]!;
    if (key === "latest-page") return res.end(JSON.stringify(showRetrospective
      ? { index: [], report: null, retrospective: retrospective(kind) }
      : { index: index(kind), report: report(kind, keys[kind].at(-1)!), retrospective: null }));
    if (key.startsWith("navigation/")) return res.end(JSON.stringify({ items: index(kind) }));
    if (keys[kind].includes(key)) return res.end(JSON.stringify(report(kind, key)));
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ code: "not_found" }));
});

before(async () => {
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  web = spawn(process.execPath, [fileURLToPath(new URL("../server.ts", import.meta.url))], {
    env: { ...process.env, WEB_PORT: "0", API_BASE_URL: `http://127.0.0.1:${(api.address() as AddressInfo).port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`web did not start: ${logs}`)), 15_000);
    web.on("exit", () => { clearTimeout(timeout); reject(new Error(`web exited: ${logs}`)); });
    web.stderr!.on("data", (chunk) => { logs += String(chunk); });
    web.stdout!.on("data", (chunk) => {
      logs += String(chunk);
      const match = logs.match(/"msg":"web started","port":(\d+)/);
      if (match) {
        origin = `http://127.0.0.1:${match[1]}`;
        clearTimeout(timeout);
        resolve();
      }
    });
  });
});

after(async () => {
  if (web && web.exitCode === null) {
    web.kill("SIGTERM");
    await once(web, "exit");
  }
  api.closeAllConnections();
  await new Promise<void>((resolve) => api.close(() => resolve()));
});

/** The masthead's visible text (the archive's has the same frame). */
function masthead(html: string): string {
  const header = /<header class="pt-5 lg:pt-0">([\s\S]*?)<\/header>/.exec(html);
  assert.ok(header, "the report masthead is rendered");
  return header[1]!.replace(/<[^>]+>/g, "");
}

for (const kind of kinds) {
  test(`the ${kind} masthead numbers the newest of 405 issues 405, not the navigation's 400`, async () => {
    const response = await fetch(`${origin}/${kind}`);
    assert.equal(response.status, 200, logs);
    const visible = masthead(await response.text());
    assert.match(visible, /第\s*405\s*期/);
    assert.doesNotMatch(visible, /第\s*400\s*期/);
  });

  test(`the oldest ${kind} issue, outside the navigation, keeps its number`, async () => {
    const first = keys[kind][0]!;
    assert.ok(!index(kind).some((entry) => entry.key === first));
    const response = await fetch(`${origin}/${kind}/${first}`);
    assert.equal(response.status, 200, logs);
    assert.match(masthead(await response.text()), /第\s*1\s*期/);
  });

  test(`the ${kind} calendar labels this issue with its own number and makes up none for others`, () => {
    const first = keys[kind][0]!;
    const { cells } = periodGrid(kind, first, index(kind), 1);
    const current = cells.find((cell) => cell.key === first)!;
    assert.equal(current.state, "current");
    assert.match(current.label, /第 1 期/);
    const unlisted = cells.find((cell) => cell.key === keys[kind][1])!;
    assert.doesNotMatch(unlisted.label, /第 \d+ 期/, "an issue the navigation does not list gets no number");
    assert.equal(issueNumber(index(kind), keys[kind].at(-1)!), 405);
    const stale = periodGrid(kind, first, [{ key: first, issueNumber: 9 }], 10);
    assert.match(stale.cells.find((cell) => cell.key === first)!.label, /第 10 期/, "the report's own number wins over an older navigation");
  });
}

test("the daily archive counts every issue, as the masthead numbers them", async () => {
  const response = await fetch(`${origin}/daily/archive`);
  assert.equal(response.status, 200, logs);
  assert.match(masthead(await response.text()), /共\s*405\s*期/);
});

test("first-site report pages show dated retrospective summaries without inventing an issue", async () => {
  showRetrospective = true;
  try {
    for (const path of ["/daily", "/weekly", "/monthly", "/daily/archive"]) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 200, logs);
      const html = await response.text();
      assert.match(html, /data-retrospective="true"/);
      assert.match(html, /历史精选回顾/);
      assert.match(html, /事后汇总/);
      assert.match(html, /并非在所述日期出刊/);
      assert.match(html, /已核实的历史精选/);
      assert.match(html, /真实来源的摘要仍可阅读/);
      assert.match(html, /原文发布/);
      assert.match(html, /本站收录/);
      assert.doesNotMatch(html, /第\s*1\s*期/);
      assert.doesNotMatch(html, /"@type":"NewsArticle"/);
      if (path.endsWith("archive")) assert.match(masthead(html), /共\s*0\s*期/);
    }
  } finally { showRetrospective = false; }
});
