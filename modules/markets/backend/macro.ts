import type { MacroObservation } from "../domain.ts";

export function macroDate(date: string, retrievedAt: Date): string {
  const timestamp = `${date}T00:00:00.000Z`;
  const time = Date.parse(timestamp);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) throw new Error("Invalid macro observation date");
  if (time > retrievedAt.getTime()) throw new Error("Future macro observation");
  return timestamp;
}

/** A repeated release keeps its first confirmed availability; a correction becomes available now. */
export function mergeMacroObservations(before: MacroObservation[], incoming: MacroObservation[]): MacroObservation[] {
  const key = (row: MacroObservation) => `${row.sourceId}:${row.metric}:${row.asOf}`;
  const rows = new Map(before.map((row) => [key(row), row]));
  for (const row of incoming) {
    const old = rows.get(key(row));
    rows.set(key(row), old && old.value === row.value && old.unit === row.unit && old.frequency === row.frequency
      ? { ...row, publishedAt: old.publishedAt, availabilityBasis: old.availabilityBasis } : row);
  }
  return [...rows.values()].sort((a, b) => a.asOf.localeCompare(b.asOf) || a.metric.localeCompare(b.metric)).slice(-500);
}
