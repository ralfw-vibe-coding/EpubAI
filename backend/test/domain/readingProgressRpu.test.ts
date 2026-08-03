import { describe, expect, it } from "vitest";
import { mergeReadingProgress, parseReadingProgress } from "../../src/domain/readingProgressRpu.js";
import type { ReadingProgress } from "../../src/domain/types.js";

function makeProgress(overrides: Partial<ReadingProgress> = {}): ReadingProgress {
  return {
    bookId: "book-1",
    cfi: "epubcfi(/6/4!/4/2,/1:0,/1:10)",
    percent: 50,
    page: 10,
    totalPages: 100,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("parseReadingProgress", () => {
  it("accepts a valid body", () => {
    const result = parseReadingProgress({ cfi: "  cfi-1  ", percent: 42, page: 5, totalPages: 100 });
    expect(result).toEqual({
      valid: true,
      draft: { cfi: "cfi-1", percent: 42, page: 5, totalPages: 100 }
    });
  });

  it("rejects a missing cfi", () => {
    expect(parseReadingProgress({ percent: 10 })).toEqual({ valid: false });
  });

  it("rejects a non-string cfi", () => {
    expect(parseReadingProgress({ cfi: 42, percent: 10 })).toEqual({ valid: false });
  });

  it("rejects an empty/whitespace-only cfi", () => {
    expect(parseReadingProgress({ cfi: "   ", percent: 10 })).toEqual({ valid: false });
  });

  it("clamps percent above 100 down to 100", () => {
    const result = parseReadingProgress({ cfi: "cfi-1", percent: 150 });
    expect(result).toEqual({ valid: true, draft: { cfi: "cfi-1", percent: 100, page: null, totalPages: null } });
  });

  it("clamps percent below 0 up to 0", () => {
    const result = parseReadingProgress({ cfi: "cfi-1", percent: -5 });
    expect(result).toEqual({ valid: true, draft: { cfi: "cfi-1", percent: 0, page: null, totalPages: null } });
  });

  it("rounds a fractional percent", () => {
    const result = parseReadingProgress({ cfi: "cfi-1", percent: 42.6 });
    expect(result).toEqual({ valid: true, draft: { cfi: "cfi-1", percent: 43, page: null, totalPages: null } });
  });

  it("rejects a non-numeric percent", () => {
    expect(parseReadingProgress({ cfi: "cfi-1", percent: "50" })).toEqual({ valid: false });
  });

  it("rejects a non-finite percent", () => {
    expect(parseReadingProgress({ cfi: "cfi-1", percent: Infinity })).toEqual({ valid: false });
  });

  it("defaults missing page/totalPages to null", () => {
    const result = parseReadingProgress({ cfi: "cfi-1", percent: 10 });
    expect(result).toEqual({ valid: true, draft: { cfi: "cfi-1", percent: 10, page: null, totalPages: null } });
  });

  it("treats explicit null page/totalPages as null", () => {
    const result = parseReadingProgress({ cfi: "cfi-1", percent: 10, page: null, totalPages: null });
    expect(result).toEqual({ valid: true, draft: { cfi: "cfi-1", percent: 10, page: null, totalPages: null } });
  });

  it("rejects a negative page", () => {
    expect(parseReadingProgress({ cfi: "cfi-1", percent: 10, page: -1 })).toEqual({ valid: false });
  });

  it("rejects a non-numeric page", () => {
    expect(parseReadingProgress({ cfi: "cfi-1", percent: 10, page: "5" })).toEqual({ valid: false });
  });

  it("rejects a negative totalPages", () => {
    expect(parseReadingProgress({ cfi: "cfi-1", percent: 10, totalPages: -1 })).toEqual({ valid: false });
  });

  it("rejects a non-numeric totalPages", () => {
    expect(parseReadingProgress({ cfi: "cfi-1", percent: 10, totalPages: "100" })).toEqual({ valid: false });
  });
});

describe("mergeReadingProgress", () => {
  it("returns the incoming progress when there is no existing entry yet", () => {
    const incoming = makeProgress({ percent: 10 });
    expect(mergeReadingProgress(null, incoming)).toEqual(incoming);
  });

  // page und percent zueinander passend halten (page = percent bei 100
  // Gesamtseiten): verglichen wird vorrangig die Seite, ein davon
  // abweichendes percent waere kein realistischer Stand.
  const at = (p: number, rest: Partial<ReadingProgress> = {}) =>
    makeProgress({ percent: p, page: p, totalPages: 100, ...rest });

  it("the incoming progress wins when it is greater than the existing one", () => {
    expect(mergeReadingProgress(at(30), at(60))).toEqual(at(60));
  });

  it("the existing progress wins when it is greater than the incoming one", () => {
    expect(mergeReadingProgress(at(80), at(20))).toEqual(at(80));
  });

  it("keeps the existing entry on a tie, so a repeated push of the same state changes nothing", () => {
    const existing = at(50, { cfi: "existing-cfi" });
    const incoming = at(50, { cfi: "incoming-cfi" });
    expect(mergeReadingProgress(existing, incoming)).toEqual(existing);
  });
});

// Der Fall aus der Praxis: Zwei Geräte standen auf Seite 374 bzw. 376 und
// blieben stehen. percent ist eine ganze Zahl - bei 400 Seiten entspricht 1 %
// rund vier Seiten, beide Stände sahen darin identisch aus.
describe("mergeReadingProgress: Fortschritt feiner als ein Prozentpunkt", () => {
  const at = (page: number, cfi: string) => ({
    bookId: "b1",
    cfi,
    percent: 94,
    page,
    totalPages: 400,
    updatedAt: "2026-08-03T10:00:00.000Z"
  });

  it("erkennt zwei Seiten Unterschied trotz identischem Prozentwert", () => {
    expect(mergeReadingProgress(at(374, "bestehend"), at(376, "neu"))).toEqual(at(376, "neu"));
  });

  it("behält den weiteren Stand, wenn der neue zurückliegt", () => {
    expect(mergeReadingProgress(at(376, "bestehend"), at(374, "neu"))).toEqual(at(376, "bestehend"));
  });

  it("lässt bei exakt gleicher Seite den bestehenden Stand stehen", () => {
    expect(mergeReadingProgress(at(376, "bestehend"), at(376, "neu"))).toEqual(at(376, "bestehend"));
  });

  it("fällt auf percent zurück, solange eine Seite fehlt", () => {
    const ohne = { ...at(0, "bestehend"), percent: 30, page: null, totalPages: null };
    const mit = { ...at(240, "neu"), percent: 60 };
    expect(mergeReadingProgress(ohne, mit)).toEqual(mit);
  });

  it("vergleicht keine Seiten aus unterschiedlichen Gesamtzahlen", () => {
    const bestehend = { ...at(200, "bestehend"), percent: 50 };
    const neu = { ...at(70, "neu"), percent: 70, totalPages: 100 };
    expect(mergeReadingProgress(bestehend, neu)).toEqual(neu);
  });
});
