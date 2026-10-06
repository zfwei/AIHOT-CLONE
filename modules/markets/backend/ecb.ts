import type { PriceBar, Quote } from "../domain.ts";

const SERIES = "B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y";

export function ecbFeedUrl(observations = 5): string {
  if (!Number.isInteger(observations) || observations < 1 || observations > 1000) throw new Error("Invalid ECB observation count");
  return `https://data-api.ecb.europa.eu/service/data/YC/${SERIES}?format=csvdata&lastNObservations=${observations}`;
}

function csvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closed = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === "," || char === "\n" || char === "\r") {
      row.push(field); field = ""; closed = false;
      if (char !== ",") {
        if (row.some((value) => value !== "")) rows.push(row);
        row = [];
        if (char === "\r" && input[i + 1] === "\n") i++;
      }
    } else if (char === '"' && !field && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error("Invalid ECB CSV quoting");
      field += char;
    }
  }
  if (quoted) throw new Error("Unclosed ECB CSV field");
  row.push(field);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

/** ECB's modelled AAA spot curve is macro information, not a tradable bond price. */
export function parseEcbCsv(csv: string, retrievedAt = new Date()): { quotes: Quote[]; history: PriceBar[] } {
  if (!Number.isFinite(retrievedAt.getTime())) throw new Error("Invalid ECB retrieval time");
  if (Buffer.byteLength(csv) > 4 * 1024 * 1024) throw new Error("ECB CSV exceeds 4 MB");
  const [header, ...rows] = csvRows(csv.replace(/^\uFEFF/, ""));
  const dimensions: Record<string, string> = { FREQ: "B", REF_AREA: "U2", CURRENCY: "EUR", PROVIDER_FM: "4F", INSTRUMENT_FM: "G_N_A", PROVIDER_FM_ID: "SV_C_YM", DATA_TYPE_FM: "SR_10Y", UNIT: "PCPA", UNIT_MULT: "0" };
  const required = ["KEY", "TIME_PERIOD", "OBS_VALUE", ...Object.keys(dimensions)];
  if (!header || new Set(header).size !== header.length || required.some((name) => !header.includes(name))) throw new Error("Invalid ECB CSV header");
  const values = new Map<string, number>();
  for (const cells of rows) {
    if (cells.length !== header.length) throw new Error("Invalid ECB CSV row");
    const entry = Object.fromEntries(header.map((name, index) => [name, cells[index]!.trim()]));
    if (entry.KEY !== `YC.${SERIES}`) throw new Error("Unexpected ECB series key");
    if (Object.entries(dimensions).some(([name, value]) => entry[name] !== value)) throw new Error("Unexpected ECB series dimensions or units");
    const date = entry.TIME_PERIOD!;
    const time = Date.parse(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) throw new Error("Invalid ECB observation date");
    if (time > retrievedAt.getTime()) throw new Error("Future ECB observation");
    const raw = entry.OBS_VALUE!;
    if (!raw || raw === "N/A") continue;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw) || !Number.isFinite(Number(raw))) throw new Error("Invalid ECB yield");
    const value = Number(raw);
    if (values.has(date) && values.get(date) !== value) throw new Error("Conflicting ECB observations for one date");
    values.set(date, value);
  }
  if (!values.size) throw new Error("ECB response has no supported yields");
  // The feed provides observation dates but no reliable release time.
  const provenance = { sourceName: "欧洲央行 · AAA 10 年即期合成曲线（连续复利）", sourceUrl: ecbFeedUrl(), publishedAt: retrievedAt.toISOString(), availabilityBasis: "retrieved" as const };
  const history: PriceBar[] = [...values].sort(([a], [b]) => a.localeCompare(b)).map(([date, close]) => ({ instrumentId: "eu-aaa-10y", date, close, ...provenance }));
  const last = history.at(-1)!;
  const quotes: Quote[] = [{ instrumentId: last.instrumentId, value: last.close, previousClose: history.at(-2)?.close ?? null, asOf: `${last.date}T00:00:00.000Z`, frequency: "daily", unit: "percent", ...provenance }];
  return { quotes, history };
}
