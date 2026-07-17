import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import pg from "pg";
import { env } from "../src/config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, "schema.sql");

/** Host + database name only - never the credentials in the URL. */
function describeDatabaseTarget(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return "(DATABASE_URL konnte nicht geparst werden)";
  }
}

async function confirm(question: string, expected: string): Promise<boolean> {
  if (!stdin.isTTY) {
    console.error("Kein interaktives Terminal - Abbruch. Migration gegen eine Nicht-Standard-Umgebung läuft nur interaktiv.");
    return false;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim() === expected;
}

async function main() {
  // EPUBAI_ENV picks the overlay in config.ts. Unset = local/test (the frequent
  // path, no confirmation); set = an explicitly targeted environment, so we
  // show it and ask once before touching it.
  const overlay = process.env.EPUBAI_ENV;
  console.log(`Ziel-Datenbank: ${describeDatabaseTarget(env.DATABASE_URL)}${overlay ? `   [${overlay.toUpperCase()}]` : ""}`);

  if (overlay) {
    // schema.sql is idempotent DDL (all `if not exists`), so this guards
    // against a mistyped target, not against the statements themselves.
    const ok = await confirm(`Schema auf "${overlay}" anwenden? Tippe "ja": `, "ja");
    if (!ok) {
      console.log("Abgebrochen.");
      return;
    }
  }

  const schemaSql = readFileSync(schemaPath, "utf8");
  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    console.log("Wende schema.sql an...");
    await client.query(schemaSql);
    console.log("Migration erfolgreich.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration fehlgeschlagen:", err instanceof Error ? err.message : err);
  process.exit(1);
});
