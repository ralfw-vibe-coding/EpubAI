import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/annotationRepo.js", () => ({
  findById: vi.fn(),
  update: vi.fn()
}));

import { updateAnnotation } from "../../src/processor/updateAnnotation.js";
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

describe("updateAnnotation reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a token, never touching the repo", async () => {
    const result = await updateAnnotation(undefined, "annotation-1", { note: "new note" });
    expect(result.status).toBe(401);
    expect(annotationRepo.findById).not.toHaveBeenCalled();
  });

  it("returns 404 when the annotation does not exist", async () => {
    const token = sign({ userId: "user-1" });
    (annotationRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await updateAnnotation(`Bearer ${token}`, "missing", { note: "new note" });
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(annotationRepo.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the annotation belongs to a different user (never leaks ownership)", async () => {
    const token = sign({ userId: "user-1" });
    (annotationRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeAnnotation({ userId: "someone-else" })
    );

    const result = await updateAnnotation(`Bearer ${token}`, "annotation-1", { note: "new note" });
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(annotationRepo.update).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-string, non-null note", async () => {
    const token = sign({ userId: "user-1" });
    (annotationRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeAnnotation());

    const result = await updateAnnotation(`Bearer ${token}`, "annotation-1", { note: 42 });
    expect(result).toEqual({ status: 400, body: { error: "invalid_request" } });
    expect(annotationRepo.update).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid color, never touching the repo", async () => {
    const token = sign({ userId: "user-1" });
    (annotationRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeAnnotation());

    const result = await updateAnnotation(`Bearer ${token}`, "annotation-1", { color: "red" });
    expect(result).toEqual({ status: 400, body: { error: "invalid_request" } });
    expect(annotationRepo.update).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-string color", async () => {
    const token = sign({ userId: "user-1" });
    (annotationRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeAnnotation());

    const result = await updateAnnotation(`Bearer ${token}`, "annotation-1", { color: 42 });
    expect(result).toEqual({ status: 400, body: { error: "invalid_request" } });
    expect(annotationRepo.update).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid color even when a valid note is also present (nothing partially applied)", async () => {
    const token = sign({ userId: "user-1" });
    (annotationRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeAnnotation());

    const result = await updateAnnotation(`Bearer ${token}`, "annotation-1", { note: "new note", color: "red" });
    expect(result).toEqual({ status: 400, body: { error: "invalid_request" } });
    expect(annotationRepo.update).not.toHaveBeenCalled();
  });

  it("trims and updates only the note when color is omitted, returning the updated annotation", async () => {
    const token = sign({ userId: "user-1" });
    (annotationRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeAnnotation());
    (annotationRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeAnnotation({ note: "new note", updatedAt: "2026-01-02T00:00:00.000Z" })
    );

    const result = await updateAnnotation(`Bearer ${token}`, "annotation-1", { note: "  new note  " });

    expect(annotationRepo.update).toHaveBeenCalledWith("annotation-1", { note: "new note" });
    expect(result).toEqual({
      status: 200,
      body: {
        id: "annotation-1",
        bookId: "book-1",
        cfiRange: "cfi-1",
        excerpt: "Some text",
        note: "new note",
        color: "accent",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z"
      }
    });
  });

  it("treats an explicit null note as clearing the note", async () => {
    const token = sign({ userId: "user-1" });
    (annotationRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeAnnotation({ note: "old note" }));
    (annotationRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeAnnotation({ note: null }));

    const result = await updateAnnotation(`Bearer ${token}`, "annotation-1", { note: null });

    expect(annotationRepo.update).toHaveBeenCalledWith("annotation-1", { note: null });
    expect((result.body as { note: string | null }).note).toBeNull();
  });

  it("treats a whitespace-only note as clearing the note", async () => {
    const token = sign({ userId: "user-1" });
    (annotationRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeAnnotation({ note: "old note" }));
    (annotationRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeAnnotation({ note: null }));

    await updateAnnotation(`Bearer ${token}`, "annotation-1", { note: "   " });

    expect(annotationRepo.update).toHaveBeenCalledWith("annotation-1", { note: null });
  });

  it("updates only the color when note is omitted, leaving the note untouched", async () => {
    const token = sign({ userId: "user-1" });
    (annotationRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeAnnotation({ note: "old note" }));
    (annotationRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeAnnotation({ note: "old note", color: "yellow", updatedAt: "2026-01-02T00:00:00.000Z" })
    );

    const result = await updateAnnotation(`Bearer ${token}`, "annotation-1", { color: "yellow" });

    expect(annotationRepo.update).toHaveBeenCalledWith("annotation-1", { color: "yellow" });
    expect(result).toEqual({
      status: 200,
      body: {
        id: "annotation-1",
        bookId: "book-1",
        cfiRange: "cfi-1",
        excerpt: "Some text",
        note: "old note",
        color: "yellow",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z"
      }
    });
  });

  it("updates both note and color when both are present", async () => {
    const token = sign({ userId: "user-1" });
    (annotationRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeAnnotation());
    (annotationRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeAnnotation({ note: "new note", color: "green" })
    );

    const result = await updateAnnotation(`Bearer ${token}`, "annotation-1", { note: "new note", color: "green" });

    expect(annotationRepo.update).toHaveBeenCalledWith("annotation-1", { note: "new note", color: "green" });
    expect(result.status).toBe(200);
    expect((result.body as { note: string; color: string }).note).toBe("new note");
    expect((result.body as { note: string; color: string }).color).toBe("green");
  });

  it("touches neither field when neither note nor color is present", async () => {
    const token = sign({ userId: "user-1" });
    (annotationRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeAnnotation());
    (annotationRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(makeAnnotation());

    const result = await updateAnnotation(`Bearer ${token}`, "annotation-1", {});

    expect(annotationRepo.update).toHaveBeenCalledWith("annotation-1", {});
    expect(result.status).toBe(200);
  });
});
