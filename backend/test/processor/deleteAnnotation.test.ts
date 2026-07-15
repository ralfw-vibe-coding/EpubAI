import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/annotationRepo.js", () => ({
  findById: vi.fn(),
  remove: vi.fn()
}));

import { deleteAnnotation } from "../../src/processor/deleteAnnotation.js";
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

describe("deleteAnnotation reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a token, never touching the repo", async () => {
    const result = await deleteAnnotation(undefined, "annotation-1");
    expect(result.status).toBe(401);
    expect(annotationRepo.findById).not.toHaveBeenCalled();
  });

  it("returns 404 when the annotation does not exist", async () => {
    const token = sign({ userId: "user-1" });
    (annotationRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await deleteAnnotation(`Bearer ${token}`, "missing");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(annotationRepo.remove).not.toHaveBeenCalled();
  });

  it("returns 404 when the annotation belongs to a different user (never leaks ownership)", async () => {
    const token = sign({ userId: "user-1" });
    (annotationRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeAnnotation({ userId: "someone-else" })
    );

    const result = await deleteAnnotation(`Bearer ${token}`, "annotation-1");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(annotationRepo.remove).not.toHaveBeenCalled();
  });

  it("deletes the annotation and returns 204", async () => {
    const token = sign({ userId: "user-1" });
    (annotationRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeAnnotation());

    const result = await deleteAnnotation(`Bearer ${token}`, "annotation-1");

    expect(annotationRepo.remove).toHaveBeenCalledWith("annotation-1");
    expect(result).toEqual({ status: 204, body: undefined });
  });
});
