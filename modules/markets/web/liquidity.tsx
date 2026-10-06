import type { MacroObservation } from "../domain.ts";
import { observeLiquidity } from "../liquidity.ts";
import { dateTime, Panel, quoteNumber, SourceLink } from "./shared.tsx";

function Record({ row }: { row: MacroObservation }) {
  return <div className="space-y-1 border-l-2 border-line pl-3 text-xs leading-relaxed text-ink-3">
    <p className="font-medium text-ink-2">{row.label} · {quoteNumber(row.value)} {row.unit === "percent" ? "%" : "百万美元"}</p>
    <p>观测日 {row.asOf.slice(0, 10)} · {row.frequency === "weekly" ? "周频" : "日频"}</p>
    <p>{row.availabilityBasis === "retrieved" ? "采集确认可用" : "发布"} {dateTime(row.publishedAt)}（北京时间）</p>
    <SourceLink url={row.sourceUrl}>{row.sourceName}</SourceLink>
    {row.sourceNotice && <p className="break-words">{row.sourceNotice}</p>}
    {row.sourceTermsUrl && <SourceLink url={row.sourceTermsUrl}>数据使用条款</SourceLink>}
  </div>;
}

export function LiquidityEvidence({ observations, now }: { observations: MacroObservation[]; now: string }) {
  const { spread, balances } = observeLiquidity(observations, new Date(now));
  const signed = (value: number) => `${value > 0 ? "+" : ""}${quoteNumber(value)}`;
  return <Panel title="流动性观测证据" aside="有依据的观测，风险结论仍需规则" className="mt-5">
    <div className="grid divide-y divide-line lg:grid-cols-3 lg:divide-y-0">
      <article className="min-w-0 p-4 lg:border-r lg:border-line">
        <h3 className="text-sm font-semibold text-ink">SOFR − EFFR 同日利差</h3>
        <p className="mono mt-3 text-2xl font-semibold text-ink">{spread.basisPoints === null ? "待配对" : <>{signed(spread.basisPoints)} <span className="text-sm font-normal">bp</span></>}</p>
        <p className="mt-2 text-xs leading-relaxed text-ink-3">{spread.reason}</p>
        {spread.asOf && <p className="mt-2 text-xs text-ink-3">同日观测 {spread.asOf}</p>}
        {spread.publishedAt && <p className="mt-1 text-xs text-ink-3">两项均可用 {dateTime(spread.publishedAt)}（北京时间）</p>}
        {!!spread.inputs.length && <details className="mt-2"><summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-accent">查看两个原始值与来源</summary><div className="space-y-4">{spread.inputs.map((row) => <Record key={row.id} row={row} />)}</div></details>}
      </article>
      {balances.map((balance) => <article key={balance.metric} className="min-w-0 p-4 lg:border-r lg:border-line">
        <h3 className="text-sm font-semibold text-ink">{balance.label} · 周三余额</h3>
        <p className="mono mt-3 text-2xl font-semibold text-ink">{balance.current ? quoteNumber(balance.current.value) : "待接入"}</p>
        <p className="mt-1 text-xs text-ink-3">百万美元{balance.current && ` · 观测日 ${balance.current.asOf.slice(0, 10)}`}</p>
        <p className="mono mt-3 text-sm text-ink-2">周变化 {balance.change === null ? "待取得可比前周" : `${signed(balance.change)} 百万美元`}</p>
        <p className="mt-2 text-xs leading-relaxed text-ink-3">{balance.reason}</p>
        {balance.current && <details className="mt-2"><summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-accent">查看余额、时点与来源</summary><div className="space-y-4"><Record row={balance.current} />{balance.previous && <Record row={balance.previous} />}</div></details>}
      </article>)}
    </div>
    <p className="border-t border-line px-4 py-3 text-xs leading-relaxed text-ink-3">以上仅展示已发布观测的算术关系，不代表四因子“已触发”或“未触发”。未设置风险阈值、历史分位阈值或风险分数；请按观测日期理解数据，不能据此推定当前市场安全。</p>
  </Panel>;
}
