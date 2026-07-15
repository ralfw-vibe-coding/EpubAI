import { Resend } from "resend";
import { env } from "../../config.js";

// xProvider: real OTP email delivery via Resend (replaces the console.log
// placeholder from the walking skeleton, see Requirements 4.2b). Untested
// like the other thin external-SDK wrappers (r2.ts) - not worth mocking a
// third-party client for.
const client = new Resend(env.RESEND_API_KEY);

// Inline-styled HTML (email clients don't reliably load external/<style>
// CSS, and several strip custom web fonts) - a plain system-font stack and
// a table-based layout keep this rendering consistently across clients.
// Colors are the app's own design tokens (frontend/src/app.css), copied in
// literally since email HTML can't reference CSS custom properties.
function otpEmailHtml(code: string): string {
  return `<!doctype html>
<html lang="de">
  <body style="margin:0; padding:0; background-color:#f3f2f2; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f2f2;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:420px; background-color:#ffffff; border:1px solid #d7d3d3;">
            <tr>
              <td style="padding:32px 32px 8px; text-align:center;">
                <span style="font-size:22px; font-weight:800; color:#201e1d;">EpubAI</span>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 24px; text-align:center; color:#605d5d; font-size:15px; line-height:1.5;">
                Dein Anmeldecode:
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px; text-align:center;">
                <span style="display:inline-block; padding:16px 28px; background-color:#f3f2f2; border:1px solid #d7d3d3; font-size:32px; font-weight:700; letter-spacing:8px; color:#ec3013; font-family:'Courier New',Courier,monospace;">${code}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 32px; text-align:center; color:#605d5d; font-size:13px; line-height:1.5;">
                Gültig für 10 Minuten. Falls du diesen Code nicht angefordert hast, kannst du diese E-Mail ignorieren.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const result = await client.emails.send({
    from: env.AUTH_FROM_EMAIL,
    to: email,
    subject: "Dein EpubAI Anmeldecode",
    text: `Dein Anmeldecode: ${code}\n\nGültig für 10 Minuten.`,
    html: otpEmailHtml(code)
  });

  if (result.error) {
    throw new Error(`Resend: ${result.error.message}`);
  }
}
