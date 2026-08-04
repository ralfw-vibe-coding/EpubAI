import type { IdProvider } from '../../processor/ports';

/**
 * ID-xProvider: nichts als `crypto.randomUUID()`. Eigener Provider, damit
 * Reactors die Plattformfunktion nicht direkt aufrufen und in Tests durch eine
 * abzählbare Folge ersetzt werden kann (wie bei `Clock`).
 *
 * Das Backend erwartet eine UUID der Versionen 1-5 in Kleinschreibung -
 * `crypto.randomUUID()` liefert genau das (v4, klein).
 */
export function createIdProvider(): IdProvider {
	return {
		newId(): string {
			return crypto.randomUUID();
		}
	};
}
