import pg from "pg";
import { env } from "../../config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
});

export async function closePool(): Promise<void> {
  await pool.end();
}
