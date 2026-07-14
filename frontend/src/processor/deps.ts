import type { ReaderDomain } from '../domain';
import type { AuthStore, Clock, DeviceProvider, FileStore, HttpClient } from './ports';

/**
 * The full set of dependencies a reactor may compose: the Domain plus the
 * xProviders. Each reactor takes exactly this bag (and its action arguments)
 * and does nothing but wire them together — no domain logic of its own.
 */
export interface ReactorDeps {
	domain: ReaderDomain;
	http: HttpClient;
	files: FileStore;
	clock: Clock;
	device: DeviceProvider;
	auth: AuthStore;
}
