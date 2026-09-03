import { Pool } from "pg";
import { env } from "../config/env";

export const pool = new Pool({ connectionString: env.databaseUrl });

pool.on("error", (err: Error) => {
  console.error("[postgres] unexpected error on idle client", err);
});

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
