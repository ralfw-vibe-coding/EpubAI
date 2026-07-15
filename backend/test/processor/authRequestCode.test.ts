import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/userRepo.js", () => ({
  findOrCreateByEmail: vi.fn(),
  setOtp: vi.fn()
}));
vi.mock("../../src/providers/x/otpCheck.js", () => ({
  generateOtp: vi.fn()
}));
vi.mock("../../src/providers/x/resend.js", () => ({
  sendOtpEmail: vi.fn()
}));

import { authRequestCode } from "../../src/processor/authRequestCode.js";
import * as userRepo from "../../src/providers/d/userRepo.js";
import * as otpCheck from "../../src/providers/x/otpCheck.js";
import * as resend from "../../src/providers/x/resend.js";

const GENERATED_OTP = { code: "ABCD2345", hash: "hash-of-abcd2345", expiresAt: "2026-01-01T12:10:00.000Z" };

describe("authRequestCode reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (userRepo.findOrCreateByEmail as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-1",
      email: "someone@example.com",
      createdAt: "2026-01-01T00:00:00.000Z"
    });
    (otpCheck.generateOtp as ReturnType<typeof vi.fn>).mockReturnValue(GENERATED_OTP);
  });

  it("finds-or-creates the user, stores a freshly generated code, and emails it", async () => {
    const result = await authRequestCode({ email: "  Someone@Example.com  " });

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(userRepo.findOrCreateByEmail).toHaveBeenCalledWith("someone@example.com");
    expect(userRepo.setOtp).toHaveBeenCalledWith("user-1", GENERATED_OTP.hash, GENERATED_OTP.expiresAt);
    expect(resend.sendOtpEmail).toHaveBeenCalledWith("someone@example.com", GENERATED_OTP.code);
  });

  it("rejects an invalid email without touching any provider", async () => {
    const result = await authRequestCode({ email: "not-an-email" });

    expect(result.status).toBe(400);
    expect(userRepo.findOrCreateByEmail).not.toHaveBeenCalled();
    expect(resend.sendOtpEmail).not.toHaveBeenCalled();
  });

  it("rejects a non-string email", async () => {
    const result = await authRequestCode({ email: 12345 });
    expect(result.status).toBe(400);
  });

  it("returns 502 when the email fails to send, but the code stays stored", async () => {
    (resend.sendOtpEmail as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Resend down"));

    const result = await authRequestCode({ email: "someone@example.com" });

    expect(result).toEqual({ status: 502, body: { error: "email_send_failed" } });
    expect(userRepo.setOtp).toHaveBeenCalled();
  });
});
