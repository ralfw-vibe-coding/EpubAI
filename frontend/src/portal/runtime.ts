import { env } from '$env/dynamic/public';
import { createReaderDomain } from '../domain';
import { createProcessor, type Processor } from '../processor';
import { createDProvider } from '../providers/d/dprovider';
import { createAuthStore } from '../providers/x/auth-store';
import { createClock } from '../providers/x/clock';
import { createDeviceProvider } from '../providers/x/device';
import { createHttpClient } from '../providers/x/http';
import { createFileStore } from '../providers/x/opfs-files';
import type { Session } from '../processor/ports';

/**
 * Portal composition root: wires the real providers, the Domain and the
 * Processor together into one singleton. Browser-only (SQLite Worker, OPFS,
 * localStorage), so it is created lazily on first access from a component.
 */

// PUBLIC_API_BASE_URL overrides this when set (e.g. frontend and backend
// deployed as genuinely separate origins). Otherwise: in a production build
// the backend serves this same static bundle from its own origin (see
// backend/src/server.ts), so relative paths are correct with no config
// needed; local dev runs frontend and backend on different Vite/tsx ports
// (see run.sh), which does need the explicit localhost fallback.
const API_BASE_URL = env.PUBLIC_API_BASE_URL ?? (import.meta.env.DEV ? 'http://localhost:3000' : '');

let processor: Processor | null = null;

const auth = createAuthStore();

export function getProcessor(): Processor {
	if (!processor) {
		const http = createHttpClient(API_BASE_URL, auth);
		const domain = createReaderDomain(createDProvider());
		processor = createProcessor({
			domain,
			http,
			files: createFileStore(),
			clock: createClock(),
			device: createDeviceProvider(),
			auth
		});
	}
	return processor;
}

/** Synchronous check used by the Portal to decide login vs. library at startup. */
export function isAuthenticated(): boolean {
	return auth.get() !== null;
}

/** The current session (token/userId/translationLanguage), or null when signed out. */
export function getSession(): Session | null {
	return auth.get();
}
