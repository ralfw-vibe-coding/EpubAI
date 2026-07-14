import type { ReactorDeps } from '../deps';

/** Reactor: sign out — discard the local session/JWT. */
export async function signOut(deps: Pick<ReactorDeps, 'auth'>): Promise<void> {
	deps.auth.clear();
}
