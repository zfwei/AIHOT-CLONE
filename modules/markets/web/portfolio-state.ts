import type { Holding } from "../domain.ts";

export const PORTFOLIO_KEY = "markets:portfolio:v1";
export interface LocalHolding extends Holding { id: string }
export interface PortfolioFile { version: 1; holdings: LocalHolding[] }

/** Local data is untrusted too. A damaged file is never interpreted as an empty portfolio. */
export function parsePortfolio(raw: string | null): LocalHolding[] {
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1
    || !("holdings" in value) || !Array.isArray(value.holdings) || value.holdings.length > 200) throw new Error("持仓文件格式不正确");
  const ids = new Set<string>();
  return value.holdings.map((row: unknown) => {
    if (!row || typeof row !== "object") throw new Error("持仓记录格式不正确");
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id || r.id.length > 100 || ids.has(r.id)
      || typeof r.instrumentId !== "string" || !r.instrumentId || r.instrumentId.length > 120
      || typeof r.quantity !== "number" || !Number.isFinite(r.quantity) || r.quantity <= 0
      || typeof r.averageCost !== "number" || !Number.isFinite(r.averageCost) || r.averageCost < 0
      || !Number.isFinite(r.quantity * r.averageCost)) throw new Error("持仓记录包含无效字段");
    ids.add(r.id);
    return { id: r.id, instrumentId: r.instrumentId, quantity: r.quantity, averageCost: r.averageCost };
  });
}

export function portfolioJson(holdings: LocalHolding[]): string {
  return JSON.stringify({ version: 1, holdings } satisfies PortfolioFile, null, 2);
}
