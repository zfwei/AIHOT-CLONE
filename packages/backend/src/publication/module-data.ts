// Modules explicitly publish JSON into this namespace. No private setting can be selected here.
import { sql, type Db } from "../db.ts";
import { API_ITEM_COLUMNS, API_ITEM_FROM, type ApiItemRow } from "./items.ts";
import { seatedCondition } from "./scope.ts";
import { rowToV1 } from "./v1.ts";

export async function readPublishedModuleSnapshot(name: string): Promise<unknown | null> {
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(name)) throw new Error("Invalid public module name");
  const [row] = await sql<{ value: unknown }[]>`SELECT value FROM settings WHERE key = ${`public.module.${name}`}`;
  return row?.value ?? null;
}

/** Modules may cite only the same currently released selected reports as the machine public exits. */
export async function readModuleResearchSources(articleIds: string[], now = new Date(), db: Db = sql) {
  if (!articleIds.length) return [];
  const rows = await db<ApiItemRow[]>`SELECT ${API_ITEM_COLUMNS} ${API_ITEM_FROM}
    WHERE p.article_id = ANY(${articleIds}::text[]) AND ${seatedCondition(now)}`;
  return rows.map(rowToV1);
}
