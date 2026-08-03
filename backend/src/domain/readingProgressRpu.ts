import type { ReadingProgress } from "./types.js";

export interface ReadingProgressDraft {
  cfi: string;
  percent: number;
  page: number | null;
  totalPages: number | null;
}

export type ParseReadingProgressResult =
  | { valid: true; draft: ReadingProgressDraft }
  | { valid: false };

/**
 * Validiert den PUT-Body. `cfi` ist ein nicht-leerer String (getrimmt),
 * `percent` eine endliche Zahl, die auf 0..100 geklemmt und auf eine
 * Ganzzahl gerundet wird. `page`/`totalPages` sind optional: fehlend oder
 * null -> null, sonst müssen es endliche, nicht-negative Zahlen sein
 * (sonst insgesamt ungültig).
 */
export function parseReadingProgress(input: {
  cfi?: unknown;
  percent?: unknown;
  page?: unknown;
  totalPages?: unknown;
}): ParseReadingProgressResult {
  if (typeof input.cfi !== "string") return { valid: false };
  const cfi = input.cfi.trim();
  if (!cfi) return { valid: false };

  if (typeof input.percent !== "number" || !Number.isFinite(input.percent)) return { valid: false };
  const percent = Math.round(Math.min(100, Math.max(0, input.percent)));

  const pageResult = parseNonNegativeIntOrNull(input.page);
  if (!pageResult.valid) return { valid: false };

  const totalPagesResult = parseNonNegativeIntOrNull(input.totalPages);
  if (!totalPagesResult.valid) return { valid: false };

  return {
    valid: true,
    draft: { cfi, percent, page: pageResult.value, totalPages: totalPagesResult.value }
  };
}

type ParseNonNegativeIntResult = { valid: true; value: number | null } | { valid: false };

function parseNonNegativeIntOrNull(value: unknown): ParseNonNegativeIntResult {
  if (value === undefined || value === null) return { valid: true, value: null };
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return { valid: false };
  return { valid: true, value: Math.round(value) };
}

/**
 * Konfliktauflösung: Der größere Fortschritt gewinnt (vom Nutzer so
 * gewünscht). Bei gleichem `percent` bleibt der bestehende Eintrag stehen -
 * so ist das Ergebnis stabil und ein wiederholter Push desselben Standes
 * ändert nichts. Gibt es noch keinen bestehenden Eintrag, gewinnt der neue.
 * Reine Funktion, keine Provider.
 */
export function mergeReadingProgress(
  existing: ReadingProgress | null,
  incoming: ReadingProgress
): ReadingProgress {
  if (!existing) return incoming;
  return isAhead(incoming, existing) ? incoming : existing;
}

/**
 * Ist `candidate` weiter im Buch als `reference`?
 *
 * Bevorzugt die Seitenzahl, nicht `percent`: percent ist eine ganze Zahl
 * 0..100, die Seitenzahl dagegen ein Index aus zeichenbasierten Abschnitten.
 * Bei einem Buch mit rund 400 Seiten entspricht 1 % etwa vier Seiten - zwei
 * Geräte, die zwei Seiten auseinanderliegen, sähen im percent identisch aus,
 * und die Regel "größerer Fortschritt gewinnt" hätte nichts zu entscheiden.
 * Genau so blieben zwei Geräte auf 374 bzw. 376 stehen.
 *
 * Die Seitenzahl stammt aus `locations.generate(1600)`, also aus der
 * Zeichenmenge des Buchs und nicht aus Fenstergröße oder Schriftgrad - sie
 * ist zwischen Geräten vergleichbar. Verglichen wird sie nur, wenn beide
 * Seiten eine haben UND von derselben Gesamtzahl ausgehen; sonst stammen sie
 * aus unterschiedlichen Berechnungen und wären nicht vergleichbar. In allen
 * übrigen Fällen (Seitenzahlen noch nicht berechnet) entscheidet percent.
 */
function isAhead(candidate: ReadingProgress, reference: ReadingProgress): boolean {
  const comparablePages =
    candidate.page !== null &&
    reference.page !== null &&
    candidate.totalPages !== null &&
    candidate.totalPages === reference.totalPages;

  return comparablePages
    ? candidate.page! > reference.page!
    : candidate.percent > reference.percent;
}
