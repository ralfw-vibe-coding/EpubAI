import type { ReactorDeps } from '../deps';
import type { Session } from '../ports';

/**
 * Reactor: verify the OTP and establish a session (POST /auth/login/verify).
 * On success the session (long-lived JWT + userId) is persisted via the auth
 * xProvider so subsequent requests are authenticated.
 */
export async function verifyLoginCode(
	deps: Pick<ReactorDeps, 'http' | 'auth'>,
	email: string,
	code: string
): Promise<Session> {
	const session = await deps.http.verifyLoginCode(email, code);
	deps.auth.set(session);
	return session;
}
