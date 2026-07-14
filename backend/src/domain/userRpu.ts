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
