import type { Clock } from '../../processor/ports';

/** Wall-clock xProvider. */
export function createClock(): Clock {
	return {
		nowIso(): string {
			return new Date().toISOString();
		}
	};
}
