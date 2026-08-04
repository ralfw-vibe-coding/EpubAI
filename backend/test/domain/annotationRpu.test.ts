import { describe, expect, it } from "vitest";
import {
  authorizeAnnotationAccess,
  isValidUuid,
  parseColor,
  parseCreateAnnotation,
  parseId,
  parseNote,
  parseTags,
  toAnnotationSummary
} from "../../src/domain/annotationRpu.js";
import type { Annotation } from "../../src/domain/types.js";

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "annotation-1",
    bookId: "book-1",
    userId: "user-1",
    cfiRange: "epubcfi(/6/4!/4/2,/1:0,/1:10)",
    excerpt: "Some highlighted text",
    note: null,
    color: "accent",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("parseCreateAnnotation", () => {
  it("accepts a valid cfiRange + excerpt with no note, defaulting color to accent and tags to empty", () => {
    const result = parseCreateAnnotation({ cfiRange: "  cfi-1  ", excerpt: "  Some text  " });
    expect(result).toEqual({
      valid: true,
      draft: { cfiRange: "cfi-1", excerpt: "Some text", note: null, color: "accent", tags: [] }
    });
  });

  it("accepts a valid note and trims it", () => {
    const result = parseCreateAnnotation({ cfiRange: "cfi-1", excerpt: "text", note: "  my note  " });
    expect(result).toEqual({
      valid: true,
      draft: { cfiRange: "cfi-1", excerpt: "text", note: "my note", color: "accent", tags: [] }
    });
  });

  it("treats a whitespace-only note as null", () => {
    const result = parseCreateAnnotation({ cfiRange: "cfi-1", excerpt: "text", note: "   " });
    expect(result).toEqual({
      valid: true,
      draft: { cfiRange: "cfi-1", excerpt: "text", note: null, color: "accent", tags: [] }
    });
  });

  it("accepts an explicit non-default color", () => {
    const result = parseCreateAnnotation({ cfiRange: "cfi-1", excerpt: "text", color: "yellow" });
    expect(result).toEqual({
      valid: true,
      draft: { cfiRange: "cfi-1", excerpt: "text", note: null, color: "yellow", tags: [] }
    });
  });

  it("accepts and normalizes explicit tags", () => {
    const result = parseCreateAnnotation({ cfiRange: "cfi-1", excerpt: "text", tags: ["  #Vocab  ", "Chapter-1"] });
    expect(result).toEqual({
      valid: true,
      draft: { cfiRange: "cfi-1", excerpt: "text", note: null, color: "accent", tags: ["vocab", "chapter-1"] }
    });
  });

  it("rejects invalid tags", () => {
    expect(parseCreateAnnotation({ cfiRange: "cfi-1", excerpt: "text", tags: "not-an-array" })).toEqual({
      valid: false
    });
  });

  it("rejects an invalid color", () => {
    expect(parseCreateAnnotation({ cfiRange: "cfi-1", excerpt: "text", color: "red" })).toEqual({ valid: false });
  });

  it("rejects a non-string color", () => {
    expect(parseCreateAnnotation({ cfiRange: "cfi-1", excerpt: "text", color: 42 })).toEqual({ valid: false });
  });

  it("rejects a missing cfiRange", () => {
    expect(parseCreateAnnotation({ excerpt: "text" })).toEqual({ valid: false });
  });

  it("rejects a non-string cfiRange", () => {
    expect(parseCreateAnnotation({ cfiRange: 42, excerpt: "text" })).toEqual({ valid: false });
  });

  it("rejects a blank cfiRange", () => {
    expect(parseCreateAnnotation({ cfiRange: "   ", excerpt: "text" })).toEqual({ valid: false });
  });

  it("rejects a missing excerpt", () => {
    expect(parseCreateAnnotation({ cfiRange: "cfi-1" })).toEqual({ valid: false });
  });

  it("rejects a non-string excerpt", () => {
    expect(parseCreateAnnotation({ cfiRange: "cfi-1", excerpt: null })).toEqual({ valid: false });
  });

  it("rejects a blank excerpt", () => {
    expect(parseCreateAnnotation({ cfiRange: "cfi-1", excerpt: "   " })).toEqual({ valid: false });
  });

  it("rejects an excerpt over the 2000 char cap", () => {
    const tooLong = "a".repeat(2001);
    expect(parseCreateAnnotation({ cfiRange: "cfi-1", excerpt: tooLong })).toEqual({ valid: false });
  });

  it("accepts an excerpt exactly at the 2000 char cap", () => {
    const atCap = "a".repeat(2000);
    const result = parseCreateAnnotation({ cfiRange: "cfi-1", excerpt: atCap });
    expect(result.valid).toBe(true);
  });

  it("rejects a non-string, non-null note", () => {
    expect(parseCreateAnnotation({ cfiRange: "cfi-1", excerpt: "text", note: 42 })).toEqual({ valid: false });
  });

  it("accepts and lowercases a client-supplied UUID id", () => {
    const result = parseCreateAnnotation({
      id: "550E8400-E29B-41D4-A716-446655440000",
      cfiRange: "cfi-1",
      excerpt: "text"
    });
    expect(result).toEqual({
      valid: true,
      draft: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        cfiRange: "cfi-1",
        excerpt: "text",
        note: null,
        color: "accent",
        tags: []
      }
    });
  });

  it("omits id from the draft when not supplied", () => {
    const result = parseCreateAnnotation({ cfiRange: "cfi-1", excerpt: "text" });
    expect(result.valid).toBe(true);
    expect((result as { draft: { id?: string } }).draft.id).toBeUndefined();
  });

  it("rejects a malformed id", () => {
    expect(parseCreateAnnotation({ id: "not-a-uuid", cfiRange: "cfi-1", excerpt: "text" })).toEqual({
      valid: false
    });
  });
});

describe("parseNote", () => {
  it("treats undefined as null", () => {
    expect(parseNote(undefined)).toEqual({ valid: true, note: null });
  });

  it("treats null as null", () => {
    expect(parseNote(null)).toEqual({ valid: true, note: null });
  });

  it("trims a valid string note", () => {
    expect(parseNote("  hello  ")).toEqual({ valid: true, note: "hello" });
  });

  it("treats an empty string as null", () => {
    expect(parseNote("")).toEqual({ valid: true, note: null });
  });

  it("treats a whitespace-only string as null", () => {
    expect(parseNote("   ")).toEqual({ valid: true, note: null });
  });

  it("rejects a non-string, non-null value", () => {
    expect(parseNote(42)).toEqual({ valid: false });
    expect(parseNote(true)).toEqual({ valid: false });
    expect(parseNote({})).toEqual({ valid: false });
  });
});

describe("parseColor", () => {
  it("defaults undefined to accent", () => {
    expect(parseColor(undefined)).toEqual({ valid: true, color: "accent" });
  });

  it.each(["accent", "orange", "yellow", "green", "blue", "purple"])("accepts the valid color %s", (color) => {
    expect(parseColor(color)).toEqual({ valid: true, color });
  });

  it("rejects an unknown color slug", () => {
    expect(parseColor("red")).toEqual({ valid: false });
  });

  it("rejects null", () => {
    expect(parseColor(null)).toEqual({ valid: false });
  });

  it("rejects a non-string, non-undefined value", () => {
    expect(parseColor(42)).toEqual({ valid: false });
    expect(parseColor(true)).toEqual({ valid: false });
    expect(parseColor({})).toEqual({ valid: false });
  });

  it("is case-sensitive - rejects an uppercase variant", () => {
    expect(parseColor("Yellow")).toEqual({ valid: false });
  });
});

describe("parseTags", () => {
  it("defaults omitted to an empty array", () => {
    expect(parseTags(undefined)).toEqual({ valid: true, tags: [] });
  });

  it("accepts an empty array", () => {
    expect(parseTags([])).toEqual({ valid: true, tags: [] });
  });

  it("trims, lowercases, and strips a leading '#' from each tag", () => {
    expect(parseTags(["  Vocab  ", "#Chapter-1", "  #Spacey  "])).toEqual({
      valid: true,
      tags: ["vocab", "chapter-1", "spacey"]
    });
  });

  it("drops blank tags (empty or whitespace-only, including a lone '#')", () => {
    expect(parseTags(["valid", "   ", "", "#"])).toEqual({ valid: true, tags: ["valid"] });
  });

  it("removes duplicates after normalization", () => {
    expect(parseTags(["Vocab", "#vocab", " vocab "])).toEqual({ valid: true, tags: ["vocab"] });
  });

  it("rejects a non-array value", () => {
    expect(parseTags("not-an-array")).toEqual({ valid: false });
    expect(parseTags(42)).toEqual({ valid: false });
    expect(parseTags({})).toEqual({ valid: false });
    expect(parseTags(null)).toEqual({ valid: false });
  });

  it("rejects an array containing a non-string item", () => {
    expect(parseTags(["valid", 42])).toEqual({ valid: false });
    expect(parseTags([null])).toEqual({ valid: false });
  });

  it("rejects a tag longer than 40 chars", () => {
    const tooLong = "a".repeat(41);
    expect(parseTags([tooLong])).toEqual({ valid: false });
  });

  it("accepts a tag exactly at the 40 char cap", () => {
    const atCap = "a".repeat(40);
    expect(parseTags([atCap])).toEqual({ valid: true, tags: [atCap] });
  });
});

describe("isValidUuid", () => {
  it.each([
    "550e8400-e29b-11d4-a716-446655440000", // v1
    "550e8400-e29b-21d4-a716-446655440000", // v2
    "550e8400-e29b-31d4-a716-446655440000", // v3
    "550e8400-e29b-41d4-a716-446655440000", // v4
    "550e8400-e29b-51d4-a716-446655440000" // v5
  ])("accepts a valid v1-v5 UUID %s", (id) => {
    expect(isValidUuid(id)).toBe(true);
  });

  it("accepts an uppercase UUID", () => {
    expect(isValidUuid("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
  });

  it("rejects a broken string", () => {
    expect(isValidUuid("not-a-uuid")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidUuid("")).toBe(false);
  });
});

describe("parseId", () => {
  it("treats undefined as no id", () => {
    expect(parseId(undefined)).toEqual({ valid: true, id: undefined });
  });

  it("accepts and lowercases a valid UUID", () => {
    expect(parseId("550E8400-E29B-41D4-A716-446655440000")).toEqual({
      valid: true,
      id: "550e8400-e29b-41d4-a716-446655440000"
    });
  });

  it("rejects a broken string", () => {
    expect(parseId("not-a-uuid")).toEqual({ valid: false });
  });

  it("rejects an empty string", () => {
    expect(parseId("")).toEqual({ valid: false });
  });

  it("rejects a non-string value", () => {
    expect(parseId(42)).toEqual({ valid: false });
  });

  it("rejects null", () => {
    expect(parseId(null)).toEqual({ valid: false });
  });
});

describe("authorizeAnnotationAccess", () => {
  it("denies access when annotation is null (not found)", () => {
    expect(authorizeAnnotationAccess(null, "user-1")).toBe(false);
  });

  it("denies access when userId does not match owner", () => {
    expect(authorizeAnnotationAccess(makeAnnotation({ userId: "other-user" }), "user-1")).toBe(false);
  });

  it("grants access when userId matches owner", () => {
    expect(authorizeAnnotationAccess(makeAnnotation({ userId: "user-1" }), "user-1")).toBe(true);
  });
});

describe("toAnnotationSummary", () => {
  it("projects the public fields, omitting userId", () => {
    const annotation = makeAnnotation({ note: "a note", color: "blue", tags: ["vocab"] });
    expect(toAnnotationSummary(annotation)).toEqual({
      id: "annotation-1",
      bookId: "book-1",
      cfiRange: "epubcfi(/6/4!/4/2,/1:0,/1:10)",
      excerpt: "Some highlighted text",
      note: "a note",
      color: "blue",
      tags: ["vocab"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
  });
});
