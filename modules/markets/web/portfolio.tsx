import { useEffect, useState, type FormEvent } from "react";
import { Link, useLoaderData } from "react-router";
import { pageMeta } from "@aihot/web/lib/seo";
import { analyzePortfolio, calculateRiskBudget } from "../analysis.ts";
import type { RiskBudget, RiskBudgetInput } from "../domain.ts";
import { loadMarkets } from "./data.server.ts";
import { buttonClass, Empty, inputClass, MarketShell, number, Panel, primaryClass, Provenance, quoteAge, signed, useEvaluationTime } from "./shared.tsx";
import { parsePortfolio, portfolioJson, PORTFOLIO_KEY, type LocalHolding, createHoldingInstrument, portfolioInstruments } from "./portfolio-state.ts";

export const loader = loadMarkets;
export const handle = { tab: "markets", name: "个人持仓" };
export const meta = () => pageMeta({ title: "个人持仓", path: "/markets/portfolio", noindex: true });
export const headers = () => ({ "Cache-Control": "private, no-store" });

function BudgetCalculator() {
  const [result, setResult] = useState<RiskBudget | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const read = (name: string) => { const value = String(values.get(name) ?? "").trim(); return value === "" ? null : Number(value); };
    const input: RiskBudgetInput = { currency: String(values.get("currency") ?? "").trim().toUpperCase(), capital: read("capital"), maxRiskPercent: read("maxRiskPercent"), entryPrice: read("entryPrice"), stopPrice: read("stopPrice"), lotSize: read("lotSize") };
    setResult(calculateRiskBudget(input));
  };
  return <Panel title="单笔风险预算" aside="用户自填 · 仅在浏览器计算">
    <form onSubmit={submit} onChange={() => setResult(null)} className="p-4">
      <p className="mb-4 text-sm leading-relaxed text-ink-3">填写你自己的同币种资金和止损情景，按现金与风险上限两者中更低的一项计算数量。字段均为空，不替你预设风险偏好。</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <label className="text-sm text-ink-2">币种<select name="currency" defaultValue="" required className={`${inputClass} mt-1`}><option value="" disabled>请选择币种</option>{["CNY", "USD", "HKD", "KRW", "EUR", "JPY", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></label>
        {([{ name: "capital", label: "可用资金", min: "0.01", step: "any" }, { name: "maxRiskPercent", label: "单笔风险上限（%）", min: "0.001", step: "any", max: "100" }, { name: "entryPrice", label: "计划入场价", min: "0.000001", step: "any" }, { name: "stopPrice", label: "计划止损价", min: "0", step: "any" }, { name: "lotSize", label: "每手 / 最小交易数量", min: "1", step: "1" }] as const).map((field) => <label key={field.name} className="text-sm text-ink-2">{field.label}<input name={field.name} type="number" inputMode="decimal" required min={field.min} step={field.step} max={"max" in field ? field.max : undefined} className={`${inputClass} mt-1`} /></label>)}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3"><button type="submit" className={primaryClass}>计算风险预算</button><span className="text-xs text-ink-3">入场价须高于止损价；仅多头现金情景</span></div>
      <div aria-live="polite" className="mt-4">{result ? <div className={`rounded-control border p-4 ${result.state === "calculated" ? "border-accent/30 bg-accent-softer" : "border-amber/30 bg-amber-soft"}`}>
        {result.state === "calculated" && <dl className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-4">{[{ label: "计划风险上限", value: `${number(result.riskAmount)} ${result.currency}` }, { label: "每单位止损距离", value: `${number(result.riskPerUnit)} ${result.currency}` }, { label: "预算可容纳数量", value: number(result.quantity, 0) }, { label: "计划投入", value: `${number(result.notional)} ${result.currency}` }].map((item) => <div key={item.label}><dt className="text-xs text-ink-3">{item.label}</dt><dd className="mono mt-1 break-words text-sm font-semibold text-ink">{item.value}</dd></div>)}</dl>}
        <p className="text-sm leading-relaxed text-ink-2">{result.reason}</p>{result.state === "calculated" && result.quantity === 0 && <p className="mt-2 text-sm font-medium text-ink-2">当前预算不足以容纳一个最小交易单位。</p>}
      </div> : <p className="text-sm text-ink-3">需要填写全部参数后才能计算；缺失输入不会按零风险处理。</p>}</div>
    </form>
  </Panel>;
}

export default function Portfolio() {
  const { data, now: loadedAt } = useLoaderData<typeof loader>();
  const now = useEvaluationTime(loadedAt);
  const [holdings, setHoldings] = useState<LocalHolding[]>([]);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [clearPending, setClearPending] = useState(false);
  const [undo, setUndo] = useState<LocalHolding[] | null>(null);
  const [entryMode, setEntryMode] = useState<"manual" | "catalog">("manual");
  const [holdingMarket, setHoldingMarket] = useState("");
  const [holdingCurrency, setHoldingCurrency] = useState("");
  const instruments = portfolioInstruments(holdings, data.instruments);
  const stocks = instruments.filter((instrument) => instrument.kind === "stock");
  useEffect(() => {
    const read = () => {
      try { setHoldings(parsePortfolio(localStorage.getItem(PORTFOLIO_KEY))); setStorageError(false); }
      catch { setStorageError(true); setMessage("无法读取本地持仓。浏览器可能禁止存储，或已有文件损坏；未覆盖已有数据。"); }
      setReady(true);
    };
    read();
    const sync = (event: StorageEvent) => { if (event.key === PORTFOLIO_KEY || event.key === null) { read(); setUndo(null); } };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const save = (next: LocalHolding[], notice: string) => {
    try {
      localStorage.setItem(PORTFOLIO_KEY, portfolioJson(next));
      setHoldings(next); setMessage(notice); setStorageError(false); return true;
    } catch { setMessage("浏览器未允许保存或存储空间不足，本次更改尚未保存。"); return false; }
  };
  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    let instrumentId = String(fields.get("instrumentId") ?? "");
    let instrument: LocalHolding["instrument"];
    try {
      if (entryMode === "manual") {
        const selected = createHoldingInstrument({ symbol: String(fields.get("symbol") ?? ""), name: String(fields.get("stockName") ?? ""), market: holdingMarket, currency: holdingCurrency }, data.instruments);
        instrumentId = selected.id;
        if ("symbol" in selected) instrument = selected;
      } else {
        if (!stocks.some((stock) => stock.id === instrumentId)) throw new Error("请选择已有股票。");
        instrument = holdings.find((holding) => holding.instrumentId === instrumentId)?.instrument;
      }
    } catch (error) { return setMessage(error instanceof Error ? error.message : "请检查股票信息。"); }
    const quantityText = String(fields.get("quantity") ?? "").trim();
    const costText = String(fields.get("averageCost") ?? "").trim();
    const quantity = Number(quantityText), averageCost = Number(costText);
    if (!quantityText || !costText || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(averageCost) || averageCost < 0 || !Number.isFinite(quantity * averageCost)) return setMessage("请填写大于零的数量及非负成本。");
    if (holdings.length >= 200) return setMessage("最多保存 200 笔持仓，请先合并或删除旧记录。");
    try {
      const next = [...holdings, { id: crypto.randomUUID(), instrumentId, quantity, averageCost, ...(instrument ? { instrument } : {}) }];
      portfolioInstruments(next, data.instruments);
      if (save(next, "已保存到此浏览器，没有上传持仓。")) { form.reset(); setHoldingMarket(""); setHoldingCurrency(""); setUndo(null); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "请检查股票信息。"); }
  };
  const exportFile = () => {
    const href = URL.createObjectURL(new Blob([portfolioJson(holdings)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = href; link.download = "portfolio.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    setMessage("持仓文件已导出；文件包含你填写的数量和成本，请自行保管。");
  };
  const analysis = analyzePortfolio(holdings, instruments, data.snapshot.quotes, new Date(now));
  return <MarketShell title="个人持仓" description="用公开行情核对个人敞口。数量与成本只由你填写，保存、计算和导出均在此浏览器完成。" privatePage>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3"><p className="text-sm text-ink-3">仅本机保存 · 无账号同步 · 清理浏览器数据会删除持仓</p><div className="flex flex-wrap gap-2"><button type="button" onClick={exportFile} disabled={!ready || !holdings.length || storageError} className={buttonClass}>导出 JSON</button><button type="button" onClick={() => setClearPending(true)} disabled={!ready || !holdings.length || storageError} className={buttonClass}>清空持仓</button></div></div>
    {clearPending && <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-card border border-amber/30 bg-amber-soft p-4"><p className="text-sm text-ink-2">清空此浏览器中的全部 {holdings.length} 笔持仓？建议先导出。</p><div className="flex gap-2"><button type="button" className={buttonClass} onClick={() => setClearPending(false)}>取消</button><button type="button" className={buttonClass} onClick={() => { const previous = holdings; if (save([], "已清空本地持仓，可撤销。")) { setUndo(previous); setClearPending(false); } }}>确认清空</button></div></div>}
    <div role="status" aria-live="polite" className="mb-4 text-sm text-ink-2">{message}{undo && <button type="button" className="ml-3 min-h-11 px-2 text-accent underline" onClick={() => { if (save(undo, "已恢复上次删除的持仓。")) setUndo(null); }}>撤销删除</button>}</div>
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{analysis.currencies.map((group) => <div key={group.currency} className="rounded-card border border-line bg-surface p-4"><p className="text-sm font-semibold text-ink">{group.currency === "UNKNOWN" ? "币种未知" : group.currency} · 独立小计</p><p className="mono mt-3 text-2xl font-semibold text-ink">{group.complete ? number(group.marketValue) : "估值待补齐"}</p><p className="mt-2 text-xs text-ink-3">{group.complete ? `未实现盈亏 ${signed(group.unrealizedPnl)} ${group.currency}` : "缺少有效价格，不展示完整盈亏与集中度"}</p><p className="mono mt-1 text-xs text-ink-3">已填成本 {number(group.cost)} {group.currency === "UNKNOWN" ? "（币种待确认）" : group.currency}</p></div>)}</div>
    {analysis.reason && <p className="mb-5 rounded-control bg-bg-sunk p-3 text-sm leading-relaxed text-ink-3">{analysis.reason}</p>}
    {!!holdings.length && analysis.holdings.some((holding) => holding.marketValue === null) && <p className="mb-5 rounded-control border border-line p-3 text-sm leading-relaxed text-ink-3">部分持仓尚不能估值，具体原因见各笔明细。数量和成本仍可保存；市值、盈亏需有效的同币种股票价格。 <Link to="/markets#market-sources" className="text-accent underline underline-offset-4">查看价格来源与更新状态 →</Link></p>}
    <div className="mb-5 grid items-start gap-5 xl:grid-cols-[1.5fr_1fr]">
      <Panel title="持仓明细" aside={`${holdings.length} 笔 · 仅股票价格口径`}>
        {!ready ? <Empty title="正在读取本地持仓">公开市场数据已加载，持仓读取只在此浏览器内进行。</Empty> : !holdings.length ? <Empty title={storageError ? "本地数据暂时无法读取" : "尚未添加个人持仓"} action={!storageError && <a href="#holding-form" className={buttonClass}>填写我的持仓 →</a>}>{storageError ? "已有数据未被覆盖。请检查浏览器的存储权限。" : "填写股票代码、名称、数量和平均成本即可保存，也可选择已有标的。没有行情的股票同样可以记录。"}</Empty> : <div className="divide-y divide-line">{analysis.holdings.map((holding, index) => {
          const local = holdings[index]!;
          const instrument = instruments.find((i) => i.id === holding.instrumentId);
          const quote = data.snapshot.quotes.find((q) => q.instrumentId === holding.instrumentId);
          return <div key={local.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-ink">{instrument?.name ?? holding.instrumentId}</h3><p className="mono mt-1 text-xs text-ink-3">{local.instrument?.symbol ?? holding.instrumentId} · {holding.currency}{local.instrument && " · 手动录入"}</p></div><button type="button" className={`${buttonClass} !text-xs`} aria-label={`删除 ${instrument?.name ?? holding.instrumentId} 第 ${index + 1} 笔持仓`} onClick={() => { const previous = holdings; if (save(holdings.filter((h) => h.id !== local.id), "已删除该笔持仓，可撤销。")) setUndo(previous); }}>删除</button></div><dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{[{ label: "数量", value: number(holding.quantity, 4) }, { label: "平均成本", value: number(holding.averageCost) }, { label: "市值", value: number(holding.marketValue) }, { label: "未实现盈亏", value: signed(holding.unrealizedPnl) }].map((item) => <div key={item.label}><dt className="text-xs text-ink-3">{item.label}</dt><dd className="mono mt-1 break-words text-sm text-ink-2">{item.value}</dd></div>)}</dl>{quote && <><Provenance record={quote} /><p className="mt-1 text-xs text-ink-3">{quoteAge(quote, now)}</p></>}{holding.concentration !== null ? <div className="mt-4"><div className="mb-1 flex flex-wrap justify-between gap-1 text-xs text-ink-3"><span>该证券占同币种持仓</span><span className="mono">{number(holding.concentration * 100)}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-bg-sunk"><div className="h-full bg-accent" style={{ width: `${Math.min(100, holding.concentration * 100)}%` }} /></div></div> : <p className="mt-3 text-xs leading-relaxed text-ink-3">{local.instrument && !quote ? "暂无行情；已保存数量与成本，市值、盈亏与集中度待接入价格后计算。" : holding.reason ?? "该币种部分价格缺失，集中度未知。"}</p>}</div>;
        })}</div>}
      </Panel>
      <Panel title="添加持仓" aside="手动录入或选择已有标的">
        <form id="holding-form" onSubmit={add} className="space-y-4 p-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="持仓录入方式">{([{ value: "manual", label: "手动输入" }, { value: "catalog", label: "选择已有标的" }] as const).map((mode) => <button key={mode.value} type="button" aria-pressed={entryMode === mode.value} onClick={() => { setEntryMode(mode.value); setMessage(""); }} className={entryMode === mode.value ? primaryClass : buttonClass}>{mode.label}</button>)}</div>
          {entryMode === "manual" ? <>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm text-ink-2">股票市场<select name="market" required value={holdingMarket} onChange={(event) => { setHoldingMarket(event.target.value); setHoldingCurrency(({ "a-shares": "CNY", "hk-stocks": "HKD", "kr-stocks": "KRW", "jp-stocks": "JPY", "us-stocks": "USD" } as Record<string, string>)[event.target.value] ?? ""); }} className={`${inputClass} mt-1`}><option value="" disabled>选择市场</option><option value="a-shares">A 股</option><option value="hk-stocks">港股</option><option value="kr-stocks">韩股</option><option value="jp-stocks">日股</option><option value="us-stocks">美股</option></select></label>
              <label className="block text-sm text-ink-2">持仓币种<select name="holdingCurrency" required value={holdingCurrency} onChange={(event) => setHoldingCurrency(event.target.value)} className={`${inputClass} mt-1`}><option value="" disabled>选择币种</option>{["CNY", "HKD", "KRW", "JPY", "USD"].map((currency) => <option key={currency}>{currency}</option>)}</select></label>
            </div>
            <label className="block text-sm text-ink-2">股票代码<input name="symbol" type="text" maxLength={40} required autoCapitalize="characters" spellCheck={false} placeholder="例如 00700、AAPL、600519.SH" className={`${inputClass} mt-1`} /></label>
            <label className="block text-sm text-ink-2">股票名称<input name="stockName" type="text" maxLength={100} required placeholder="填写便于识别的名称" className={`${inputClass} mt-1`} /></label>
          </> : <label className="block text-sm text-ink-2">股票标的<select name="instrumentId" required defaultValue="" className={`${inputClass} mt-1`}><option value="" disabled>选择股票</option>{stocks.map((stock) => <option key={stock.id} value={stock.id}>{stock.name} · {stock.currency}</option>)}</select></label>}
          <label className="block text-sm text-ink-2">持有数量<input name="quantity" type="number" inputMode="decimal" min="0.000001" step="any" required className={`${inputClass} mt-1`} /></label>
          <label className="block text-sm text-ink-2">平均每股成本（持仓币种）<input name="averageCost" type="number" inputMode="decimal" min="0" step="any" required className={`${inputClass} mt-1`} /></label>
          <p className="text-xs leading-relaxed text-ink-3">支持现金多头股票持仓。未接入行情也可保存数量与成本；指数点位和国债收益率不能用于股票持仓估值。</p>
          <button type="submit" className={`${primaryClass} w-full`} disabled={!ready || storageError}>保存到此浏览器</button>
          {message && <p className="text-sm leading-relaxed text-ink-2">{message}</p>}
        </form>
      </Panel>
    </div>
    <BudgetCalculator />
  </MarketShell>;
}
