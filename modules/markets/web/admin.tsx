import { useState } from "react";
import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { SITE } from "@aihot/site";
import { adminGet } from "@aihot/web/lib/admin.server";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { AdminPage } from "@aihot/web/features/admin/ui";
import type { Snapshot } from "../domain.ts";
import type { MarketData } from "./data.server.ts";
import { buttonClass, dateTime, inputClass, Panel, primaryClass, SourceLink } from "./shared.tsx";

export async function loader({ request }: LoaderFunctionArgs) {
  return adminGet<MarketData>(request, "/api/admin/markets");
}
export const meta = () => [{ title: `市场数据 · ${SITE.name} 后台` }];
export const headers = () => ({ "Cache-Control": "private, no-store" });

export default function MarketAdmin() {
  const data = useLoaderData<typeof loader>();
  const { run, pending, busy } = useAdminAction();
  const [draft, setDraft] = useState(() => JSON.stringify(data.snapshot, null, 2));
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [source, setSource] = useState("treasury");
  const [researchNotice, setResearchNotice] = useState("");
  const review = () => {
    setPreview(null); setError(""); setNotice("");
    if (new TextEncoder().encode(draft).byteLength > 1024 * 1024) return setError("JSON 文件超过 1 MB，请缩小本次导入。");
    try {
      const value: unknown = JSON.parse(draft);
      if (!value || typeof value !== "object") throw new Error("请输入快照对象。");
      const s = value as Record<string, unknown>;
      if (s.schemaVersion !== 1 || typeof s.asOf !== "string" || !Number.isFinite(Date.parse(s.asOf))
        || !["quotes", "evidence", "rules", "history", "ideas"].every((key) => Array.isArray(s[key]))) throw new Error("需要 schemaVersion:1、有效 asOf，以及 quotes/evidence/rules/history/ideas 数组。");
      setPreview(value as Snapshot);
    } catch (e) { setError(e instanceof SyntaxError ? "JSON 语法不正确，请检查引号、逗号与括号。" : e instanceof Error ? e.message : "无法读取快照。"); }
  };
  const publish = async () => {
    if (!preview || !reason.trim()) return setError("发布前请填写核验与更新原因。");
    setError("");
    const result = await run("POST", "/api/admin/markets/snapshot", { snapshot: preview, reason: reason.trim() }, { success: "市场快照已发布", label: "market-snapshot" });
    if (result) { setPreview(null); setNotice("已发布。本次快照替换旧快照，公开页面刷新后可读取。"); }
  };
  const collect = async () => {
    if (!reason.trim()) return setError("采集前请填写本次操作原因。");
    const result = await run("POST", "/api/admin/markets/collect", { reason: reason.trim(), source }, { success: "市场数据采集任务已提交", label: "market-collect" });
    if (result) setNotice("采集任务已提交，尚不代表采集成功。请在运行记录查看完成状态，再到公开页面核对观测日期与原始来源。");
  };
  const research = async () => {
    if (!reason.trim()) return setError("生成研究前请填写本次操作原因。");
    setError(""); setResearchNotice("");
    const result = await run<{ queued: boolean }>("POST", "/api/admin/markets/research", { reason: reason.trim() }, { success: "政策情景研究任务已提交", label: "market-research" });
    if (result?.queued) setResearchNotice("研究任务已入队，尚未生成或发布。请在运行记录核对完成状态，再刷新研究页查看资料摘录与本站推演。");
  };
  const hasData = data.snapshot.quotes.length + data.snapshot.evidence.length + data.snapshot.history.length + data.snapshot.ideas.length + (data.snapshot.macro?.length ?? 0) > 0;
  return <AdminPage title="市场数据" subtitle="管理公开研究快照与来源状态。个人持仓保存在读者浏览器中，不进入此后台。" actions={<Link to="/markets" className={buttonClass}>打开市场总览 →</Link>}>
    <div className="mb-5 grid gap-3 sm:grid-cols-3">{[{ label: "最新快照", value: hasData ? dateTime(data.snapshot.asOf) : "尚未发布" }, { label: "有效接入方式", value: "已核验 JSON / 宏观与行情日线" }, { label: "采集安全阀", value: data.collection.enabled ? "已启用" : "已关闭" }].map((item) => <div key={item.label} className="rounded-card border border-line bg-surface p-4"><p className="text-xs text-ink-3">{item.label}</p><p className="mt-2 text-sm font-semibold text-ink">{item.value}</p></div>)}</div>
    <Panel title="导入已核验快照" aside="替换当前公开快照">
      <div className="space-y-4 p-4"><p className="text-sm leading-relaxed text-ink-3">所有数值都需要原始来源、观测时间与可用时间。请先预览条数，再发布；后端会校验证券、单位、时序和证据字段。不在这里输入个人数量、成本或密钥。</p>
        <label className="block text-sm text-ink-2">读取本地 JSON 文件<input type="file" accept="application/json,.json" className="mt-2 block w-full min-w-0 text-sm text-ink-3 file:mr-3 file:min-h-11 file:rounded-control file:border file:border-line-strong file:bg-surface file:px-3 file:text-ink-2" onChange={async (e) => {
          const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
          if (file.size > 1024 * 1024) return setError("文件超过 1 MB，请缩小本次导入。");
          try { setDraft(await file.text()); setPreview(null); setError(""); } catch { setError("无法读取此文件。"); }
        }} /></label>
        <label className="block text-sm text-ink-2">快照 JSON<textarea value={draft} onChange={(e) => { setDraft(e.target.value); setPreview(null); }} spellCheck={false} rows={18} className={`${inputClass} mono mt-2 !text-xs leading-relaxed`} /></label>
        <label className="block text-sm text-ink-2">核验与更新原因<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required className={`${inputClass} mt-2`} placeholder="写明核验了哪些原始来源及本次改动" /></label>
        {error && <p role="alert" className="rounded-control bg-hot-soft p-3 text-sm text-hot">{error}</p>}
        {notice && <p role="status" className="rounded-control bg-accent-soft p-3 text-sm text-accent-ink">{notice}</p>}
        <div className="flex flex-wrap gap-2"><button type="button" onClick={review} disabled={busy} className={buttonClass}>检查格式并预览</button><button type="button" onClick={() => { setDraft(JSON.stringify(data.snapshot, null, 2)); setPreview(null); }} disabled={busy} className={buttonClass}>载入当前快照</button></div>
        {preview && <div className="rounded-card border border-accent/30 bg-accent-softer p-4"><p className="text-sm font-semibold text-ink">准备发布 · {dateTime(preview.asOf)}</p><dl className="my-4 grid grid-cols-2 gap-3 sm:grid-cols-6">{[{ label: "行情", count: preview.quotes.length }, { label: "风险证据", count: preview.evidence.length }, { label: "判定规则", count: preview.rules.length }, { label: "日线记录", count: preview.history.length }, { label: "交易研究", count: preview.ideas.length }, { label: "宏观观测", count: preview.macro?.length ?? 0 }].map((item) => <div key={item.label}><dt className="text-xs text-ink-3">{item.label}</dt><dd className="mono mt-1 text-lg font-semibold text-ink">{item.count}</dd></div>)}</dl><p className="mb-3 text-xs leading-relaxed text-ink-3">这是完整替换。没有出现在新快照中的旧行情、宏观观测、证据、规则与研究将不再公开显示；应先确认所需记录已包含。格式通过不代表来源真实性已自动核验。</p><button type="button" onClick={publish} disabled={busy || !reason.trim()} className={primaryClass}>{busy ? "发布中…" : "发布已核验快照"}</button></div>}
      </div>
    </Panel>
    <Panel title="市场数据采集" className="mt-5" aside="免费股票日线 / 国债曲线 / 宏观数据"><div className="space-y-3 p-4">
      <p className="text-sm leading-relaxed text-ink-3">读取股票与指数日线、官方国债收益率、参考利率和央行周频余额。观测日与本次确认可用时间分别保存；免费行情以已完成日线为准，参考利率不是实时融资报价。</p>
      <label className="block max-w-md text-sm text-ink-2">采集来源<select value={source} onChange={(e) => setSource(e.target.value)} className={`${inputClass} mt-1`}><option value="treasury">美国财政部 · 2 / 5 / 10 / 30 年</option><option value="japan-mof">日本财务省 · 10 年</option><option value="ecb">欧洲央行 · AAA 10 年即期曲线（仅宏观）</option><option value="nyfed">纽约联储 · SOFR / EFFR 参考利率</option><option value="fed">美联储 · H.4.1 周频余额</option><option value="akshare">AKShare · A股与指数免费日线</option><option value="yfinance">yfinance · 美股、港股、韩股与日股指数日线</option></select></label>
      <button type="button" onClick={collect} disabled={busy || !data.collection.enabled || !data.sources.some((s) => s.id === source && s.status === "approved" && s.integration === "ready") || !reason.trim()} className={buttonClass}>{busy ? "处理中…" : "采集一次并发布"}</button>
      <p className="text-xs text-ink-3">{!data.collection.enabled ? "采集阀已关闭；部署时启用后可操作。" : !reason.trim() ? "请先在上方填写操作原因。" : "会请求所选来源的数据，并记录操作审计。"}</p>
    </div></Panel>
    <Panel title="生成政策情景研究" className="mt-5" aside="仅基于已发布精选"><div className="space-y-3 p-4">
      <p className="text-sm leading-relaxed text-ink-3">模型引用已发布资料摘录，基于已发布精选生成本站的政策情景假设、研究验证条件与复核日期。摘录来自本站标题或摘要，事实请核对官方原文。无行情时只做政策条件推演，不生成目标价、买卖点或执行推荐。</p>
      <p className="text-xs leading-relaxed text-ink-3">这项任务使用已配置的模型，需要模型调用开关已启用，并受预算限制。模型调用未开启时，后台会拒绝提交并说明原因。</p>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={research} disabled={busy || !reason.trim()} className={buttonClass}>{pending === "market-research" ? "提交中…" : "生成政策情景研究"}</button><Link to="/admin/runs" className={buttonClass}>查看运行记录 →</Link><Link to="/markets/trades" className={buttonClass}>打开研究页 →</Link></div>
      {!reason.trim() && <p className="text-xs text-ink-3">请先在上方填写本次操作原因。</p>}
      {researchNotice && <p role="status" className="rounded-control bg-accent-soft p-3 text-sm text-accent-ink">{researchNotice}</p>}
    </div></Panel>
    <Panel title="来源目录" className="mt-5"><div className="divide-y divide-line">{data.sources.map((source) => <div key={source.id} className="p-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-semibold"><SourceLink url={source.url}>{source.name}</SourceLink></h3><span className="text-xs text-ink-3">{source.status === "approved" ? "来源已确认" : "待确认"} · {source.integration === "ready" ? "适配器已实现" : "数据待接入"}</span></div><p className="mt-2 text-sm text-ink-3">{source.coverage} · {source.frequency}</p><p className="mt-1 text-xs leading-relaxed text-ink-3">{source.access}。{source.note}</p></div>)}</div></Panel>
  </AdminPage>;
}
