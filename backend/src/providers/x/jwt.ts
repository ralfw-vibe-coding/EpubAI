import jwt from "jsonwebtoken";
import { env } from "../../config.js";

export interface SessionPayload {
  userId: string;
}

// xProvider: JWT signer/verifier. TTL comes from server config (JWT_TTL_SECONDS,
// deliberately long-lived - see Requirements 4.2b).
export function sign(payload: SessionPayload): string {
  return jwt.sign(payload, env.AUTH_SESSION_SECRET, { expiresIn: env.JWT_TTL_SECONDS });
}

export function verify(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, env.AUTH_SESSION_SECRET);
    if (typeof decoded === "object" && decoded !== null && typeof (decoded as Record<string, unknown>).userId === "string") {
      return { userId: (decoded as Record<string, unknown>).userId as string };
    }
    return null;
  } catch {
    return null;
  }
}

export function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  return match ? match[1] : null;
}
