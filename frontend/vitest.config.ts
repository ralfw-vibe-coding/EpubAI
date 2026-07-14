import { defineConfig } from 'vitest/config';

// Deliberately does NOT load the SvelteKit plugin: the covered units (domain RPUs,
// reactors, the HTTP xProvider) are framework-agnostic and testable in plain Node.
// Portals (Svelte components) and browser-only providers (SQLite-Wasm/OPFS, epub.js)
// are excluded from coverage per the test strategy (Requirements 4.7).
export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: [
				'src/domain/**/*.ts',
				'src/processor/**/*.ts',
				'src/providers/x/http.ts'
			],
			exclude: [
				'src/**/*.test.ts',
				// Type-only modules (no runtime code) — nothing to cover.
				'src/domain/types.ts',
				'src/domain/ports.ts',
				'src/processor/ports.ts',
				'src/processor/deps.ts'
			],
			thresholds: {
				lines: 80,
				functions: 80,
				statements: 80,
				branches: 80
			}
		}
	}
});
