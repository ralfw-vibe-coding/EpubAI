import { describe, expect, it } from "vitest";
import {
  authorizeAnnotationAccess,
  parseColor,
  parseCreateAnnotation,
  parseNote,
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("parseCreateAnnotation", () => {
  it("accepts a valid cfiRange + excerpt with no note, defaulting color to accent", () => {
    const result = parseCreateAnnotation({ cfiRange: "  cfi-1  ", excerpt: "  Some text  " });
    expect(result).toEqual({
      valid: true,
      draft: { cfiRange: "cfi-1", excerpt: "Some text", note: null, color: "accent" }
    });
  });

  it("accepts a valid note and trims it", () => {
    const result = parseCreateAnnotation({ cfiRange: "cfi-1", excerpt: "text", note: "  my note  " });
    expect(result).toEqual({
      valid: true,
      draft: { cfiRange: "cfi-1", excerpt: "text", note: "my note", color: "accent" }
    });
  });

  it("treats a whitespace-only note as null", () => {
    const result = parseCreateAnnotation({ cfiRange: "cfi-1", excerpt: "text", note: "   " });
    expect(result).toEqual({
      valid: true,
      draft: { cfiRange: "cfi-1", excerpt: "text", note: null, color: "accent" }
    });
  });

  it("accepts an explicit non-default color", () => {
    const result = parseCreateAnnotation({ cfiRange: "cfi-1", excerpt: "text", color: "yellow" });
    expect(result).toEqual({
      valid: true,
      draft: { cfiRange: "cfi-1", excerpt: "text", note: null, color: "yellow" }
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
    const annotation = makeAnnotation({ note: "a note", color: "blue" });
    expect(toAnnotationSummary(annotation)).toEqual({
      id: "annotation-1",
      bookId: "book-1",
      cfiRange: "epubcfi(/6/4!/4/2,/1:0,/1:10)",
      excerpt: "Some highlighted text",
      note: "a note",
      color: "blue",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
  });
});
