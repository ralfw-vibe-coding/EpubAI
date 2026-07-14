import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		// Bind both IPv4 and IPv6 loopback - a Vite default of IPv6-only can leave
		// http://127.0.0.1:<port> (and some browser/network configs) unreachable.
		host: true,
		// Allow any Host header - needed so Vite's DNS-rebinding guard doesn't
		// reject requests coming through a temporary tunnel (e.g. ngrok) used
		// for on-device testing, whose hostname changes on every run.
		allowedHosts: true
	},
	worker: {
		format: 'es'
	},
	optimizeDeps: {
		// sqlite-wasm ships its own worker/wasm assets; let Vite serve them as-is.
		exclude: ['@sqlite.org/sqlite-wasm']
	}
});
