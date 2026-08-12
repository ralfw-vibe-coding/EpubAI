import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Wächter gegen eine Fehlerklasse, die schon einmal zugeschlagen hat.
 *
 * Kein Fremdschlüssel auf book(id) hat `on delete cascade` - das Aufräumen
 * beim Löschen eines Buchs steht komplett in deleteBook.ts. Wird dort eine
 * Tabelle vergessen, scheitert nur der ALLERLETZTE Schritt: Datei, Ausleihe
 * und Notizen sind dann schon weg, das Buch bleibt als Leiche zurück und
 * lässt sich weder öffnen noch zurückgeben noch löschen.
 *
 * Genau so ist es mit `reading_progress` passiert: Die Tabelle kam mit dem
 * geräteübergreifenden Abgleich der Leseposition dazu, deleteBook.ts wurde
 * nicht nachgezogen, und das Löschen schlug fortan für jedes Buch fehl, in
 * dem je gelesen wurde - unbemerkt, weil die Reaktor-Tests mit Attrappen
 * arbeiten und der Fremdschlüssel dort gar nicht existiert.
 *
 * Dieser Test liest deshalb das Schema selbst: Jede Tabelle, die auf
 * book(id) verweist, muss in deleteBook.ts auch abgeräumt werden. Er kann
 * nicht prüfen, ob das Aufräumen korrekt ist - aber er merkt, wenn eine neue
 * Tabelle schlicht vergessen wurde. Das war hier das Problem.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../../");

/** Tabellennamen, deren Definition eine Spalte mit `references book(id)` enthält. */
function tablesReferencingBook(schema: string): string[] {
  const tables: string[] = [];
  // `create table if not exists <name> ( ... );` - je Block prüfen, ob darin
  // ein Verweis auf book(id) steht.
  const blocks = schema.matchAll(/create table (?:if not exists )?(\w+)\s*\(([\s\S]*?)\n\);/g);
  for (const [, name, body] of blocks) {
    if (/references\s+book\s*\(\s*id\s*\)/.test(body)) tables.push(name);
  }
  return tables;
}

/**
 * Von welchen Tabellen deleteBook.ts löscht - abgeleitet aus den benutzten
 * Repositories. `annotationRepo` räumt `annotation` ab, `loanRepo` die
 * Tabelle `loan` und so fort; die Namensgleichheit ist im Bestand durchgängig.
 */
function tablesCleanedUp(source: string): string[] {
  const cleaned: string[] = [];
  for (const [, repo] of source.matchAll(/(\w+)Repo\.deleteByBookId\(/g)) {
    cleaned.push(repo.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase());
  }
  return cleaned;
}

describe("deleteBook räumt jede Tabelle ab, die auf book(id) verweist", () => {
  const schema = readFileSync(path.join(backendRoot, "db/schema.sql"), "utf-8");
  const source = readFileSync(path.join(backendRoot, "src/processor/deleteBook.ts"), "utf-8");

  it("findet die erwarteten Tabellen im Schema (sonst greift der Test ins Leere)", () => {
    // Absicherung des Wächters selbst: Fände die Regex nichts, wäre der Test
    // unten immer grün und damit wertlos.
    const tables = tablesReferencingBook(schema);
    expect(tables).toContain("book_file");
    expect(tables).toContain("loan");
    expect(tables).toContain("annotation");
    expect(tables).toContain("reading_progress");
  });

  it("lässt keine davon aus", () => {
    const referencing = tablesReferencingBook(schema);
    const cleaned = tablesCleanedUp(source);
    const forgotten = referencing.filter((t) => !cleaned.includes(t));
    expect(forgotten).toEqual([]);
  });
});
