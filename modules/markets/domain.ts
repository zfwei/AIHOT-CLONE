export type MarketId = "a-shares" | "us-stocks" | "us-treasury" | "global-bonds";
export type RiskFactor = "valuation" | "crowding" | "liquidity" | "speculation";
export type AssessmentState = "triggered" | "not_triggered" | "unknown" | "not_applicable";

export interface Instrument {
  id: string;
  name: string;
  market: MarketId;
  currency: string;
  kind: "index" | "stock" | "bond-yield";
  tenorYears?: number;
  country?: string;
}

export interface Quote {
  instrumentId: string;
  value: number;
  previousClose: number | null;
  asOf: string;
  publishedAt: string;
  /** When no release time is known, publishedAt is the first confirmed retrieval time. */
  availabilityBasis?: "published" | "retrieved";
  sourceName: string;
  sourceUrl: string;
  frequency: "daily" | "delayed";
  unit: "points" | "price" | "percent";
}

export interface RiskEvidence {
  id: string;
  market: MarketId;
  metric: string;
  value: number | null;
  unit: string;
  asOf: string;
  publishedAt: string;
  expiresAt: string;
  sourceName: string;
  sourceUrl: string;
}

export interface RiskRule {
  id: string;
  market: MarketId;
  factor: RiskFactor;
  metric: string;
  unit: string;
  operator: "gte" | "lte";
  threshold: number | null;
  version: string;
  enabled: boolean;
}

export interface PriceBar {
  instrumentId: string;
  date: string; // Exchange trading day, YYYY-MM-DD, not the retrieval day.
  close: number;
  publishedAt: string;
  availabilityBasis?: "published" | "retrieved";
  priceBasis?: "adjusted" | "unadjusted";
  sourceName: string;
  sourceUrl: string;
}

export interface TradeIdea {
  researchType?: "policy-scenario";
  sourceArticleId?: string;
  evidenceQuote?: string;
  id: string;
  market: MarketId;
  instrumentId: string;
  title: string;
  hypothesis: string;
  condition: string;
  invalidation: string;
  horizon: string | null;
  asOf: string;
  expiresAt: string;
  sourceName: string;
  sourceUrl: string;
}

export interface Snapshot {
  schemaVersion: 1;
  asOf: string;
  quotes: Quote[];
  evidence: RiskEvidence[];
  rules: RiskRule[];
  history: PriceBar[];
  ideas: TradeIdea[];
  /** Older published schemaVersion 1 snapshots predate the macro data adapters. */
  macro?: MacroObservation[];
}

export interface MacroObservation {
  id: string;
  sourceId: string;
  metric: string;
  label: string;
  value: number;
  unit: "percent" | "usd-million";
  frequency: "daily" | "weekly";
  asOf: string;
  publishedAt: string;
  availabilityBasis: "published" | "retrieved";
  sourceName: string;
  sourceUrl: string;
  sourceNotice?: string;
  sourceTermsUrl?: string;
}

export interface FactorAssessment {
  factor: RiskFactor;
  state: AssessmentState;
  reason: string;
  ruleId: string | null;
  ruleVersion: string | null;
  evidence: RiskEvidence[];
  validUntil: string | null;
}

export interface MarketAssessment {
  market: MarketId;
  asOf: string;
  factors: FactorAssessment[];
  evaluatedCount: number;
  unknownCount: number;
  triggeredCount: number;
  notApplicableCount: number;
}

export interface TrendObservation {
  state: "unknown" | "not_applicable" | "observed";
  signal: "cross_above" | "cross_below" | "above" | "below" | "equal" | null;
  reason: string;
  ruleVersion: "ma20-60-v1-unbacktested";
  asOf: string | null;
  ma20: number | null;
  ma60: number | null;
  sampleCount: number;
}

export interface Holding { instrumentId: string; quantity: number; averageCost: number }
export interface HoldingValue extends Holding {
  currency: string;
  marketValue: number | null;
  cost: number | null;
  unrealizedPnl: number | null;
  concentration: number | null; // Share of same-currency marked value, not total portfolio.
  reason: string | null;
}
export interface PortfolioAnalysis {
  holdings: HoldingValue[];
  currencies: Array<{ currency: string; marketValue: number; cost: number; unrealizedPnl: number; complete: boolean }>;
  reason: string | null;
}

export interface RiskBudgetInput {
  currency: string;
  capital: number | null;
  maxRiskPercent: number | null; // User-entered percent, e.g. 1 means 1%.
  entryPrice: number | null;
  stopPrice: number | null;
  lotSize: number | null;
}
export interface RiskBudget {
  state: "unknown" | "calculated";
  reason: string;
  currency: string;
  riskAmount: number | null;
  riskPerUnit: number | null;
  quantity: number | null;
  notional: number | null;
}
