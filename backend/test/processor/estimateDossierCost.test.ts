import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  findById: vi.fn()
}));
vi.mock("../../src/processor/shared/bookText.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/processor/shared/bookText.js")>();
  return { ...actual, ensureBookText: vi.fn() };
});

import { estimateDossierCost } from "../../src/processor/estimateDossierCost.js";
import * as bookRepo from "../../src/providers/d/bookRepo.js";
import { ensureBookText } from "../../src/processor/shared/bookText.js";
import { sign } from "../../src/providers/x/jwt.js";
import type { Book } from "../../src/domain/types.js";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

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
    dossierUploadedAt: null,
    aiCostUsd: 0,
    archivedAt: null,
    originalFilename: null,
    dossierCostUsd: 0,
    ...overrides
  };
}

const token = () => `Bearer ${sign({ userId: "user-1" })}`;

describe("estimateDossierCost reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked(bookRepo.findById).mockResolvedValue(makeBook());
    mocked(ensureBookText).mockResolvedValue("Ein zwei drei vier fünf Wörter im Buch.");
  });

  it("returns 401 without a token, never touching the repo", async () => {
    const result = await estimateDossierCost(undefined, "book-1");
    expect(result.status).toBe(401);
    expect(bookRepo.findById).not.toHaveBeenCalled();
  });

  it("returns 404 when the book does not exist", async () => {
    mocked(bookRepo.findById).mockResolvedValue(null);
    const result = await estimateDossierCost(token(), "missing-book");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("returns 404 when the book belongs to a different user (never leaks ownership)", async () => {
    mocked(bookRepo.findById).mockResolvedValue(makeBook({ userId: "someone-else" }));
    const result = await estimateDossierCost(token(), "book-1");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("returns 502 text_missing when the book has no extractable text", async () => {
    mocked(ensureBookText).mockResolvedValue(null);
    const result = await estimateDossierCost(token(), "book-1");
    expect(result).toEqual({ status: 502, body: { error: "text_missing" } });
  });

  it("returns a positive estimated cost for a book with text", async () => {
    const result = await estimateDossierCost(token(), "book-1");
    expect(result.status).toBe(200);
    expect((result.body as { estimatedUsd: number }).estimatedUsd).toBeGreaterThan(0);
  });
});
