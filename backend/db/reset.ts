// Wipes everything in the database DATABASE_URL points at (all tables,
// emptied but left structurally intact - no need to re-run migrate
// afterward) and every object in the R2_BUCKET. Meant for resetting the
// dedicated test database/bucket between test runs.
//
// Two guards, both always on:
//   - refuses to run non-interactively (no stdin), so it can never fire from
//     a script by accident;
//   - when it is NOT clearly pointed at test - either because EPUBAI_ENV
//     selected an overlay (`.env.production`), or because `.env` was hand-
//     edited to non-test values - it requires typing the exact R2_BUCKET
//     name. A bucket name is something you cannot type correctly by accident,
//     which is the whole point: it replaces the old, semantically awkward
//     "ich bin sicher, das ist keine produktion" phrase with a real check.
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import pg from "pg";
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { env } from "../src/config.js";

const TABLES = ["annotation", "book_file", "loan", "book", '"user"'];

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
    console.error("Kein interaktives Terminal erkannt - Abbruch (dieses Skript läuft nur interaktiv).");
    return false;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim() === expected;
}

async function resetDatabase(): Promise<void> {
  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
  });
  await client.connect();
  try {
    console.log(`Leere Tabellen: ${TABLES.join(", ")}...`);
    await client.query(`truncate table ${TABLES.join(", ")} restart identity cascade`);
    console.log("Datenbank geleert.");
  } finally {
    await client.end();
  }
}

async function resetR2(): Promise<void> {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED"
  });

  console.log(`Lösche alle Objekte in R2-Bucket "${env.R2_BUCKET}"...`);
  let continuationToken: string | undefined;
  let deletedCount = 0;
  do {
    const listed = await client.send(
      new ListObjectsV2Command({ Bucket: env.R2_BUCKET, ContinuationToken: continuationToken })
    );
    const keys = (listed.Contents ?? [])
      .map((object) => object.Key)
      .filter((key): key is string => Boolean(key));
    if (keys.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: env.R2_BUCKET,
          Delete: { Objects: keys.map((Key) => ({ Key })) }
        })
      );
      deletedCount += keys.length;
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
  console.log(`${deletedCount} Objekt(e) gelöscht.`);
}

async function main() {
  const overlay = process.env.EPUBAI_ENV;
  console.log("=== EpubAI-Umgebung zurücksetzen ===");
  console.log(`Datenbank: ${describeDatabaseTarget(env.DATABASE_URL)}${overlay ? `   [${overlay.toUpperCase()}]` : ""}`);
  console.log(`R2-Bucket: ${env.R2_BUCKET}`);
  console.log("");
  console.log("Das leert ALLE Tabellen (Nutzer, Bücher, Notizen, Ausleihen) in dieser");
  console.log("Datenbank und löscht ALLE Dateien im R2-Bucket oben. Unwiderruflich.");
  console.log("");

  // Not clearly test = either an explicit overlay was selected, or `.env` was
  // hand-edited to non-test values. Either way, demand the exact bucket name -
  // a target you cannot name correctly unless you actually mean it.
  const looksLikeTest = /test/i.test(env.DATABASE_URL) || /test/i.test(env.R2_BUCKET);
  if (overlay || !looksLikeTest) {
    console.log(
      overlay
        ? `ACHTUNG: EPUBAI_ENV=${overlay} - das ist NICHT die Standard-Testumgebung.`
        : 'ACHTUNG: Weder DATABASE_URL noch R2_BUCKET enthalten "test" im Namen.'
    );
    console.log("Das könnte die echte Produktionsumgebung sein!");
    console.log("");
    const nameConfirmed = await confirm(
      `Zum Fortfahren tippe exakt den Bucket-Namen "${env.R2_BUCKET}": `,
      env.R2_BUCKET
    );
    if (!nameConfirmed) {
      console.log("Abgebrochen.");
      return;
    }
  }

  const confirmed = await confirm('Bist du sicher? Tippe "ja" zum Fortfahren: ', "ja");
  if (!confirmed) {
    console.log("Abgebrochen.");
    return;
  }

  await resetDatabase();
  await resetR2();
  console.log("Fertig.");
}

main().catch((err) => {
  console.error("Fehler beim Zurücksetzen:", err instanceof Error ? err.message : err);
  process.exit(1);
});
