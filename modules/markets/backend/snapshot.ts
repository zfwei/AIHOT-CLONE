import { audit } from "@aihot/backend/audit";
import { sql, type Tx } from "@aihot/backend/db";
import { readPublishedModuleSnapshot, readModuleResearchSources } from "@aihot/backend/publication/module-data";
import type { Snapshot } from "../domain.ts";
import { INSTRUMENTS, SOURCE_CANDIDATES } from "../sources.ts";
import { emptySnapshot, parseSnapshot } from "./validation.ts";

const KEY = "public.module.markets";

export function collectionState() {
  const treasuryApproved = SOURCE_CANDIDATES.some((source) => source.id === "treasury" && source.status === "approved");
  return { treasuryApproved, enabled: process.env.COLLECT_ENABLED === "true" };
}

export async function readMarketData() {
  const value = await readPublishedModuleSnapshot("markets");
  const collection = collectionState();
  const snapshot = value === null ? emptySnapshot() : parseSnapshot(value);
  const sources = await readModuleResearchSources(snapshot.ideas.filter((idea) => idea.researchType === "policy-scenario").map((idea) => idea.sourceArticleId!));
  const ideas = snapshot.ideas.filter((idea) => {
    if (idea.researchType !== "policy-scenario") return true;
    const source = sources.find((item) => item.id === idea.sourceArticleId);
    return source && source.links.original === idea.sourceUrl && source.source.name === idea.sourceName
      && [source.title, source.summary ?? ""].some((text) => text.includes(idea.evidenceQuote!));
  });
  return {
    snapshot: { ...snapshot, ideas, macro: snapshot.macro ?? [] },
    instruments: INSTRUMENTS,
    sources: SOURCE_CANDIDATES.map((source) => source.id === "treasury" && collection.treasuryApproved ? { ...source, status: "approved" as const } : source),
    collection,
  };
}

/** All data here is deliberately public; holdings and credentials must never be placed in this snapshot. */
export async function writeSnapshot(snapshot: Snapshot, actor: string, reason: string): Promise<Snapshot> {
  const valid = parseSnapshot(snapshot);
  return mutateSnapshot(() => valid, actor, reason);
}

export async function mutateSnapshot(change: (before: Snapshot, tx: Tx) => Snapshot | Promise<Snapshot>, actor: string, reason: string): Promise<Snapshot> {
  if (!reason.trim() || reason.length > 500) throw new Error("A publication reason of 1–500 characters is required");
  return sql.begin(async (tx) => {
    // Both the importer and the collector replace the same snapshot. Serialize even the initial insert.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${KEY}))`;
    const [row] = await tx<{ value: unknown }[]>`SELECT value FROM settings WHERE key = ${KEY}`;
    const before = row ? parseSnapshot(row.value) : emptySnapshot();
    const next = parseSnapshot(await change(before, tx));
    if (JSON.stringify(next) === JSON.stringify(before)) return before;
    await tx`INSERT INTO settings (key, value, updated_by) VALUES (${KEY}, ${tx.json(next as never)}, ${actor})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
    await audit(actor, "markets.publish", "module:markets", reason, row?.value ?? null, next, { db: tx });
    return next;
  });
}
