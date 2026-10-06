import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { emptySnapshot, parseSnapshot } from "./validation.ts";

export type EquitySource = "akshare" | "yfinance";
const instruments: Record<EquitySource, string[]> = {
  akshare: ["cn-sse-composite", "cn-csi300", "600519.sh"],
  yfinance: ["us-sp500", "us-nasdaq100", "aapl", "msft", "nvda"],
};
const resultSchema = z.object({ quotes: z.array(z.unknown()), history: z.array(z.unknown()), errors: z.array(z.object({ instrumentId: z.string(), message: z.string() }).strict()) }).strict();

export function parseEquityResult(input: unknown, source: EquitySource, now = new Date()) {
  const result = resultSchema.parse(input);
  const snapshot = parseSnapshot({ ...emptySnapshot(), asOf: now.toISOString(), quotes: result.quotes, history: result.history }, now);
  const allowed = instruments[source];
  if ([...snapshot.quotes, ...snapshot.history, ...result.errors].some((row) => !allowed.includes(row.instrumentId))) throw new Error("Unexpected equity instrument");
  if (result.errors.some((error) => snapshot.quotes.some((quote) => quote.instrumentId === error.instrumentId))) throw new Error("Equity result cannot both succeed and fail");
  for (const quote of snapshot.quotes) {
    const history = snapshot.history.filter((bar) => bar.instrumentId === quote.instrumentId);
    if (!history.length || history.at(-1)?.date !== quote.asOf.slice(0, 10)) throw new Error("Equity quote and history dates disagree");
    if (quote.frequency !== "daily" || quote.availabilityBasis !== "retrieved") throw new Error("Equities require daily retrieved observations");
    if (history.some((bar, i) => (i > 0 && history[i - 1].date >= bar.date) || bar.availabilityBasis !== "retrieved" || bar.priceBasis !== (quote.unit === "price" ? "adjusted" : "unadjusted"))) throw new Error("Invalid equity history order or price basis");
  }
  if (snapshot.history.some((bar) => !snapshot.quotes.some((quote) => quote.instrumentId === bar.instrumentId))) throw new Error("Equity history requires its quote");
  if (!snapshot.quotes.length) throw new Error(`No ${source} data collected: ${result.errors.map((error) => `${error.instrumentId}: ${error.message}`).join("; ")}`);
  return { quotes: snapshot.quotes, history: snapshot.history, errors: result.errors, macro: [] };
}

export async function fetchEquities(source: EquitySource) {
  const env: NodeJS.ProcessEnv = { PYTHONUNBUFFERED: "1" };
  for (const key of ["PATH", "HOME", "LANG", "TZ", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY", "SSL_CERT_FILE", "MARKET_CACHE_DIR"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  const { stdout } = await promisify(execFile)(process.env.MARKET_PYTHON || "python3", [fileURLToPath(new URL("../python/collect_equities.py", import.meta.url)), "--source", source], { env, timeout: 240_000, maxBuffer: 1024 * 1024 });
  return parseEquityResult(JSON.parse(stdout), source);
}
