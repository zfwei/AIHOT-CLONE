// Deterministic observations, not execution signals. Callers supply the evaluation clock.
// maxAgeMs is a data-quality window, not the user's investment horizon or risk tolerance.
import type {
  FactorAssessment, Holding, HoldingValue, Instrument, MarketAssessment, MarketId,
  PortfolioAnalysis, PriceBar, Quote, RiskBudget, RiskBudgetInput, RiskFactor, Snapshot, TrendObservation,
} from "./domain.ts";

export const FACTORS: readonly RiskFactor[] = ["valuation", "crowding", "liquidity", "speculation"];
export const DAILY_MAX_AGE_MS = 7 * 86400000;
const time = (value: string) => Date.parse(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const sourcePresent = (source: { sourceName: string; sourceUrl: string }) => {
  try { return !!source.sourceName.trim() && ["https:", "http:"].includes(new URL(source.sourceUrl).protocol); }
  catch { return false; }
};
const available = (asOf: string, publishedAt: string, now: number) =>
  Number.isFinite(now) && Number.isFinite(time(asOf)) && time(asOf) <= now
  && Number.isFinite(time(publishedAt)) && time(publishedAt) >= time(asOf) && time(publishedAt) <= now;

/** Missing/expired evidence never means not-triggered. One active rule per market/factor. */
export function evaluateMarket(snapshot: Snapshot, market: MarketId, now: Date): MarketAssessment {
  const at = now.getTime();
  const factors = FACTORS.map((factor): FactorAssessment => {
    const result: FactorAssessment = { factor, state: "unknown", reason: "尚未配置有效规则与阈值", ruleId: null, ruleVersion: null, evidence: [], validUntil: null };
    if ((market === "us-treasury" || market === "global-bonds") && (factor === "valuation" || factor === "speculation")) {
      return { ...result, state: "not_applicable", reason: "股票估值与产业题材规则不适用于国债；独立债券风险尚未覆盖" };
    }
    const rules = snapshot.rules.filter(r => r.market === market && r.factor === factor && r.enabled);
    if (rules.length !== 1) return { ...result, reason: rules.length ? "同一因子存在多条启用规则，需明确规则" : result.reason };
    const rule = rules[0]!;
    result.ruleId = rule.id;
    result.ruleVersion = rule.version;
    if (!finite(rule.threshold) || !rule.version.trim() || !rule.metric.trim() || !rule.unit.trim()) return result;
    const records = snapshot.evidence.filter(e => e.market === market && e.metric === rule.metric && e.unit === rule.unit
      && finite(e.value) && sourcePresent(e) && available(e.asOf, e.publishedAt, at)
      && Number.isFinite(time(e.expiresAt)) && time(e.expiresAt) > at);
    if (!records.length) return { ...result, reason: "缺少同口径、已发布且未过期的来源证据" };
    const latestTime = Math.max(...records.map(e => time(e.asOf)));
    const latest = records.filter(e => time(e.asOf) === latestTime);
    result.evidence = latest;
    if (new Set(latest.map(e => e.value)).size > 1) return { ...result, reason: "同一观察时点的来源数值冲突，暂不判定" };
    const value = latest[0]!.value!;
    if (rule.operator !== "gte" && rule.operator !== "lte") return { ...result, reason: "不支持的比较规则" };
    const triggered = rule.operator === "gte" ? value >= rule.threshold : value <= rule.threshold;
    return { ...result, state: triggered ? "triggered" : "not_triggered",
      reason: `${value} ${rule.unit} ${rule.operator === "gte" ? "≥" : "≤"} ${rule.threshold}：${triggered ? "条件成立" : "未触发；不代表无风险"}`,
      validUntil: new Date(Math.min(...latest.map(e => time(e.expiresAt)))).toISOString() };
  });
  return { market, asOf: Number.isFinite(at) ? now.toISOString() : "", factors,
    evaluatedCount: factors.filter(f => f.state === "triggered" || f.state === "not_triggered").length,
    unknownCount: factors.filter(f => f.state === "unknown").length,
    triggeredCount: factors.filter(f => f.state === "triggered").length,
    notApplicableCount: factors.filter(f => f.state === "not_applicable").length };
}

/** 20/60 daily-observation close averages. The 61st point permits comparing successive averages.
 * Dates supplied by a price provider are trading sessions; this function does not invent holiday bars.
 * Duplicate-date revisions use the latest publication available at evaluation time.
 */
export function observeTrend(instrument: Instrument, bars: PriceBar[], now: Date, maxAgeMs = DAILY_MAX_AGE_MS): TrendObservation {
  const result: TrendObservation = { state: "unknown", signal: null, reason: "至少需要 61 个有效、去重且已发布的交易日日线",
    ruleVersion: "ma20-60-v1-unbacktested", asOf: null, ma20: null, ma60: null, sampleCount: 0 };
  if (instrument.kind === "bond-yield") return { ...result, state: "not_applicable", reason: "国债收益率不是股票价格，不应用股票均线规则" };
  const at = now.getTime();
  const byDate = new Map<string, PriceBar>();
  for (const bar of bars) {
    if (bar.instrumentId !== instrument.id || !/^\d{4}-\d{2}-\d{2}$/.test(bar.date)
      || !finite(bar.close) || bar.close <= 0 || !sourcePresent(bar)) continue;
    const day = time(`${bar.date}T00:00:00Z`);
    if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== bar.date
      || !available(`${bar.date}T00:00:00Z`, bar.publishedAt, at)) continue;
    const previous = byDate.get(bar.date);
    if (!previous || time(bar.publishedAt) > time(previous.publishedAt)) byDate.set(bar.date, bar);
  }
  const history = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  result.sampleCount = history.length;
  const last = history.at(-1);
  if (last) result.asOf = last.date;
  if (history.length < 61) return result;
  if (!finite(maxAgeMs) || maxAgeMs <= 0 || at - time(`${last!.date}T00:00:00Z`) >= maxAgeMs) {
    return { ...result, reason: "最近交易日数据已过期，暂停均线观察" };
  }
  const sample = history.slice(-61);
  if (instrument.kind === "stock" && sample.some(b => b.priceBasis !== "adjusted")) {
    return { ...result, reason: "股票样本须明确使用一致的复权价格，缺失或未复权价格不生成观察" };
  }
  const days = sample.map(b => time(`${b.date}T00:00:00Z`));
  if (days[60]! - days[0]! > 110 * 86400000 || days.some((day, i) => i > 0 && day - days[i - 1]! > 7 * 86400000)) {
    return { ...result, reason: "样本间隔或总跨度异常；尚未校准交易日历，暂停均线观察" };
  }
  const closes = sample.map(b => b.close);
  const average = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const ma20 = average(closes.slice(-20));
  const ma60 = average(closes.slice(-60));
  const previous20 = average(closes.slice(-21, -1));
  const previous60 = average(closes.slice(0, -1));
  const signal = ma20 > ma60 ? previous20 <= previous60 ? "cross_above" : "above"
    : ma20 < ma60 ? previous20 >= previous60 ? "cross_below" : "below" : "equal";
  return { ...result, state: "observed", signal, ma20, ma60, reason: "20/60 观察值均线研究；未回测、未校准交易日历，不是买卖指令，也未计交易成本" };
}

/** Current marks only; missing marks make the currency group's concentration unknown.
 * Currency totals are independent subtotals. No FX conversion, index holding or short valuation.
 */
export function analyzePortfolio(holdings: Holding[], instruments: Instrument[], quotes: Quote[], now: Date, maxAgeMs = DAILY_MAX_AGE_MS): PortfolioAnalysis {
  const at = now.getTime();
  const rows = holdings.map((holding): HoldingValue => {
    const instrument = instruments.find(i => i.id === holding.instrumentId);
    const valid = finite(holding.quantity) && holding.quantity > 0 && finite(holding.averageCost) && holding.averageCost >= 0;
    const cost = valid ? holding.quantity * holding.averageCost : null;
    const base: HoldingValue = { ...holding, currency: instrument?.currency ?? "UNKNOWN", cost: cost !== null && finite(cost) ? cost : null,
      marketValue: null, unrealizedPnl: null, concentration: null, reason: null };
    if (!valid || base.cost === null) return { ...base, reason: "数量及成本必须是有效的非负多头持仓数据" };
    if (!instrument) return { ...base, reason: "未知证券，无法确认币种和价格口径" };
    if (instrument.kind !== "stock") return { ...base, reason: "指数点位及国债收益率不能作为持仓证券价格" };
    const quote = quotes.filter(q => q.instrumentId === holding.instrumentId && q.unit === "price"
      && finite(q.value) && q.value > 0 && sourcePresent(q) && available(q.asOf, q.publishedAt, at)
      && finite(maxAgeMs) && maxAgeMs > 0 && at - time(q.asOf) < maxAgeMs)
      .sort((a, b) => time(b.asOf) - time(a.asOf) || time(b.publishedAt) - time(a.publishedAt))[0];
    if (!quote) return { ...base, reason: "缺少同口径且未过期的已发布价格" };
    const marketValue = holding.quantity * quote.value;
    if (!finite(marketValue)) return { ...base, reason: "持仓金额超出可计算范围" };
    return { ...base, marketValue, unrealizedPnl: marketValue - base.cost };
  });
  const currencies = [...new Set(rows.map(r => r.currency))].map(currency => {
    const group = rows.filter(r => r.currency === currency);
    const complete = group.every(r => r.marketValue !== null && r.cost !== null);
    const marketValue = group.reduce((sum, r) => sum + (r.marketValue ?? 0), 0);
    const cost = group.reduce((sum, r) => sum + (r.cost ?? 0), 0);
    const unrealizedPnl = group.reduce((sum, r) => sum + (r.unrealizedPnl ?? 0), 0);
    if (complete && marketValue > 0) for (const row of group) {
      // Multiple lots of one instrument still describe one concentrated exposure.
      row.concentration = group.filter(r => r.instrumentId === row.instrumentId).reduce((sum, r) => sum + r.marketValue!, 0) / marketValue;
    }
    return { currency, marketValue, cost, unrealizedPnl, complete };
  });
  return { holdings: rows, currencies, reason: rows.some(r => r.marketValue === null)
    ? "部分持仓无法估值：分币种金额仅为已知部分，集中度不可完整评估"
    : currencies.length > 1 ? "按币种分别计算；没有汇率，不提供跨币种总额及总组合集中度" : null };
}

/** Cash-funded long-only sizing from explicit user inputs; no default personal risk allowance.
 * Stop price defines a scenario, not guaranteed execution. Fees, slippage, gaps and FX are excluded.
 */
export function calculateRiskBudget(input: RiskBudgetInput): RiskBudget {
  const result: RiskBudget = { state: "unknown", reason: "请填写币种、资金、单笔风险上限、入场价、止损价及交易单位",
    currency: input.currency, riskAmount: null, riskPerUnit: null, quantity: null, notional: null };
  const { capital, maxRiskPercent, entryPrice, stopPrice, lotSize } = input;
  if (!input.currency.trim() || !finite(capital) || capital <= 0 || !finite(maxRiskPercent) || maxRiskPercent <= 0 || maxRiskPercent > 100
    || !finite(entryPrice) || entryPrice <= 0 || !finite(stopPrice) || stopPrice < 0 || stopPrice >= entryPrice
    || !finite(lotSize) || lotSize <= 0 || !Number.isInteger(lotSize)) return result;
  const riskAmount = capital * maxRiskPercent / 100;
  const riskPerUnit = entryPrice - stopPrice;
  const quantity = Math.floor(Math.min(riskAmount / riskPerUnit, capital / entryPrice) / lotSize) * lotSize;
  const notional = quantity * entryPrice;
  if (![riskAmount, riskPerUnit, quantity, notional].every(Number.isFinite) || !Number.isSafeInteger(quantity)) return result;
  return { state: "calculated", currency: input.currency, riskAmount, riskPerUnit, quantity, notional,
    reason: "仅为同币种现金多头的计划风险预算；止损不保证成交，未计手续费、滑点及跳空损失，不执行交易" };
}
