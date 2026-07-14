import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({
  findById: vi.fn()
}));
vi.mock("../../src/providers/d/bookFileRepo.js", () => ({
  findByBookId: vi.fn()
}));
vi.mock("../../src/providers/x/r2.js", () => ({
  getObjectStream: vi.fn()
}));

import { getBookFile } from "../../src/processor/getBookFile.js";
import * as bookRepo from "../../src/providers/d/bookRepo.js";
import * as bookFileRepo from "../../src/providers/d/bookFileRepo.js";
import * as r2 from "../../src/providers/x/r2.js";
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

describe("getBookFile reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a token", async () => {
    const result = await getBookFile(undefined, "book-1");
    expect(result).toEqual({ status: 401, kind: "json", body: { error: "unauthorized" } });
  });

  it("returns 404 when the book belongs to another user", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook({ userId: "other" }));

    const result = await getBookFile(`Bearer ${token}`, "book-1");
    expect(result).toEqual({ status: 404, kind: "json", body: { error: "not_found" } });
    expect(r2.getObjectStream).not.toHaveBeenCalled();
  });

  it("streams the object using the BookFile's storage key when available", async () => {
    const token = sign({ userId: "user-1" });
    const fakeStream = Readable.from([Buffer.from("epub-bytes")]);
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (bookFileRepo.findByBookId as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "bf-1",
      bookId: "book-1",
      storageKey: "hash-1.epub",
      fileHash: "hash-1",
      sizeBytes: 10,
      uploadedAt: "2026-01-01T00:00:00.000Z"
    });
    (r2.getObjectStream as ReturnType<typeof vi.fn>).mockResolvedValue(fakeStream);

    const result = await getBookFile(`Bearer ${token}`, "book-1");

    expect(r2.getObjectStream).toHaveBeenCalledWith("hash-1.epub");
    expect(result.status).toBe(200);
    expect(result.kind).toBe("stream");
  });

  it("falls back to deriving the storage key from fileHash when no BookFile row exists", async () => {
    const token = sign({ userId: "user-1" });
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (bookFileRepo.findByBookId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (r2.getObjectStream as ReturnType<typeof vi.fn>).mockResolvedValue(Readable.from([Buffer.from("x")]));

    await getBookFile(`Bearer ${token}`, "book-1");

    expect(r2.getObjectStream).toHaveBeenCalledWith("hash-1.epub");
  });
});
