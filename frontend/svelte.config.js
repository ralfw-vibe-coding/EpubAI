import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// SPA mode: fully client-side (OPFS, SQLite-Wasm and epub.js are browser-only).
		adapter: adapter({ fallback: 'index.html' })
	}
};

export default config;
