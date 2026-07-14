import { env } from '$env/dynamic/public';
import { createReaderDomain } from '../domain';
import { createProcessor, type Processor } from '../processor';
import { createDProvider } from '../providers/d/dprovider';
import { createAuthStore } from '../providers/x/auth-store';
import { createClock } from '../providers/x/clock';
import { createDeviceProvider } from '../providers/x/device';
import { createHttpClient } from '../providers/x/http';
import { createFileStore } from '../providers/x/opfs-files';

/**
 * Portal composition root: wires the real providers, the Domain and the
 * Processor together into one singleton. Browser-only (SQLite Worker, OPFS,
 * localStorage), so it is created lazily on first access from a component.
 */

const API_BASE_URL = env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

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
