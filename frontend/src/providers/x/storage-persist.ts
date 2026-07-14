/**
 * navigator.storage.persist() xProvider — requests persistent storage at app
 * start to reduce eviction of OPFS data under storage pressure (Requirements
 * §4.4, §7). Best-effort: returns false if the API is unavailable or denied.
 */
export async function requestPersistentStorage(): Promise<boolean> {
	try {
		if (!navigator.storage?.persist) return false;
		if (await navigator.storage.persisted()) return true;
		return await navigator.storage.persist();
	} catch {
		return false;
	}
}
