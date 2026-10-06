import type { MacroObservation } from "../domain.ts";
import { dateTime, Empty, Panel, quoteNumber, SourceLink } from "./shared.tsx";

export function MacroIndicators({ observations }: { observations: MacroObservation[] }) {
  const latest = new Map<string, MacroObservation>();
  for (const observation of observations) {
    const key = `${observation.sourceId}:${observation.metric}`;
    const previous = latest.get(key);
    if (!previous || observation.asOf > previous.asOf || (observation.asOf === previous.asOf && observation.publishedAt > previous.publishedAt)) latest.set(key, observation);
  }
  const notices = [...new Map([...latest.values()].filter((observation) => observation.sourceNotice || observation.sourceTermsUrl).map((observation) => [JSON.stringify([observation.sourceNotice ?? "", observation.sourceTermsUrl ?? ""]), observation])).entries()];
  return <Panel title="官方宏观指标" aside="日频利率 / 周频资产负债表" className="mt-5">
    {!latest.size ? <Empty title="尚无已发布的宏观观测">纽约联储参考利率与美联储资产负债表发布后，将在这里按各自频率展示。</Empty> : <div className="grid divide-y divide-line md:grid-cols-2 md:divide-y-0">{[...latest.values()].map((observation) => <article key={`${observation.sourceId}:${observation.metric}`} className="min-w-0 p-4 md:border-b md:border-r md:border-line">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-ink">{observation.label}</h3><span className="rounded-mark bg-bg-sunk px-2 py-1 text-xs text-ink-3">{observation.frequency === "weekly" ? "周频观测" : "日频观测"}</span></div>
      <p className="mono mt-3 break-words text-2xl font-semibold text-ink">{quoteNumber(observation.value)}<span className="ml-1 text-sm font-normal">{observation.unit === "percent" ? "%" : "百万美元"}</span></p>
      <p className="mt-2 text-xs leading-relaxed text-ink-3">{observation.unit === "percent" ? "已公布的参考利率，不是盘中实时融资报价。" : "美联储 H.4.1 周三余额，单位百万美元；不是周平均或每日新增。"}</p>
      <div className="mt-3 text-xs leading-6 text-ink-3"><p>观测日 {observation.asOf.slice(0, 10)}</p><p>{observation.availabilityBasis === "retrieved" ? "采集确认可用" : "发布"} {dateTime(observation.publishedAt)}（北京时间）</p><SourceLink url={observation.sourceUrl}>{observation.sourceName}</SourceLink></div>
    </article>)}</div>}
    <div className="space-y-2 border-t border-line px-4 py-3 text-xs leading-relaxed text-ink-3"><p>显示每个指标的最新已发布观测，日期以各行标注为准。宏观指标不直接等同于四因子风险判定或交易条件。</p>{notices.map(([key, observation]) => <div key={key}>{observation.sourceNotice && <p>{observation.sourceNotice}</p>}{observation.sourceTermsUrl && <SourceLink url={observation.sourceTermsUrl}>{observation.sourceName}数据使用条款</SourceLink>}</div>)}</div>
  </Panel>;
}
