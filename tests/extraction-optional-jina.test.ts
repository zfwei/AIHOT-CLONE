import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { queueProcessing, registerExtractionJobs } from "@aihot/backend/jobs/content";
import { getBoss, QUEUES, stopBoss } from "@aihot/backend/jobs/queue";

let pageReads = 0, jinaReads = 0;
const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/jina/")) jinaReads++;
  else pageReads++;
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><body><p>This page requires JavaScript.</p></body></html>");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
process.env.JINA_API_KEY = "";
process.env.JINA_BASE_URL = `${base}/jina`;
config.allowPrivateNetworkFetch = true;
after(async () => { server.close(); await stopBoss(); await closeDb(); });

test("without optional Jina credentials, unreadable HTML advances to summary review without retries or paid requests", async () => {
  const sourceId = `optional-jina-${tag()}`;
  await sql`INSERT INTO sources(id,name,kind) VALUES (${sourceId},'Optional Jina','web_list')`;
  await sql`UPDATE budgets SET per_minute=1000,per_hour=1000,per_day=1000 WHERE service='jina'`;
  const excerpt = "The publisher's feed summary remains available for editorial review.";
  const { articleId } = await upsertMaterial({ sourceId, url: `${base}/article`, title: "Original announcement", excerpt, via: "fetch" });
  const job = await queueProcessing(articleId);
  await registerExtractionJobs(await getBoss());
  const deadline = Date.now() + 12_000;
  while ((await sql`SELECT state FROM pgboss.job WHERE id=${job!}`)[0]?.state !== "completed") {
    assert.ok(Date.now() < deadline, "extraction worker did not finish");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const [row] = await sql`SELECT body_status,body_text,excerpt,revision,processing_attempts,processing_error,processing_retry_at FROM articles WHERE id=${articleId}`;
  assert.deepEqual({ ...row }, { body_status: "unconfirmed", body_text: null, excerpt, revision: 1, processing_attempts: 0, processing_error: null, processing_retry_at: null });
  assert.equal((await sql`SELECT 1 FROM pgboss.job WHERE name=${QUEUES.analyze} AND data->>'articleId'=${articleId}`).length, 1);
  assert.equal((await sql`SELECT 1 FROM receipts WHERE service='jina' AND subject=${`article:${articleId}`}`).length, 0);
  assert.deepEqual([pageReads, jinaReads], [1, 0]);
});
