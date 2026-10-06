import type { LoaderFunctionArgs } from "react-router";
import { loadOr404 } from "@aihot/web/lib/api.server";
import type { Instrument, Snapshot } from "../domain.ts";
import type { SourceCandidate } from "../sources.ts";

export interface MarketData {
  snapshot: Snapshot;
  instruments: Instrument[];
  sources: SourceCandidate[];
  collection: { enabled: boolean; treasuryApproved: boolean };
}

export async function loadMarkets({ request }: LoaderFunctionArgs) {
  const data = await loadOr404<MarketData>("/api/v1/markets", { signal: request.signal });
  return { data, now: new Date().toISOString() };
}
