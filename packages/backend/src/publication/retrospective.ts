// First-site reading material without inventing past issues. Source dates group current selections;
// retrieval time is explicit, and no report, publication timestamp or backfill flag is written.
import type { ReportKind, ReportRetrospective } from "@aihot/contracts/site";
import { isoWeekLabel, isoWeekRange, monthRange } from "@aihot/contracts/time";
import { sql } from "../db.ts";
import { proxiedImage, proxiedImageSet } from "../media/imgproxy.ts";
import { publicSourceName } from "./rules.ts";
import { seatedCondition } from "./scope.ts";

const LIMITS = { daily: { periods: 7, items: 12 }, weekly: { periods: 4, items: 20 }, monthly: { periods: 3, items: 30 } };

export async function loadReportRetrospective(kind: ReportKind, now = new Date()): Promise<ReportRetrospective> {
  const unit = kind === "daily" ? "day" : kind === "weekly" ? "week" : "month";
  const limit = LIMITS[kind];
  const rows = await sql<{
    id: string; title: string; summary: string | null; url: string; source_name: string; icon_url: string | null;
    first_party: boolean; published_at: Date; discovered_at: Date; period_start: string; total: number;
  }[]>`
    WITH material AS (
      SELECT p.article_id AS id, p.title, p.summary, p.url, s.name AS source_name, s.icon_url,
        (s.tier = 'T1') AS first_party, p.published_at, p.discovered_at,
        date_trunc(${unit}, p.published_at AT TIME ZONE 'Asia/Shanghai')::date AS period
      FROM publications p JOIN sources s ON s.id = p.source_id
      WHERE ${seatedCondition(now)} AND p.eligible AND s.participation_mode = 'editorial'
        AND p.published_at IS NOT NULL AND p.published_at <= ${now}
    ), ranked AS (
      SELECT *, dense_rank() OVER (ORDER BY period DESC) AS period_rank,
        row_number() OVER (PARTITION BY period ORDER BY published_at DESC, id) AS item_rank,
        count(*) OVER (PARTITION BY period)::int AS total
      FROM material
    )
    SELECT id, title, summary, url, source_name, icon_url, first_party, published_at, discovered_at,
      period::text AS period_start, total FROM ranked
    WHERE period_rank <= ${limit.periods} AND item_rank <= ${limit.items}
    ORDER BY period DESC, item_rank`;
  const periods: ReportRetrospective["periods"] = [];
  for (const row of rows) {
    const key = kind === "daily" ? row.period_start : kind === "weekly" ? isoWeekLabel(row.period_start) : row.period_start.slice(0, 7);
    let period = periods.at(-1);
    if (!period || period.key !== key) {
      const range = kind === "weekly" ? isoWeekRange(key)! : kind === "monthly" ? monthRange(key)! : { start: key, end: key };
      period = { key, startDate: range.start, endDate: range.end, total: row.total, items: [] };
      periods.push(period);
    }
    const srcSet = row.icon_url ? proxiedImageSet(row.icon_url, "avatar") : null;
    period.items.push({
      itemId: row.id, title: row.title, summary: row.summary,
      sourceName: publicSourceName(row.source_name), sourceUrl: row.url,
      sourceIconUrl: row.icon_url ? proxiedImage(row.icon_url, "avatar") : null,
      ...(srcSet ? { sourceIconSrcSet: srcSet } : {}), firstParty: row.first_party,
      publishedAt: row.published_at.toISOString(), recordedAt: row.discovered_at.toISOString(), available: true,
    });
  }
  return { kind, asOf: now.toISOString(), limitPerPeriod: limit.items, periods };
}
