import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/loanRepo.js", () => ({
  markReturned: vi.fn()
}));

import { returnLoan } from "../../src/processor/returnLoan.js";
import * as loanRepo from "../../src/providers/d/loanRepo.js";
import { sign } from "../../src/providers/x/jwt.js";

describe("returnLoan reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a token, never touching the repo", async () => {
    const result = await returnLoan(undefined, { bookId: "book-1", deviceId: "device-1" });
    expect(result.status).toBe(401);
    expect(loanRepo.markReturned).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing bookId", async () => {
    const token = sign({ userId: "user-1" });
    const result = await returnLoan(`Bearer ${token}`, { bookId: undefined, deviceId: "device-1" });
    expect(result.status).toBe(400);
    expect(loanRepo.markReturned).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing deviceId", async () => {
    const token = sign({ userId: "user-1" });
    const result = await returnLoan(`Bearer ${token}`, { bookId: "book-1", deviceId: "" });
    expect(result.status).toBe(400);
    expect(loanRepo.markReturned).not.toHaveBeenCalled();
  });

  it("returns 404 when there is no matching active loan", async () => {
    const token = sign({ userId: "user-1" });
    (loanRepo.markReturned as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await returnLoan(`Bearer ${token}`, { bookId: "book-1", deviceId: "device-1" });

    expect(loanRepo.markReturned).toHaveBeenCalledWith("book-1", "user-1", "device-1");
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("marks the loan returned and returns 204 on success", async () => {
    const token = sign({ userId: "user-1" });
    (loanRepo.markReturned as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "loan-1",
      bookId: "book-1",
      userId: "user-1",
      deviceId: "device-1",
      fileHash: "hash-1",
      borrowedAt: "2026-01-01T00:00:00.000Z",
      returnedAt: "2026-01-02T00:00:00.000Z"
    });

    const result = await returnLoan(`Bearer ${token}`, { bookId: "book-1", deviceId: "device-1" });

    expect(loanRepo.markReturned).toHaveBeenCalledWith("book-1", "user-1", "device-1");
    expect(result).toEqual({ status: 204, body: undefined });
  });
});
