import { describe, expect, it } from 'vitest';
import { mergeProgress, planProgressSync } from './readingProgressMerge';
import type { ReadingProgress } from './types';

function progress(overrides: Partial<ReadingProgress> = {}): ReadingProgress {
	return {
		bookId: 'b1',
		cfi: 'epubcfi(/6/2!/4/2/1:0)',
		percent: 10,
		page: 10,
		totalPages: 100,
		updatedAt: '2026-07-13T10:00:00.000Z',
		...overrides
	};
}

describe('mergeProgress', () => {
	it('takes the remote position when it is further along', () => {
		const local = progress({ percent: 20, page: 20, cfi: 'local' });
		const remote = progress({ percent: 55, page: 55, cfi: 'remote' });
		expect(mergeProgress(local, remote)).toEqual(remote);
	});

	it('keeps the local position when it is further along', () => {
		const local = progress({ percent: 80, page: 80, cfi: 'local' });
		const remote = progress({ percent: 55, page: 55, cfi: 'remote' });
		expect(mergeProgress(local, remote)).toEqual(local);
	});

	it('keeps the local position on a tie, so a repeated sync changes nothing', () => {
		const local = progress({ percent: 42, cfi: 'local', updatedAt: '2026-07-13T09:00:00.000Z' });
		// Even a newer remote timestamp does not win — only percent decides.
		const remote = progress({ percent: 42, cfi: 'remote', updatedAt: '2026-07-13T23:00:00.000Z' });
		expect(mergeProgress(local, remote)).toEqual(local);
	});

	it('fills missing page/totalPages from the losing side', () => {
		const local = progress({ percent: 20, page: 20, totalPages: 100 });
		const remote = progress({ percent: 60, page: null, totalPages: null, cfi: 'remote' });
		expect(mergeProgress(local, remote)).toEqual({
			...remote,
			page: 20,
			totalPages: 100
		});
	});

	it('keeps the winner’s own page when it has one', () => {
		const local = progress({ percent: 20, page: 20, totalPages: 100 });
		const remote = progress({ percent: 60, page: 60, totalPages: 90, cfi: 'remote' });
		expect(mergeProgress(local, remote)).toEqual(remote);
	});

	it('returns the remote entry when there is nothing local', () => {
		const remote = progress();
		expect(mergeProgress(null, remote)).toEqual(remote);
	});

	it('returns the local entry when there is nothing remote', () => {
		const local = progress();
		expect(mergeProgress(local, null)).toEqual(local);
	});

	it('returns null when neither side has a position', () => {
		expect(mergeProgress(null, null)).toBeNull();
	});
});

describe('planProgressSync', () => {
	it('does nothing when both sides are empty', () => {
		expect(planProgressSync([], [])).toEqual({ toStoreLocally: [], toPush: [] });
	});

	it('does nothing when both sides are identical', () => {
		const p = progress();
		expect(planProgressSync([p], [{ ...p }])).toEqual({ toStoreLocally: [], toPush: [] });
	});

	it('stores a remote-only book locally without pushing it back', () => {
		const remote = progress({ bookId: 'b2', percent: 33 });
		const plan = planProgressSync([], [remote]);
		expect(plan.toStoreLocally).toEqual([remote]);
		expect(plan.toPush).toEqual([]);
	});

	it('pushes a local-only book without changing anything locally', () => {
		const local = progress({ bookId: 'b3', percent: 12 });
		const plan = planProgressSync([local], []);
		expect(plan.toStoreLocally).toEqual([]);
		expect(plan.toPush).toEqual([local]);
	});

	it('stores the remote position locally when the other device read further', () => {
		const local = progress({ percent: 20, cfi: 'local' });
		const remote = progress({ percent: 70, cfi: 'remote', page: 70 });
		const plan = planProgressSync([local], [remote]);
		expect(plan.toStoreLocally).toEqual([remote]);
		expect(plan.toPush).toEqual([]);
	});

	it('hands over progress made offline: local ahead is pushed, nothing stored', () => {
		const local = progress({ percent: 70, cfi: 'local', page: 70 });
		const remote = progress({ percent: 20, cfi: 'remote', page: 20 });
		const plan = planProgressSync([local], [remote]);
		expect(plan.toStoreLocally).toEqual([]);
		expect(plan.toPush).toEqual([local]);
	});

	it('still stores locally when the winner had to borrow page/totalPages', () => {
		const local = progress({ percent: 70, page: 70, totalPages: 100 });
		const remote = progress({ percent: 70, page: null, totalPages: null, cfi: 'remote' });
		// Tie -> local wins outright and already carries the pages: nothing to do.
		expect(planProgressSync([local], [remote])).toEqual({ toStoreLocally: [], toPush: [] });

		const behind = progress({ percent: 30, page: 30, totalPages: 100 });
		const ahead = progress({ percent: 90, page: null, totalPages: null, cfi: 'remote' });
		const plan = planProgressSync([behind], [ahead]);
		expect(plan.toStoreLocally).toEqual([{ ...ahead, page: 30, totalPages: 100 }]);
		expect(plan.toPush).toEqual([]);
	});

	it('handles several books at once, each on its own merits', () => {
		// page und percent zueinander passend halten (page = percent bei 100
		// Gesamtseiten): verglichen wird vorrangig die Seite, ein davon
		// abweichendes percent waere kein realistischer Stand.
		const at = (bookId: string, p: number, cfi: string) =>
			progress({ bookId, percent: p, page: p, totalPages: 100, cfi });

		const localAhead = at('ahead', 80, 'local');
		const localBehind = at('behind', 10, 'local');
		const localOnly = at('localOnly', 5, 'local');
		const tie = at('tie', 50, 'local');

		const remoteBehind = at('ahead', 30, 'remote');
		const remoteAhead = at('behind', 95, 'remote');
		const remoteOnly = at('remoteOnly', 60, 'remote');
		const remoteTie = at('tie', 50, 'remote');

		const plan = planProgressSync(
			[localAhead, localBehind, localOnly, tie],
			[remoteBehind, remoteAhead, remoteOnly, remoteTie]
		);

		expect(plan.toStoreLocally).toEqual([remoteAhead, remoteOnly]);
		expect(plan.toPush).toEqual([localAhead, localOnly]);
	});

	it('re-stores a position whose timestamp alone changed remotely at the same percent', () => {
		// Tie keeps the local record, so a purely remote timestamp bump is ignored.
		const local = progress({ percent: 50, updatedAt: '2026-07-13T08:00:00.000Z' });
		const remote = progress({ percent: 50, updatedAt: '2026-07-14T08:00:00.000Z' });
		expect(planProgressSync([local], [remote])).toEqual({ toStoreLocally: [], toPush: [] });
	});
});

// Der Fall aus der Praxis: Zwei Browser standen auf Seite 374 bzw. 376 und
// blieben beharrlich stehen. percent ist eine ganze Zahl - bei 400 Seiten
// entspricht 1 % rund vier Seiten, beide Stände sahen darin identisch aus.
describe('Fortschritt feiner als ein Prozentpunkt', () => {
	const auf = (page: number, cfi: string) =>
		progress({ percent: 94, page, totalPages: 400, cfi });

	it('erkennt zwei Seiten Unterschied trotz identischem Prozentwert', () => {
		const local = auf(374, 'lokal');
		const remote = auf(376, 'entfernt');
		expect(mergeProgress(local, remote)).toEqual(remote);
		expect(mergeProgress(remote, local)).toEqual(remote);
	});

	it('reicht den lokalen Vorsprung nach, auch wenn das Prozent gleich bleibt', () => {
		const plan = planProgressSync([auf(376, 'lokal')], [auf(374, 'entfernt')]);
		expect(plan.toPush.map((p) => p.page)).toEqual([376]);
	});

	it('holt den entfernten Vorsprung, auch wenn das Prozent gleich bleibt', () => {
		const plan = planProgressSync([auf(374, 'lokal')], [auf(376, 'entfernt')]);
		expect(plan.toStoreLocally.map((p) => p.page)).toEqual([376]);
		expect(plan.toPush).toEqual([]);
	});

	it('lässt bei exakt gleicher Seite alles unangetastet', () => {
		const plan = planProgressSync([auf(376, 'x')], [auf(376, 'x')]);
		expect(plan.toStoreLocally).toEqual([]);
		expect(plan.toPush).toEqual([]);
	});

	it('fällt auf percent zurück, solange eine Seite fehlt (Locations noch nicht berechnet)', () => {
		const ohneSeite = progress({ percent: 30, page: null, totalPages: null, cfi: 'lokal' });
		const mitSeite = progress({ percent: 60, page: 240, totalPages: 400, cfi: 'entfernt' });
		expect(mergeProgress(ohneSeite, mitSeite)).toEqual(mitSeite);
	});

	it('vergleicht keine Seiten aus unterschiedlichen Gesamtzahlen', () => {
		// Andere Gesamtzahl = andere Berechnungsgrundlage, die Seitenindizes sind
		// nicht vergleichbar. Dann muss percent entscheiden.
		const local = progress({ percent: 50, page: 200, totalPages: 400, cfi: 'lokal' });
		const remote = progress({ percent: 70, page: 70, totalPages: 100, cfi: 'entfernt' });
		expect(mergeProgress(local, remote)).toEqual(remote);
	});
});
