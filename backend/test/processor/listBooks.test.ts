import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  listByUser: vi.fn()
}));

import { listBooks } from "../../src/processor/listBooks.js";
import * as bookRepo from "../../src/providers/d/bookRepo.js";
import { sign } from "../../src/providers/x/jwt.js";
import type { Book } from "../../src/domain/types.js";

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "book-1",
    userId: "user-1",
    title: "T",
    author: "A",
    tags: [],
    coverUrl: null,
    addedAt: "2026-01-01T00:00:00.000Z",
    currentFileHash: "hash-1",
    processingStatus: "ready",
    ...overrides
  };
}

describe("listBooks reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a bearer token, never touching the repo", async () => {
    const result = await listBooks(undefined);
    expect(result).toEqual({ status: 401, body: { error: "unauthorized" } });
    expect(bookRepo.listByUser).not.toHaveBeenCalled();
  });

  it("returns 401 for a malformed token", async () => {
    const result = await listBooks("Bearer not-a-real-token");
    expect(result.status).toBe(401);
  });

  it("lists the caller's own books as summaries, filtered by userId from the JWT", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.listByUser as ReturnType<typeof vi.fn>).mockResolvedValue([makeBook({ tags: ["a", "b"] })]);

    const result = await listBooks(`Bearer ${token}`);

    expect(bookRepo.listByUser).toHaveBeenCalledWith("user-1");
    expect(result).toEqual({
      status: 200,
      body: {
        books: [
          { id: "book-1", title: "T", author: "A", tags: ["a", "b"], fileHash: "hash-1", processingStatus: "ready" }
        ]
      }
    });
  });
});
