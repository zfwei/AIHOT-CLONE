// Modules explicitly publish JSON into this namespace. No private setting can be selected here.
import { sql } from "../db.ts";

export async function readPublishedModuleSnapshot(name: string): Promise<unknown | null> {
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(name)) throw new Error("Invalid public module name");
  const [row] = await sql<{ value: unknown }[]>`SELECT value FROM settings WHERE key = ${`public.module.${name}`}`;
  return row?.value ?? null;
}
