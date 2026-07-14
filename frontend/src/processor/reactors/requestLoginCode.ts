import type { ReactorDeps } from '../deps';
import type { LoginRequestResult } from '../ports';

/** Reactor: request an OTP for the given e-mail (POST /auth/login/request). */
export async function requestLoginCode(
	deps: Pick<ReactorDeps, 'http'>,
	email: string
): Promise<LoginRequestResult> {
	return deps.http.requestLoginCode(email);
}
