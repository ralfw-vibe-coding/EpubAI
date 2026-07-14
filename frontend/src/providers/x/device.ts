import type { DeviceProvider } from '../../processor/ports';

const KEY = 'epubai.deviceId';

/**
 * Device-id xProvider. Generates a UUID once and persists it in localStorage so
 * the same device id is used across sessions for `POST /loans`.
 */
export function createDeviceProvider(): DeviceProvider {
	return {
		id(): string {
			let id = localStorage.getItem(KEY);
			if (!id) {
				id = crypto.randomUUID();
				localStorage.setItem(KEY, id);
			}
			return id;
		}
	};
}
