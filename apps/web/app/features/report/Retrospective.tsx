import { Link } from "react-router";
import type { ReportRetrospective } from "@aihot/contracts/site";
import { beijingDate, beijingTime } from "@aihot/contracts/time";
import { SourceAvatar } from "../../components/ui/SourceAvatar";
import { KIND_LABEL } from "./format";

const at = (value: string) => `${beijingDate(value)} ${beijingTime(value)}`;

export function Retrospective({ data, embedded = false }: { data: ReportRetrospective; embedded?: boolean }) {
  const unit = data.kind === "daily" ? "日" : data.kind === "weekly" ? "周" : "月";
  const Heading = embedded ? "h2" : "h1";
  return (
    <section data-retrospective="true" className="@container pb-8 pt-5 lg:pt-0">
      <header className="border-b border-line-strong pb-6">
        <p className="text-[12px] font-medium tracking-wide text-accent">按原文日期 · {unit}度归档</p>
        <Heading id={embedded ? "retrospective-start" : "report-start"} className="mt-3 text-[30px] font-bold tracking-tight text-ink @[640px]:text-[40px]">历史精选回顾</Heading>
        <p className="mt-3 max-w-3xl text-[14px] leading-7 text-ink-2">
          首期{KIND_LABEL[data.kind]}尚未发布。以下根据当前已收录的精选事后汇总，并非在所述日期出刊的正式{KIND_LABEL[data.kind]}。
          仅覆盖已收录资料，不代表该时期的全部新闻。
        </p>
        <p className="mt-2 text-[12px] leading-6 text-ink-4">汇总截至 {at(data.asOf)}（北京时间） · 每组最多展示 {data.limitPerPeriod} 条</p>
      </header>
      {data.periods.map((period) => (
        <section key={period.key} aria-labelledby={`review-${period.key}`} className="pt-7">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-3">
            <h2 id={`review-${period.key}`} className="num text-[18px] font-bold text-ink">{period.key}</h2>
            <p className="text-[12px] text-ink-4">
              {period.startDate !== period.endDate && <span className="num">{period.startDate} 至 {period.endDate} · </span>}
              {period.items.length < period.total ? `展示 ${period.items.length} / ${period.total}` : `${period.total}`} 条精选
            </p>
          </div>
          <div className="grid @[700px]:grid-cols-2 @[700px]:gap-x-8">
            {period.items.map((item) => (
              <article key={item.itemId} className="flex min-w-0 flex-col border-b border-line py-5">
                <div className="flex items-center gap-2 text-[12px] text-ink-3">
                  <SourceAvatar name={item.sourceName} iconUrl={item.sourceIconUrl} iconSrcSet={item.sourceIconSrcSet} size={16} />
                  <span>{item.sourceName}</span>
                </div>
                <h3 className="mt-3 text-[18px] font-bold leading-7 text-ink [overflow-wrap:anywhere]">
                  <Link to={`/items/${item.itemId}`} prefetch="intent" className="transition-colors hover:text-accent">{item.title}</Link>
                </h3>
                {item.summary && <p className="mt-2 text-[14px] leading-7 text-ink-2 [overflow-wrap:anywhere]">{item.summary}</p>}
                <div className="mt-auto pt-3 text-[11px] leading-6 text-ink-4">
                  <p>原文发布 <time dateTime={item.publishedAt!}>{at(item.publishedAt!)}</time> · 北京时间</p>
                  <p>本站收录 <time dateTime={item.recordedAt}>{at(item.recordedAt)}</time></p>
                  <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-8 items-center text-[12px] text-ink-3 transition-colors hover:text-accent">阅读原文 ↗</a>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}
