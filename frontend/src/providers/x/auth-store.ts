import type { AuthStore, Session } from '../../processor/ports';

const KEY = 'epubai.session';

/**
 * Auth session xProvider, backed by localStorage.
 *
 * Why localStorage and not the SQLite-Wasm DB: the token must be read
 * synchronously at app start — before the SQLite Web Worker has finished
 * booting — to decide login vs. library and to attach the Authorization header
 * to the very first requests. localStorage gives that synchronous access with
 * no async boot. SQLite/OPFS remains reserved for the Domain's relational state
 * (loans, reading progress), which is exactly what §4.4 prescribes.
 */
export function createAuthStore(): AuthStore {
	return {
		get(): Session | null {
			try {
				const raw = localStorage.getItem(KEY);
				return raw ? (JSON.parse(raw) as Session) : null;
			} catch {
				return null;
			}
		},
		set(session: Session): void {
			localStorage.setItem(KEY, JSON.stringify(session));
		},
		clear(): void {
			localStorage.removeItem(KEY);
		}
	};
}
