import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/bookRepo.js", () => ({ findById: vi.fn() }));
vi.mock("../../src/providers/d/loanRepo.js", () => ({ markAllReturned: vi.fn() }));

import { returnAllLoans } from "../../src/processor/returnAllLoans.js";
import * as bookRepo from "../../src/providers/d/bookRepo.js";
import * as loanRepo from "../../src/providers/d/loanRepo.js";
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
    dossierUploadedAt: null,
    aiCostUsd: 0,
    archivedAt: null,
    originalFilename: null,
    dossierCostUsd: 0,
    ...overrides
  } as Book;
}

const token = () => `Bearer ${sign({ userId: "user-1" })}`;

describe("returnAllLoans reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeBook());
    (loanRepo.markAllReturned as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  });

  it("gibt 401 ohne Token zurück, ohne etwas zu ändern", async () => {
    const result = await returnAllLoans(undefined, "book-1");
    expect(result).toEqual({ status: 401, body: { error: "unauthorized" } });
    expect(loanRepo.markAllReturned).not.toHaveBeenCalled();
  });

  it("gibt 404 für ein fremdes Buch zurück und rührt dessen Ausleihen nicht an", async () => {
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeBook({ userId: "jemand-anderes" })
    );
    const result = await returnAllLoans(token(), "book-1");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(loanRepo.markAllReturned).not.toHaveBeenCalled();
  });

  it("gibt 404 zurück, wenn es das Buch nicht gibt", async () => {
    (bookRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await returnAllLoans(token(), "weg")).toEqual({
      status: 404,
      body: { error: "not_found" }
    });
  });

  // Der Fall, für den es die Route gibt: Eine Ausleihe haftet an einem Gerät,
  // das es nicht mehr gibt. Über die geräte-eingegrenzte Rückgabe war sie
  // nicht mehr aufzulösen, und das Buch damit nie wieder archivierbar.
  it("beendet alle offenen Ausleihen und meldet ihre Zahl", async () => {
    (loanRepo.markAllReturned as ReturnType<typeof vi.fn>).mockResolvedValue(2);

    const result = await returnAllLoans(token(), "book-1");

    expect(result).toEqual({ status: 200, body: { returned: 2 } });
    expect(loanRepo.markAllReturned).toHaveBeenCalledWith("book-1", "user-1");
  });

  // Kein Fehler, wenn nichts offen war: Der gewünschte Zustand besteht schon.
  it("ist idempotent - ohne offene Ausleihe kommt 200 mit 0", async () => {
    expect(await returnAllLoans(token(), "book-1")).toEqual({
      status: 200,
      body: { returned: 0 }
    });
  });
});
