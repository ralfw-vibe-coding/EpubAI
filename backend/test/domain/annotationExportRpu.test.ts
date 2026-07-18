import { describe, expect, it } from "vitest";
import {
  buildAnnotationExport,
  filterValidColors,
  isDuplicateAnnotation,
  validateImportPayload,
  MAX_IMPORT_ANNOTATIONS,
  type AnnotationIdentity,
  type ImportAnnotationCandidate
} from "../../src/domain/annotationExportRpu.js";
import type { Annotation, Book } from "../../src/domain/types.js";

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "ann-1",
    bookId: "book-1",
    userId: "user-1",
    cfiRange: "epubcfi(/6/4!/4/2)",
    excerpt: "Some excerpt.",
    note: null,
    color: "accent",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("buildAnnotationExport", () => {
  it("builds the export payload with fileHash as the only matching field and display-only title/author", () => {
    const book: Pick<Book, "currentFileHash" | "title" | "author"> = {
      currentFileHash: "hash-1",
      title: "Some Title",
      author: "Some Author"
    };
    const annotations = [
      makeAnnotation({ cfiRange: "cfi-1", excerpt: "e1", note: "n1", color: "yellow" }),
      makeAnnotation({ cfiRange: "cfi-2", excerpt: "e2", note: null, color: "accent" })
    ];

    const payload = buildAnnotationExport(book, annotations, new Date("2026-01-02T00:00:00.000Z"));

    expect(payload).toEqual({
      schemaVersion: 1,
      fileHash: "hash-1",
      bookTitle: "Some Title",
      bookAuthor: "Some Author",
      exportedAt: "2026-01-02T00:00:00.000Z",
      annotations: [
        { cfiRange: "cfi-1", excerpt: "e1", note: "n1", color: "yellow" },
        { cfiRange: "cfi-2", excerpt: "e2", note: null, color: "accent" }
      ]
    });
  });

  it("produces an empty annotations array for a book with no annotations", () => {
    const book = { currentFileHash: "hash-1", title: "T", author: "A" };
    const payload = buildAnnotationExport(book, [], new Date("2026-01-02T00:00:00.000Z"));
    expect(payload.annotations).toEqual([]);
  });
});

describe("validateImportPayload", () => {
  it("rejects a non-object payload (e.g. a raw string or array) as invalid_input", () => {
    expect(validateImportPayload("not an object")).toEqual({ valid: false, error: "invalid_input" });
    expect(validateImportPayload(null)).toEqual({ valid: false, error: "invalid_input" });
    expect(validateImportPayload(42)).toEqual({ valid: false, error: "invalid_input" });
    expect(validateImportPayload([1, 2, 3])).toEqual({ valid: false, error: "invalid_input" });
  });

  it("rejects an object without an annotations array as invalid_input", () => {
    expect(validateImportPayload({ fileHash: "h" })).toEqual({ valid: false, error: "invalid_input" });
    expect(validateImportPayload({ fileHash: "h", annotations: "not-an-array" })).toEqual({
      valid: false,
      error: "invalid_input"
    });
  });

  it("accepts an empty annotations array", () => {
    const result = validateImportPayload({ fileHash: "h", annotations: [] });
    expect(result).toEqual({ valid: true, fileHash: "h", annotations: [], totalCount: 0 });
  });

  it("rejects a payload with more than MAX_IMPORT_ANNOTATIONS entries as too_many_annotations", () => {
    const annotations = Array.from({ length: MAX_IMPORT_ANNOTATIONS + 1 }, (_, i) => ({
      cfiRange: `cfi-${i}`,
      excerpt: "e",
      note: null,
      color: "accent"
    }));
    const result = validateImportPayload({ fileHash: "h", annotations });
    expect(result).toEqual({ valid: false, error: "too_many_annotations" });
  });

  it("accepts exactly MAX_IMPORT_ANNOTATIONS entries (boundary, not over the limit)", () => {
    const annotations = Array.from({ length: MAX_IMPORT_ANNOTATIONS }, (_, i) => ({
      cfiRange: `cfi-${i}`,
      excerpt: "e",
      note: null,
      color: "accent"
    }));
    const result = validateImportPayload({ fileHash: "h", annotations });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.annotations).toHaveLength(MAX_IMPORT_ANNOTATIONS);
    }
  });

  it("passes fileHash through unchanged, even if missing or the wrong type, for the Reactor's mismatch check", () => {
    const missing = validateImportPayload({ annotations: [] });
    expect(missing).toEqual({ valid: true, fileHash: undefined, annotations: [], totalCount: 0 });

    const wrongType = validateImportPayload({ fileHash: 42, annotations: [] });
    expect(wrongType).toEqual({ valid: true, fileHash: 42, annotations: [], totalCount: 0 });
  });

  it("drops structurally malformed entries (non-object, missing cfiRange/excerpt) without failing the whole payload", () => {
    const result = validateImportPayload({
      fileHash: "h",
      annotations: [
        "not an object",
        null,
        42,
        { cfiRange: "cfi-1", excerpt: "e1", note: null, color: "accent" },
        { excerpt: "no cfiRange" },
        { cfiRange: "  ", excerpt: "blank cfiRange" },
        { cfiRange: "cfi-2" },
        { cfiRange: "cfi-3", excerpt: 42 },
        { cfiRange: "cfi-4", excerpt: "e4", note: 123 }
      ]
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.annotations).toEqual([{ cfiRange: "cfi-1", excerpt: "e1", note: null, color: "accent" }]);
    }
  });

  it("keeps an omitted or null note as null, and preserves a string note", () => {
    const result = validateImportPayload({
      fileHash: "h",
      annotations: [
        { cfiRange: "cfi-1", excerpt: "e1" },
        { cfiRange: "cfi-2", excerpt: "e2", note: null },
        { cfiRange: "cfi-3", excerpt: "e3", note: "a note" }
      ]
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.annotations.map((a) => a.note)).toEqual([null, null, "a note"]);
    }
  });
});

describe("filterValidColors", () => {
  function candidate(overrides: Partial<ImportAnnotationCandidate> = {}): ImportAnnotationCandidate {
    return { cfiRange: "cfi-1", excerpt: "e", note: null, color: "accent", ...overrides };
  }

  it("keeps all 6 valid color slugs", () => {
    const colors = ["accent", "orange", "yellow", "green", "blue", "purple"];
    const candidates = colors.map((color) => candidate({ color }));
    const result = filterValidColors(candidates);
    expect(result.valid).toHaveLength(6);
    expect(result.invalidColorCount).toBe(0);
  });

  it("skips only the annotation with an invalid color, keeping the rest", () => {
    const candidates = [
      candidate({ cfiRange: "cfi-1", color: "accent" }),
      candidate({ cfiRange: "cfi-2", color: "not-a-real-color" }),
      candidate({ cfiRange: "cfi-3", color: "yellow" })
    ];
    const result = filterValidColors(candidates);
    expect(result.valid.map((a) => a.cfiRange)).toEqual(["cfi-1", "cfi-3"]);
    expect(result.invalidColorCount).toBe(1);
  });

  it("skips a non-string color (e.g. number, null, undefined)", () => {
    const candidates = [candidate({ color: 42 }), candidate({ color: null }), candidate({ color: undefined })];
    const result = filterValidColors(candidates);
    expect(result.valid).toHaveLength(0);
    expect(result.invalidColorCount).toBe(3);
  });

  it("handles an empty input", () => {
    const result = filterValidColors([]);
    expect(result).toEqual({ valid: [], invalidColorCount: 0 });
  });
});

describe("isDuplicateAnnotation", () => {
  function identity(overrides: Partial<AnnotationIdentity> = {}): AnnotationIdentity {
    return { cfiRange: "cfi-1", note: "a note", color: "accent", ...overrides };
  }

  it("detects an exact match on cfiRange, note, and color", () => {
    const existing = [identity()];
    expect(isDuplicateAnnotation(existing, identity())).toBe(true);
  });

  it("is not a duplicate when cfiRange differs", () => {
    const existing = [identity({ cfiRange: "cfi-1" })];
    expect(isDuplicateAnnotation(existing, identity({ cfiRange: "cfi-2" }))).toBe(false);
  });

  it("is not a duplicate when note differs", () => {
    const existing = [identity({ note: "a note" })];
    expect(isDuplicateAnnotation(existing, identity({ note: "different note" }))).toBe(false);
  });

  it("is not a duplicate when note differs only by null vs a string", () => {
    const existing = [identity({ note: null })];
    expect(isDuplicateAnnotation(existing, identity({ note: "a note" }))).toBe(false);
  });

  it("is not a duplicate when color differs", () => {
    const existing = [identity({ color: "accent" })];
    expect(isDuplicateAnnotation(existing, identity({ color: "yellow" }))).toBe(false);
  });

  it("returns false against an empty existing list", () => {
    expect(isDuplicateAnnotation([], identity())).toBe(false);
  });

  it("finds a match anywhere in a list of several existing annotations", () => {
    const existing = [
      identity({ cfiRange: "cfi-1", note: "one" }),
      identity({ cfiRange: "cfi-2", note: "two" }),
      identity({ cfiRange: "cfi-3", note: "three" })
    ];
    expect(isDuplicateAnnotation(existing, identity({ cfiRange: "cfi-2", note: "two" }))).toBe(true);
  });
});
