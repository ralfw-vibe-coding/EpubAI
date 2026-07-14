import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendOtpPlaceholder } from "../../src/providers/x/emailPlaceholder.js";

describe("sendOtpPlaceholder", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the intent to send without throwing", () => {
    expect(() => sendOtpPlaceholder("someone@example.com")).not.toThrow();
    expect(console.log).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("someone@example.com"));
  });
});
