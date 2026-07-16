import { describe, expect, it } from "vitest";
import {
  authorizeBookAccess,
  buildBookDraft,
  buildDetectedMeta,
  computeFileHash,
  detectDuplicate,
  toBookSummary,
  updateBookMetadata
} from "../../src/domain/bookRpu.js";
import type { Book } from "../../src/domain/types.js";

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "book-1",
    userId: "user-1",
    title: "Some Title",
    author: "Some Author",
    tags: [],
    coverUrl: null,
    addedAt: "2026-01-01T00:00:00.000Z",
    currentFileHash: "abc123",
    processingStatus: "ready",
    ...overrides
  };
}

describe("computeFileHash", () => {
  it("is deterministic sha-256 hex", () => {
    const buf = Buffer.from("hello world");
    const hash1 = computeFileHash(buf);
    const hash2 = computeFileHash(Buffer.from("hello world"));
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different content", () => {
    expect(computeFileHash(Buffer.from("a"))).not.toBe(computeFileHash(Buffer.from("b")));
  });
});

describe("detectDuplicate", () => {
  it("reports no duplicate when nothing found", () => {
    expect(detectDuplicate(null)).toEqual({ isDuplicate: false });
  });

  it("reports duplicate with existing book id", () => {
    expect(detectDuplicate({ id: "existing-1" })).toEqual({ isDuplicate: true, existingBookId: "existing-1" });
  });
});

describe("buildDetectedMeta", () => {
  it("uses detected values when present", () => {
    const meta = buildDetectedMeta({ title: "  Real Title  ", author: "Jane Doe", language: "en" }, "fallback");
    expect(meta).toEqual({ title: "Real Title", author: "Jane Doe", language: "en" });
  });

  it("falls back to filename-derived title and Unknown author when missing", () => {
    const meta = buildDetectedMeta({}, "My Book");
    expect(meta).toEqual({ title: "My Book", author: "Unknown" });
  });

  it("omits language when blank", () => {
    const meta = buildDetectedMeta({ title: "T", author: "A", language: "   " }, "fallback");
    expect(meta).toEqual({ title: "T", author: "A" });
  });
});

describe("buildBookDraft", () => {
  it("normalizes title/author and defaults processingStatus to ready, with no cover by default", () => {
    const draft = buildBookDraft({ title: "  T  ", author: " A ", fileHash: "hash1" });
    expect(draft).toEqual({
      title: "T",
      author: "A",
      fileHash: "hash1",
      tags: [],
      processingStatus: "ready",
      coverKey: null
    });
  });

  it("falls back to Untitled/Unknown for blank strings", () => {
    const draft = buildBookDraft({ title: "  ", author: "  ", fileHash: "hash2" });
    expect(draft.title).toBe("Untitled");
    expect(draft.author).toBe("Unknown");
  });

  it("carries through an already-resolved coverKey", () => {
    const draft = buildBookDraft({ title: "T", author: "A", fileHash: "hash1", coverKey: "hash1-cover.jpg" });
    expect(draft.coverKey).toBe("hash1-cover.jpg");
  });
});

describe("toBookSummary", () => {
  it("projects the public fields and includes the presigned coverUrl passed in", () => {
    const book = makeBook({ tags: ["sci-fi", "physics"] });
    expect(toBookSummary(book, "https://example.com/presigned-cover")).toEqual({
      id: "book-1",
      title: "Some Title",
      author: "Some Author",
      tags: ["sci-fi", "physics"],
      coverUrl: "https://example.com/presigned-cover",
      fileHash: "abc123",
      processingStatus: "ready"
    });
  });

  it("uses null coverUrl when the book has no cover", () => {
    const book = makeBook();
    expect(toBookSummary(book, null).coverUrl).toBeNull();
  });
});

describe("updateBookMetadata", () => {
  it("accepts an empty patch (no fields provided -> nothing changes)", () => {
    expect(updateBookMetadata({})).toEqual({ valid: true, patch: {} });
  });

  it("trims and accepts a valid title", () => {
    expect(updateBookMetadata({ title: "  New Title  " })).toEqual({
      valid: true,
      patch: { title: "New Title" }
    });
  });

  it("rejects a non-string title", () => {
    expect(updateBookMetadata({ title: 123 })).toEqual({ valid: false });
  });

  it("rejects a blank title", () => {
    expect(updateBookMetadata({ title: "   " })).toEqual({ valid: false });
  });

  it("trims and accepts a valid author", () => {
    expect(updateBookMetadata({ author: "  Jane Doe  " })).toEqual({
      valid: true,
      patch: { author: "Jane Doe" }
    });
  });

  it("rejects a non-string author", () => {
    expect(updateBookMetadata({ author: null })).toEqual({ valid: false });
  });

  it("rejects a blank author", () => {
    expect(updateBookMetadata({ author: "" })).toEqual({ valid: false });
  });

  it("trims and accepts a valid tags array", () => {
    expect(updateBookMetadata({ tags: ["  sci-fi  ", "physics"] })).toEqual({
      valid: true,
      patch: { tags: ["sci-fi", "physics"] }
    });
  });

  it("accepts an empty tags array (clears all tags)", () => {
    expect(updateBookMetadata({ tags: [] })).toEqual({ valid: true, patch: { tags: [] } });
  });

  it("rejects tags that are not an array", () => {
    expect(updateBookMetadata({ tags: "sci-fi" })).toEqual({ valid: false });
  });

  it("rejects a tags array with a non-string element", () => {
    expect(updateBookMetadata({ tags: ["sci-fi", 42] })).toEqual({ valid: false });
  });

  it("rejects a tags array with a blank string element", () => {
    expect(updateBookMetadata({ tags: ["sci-fi", "   "] })).toEqual({ valid: false });
  });

  it("combines multiple valid fields into one patch", () => {
    expect(updateBookMetadata({ title: "T", author: "A", tags: ["x"] })).toEqual({
      valid: true,
      patch: { title: "T", author: "A", tags: ["x"] }
    });
  });
});

describe("authorizeBookAccess", () => {
  it("denies access when book is null (not found)", () => {
    expect(authorizeBookAccess(null, "user-1")).toBe(false);
  });

  it("denies access when userId does not match owner", () => {
    expect(authorizeBookAccess(makeBook({ userId: "other-user" }), "user-1")).toBe(false);
  });

  it("grants access when userId matches owner", () => {
    expect(authorizeBookAccess(makeBook({ userId: "user-1" }), "user-1")).toBe(true);
  });
});
