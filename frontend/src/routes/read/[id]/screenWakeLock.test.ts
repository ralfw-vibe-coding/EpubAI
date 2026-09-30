import { describe, expect, it, vi } from 'vitest';
import {
	createWakeLockKeeper,
	type WakeLockApi,
	type WakeLockSentinelLike
} from './screenWakeLock';

/** Eine Sperre, die sich wie die echte vom System einziehen lässt. */
function fakeSentinel() {
	const listeners: Array<() => void> = [];
	const sentinel: WakeLockSentinelLike & { released: boolean } = {
		released: false,
		release: vi.fn(async () => {
			sentinel.released = true;
		}),
		addEventListener: (_type, listener) => listeners.push(listener)
	};
	/** Was das System tut, wenn es die Sperre von sich aus zurücknimmt. */
	const revoke = () => {
		sentinel.released = true;
		for (const l of listeners) l();
	};
	return { sentinel, revoke };
}

function fakeApi(): { api: WakeLockApi; requests: number; last: () => ReturnType<typeof fakeSentinel> } {
	let last: ReturnType<typeof fakeSentinel> | null = null;
	const state = {
		api: {
			request: async () => {
				state.requests++;
				last = fakeSentinel();
				return last.sentinel;
			}
		},
		requests: 0,
		last: () => last!
	};
	return state;
}

describe('createWakeLockKeeper', () => {
	it('fordert die Sperre an und hält sie', async () => {
		const { api } = fakeApi();
		const keeper = createWakeLockKeeper(api);

		expect(keeper.held()).toBe(false);
		expect(await keeper.acquire()).toBe(true);
		expect(keeper.held()).toBe(true);
	});

	it('fordert keine zweite an, wenn schon eine gehalten wird', async () => {
		// Sonst bliebe bei jedem Sichtbarwerden eine Sperre zurück, die niemand
		// mehr freigibt.
		const state = fakeApi();
		const keeper = createWakeLockKeeper(state.api);

		await keeper.acquire();
		await keeper.acquire();
		await keeper.acquire();

		expect(state.requests).toBe(1);
	});

	it('bündelt gleichzeitige Anfragen zu einer', async () => {
		// Öffnen des Buches und ein Sichtbarkeitswechsel unmittelbar danach: beide
		// rufen acquire(), bevor die erste Antwort da ist.
		const state = fakeApi();
		const keeper = createWakeLockKeeper(state.api);

		const [a, b] = await Promise.all([keeper.acquire(), keeper.acquire()]);

		expect(a).toBe(true);
		expect(b).toBe(true);
		expect(state.requests).toBe(1);
	});

	it('fordert nach einem Entzug durch das System eine neue an', async () => {
		// Das System zieht die Sperre ein, sobald das Dokument unsichtbar wird.
		// Ohne das release-Ereignis hielte der Keeper sich weiter für im Besitz
		// einer Sperre - und der Bildschirm ginge beim Weiterlesen wieder aus.
		const state = fakeApi();
		const keeper = createWakeLockKeeper(state.api);
		await keeper.acquire();

		state.last().revoke();
		expect(keeper.held()).toBe(false);

		expect(await keeper.acquire()).toBe(true);
		expect(state.requests).toBe(2);
	});

	it('gibt die Sperre frei und hält danach keine mehr', async () => {
		const state = fakeApi();
		const keeper = createWakeLockKeeper(state.api);
		await keeper.acquire();
		const { sentinel } = state.last();

		await keeper.release();

		expect(sentinel.release).toHaveBeenCalled();
		expect(keeper.held()).toBe(false);
	});

	it('verträgt ein Freigeben ohne Sperre', async () => {
		const { api } = fakeApi();
		await expect(createWakeLockKeeper(api).release()).resolves.toBeUndefined();
	});

	it('schluckt eine Ablehnung, statt zu werfen', async () => {
		// Im Stromsparmodus und bei niedrigem Akku darf das Gerät ablehnen - das
		// ist der Normalfall, kein Fehler, und darf das Öffnen des Buches nicht
		// scheitern lassen.
		const denied: unknown[] = [];
		const keeper = createWakeLockKeeper(
			{ request: async () => Promise.reject(new Error('NotAllowedError')) },
			(r) => denied.push(r)
		);

		expect(await keeper.acquire()).toBe(false);
		expect(keeper.held()).toBe(false);
		expect(denied).toHaveLength(1);
	});

	it('versucht es nach einer Ablehnung beim nächsten Mal wieder', async () => {
		// Der Stromsparmodus kann zwischendurch ausgeschaltet worden sein.
		let fail = true;
		let requests = 0;
		const keeper = createWakeLockKeeper({
			request: async () => {
				requests++;
				if (fail) throw new Error('NotAllowedError');
				return fakeSentinel().sentinel;
			}
		});

		expect(await keeper.acquire()).toBe(false);
		fail = false;
		expect(await keeper.acquire()).toBe(true);
		expect(requests).toBe(2);
	});

	it('tut ohne API schlicht nichts', async () => {
		// Safari auf iOS vor 18.4 setzt sie in Web-Apps vom Home-Screen nicht um.
		for (const api of [null, undefined]) {
			const keeper = createWakeLockKeeper(api);
			expect(await keeper.acquire()).toBe(false);
			expect(keeper.held()).toBe(false);
			await expect(keeper.release()).resolves.toBeUndefined();
		}
	});
});
