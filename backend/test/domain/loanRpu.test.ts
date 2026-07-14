import { describe, expect, it } from "vitest";
import { buildLoanDraft } from "../../src/domain/loanRpu.js";
import type { Book } from "../../src/domain/types.js";

describe("buildLoanDraft", () => {
  it("takes the fileHash from the book, never from caller input", () => {
    const book: Book = {
      id: "book-1",
      userId: "user-1",
      title: "T",
      author: "A",
      tags: [],
      coverUrl: null,
      addedAt: "2026-01-01T00:00:00.000Z",
      currentFileHash: "current-hash",
      processingStatus: "ready"
    };

    const draft = buildLoanDraft(book, "device-42");
    expect(draft).toEqual({ bookId: "book-1", deviceId: "device-42", fileHash: "current-hash" });
  });
});
