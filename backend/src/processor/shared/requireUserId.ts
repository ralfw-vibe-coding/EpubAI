import * as jwtProvider from "../../providers/x/jwt.js";

export class AuthError extends Error {}

/**
 * Shared composition step used by every protected Reactor: turns the raw
 * Authorization header into a userId by calling the JWT xProvider. Kept out
 * of the Portal because xProviders are only ever used by Reactors.
 */
export function requireUserId(authorizationHeader: string | undefined): string {
  const token = jwtProvider.extractBearerToken(authorizationHeader);
  if (!token) throw new AuthError("missing bearer token");

  const session = jwtProvider.verify(token);
  if (!session) throw new AuthError("invalid or expired token");

  return session.userId;
}
