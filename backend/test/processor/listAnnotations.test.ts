import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/annotationRepo.js", () => ({
  listByUser: vi.fn()
}));

import { listAnnotations } from "../../src/processor/listAnnotations.js";
import * as annotationRepo from "../../src/providers/d/annotationRepo.js";
import { sign } from "../../src/providers/x/jwt.js";
import type { Annotation } from "../../src/domain/types.js";

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "annotation-1",
    bookId: "book-1",
    userId: "user-1",
    cfiRange: "cfi-1",
    excerpt: "Some text",
    note: null,
    color: "accent",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("listAnnotations reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a token, never touching the repo", async () => {
    const result = await listAnnotations(undefined);
    expect(result.status).toBe(401);
    expect(annotationRepo.listByUser).not.toHaveBeenCalled();
  });

  it("returns all of the caller's annotations across every book, projected to the public shape", async () => {
    const token = sign({ userId: "user-1" });
    (annotationRepo.listByUser as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeAnnotation({ id: "annotation-1", note: "a note" }),
      makeAnnotation({ id: "annotation-2", bookId: "book-2" })
    ]);

    const result = await listAnnotations(`Bearer ${token}`);

    expect(annotationRepo.listByUser).toHaveBeenCalledWith("user-1");
    expect(result).toEqual({
      status: 200,
      body: {
        annotations: [
          {
            id: "annotation-1",
            bookId: "book-1",
            cfiRange: "cfi-1",
            excerpt: "Some text",
            note: "a note",
            color: "accent",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          },
          {
            id: "annotation-2",
            bookId: "book-2",
            cfiRange: "cfi-1",
            excerpt: "Some text",
            note: null,
            color: "accent",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ]
      }
    });
  });

  it("returns an empty list when the user has no annotations", async () => {
    const token = sign({ userId: "user-1" });
    (annotationRepo.listByUser as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await listAnnotations(`Bearer ${token}`);

    expect(result).toEqual({ status: 200, body: { annotations: [] } });
  });
});
