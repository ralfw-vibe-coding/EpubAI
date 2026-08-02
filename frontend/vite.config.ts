import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		// Eigener Port statt Vites Standard-5173: Der lässt sich mit jedem
		// anderen Vite-Projekt teilen, ohne dass es auffällt. Belegt ein
		// fremder Dev-Server bereits [::1]:5173, kann Vite hier trotzdem noch
		// auf *:5173 binden - beide "laufen" dann, aber der Browser bevorzugt
		// für `localhost` IPv6 und landet beim fremden Projekt. Das sah dann
		// aus wie ein Fehler in EpubAI (fremde Login-Seite, 404, kein
		// OTP-Screen). strictPort erzwingt, dass ein belegter Port als Fehler
		// auffliegt, statt still auf einen anderen auszuweichen.
		port: 5273,
		strictPort: true,
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
