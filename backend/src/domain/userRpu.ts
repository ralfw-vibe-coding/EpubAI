// RPU (Request Processing Unit): nearly-pure function, knows only domain types.

/**
 * Normalizes an email address for identity comparison (case-insensitive,
 * whitespace-trimmed). This is the single rule that decides whether two
 * login attempts refer to the "same" user.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  // Deliberately simple - the walking skeleton is a small, trusted user group.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Normalizes an entered login code for comparison (whitespace-trimmed,
 * uppercased). Generated codes are always uppercase (see otpCheck.ts); this
 * just stops a lowercase/mixed-case entry - e.g. from a keyboard that didn't
 * autocapitalize, or a copy-paste that lowercased it - from failing to match
 * for no security-relevant reason.
 */
export function normalizeOtpCode(code: string): string {
  return code.trim().toUpperCase();
}
