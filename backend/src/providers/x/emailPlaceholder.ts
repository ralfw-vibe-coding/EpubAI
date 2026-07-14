// xProvider: E-Mail-Versand-Platzhalter.
// Bewusst kein echter Versand (siehe Requirements 4.2b) - protokolliert nur die Absicht.
// RESEND_API_KEY/AUTH_FROM_EMAIL werden hier absichtlich NICHT verwendet.

export function sendOtpPlaceholder(email: string): void {
  console.log(`[email-placeholder] would send OTP login email to ${email}`);
}
