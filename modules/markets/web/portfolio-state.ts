import type { Holding, Instrument } from "../domain.ts";
import { INSTRUMENTS } from "../sources.ts";

export const PORTFOLIO_KEY = "markets:portfolio:v1";
export interface LocalStockInstrument extends Instrument { kind: "stock"; symbol: string }
export interface LocalHolding extends Holding { id: string; instrument?: LocalStockInstrument }
export interface PortfolioFile { version: 1; holdings: LocalHolding[] }

const STOCK_MARKETS = new Set(["a-shares", "hk-stocks", "kr-stocks", "jp-stocks", "us-stocks"]);
const CURRENCIES = new Set(["CNY", "HKD", "KRW", "JPY", "USD"]);

function parseInstrument(value: unknown, instrumentId: string): LocalStockInstrument {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("自定义股票信息不完整");
  const r = value as Record<string, unknown>;
  if (r.id !== instrumentId || INSTRUMENTS.some((item) => item.id === instrumentId)
    || r.kind !== "stock" || typeof r.market !== "string" || !STOCK_MARKETS.has(r.market)
    || typeof r.currency !== "string" || !CURRENCIES.has(r.currency)
    || typeof r.symbol !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(r.symbol.trim())
    || typeof r.name !== "string" || !r.name.trim() || r.name.trim().length > 100
    || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(r.name)
    || (r.country !== undefined && (typeof r.country !== "string" || !/^[A-Z]{2}$/.test(r.country)))
    || Object.keys(r).some((key) => !["id", "name", "market", "currency", "kind", "country", "symbol"].includes(key))) {
    throw new Error("自定义股票信息包含无效字段");
  }
  const symbol = r.symbol.trim().toUpperCase();
  if (instrumentId !== `local:${r.market}:${symbol.toLowerCase()}`) throw new Error("自定义股票代码与标识不一致");
  return { id: instrumentId, name: r.name.trim(), market: r.market as LocalStockInstrument["market"], currency: r.currency,
    kind: "stock", symbol, ...(r.country === undefined ? {} : { country: r.country as string }) };
}

export function createHoldingInstrument(input: { symbol: string; name: string; market: string; currency: string },
  catalog: Instrument[] = INSTRUMENTS): Instrument | LocalStockInstrument {
  const id = `local:${input.market}:${input.symbol.trim().toLowerCase()}`;
  const instrument = parseInstrument({ ...input, id, kind: "stock" }, id);
  const existing = catalog.find((item) => item.kind === "stock" && item.id.toLowerCase() === instrument.symbol.toLowerCase()
    && item.market === instrument.market && item.currency === instrument.currency);
  return existing ?? instrument;
}

function parseFile(value: unknown): LocalHolding[] {
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1
    || !("holdings" in value) || !Array.isArray(value.holdings) || value.holdings.length > 200) throw new Error("持仓文件格式不正确");
  const ids = new Set<string>();
  const instruments = new Map<string, string>();
  return value.holdings.map((row: unknown) => {
    if (!row || typeof row !== "object") throw new Error("持仓记录格式不正确");
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id || r.id.length > 100 || ids.has(r.id)
      || typeof r.instrumentId !== "string" || !r.instrumentId || r.instrumentId.length > 120
      || typeof r.quantity !== "number" || !Number.isFinite(r.quantity) || r.quantity <= 0
      || typeof r.averageCost !== "number" || !Number.isFinite(r.averageCost) || r.averageCost < 0
      || !Number.isFinite(r.quantity * r.averageCost)) throw new Error("持仓记录包含无效字段");
    ids.add(r.id);
    const instrument = r.instrument === undefined ? undefined : parseInstrument(r.instrument, r.instrumentId);
    if (instrument) {
      const metadata = JSON.stringify(instrument);
      const previous = instruments.get(instrument.id);
      if (previous !== undefined && previous !== metadata) throw new Error("同一股票的名称、市场或币种不一致");
      instruments.set(instrument.id, metadata);
    }
    return { id: r.id, instrumentId: r.instrumentId, quantity: r.quantity, averageCost: r.averageCost,
      ...(instrument ? { instrument } : {}) };
  });
}

/** Local data is untrusted too. A damaged file is never interpreted as an empty portfolio. */
export function parsePortfolio(raw: string | null): LocalHolding[] {
  return raw === null ? [] : parseFile(JSON.parse(raw));
}

export function portfolioJson(holdings: LocalHolding[]): string {
  return JSON.stringify({ version: 1, holdings: parseFile({ version: 1, holdings }) } satisfies PortfolioFile, null, 2);
}

export function portfolioInstruments(holdings: LocalHolding[], catalog: Instrument[] = INSTRUMENTS): Instrument[] {
  const result = [...catalog];
  const existing = new Set(catalog.map((item) => item.id));
  const added = new Set<string>();
  for (const { instrument } of parseFile({ version: 1, holdings })) {
    if (!instrument) continue;
    if (existing.has(instrument.id)) throw new Error("自定义股票不能覆盖已配置标的");
    if (!added.has(instrument.id)) {
      result.push(instrument);
      added.add(instrument.id);
    }
  }
  return result;
}
