import { useState } from "react";
import { Link, useLoaderData } from "react-router";
import { pageMeta } from "@aihot/web/lib/seo";
import { observeTrend } from "../analysis.ts";
import type { MarketId, TrendObservation } from "../domain.ts";
import { loadMarkets } from "./data.server.ts";
import { buttonClass, dateTime, Empty, MARKETS, MarketShell, number, Panel, SourceLink, Provenance, useEvaluationTime } from "./shared.tsx";

export const loader = loadMarkets;
export const handle = { tab: "markets", name: "交易推荐" };
export const meta = () => pageMeta({ title: "条件式交易推荐", description: "带出处的交易研究与本站政策情景推演，以及未回测的20/60观察值均线观察。", path: "/markets/trades" });
export const headers = () => ({ "Cache-Control": "no-store" });

const SIGNALS: Record<NonNullable<TrendObservation["signal"]>, string> = { cross_above: "20 点均线向上穿越 60 点均线", cross_below: "20 点均线向下穿越 60 点均线", above: "20 点均线在 60 点均线上方", below: "20 点均线在 60 点均线下方", equal: "两条均线相等" };

export default function Trades() {
  const { data, now: loadedAt } = useLoaderData<typeof loader>();
  const now = useEvaluationTime(loadedAt);
  const [market, setMarket] = useState<MarketId | "all">("all");
  const ideas = data.snapshot.ideas.filter((idea) => market === "all" || idea.market === market);
  const instruments = data.instruments.filter((i) => market === "all" || i.market === market);
  const observations = instruments.map((instrument) => ({ instrument, observation: observeTrend(instrument, data.snapshot.history, new Date(now)) }));
  return <MarketShell title="条件式交易推荐" description="带出处的交易研究与本站政策情景推演。来源证据、研究假设和验证条件分开展示。" asOf={data.snapshot.ideas.length || data.snapshot.history.length ? data.snapshot.asOf : undefined}>
    <div className="mb-5 rounded-card border border-line bg-surface p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-ink">日线观察，不提供盘中实时信号</p><p className="mt-1 text-sm leading-relaxed text-ink-3">20/60 观察值均线规则未回测、未校准交易日历，未计手续费、滑点与跳空。研究条件满足也不意味着价格必然按预期变化。</p></div><Link to="/markets/portfolio" className={buttonClass}>计算个人风险预算 →</Link></div></div>
    <div className="mb-5 flex flex-wrap gap-2" aria-label="交易研究市场筛选">{[{ id: "all", label: "全部市场" }, ...MARKETS].map((m) => <button type="button" key={m.id} aria-pressed={market === m.id} className={`${buttonClass} ${market === m.id ? "!border-accent !bg-accent-soft !text-accent" : ""}`} onClick={() => setMarket(m.id as MarketId | "all")}>{m.label}</button>)}</div>
    <Panel title="交易与政策情景研究" aside={`${ideas.length} 条有出处的研究`}>
      {!ideas.length ? <Empty title="尚无已发布的条件式研究" action={<><Link to={market === "all" ? "/all" : `/all?category=${market}`} className={buttonClass}>阅读市场动态 →</Link><Link to="/admin/markets" className={buttonClass}>管理员：发布核验后的研究 →</Link></>}>研究需要来源、日期、验证条件与失效条件。管理员可导入核验后的交易研究，或基于已发布精选生成政策情景研究。</Empty> : <div className="grid gap-4 p-4 xl:grid-cols-2">{ideas.map((idea) => {
        const expired = Date.parse(idea.expiresAt) <= Date.parse(now);
        const future = Date.parse(idea.asOf) > Date.parse(now);
        const instrument = data.instruments.find((i) => i.id === idea.instrumentId);
        const policy = idea.researchType === "policy-scenario";
        return <article key={idea.id} className="min-w-0 rounded-card border border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium text-accent">{MARKETS.find((m) => m.id === idea.market)?.label} · {instrument?.name ?? idea.instrumentId}</span><span className={`rounded-mark px-2 py-1 text-xs ${expired || future ? "bg-bg-sunk text-ink-3" : "bg-accent-soft text-accent"}`}>{expired ? policy ? "待重新复核" : "已过期 · 不再有效" : future ? "尚未到研究日期" : policy ? "情景待验证" : "条件观察中"}</span></div>
          <p className="mt-3 text-xs font-semibold text-ink-3">{policy ? "本站推演 · 政策情景研究（模型辅助）" : "有出处的交易研究"}</p>
          <h3 className="mt-2 text-lg font-semibold text-ink">{idea.title}</h3>
          {policy && <div className="mt-4 rounded-control bg-bg-sunk p-3 text-sm leading-relaxed text-ink-3"><p className="mb-2 text-xs font-semibold text-ink-2">已发布资料摘录</p><p className="mb-2 text-xs">摘录来自本站标题或摘要，事实请核对官方原文。</p>{idea.evidenceQuote && <blockquote className="border-l-2 border-line-strong pl-3">{idea.evidenceQuote}</blockquote>}<p className="mt-2 text-xs"><SourceLink url={idea.sourceUrl}>{idea.sourceName}</SourceLink>{idea.sourceArticleId && <> · <Link to={`/items/${encodeURIComponent(idea.sourceArticleId)}`} className="text-accent underline underline-offset-4">查看本站收录资料</Link></>}</p></div>}
          {policy && <h4 className="mt-4 text-xs font-semibold text-ink-2">本站情景假设</h4>}
          <p className="mt-2 text-sm leading-relaxed text-ink-3">{idea.hypothesis}</p>
          <dl className="mt-4 space-y-3"><div className="border-l-2 border-accent pl-3"><dt className="text-xs font-semibold text-ink-2">{policy ? "研究验证条件" : "入场条件 · 待自行核验"}</dt><dd className="mt-1 text-sm leading-relaxed text-ink-3">{idea.condition}</dd></div><div className="border-l-2 border-amber pl-3"><dt className="text-xs font-semibold text-ink-2">{policy ? "情景失效条件" : "失效条件"}</dt><dd className="mt-1 text-sm leading-relaxed text-ink-3">{idea.invalidation}</dd></div><div className="border-l-2 border-line-strong pl-3"><dt className="text-xs font-semibold text-ink-2">{policy ? "研究范围" : "执行风险"}</dt><dd className="mt-1 text-sm leading-relaxed text-ink-3">{policy ? "假设与验证条件由本站依据公开资料推演，未经行情与交易执行验证；不提供目标价、买卖点或执行推荐。请对照官方原文复核。" : <>日线数据可能滞后；跳空、滑点与流动性不足可能使实际损失超过计划止损。{instrument?.kind === "bond-yield" ? "收益率方向不能直接当作债券买卖方向。" : ""}</>}</dd></div></dl>
          <footer className="mt-4 border-t border-line pt-3 text-xs leading-6 text-ink-3"><p>{policy ? "本站政策情景推演" : <SourceLink url={idea.sourceUrl}>{idea.sourceName}</SourceLink>}{idea.horizon ? ` · 研究周期 ${idea.horizon}` : " · 研究周期未注明"}</p><p>研究日期 {dateTime(idea.asOf)}（北京时间）</p><p>{policy ? "下次复核最迟" : "有效至"} {dateTime(idea.expiresAt)}（北京时间）</p></footer>
        </article>;
      })}</div>}
    </Panel>
    <Panel title="20 / 60 观察值均线研究" aside="ma20-60-v1-unbacktested" className="mt-5"><p className="border-b border-line px-4 py-3 text-xs leading-relaxed text-ink-3">当前筛选：{observations.filter(({ observation }) => observation.state === "observed").length} 个标的可观察，{observations.filter(({ observation }) => observation.state === "unknown").length} 个缺少合格日线，{observations.filter(({ observation }) => observation.state === "not_applicable").length} 个不适用。每个价格标的至少需要 61 个有效观测值；个股均线使用复权收盘序列，持仓估值另用报价。 <Link to="/markets#market-sources" className="text-accent underline underline-offset-4">查看来源与数据更新状态 →</Link></p><div className="divide-y divide-line">{observations.map(({ instrument, observation }) => {
      const last = data.snapshot.history.filter((bar) => bar.instrumentId === instrument.id && bar.date === observation.asOf && Date.parse(bar.publishedAt) <= Date.parse(now)).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
      return <div key={instrument.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]"><div><h3 className="text-sm font-semibold text-ink">{instrument.name}</h3><p className="mono mt-1 text-xs text-ink-3">{instrument.id} · {observation.sampleCount} 个有效日线观测值</p>{last && <><p className="mt-2 text-xs text-ink-3">{instrument.kind === "index" ? "指数收盘点位" : last.priceBasis === "adjusted" ? "复权收盘价格 · 用于均线研究" : last.priceBasis === "unadjusted" ? "未复权收盘价格 · 不生成个股均线" : "复权口径未注明 · 不生成个股均线"}</p><Provenance record={{ ...last, asOf: last.date }} observationDate={last.date} /></>}</div><div><p className="text-sm font-medium text-ink-2">{observation.signal ? SIGNALS[observation.signal] : observation.state === "not_applicable" ? "不适用" : "未知 · 日线数据不足或失效"}</p>{observation.state === "observed" && <p className="mono mt-2 text-sm text-accent">MA20 {number(observation.ma20)} · MA60 {number(observation.ma60)} {instrument.kind === "index" ? "点" : instrument.currency}</p>}<p className="mt-2 text-xs leading-relaxed text-ink-3">{observation.reason}</p></div></div>;
    })}</div>{!instruments.length && <Empty title="暂无观察标的">请先配置需要观察的市场标的。</Empty>}</Panel>
    <p className="mt-4 text-xs leading-relaxed text-ink-3">这里只展示研究与情景计算，没有下单接口，也不自动执行交易。是否采取行动取决于你自行核验的条件和个人承受能力。</p>
  </MarketShell>;
}
