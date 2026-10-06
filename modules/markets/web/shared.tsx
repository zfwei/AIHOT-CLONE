import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useRevalidator } from "react-router";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import type { AssessmentState, MarketId, RiskFactor, Quote } from "../domain.ts";
import { DAILY_MAX_AGE_MS } from "../analysis.ts";
import { AutoRefresh } from "@aihot/web/components/ui/AutoRefresh";

export const MARKETS: Array<{ id: MarketId; label: string; short: string; category: string; note: string }> = [
  { id: "a-shares", label: "A 股", short: "CN EQUITY", category: "a-shares", note: "中国内地股票 · CNY" },
  { id: "hk-stocks", label: "港股", short: "HK EQUITY", category: "hk-stocks", note: "恒生指数 · HKD" },
  { id: "kr-stocks", label: "韩股", short: "KR EQUITY", category: "kr-stocks", note: "韩国综合指数 · KRW" },
  { id: "jp-stocks", label: "日股", short: "JP EQUITY", category: "jp-stocks", note: "日经225 · JPY" },
  { id: "us-stocks", label: "美股", short: "US EQUITY", category: "us-stocks", note: "美国股票 · USD" },
  { id: "us-treasury", label: "美债", short: "US TREASURY", category: "us-treasury", note: "美国国债 · 名义常期限收益率" },
  { id: "global-bonds", label: "全球国债", short: "SOVEREIGN", category: "global-bonds", note: "分国家观察 · 收益率不可混算" },
];
export const FACTORS: Record<RiskFactor, string> = { valuation: "估值", crowding: "拥挤度", liquidity: "流动性", speculation: "投机行为" };
const STATES: Record<AssessmentState, { label: string; style: string }> = {
  triggered: { label: "触发", style: "bg-hot-soft text-hot" },
  not_triggered: { label: "未触发", style: "bg-accent-soft text-accent-ink" },
  unknown: { label: "未知", style: "bg-bg-sunk text-ink-3" },
  not_applicable: { label: "不适用", style: "bg-surface-2 text-ink-3" },
};
export const inputClass = "min-h-11 w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-base text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
export const buttonClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-bg-sunk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";
export const primaryClass = `${buttonClass} !border-accent !bg-accent !text-accent-contrast hover:!bg-accent-ink`;

/** Keep validity labels honest when a reader leaves a research page open. This does not fetch quotes. */
export function useEvaluationTime(initial: string): string {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    setNow(new Date().toISOString());
    const timer = setInterval(() => setNow(new Date().toISOString()), 60_000);
    return () => clearInterval(timer);
  }, [initial]);
  return now;
}

export function number(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
/** Preserve the official observation's precision; curve estimates may have more decimals than prices. */
export function quoteNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 12 }) : "—";
}
export function signed(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${number(value, digits)}`;
}
export function dateTime(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "待接入";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
export function quoteChange(quote: Quote): string {
  if (quote.previousClose === null) return "前值待接入";
  if (quote.unit === "percent") return `${signed((quote.value - quote.previousClose) * 100)} bp`;
  return quote.previousClose === 0 ? "前值为零，无法计算涨跌幅" : `${signed((quote.value / quote.previousClose - 1) * 100)}%`;
}
export function quoteAge(quote: Quote, now: string): string {
  return Date.parse(now) - Date.parse(quote.asOf) >= DAILY_MAX_AGE_MS ? "历史数据 · 已超过估值有效期" : quote.frequency === "daily" ? "日频观测" : "延迟观测";
}
export function quoteObservedAt(quote: Quote): string {
  return quote.frequency === "daily" ? quote.asOf.slice(0, 10) : dateTime(quote.asOf);
}
export function Provenance({ record, observationDate }: { record: Pick<Quote, "sourceName" | "sourceUrl" | "asOf" | "publishedAt" | "availabilityBasis"> & Partial<Pick<Quote, "frequency">>; observationDate?: string }) {
  const observation = observationDate ?? (record.frequency === "daily" ? record.asOf.slice(0, 10) : dateTime(record.asOf));
  return <div className="mt-2 text-xs leading-5 text-ink-3"><SourceLink url={record.sourceUrl}>{record.sourceName}</SourceLink><p>{observationDate || record.frequency === "daily" ? "观测日" : "观测"} {observation}</p><p>{record.availabilityBasis === "retrieved" ? "采集确认可用" : "发布"} {dateTime(record.publishedAt)}（北京时间）</p></div>;
}
export function StateBadge({ state }: { state: AssessmentState }) {
  const s = STATES[state];
  return <span className={`inline-flex rounded-mark px-2 py-1 text-xs font-semibold ${s.style}`}>{s.label}</span>;
}
export function SourceLink({ url, children }: { url: string; children: ReactNode }) {
  let valid = false;
  try { valid = ["https:", "http:"].includes(new URL(url).protocol); } catch { /* An invalid source never becomes a clickable URL. */ }
  return valid ? <a href={url} target="_blank" rel="noopener noreferrer" className="break-words text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent">{children}<span className="sr-only">（新窗口）</span></a> : <span>{children}</span>;
}
export function Panel({ title, aside, children, className = "", id }: { title: string; aside?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={`min-w-0 rounded-card border border-line bg-surface ${className}`}><header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3"><h2 className="text-sm font-semibold text-ink">{title}</h2>{aside && <div className="text-xs text-ink-3">{aside}</div>}</header>{children}</section>;
}
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-5 py-7 text-center"><p className="text-sm font-semibold text-ink-2">{title}</p><p className="max-w-md text-sm leading-relaxed text-ink-3">{children}</p>{action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}</div>;
}
export function MarketShell({ title, description, asOf, children, privatePage = false }: { title: string; description: string; asOf?: string; children: ReactNode; privatePage?: boolean }) {
  const revalidator = useRevalidator();
  return <div className="pb-8">
    <PhoneBar title={title} back={{ to: "/more", label: "我的" }} />
    <header className="flex flex-wrap items-end justify-between gap-4 pb-5 pt-4 lg:pt-1">
      <div><p className="mono mb-1 text-xs tracking-widest text-accent">MARKET RESEARCH</p><h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-3">{description}</p></div>
      <div className="flex items-center gap-3"><div className="text-right text-xs leading-5 text-ink-3"><p>{privatePage ? "持仓仅保存在此浏览器" : "快照更新（北京时间）"}</p>{!privatePage && <p className="mono text-ink-2">{dateTime(asOf)}</p>}</div>{privatePage && <button type="button" className={buttonClass} disabled={revalidator.state !== "idle"} title="重新读取已发布的市场快照" onClick={() => revalidator.revalidate()}>{revalidator.state === "idle" ? "刷新快照" : "读取中…"}</button>}</div>
    </header>
    {!privatePage && <AutoRefresh />}
    <nav aria-label="市场研究" className="mb-5 flex gap-1 border-b border-line">
      {[{ to: "/markets", label: "市场总览" }, { to: "/markets/portfolio", label: "个人持仓" }, { to: "/markets/trades", label: "交易推荐" }].map((tab) => <NavLink key={tab.to} to={tab.to} end className={({ isActive }) => `min-h-11 border-b-2 px-3 py-3 text-sm font-medium transition-colors ${isActive ? "border-accent text-accent" : "border-transparent text-ink-3 hover:text-ink"}`}>{tab.label}</NavLink>)}
    </nav>
    {children}
  </div>;
}
