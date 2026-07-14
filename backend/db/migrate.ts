import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { env } from "../src/config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, "schema.sql");

async function main() {
  const schemaSql = readFileSync(schemaPath, "utf8");
  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    console.log("Applying schema.sql to the database...");
    await client.query(schemaSql);
    console.log("Migration applied successfully.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
