import type { MacroObservation } from "./domain.ts";

interface SpreadObservation {
  basisPoints: number | null;
  asOf: string | null;
  publishedAt: string | null;
  inputs: MacroObservation[];
  reason: string;
}
interface BalanceObservation {
  metric: string;
  label: string;
  current: MacroObservation | null;
  previous: MacroObservation | null;
  change: number | null;
  reason: string;
}
export interface LiquidityObservation { spread: SpreadObservation; balances: BalanceObservation[] }

/** Only observations available at the caller's time; equal-time conflicts remain missing. */
function series(observations: MacroObservation[], sourceId: string, metric: string, unit: MacroObservation["unit"], frequency: MacroObservation["frequency"], now: number) {
  const byDate = new Map<string, { row: MacroObservation; conflict: boolean }>();
  for (const row of observations) {
    if (row.sourceId !== sourceId || row.metric !== metric || row.unit !== unit || row.frequency !== frequency || !Number.isFinite(row.value)) continue;
    const observed = Date.parse(row.asOf), published = Date.parse(row.publishedAt);
    if (!Number.isFinite(now) || !Number.isFinite(observed) || !Number.isFinite(published) || observed > published || published > now) continue;
    try {
      const url = new URL(row.sourceUrl);
      if (!row.sourceName.trim() || !["https:", "http:"].includes(url.protocol) || url.username || url.password) continue;
    } catch { continue; }
    const date = row.asOf.slice(0, 10);
    if (frequency === "weekly" && new Date(`${date}T00:00:00Z`).getUTCDay() !== 3) continue;
    const previous = byDate.get(date);
    if (!previous || published > Date.parse(previous.row.publishedAt)) byDate.set(date, { row, conflict: false });
    else if (published === Date.parse(previous.row.publishedAt) && row.value !== previous.row.value) previous.conflict = true;
  }
  return byDate;
}

/** Descriptive arithmetic only: no inferred risk thresholds, percentile cutoffs or trade signals. */
export function observeLiquidity(observations: MacroObservation[], now: Date): LiquidityObservation {
  const at = now.getTime();
  const sofr = series(observations, "nyfed", "sofr", "percent", "daily", at);
  const effr = series(observations, "nyfed", "effr", "percent", "daily", at);
  const date = [...sofr.keys()].filter((day) => effr.has(day)).sort().at(-1);
  let spread: SpreadObservation = { basisPoints: null, asOf: null, publishedAt: null, inputs: [], reason: "需要同一观测日、已确认可用的 SOFR 与 EFFR。" };
  if (date) {
    const first = sofr.get(date)!, second = effr.get(date)!;
    if (first.conflict || second.conflict) spread.reason = "同日来源数值冲突，暂不计算利差。";
    else {
      const inputs = [first.row, second.row];
      spread = { basisPoints: Math.round((first.row.value - second.row.value) * 100 * 1e8) / 1e8, asOf: date, publishedAt: new Date(Math.max(...inputs.map((row) => Date.parse(row.publishedAt)))).toISOString(), inputs, reason: "SOFR − EFFR，百分数差 × 100 转为基点；仅比较两种隔夜融资参考利率。" };
    }
  }
  const balances = [
    { metric: "fed-total-assets", label: "美联储总资产" },
    { metric: "fed-reserve-balances", label: "存款机构准备金" },
  ].map(({ metric, label }): BalanceObservation => {
    const rows = series(observations, "fed", metric, "usd-million", "weekly", at);
    const day = [...rows.keys()].sort().at(-1);
    const latest = day ? rows.get(day) : undefined;
    const result: BalanceObservation = { metric, label, current: latest && !latest.conflict ? latest.row : null, previous: null, change: null, reason: latest?.conflict ? "最新观测存在来源数值冲突。" : "尚无已确认可用的周三余额。" };
    if (!day || !result.current) return result;
    const priorDay = new Date(Date.parse(`${day}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
    const previous = rows.get(priorDay);
    if (!previous || previous.conflict) return { ...result, reason: "缺少恰好前一周、同口径的周三余额，不计算周变化。" };
    return { ...result, previous: previous.row, change: result.current.value - previous.row.value, reason: "本周三余额 − 前一周三余额，单位百万美元；不是每日新增，也不自动代表流动性风险。" };
  });
  return { spread, balances };
}
