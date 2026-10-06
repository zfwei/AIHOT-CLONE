import { useState } from "react";
import { Link, useLoaderData } from "react-router";
import { pageMeta } from "@aihot/web/lib/seo";
import { evaluateMarket } from "../analysis.ts";
import type { Instrument, MarketId, Quote } from "../domain.ts";
import { loadMarkets } from "./data.server.ts";
import { MacroIndicators } from "./macro.tsx";
import { LiquidityEvidence } from "./liquidity.tsx";
import { buttonClass, dateTime, Empty, FACTORS, MARKETS, MarketShell, number, Panel, Provenance, quoteAge, quoteObservedAt, quoteChange, quoteNumber, SourceLink, StateBadge, useEvaluationTime } from "./shared.tsx";

export const loader = loadMarkets;
export const handle = { tab: "markets", name: "市场总览" };
export const meta = () => pageMeta({ title: "市场总览", description: "A股、美股、美债与全球国债的市场数据、四因子风险观察与证据。", path: "/markets" });
export const headers = () => ({ "Cache-Control": "no-store" });

function YieldCurve({ instruments, quotes }: { instruments: Instrument[]; quotes: Quote[] }) {
  const points = instruments.flatMap((instrument) => {
    const quote = quotes.find((q) => q.instrumentId === instrument.id && q.unit === "percent");
    return quote && instrument.tenorYears != null ? [{ instrument, quote, tenor: instrument.tenorYears }] : [];
  }).sort((a, b) => a.tenor - b.tenor);
  const latestDay = points.map((p) => p.quote.asOf.slice(0, 10)).sort().at(-1);
  const sameDay = points.filter((p) => p.quote.asOf.slice(0, 10) === latestDay);
  if (sameDay.length < 2) return <Empty title="期限结构待接入">至少需要同一观测日、两个不同期限的美国国债收益率。这里不会用示例点补齐曲线。</Empty>;
  const min = Math.min(...sameDay.map((p) => p.quote.value)) - 0.15;
  const max = Math.max(...sameDay.map((p) => p.quote.value)) + 0.15;
  const maxTenor = Math.max(...sameDay.map((p) => p.tenor));
  const x = (tenor: number) => 48 + tenor / maxTenor * 430;
  const y = (value: number) => 154 - (value - min) / (max - min) * 110;
  return <div className="px-4 py-3"><p className="mb-2 text-xs text-ink-3">观测日 {latestDay} · 名义常期限收益率 % · 仅连接已发布的真实期限点</p><svg viewBox="0 0 530 202" role="img" aria-label={`${latestDay} 美国国债收益率期限结构，详细数据见下方表格`} className="w-full text-accent">
    {[min, (min + max) / 2, max].map((v) => <g key={v}><line x1={48} y1={y(v)} x2={492} y2={y(v)} stroke="var(--line)" /><text x={5} y={y(v) + 4} fontSize={12} fill="var(--ink-3)">{number(v)}%</text></g>)}
    <polyline points={sameDay.map((p) => `${x(p.tenor)},${y(p.quote.value)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth={2} />
    {sameDay.map((p) => <g key={p.instrument.id}><circle cx={x(p.tenor)} cy={y(p.quote.value)} r={4} fill="currentColor" /><text x={x(p.tenor)} y={178} textAnchor="middle" fontSize={12} fill="var(--ink-2)">{p.tenor < 1 ? `${Math.round(p.tenor * 12)}月` : `${p.tenor}年`}</text></g>)}
    <text x={266} y={200} textAnchor="middle" fontSize={12} fill="var(--ink-3)">期限</text>
  </svg><dl className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-5">{sameDay.map((p) => <div key={p.instrument.id} className="rounded-control bg-bg-sunk p-2 text-xs"><dt className="text-ink-3">{p.instrument.name}</dt><dd className="mono mt-1 font-semibold text-ink">{number(p.quote.value)}%</dd><dd className="mt-1"><SourceLink url={p.quote.sourceUrl}>{p.quote.sourceName}</SourceLink></dd></div>)}</dl></div>;
}

export default function Overview() {
  const { data, now: loadedAt } = useLoaderData<typeof loader>();
  const now = useEvaluationTime(loadedAt);
  const { snapshot, instruments, sources } = data;
  const publishedRecords = [
    ...snapshot.quotes, ...snapshot.evidence, ...snapshot.ideas, ...(snapshot.macro ?? []),
    ...snapshot.history.map((bar) => ({ ...bar, asOf: bar.date })),
  ];
  const sourceHost = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const [market, setMarket] = useState<MarketId | "all">("all");
  const selected = MARKETS.filter((m) => market === "all" || m.id === market);
  const assessments = selected.map((m) => ({ ...m, assessment: evaluateMarket(snapshot, m.id, new Date(now)) }));
  const listed = instruments.filter((i) => market === "all" || i.market === market);
  return <MarketShell title="市场总览" description="先看数据时点，再看四项独立风险。未知表示证据不足，不代表风险较低。" asOf={snapshot.quotes.length || snapshot.evidence.length || snapshot.macro?.length ? snapshot.asOf : undefined}>
    <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">{MARKETS.map((m) => {
      const basket = instruments.filter((i) => i.market === m.id);
      const quote = basket.map((i) => snapshot.quotes.find((q) => q.instrumentId === i.id)).find(Boolean);
      const instrument = basket.find((i) => i.id === quote?.instrumentId);
      return <button type="button" key={m.id} onClick={() => setMarket(market === m.id ? "all" : m.id)} aria-pressed={market === m.id} className={`min-w-0 rounded-card border bg-surface p-4 text-left transition-colors hover:border-accent ${market === m.id ? "border-accent ring-1 ring-accent" : "border-line"}`}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-ink">{m.label}</h2><span className="mono text-[11px] tracking-wider text-ink-3">{m.short}</span></div><p className="mono mt-4 break-words text-xl sm:text-2xl font-semibold text-ink">{quote ? `${quoteNumber(quote.value)}${quote.unit === "percent" ? "%" : quote.unit === "points" ? " 点" : ` ${instrument?.currency ?? ""}`}` : "待接入"}</p><p className="mt-2 text-xs text-ink-3">{quote ? `${instrument?.name} · ${quoteChange(quote)}` : m.note}</p><p className="mt-2 text-xs text-ink-3">{quote ? `${quoteObservedAt(quote)} · ${quoteAge(quote, now)}` : "尚无已发布观测值"}</p></button>;
    })}</div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap gap-2" aria-label="市场筛选">{[{ id: "all", label: "全部市场" }, ...MARKETS].map((m) => <button type="button" key={m.id} onClick={() => setMarket(m.id as MarketId | "all")} aria-pressed={market === m.id} className={`${buttonClass} ${market === m.id ? "!border-accent !bg-accent-soft !text-accent" : ""}`}>{m.label}</button>)}</div><span className="text-xs text-ink-3">日线 / 延迟数据 · 非实时行情</span></div>
    <Panel title="四因子风险矩阵" aside="逐项判断，不合成虚假的总分">
      <div className="grid divide-y divide-line lg:grid-cols-2 lg:divide-y-0">{assessments.map(({ id, label, assessment }) => <div key={id} className="min-w-0 p-4 lg:border-b lg:border-r lg:border-line"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-ink">{label}</h3><span className="text-xs text-ink-3">已判定 {assessment.evaluatedCount} 项 · 未知 {assessment.unknownCount} 项</span></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{assessment.factors.map((factor) => <div key={factor.factor} className="rounded-control border border-line p-3"><p className="mb-2 text-xs text-ink-3">{FACTORS[factor.factor]}</p><StateBadge state={factor.state} /></div>)}</div><details className="mt-3"><summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-accent">判断依据与有效期</summary><div className="space-y-3">{assessment.factors.map((factor) => <div key={factor.factor} className="border-l-2 border-line pl-3 text-xs leading-relaxed"><p className="font-semibold text-ink-2">{FACTORS[factor.factor]} · {factor.ruleVersion ?? "规则待配置"}</p><p className="mt-1 text-ink-3">{factor.reason}</p>{factor.validUntil && <p className="text-ink-3">有效至 {dateTime(factor.validUntil)}</p>}{factor.evidence.map((e) => <p key={e.id} className="mt-1 text-ink-3"><SourceLink url={e.sourceUrl}>{e.sourceName}</SourceLink> · {e.metric} {number(e.value)} {e.unit} · 观测 {dateTime(e.asOf)} · 发布 {dateTime(e.publishedAt)}</p>)}</div>)}</div></details></div>)}</div>
    </Panel>
    <LiquidityEvidence observations={snapshot.macro ?? []} now={now} />
    <div className="mt-5 grid items-start gap-5 xl:grid-cols-[1.3fr_1fr]">
      <Panel title="观察清单" aside={`${listed.length} 个标的`}><div className="divide-y divide-line">{listed.map((instrument) => {
        const quote = snapshot.quotes.find((q) => q.instrumentId === instrument.id);
        return <div key={instrument.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3"><div className="min-w-0"><p className="break-words text-sm font-medium text-ink">{instrument.name}</p><p className="mono mt-1 break-all text-xs text-ink-3">{instrument.id} · {instrument.currency}{instrument.kind === "bond-yield" ? " · 收益率" : instrument.kind === "index" ? " · 指数" : " · 股票"}</p>{quote && <Provenance record={quote} />}</div><div className="text-right"><p className="mono text-sm font-semibold text-ink">{quote ? `${quoteNumber(quote.value)} ${quote.unit === "percent" ? "%" : quote.unit === "points" ? "点" : instrument.currency}` : "待接入"}</p><p className="mono mt-1 text-xs text-ink-3">{quote ? quoteChange(quote) : "—"}</p>{quote && <p className="mt-1 max-w-36 text-xs leading-5 text-ink-3">{quoteAge(quote, now)}</p>}</div></div>;
      })}</div>{!listed.length && <Empty title="尚未配置观察标的">请在市场模块配置观察清单。</Empty>}</Panel>
      <div className="space-y-5"><Panel title="美国国债期限结构" aside="收益率上升 ≠ 债券价格上涨"><YieldCurve instruments={instruments.filter((i) => i.market === "us-treasury")} quotes={snapshot.quotes} /></Panel><Panel title="已发布的市场动态"><div className="grid grid-cols-2 gap-2 p-4">{MARKETS.map((m) => <Link key={m.id} to={`/all?category=${m.category}`} className={buttonClass}>{m.label}动态 →</Link>)}</div></Panel></div>
    </div>
    <MacroIndicators observations={snapshot.macro ?? []} />
    <Panel id="market-sources" title="数据来源与接入状态" className="mt-5" aside={`${sources.filter((s) => s.status === "approved").length} 个已确认 / ${sources.length} 个登记来源`}><div className="grid gap-0 divide-y divide-line md:grid-cols-2 md:divide-y-0">{sources.map((source) => {
      const records = publishedRecords.filter((record) => source.id === "akshare" || source.id === "yfinance"
        ? record.sourceName.toLowerCase().includes(source.id)
        : sourceHost(record.sourceUrl) === sourceHost(source.url));
      const latestObservation = records.map((record) => record.asOf.slice(0, 10)).sort().at(-1);
      const latestAvailable = records.flatMap((record) => "publishedAt" in record ? [record.publishedAt] : []).sort().at(-1);
      return <div key={source.id} className="min-w-0 p-4 md:border-b md:border-r md:border-line"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold"><SourceLink url={source.url}>{source.name}</SourceLink></h3><span className="rounded-mark bg-bg-sunk px-2 py-1 text-xs text-ink-3">{source.status === "approved" ? "来源已确认" : "待确认"}</span></div><p className="mt-2 text-xs font-medium text-ink-2">{source.integration === "ready" ? "适配器已实现" : "数据待接入"} · {records.length ? `${records.length} 条已发布记录` : "暂无已发布数据"}</p><p className="mt-2 text-xs leading-relaxed text-ink-3">{source.coverage} · {source.frequency}</p><p className="mt-1 text-xs leading-relaxed text-ink-3">{source.note}</p>{latestObservation && <p className="mt-2 text-xs leading-6 text-ink-3">最新观测 / 研究日 {latestObservation}{latestAvailable && <><br />最近记录可用时间 {dateTime(latestAvailable)}（北京时间）</>}</p>}</div>;
    })}</div><p className="border-t border-line px-4 py-3 text-xs leading-relaxed text-ink-3">来源已确认不等于数据已更新。具体观测时间和出处以每条数据为准；采集{data.collection.enabled ? "已启用" : "未启用"}。 <Link to="/admin/markets" className="text-accent underline underline-offset-4">管理员：采集与发布市场数据 →</Link></p></Panel>
  </MarketShell>;
}
