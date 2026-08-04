import { describe, expect, it } from 'vitest';
import { planAnnotationMerge, planAnnotationPush, type SyncedAnnotation } from './annotationSync';
import type { Annotation } from './types';

function annotation(id: string, updatedAt: string, note: string | null = null): Annotation {
	return {
		id,
		bookId: 'book-1',
		cfiRange: 'epubcfi(/6/4!/4/2)',
		excerpt: 'Text',
		note,
		color: 'accent',
		tags: [],
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt
	};
}

function local(
	a: Annotation,
	{ serverKnown = true, dirty = false } = {}
): SyncedAnnotation {
	return { annotation: a, serverKnown, dirty };
}

describe('planAnnotationPush', () => {
	it('reicht offline angelegte Markierungen als Neuanlage nach', () => {
		const fresh = annotation('a', '2026-01-02T00:00:00.000Z');
		const plan = planAnnotationPush([local(fresh, { serverKnown: false, dirty: true })], []);
		expect(plan.toCreate).toEqual([fresh]);
		expect(plan.toUpdate).toEqual([]);
	});

	it('reicht lokale Bearbeitungen bekannter Markierungen als Aktualisierung nach', () => {
		const edited = annotation('a', '2026-01-02T00:00:00.000Z', 'geändert');
		const plan = planAnnotationPush([local(edited, { dirty: true })], []);
		expect(plan.toCreate).toEqual([]);
		expect(plan.toUpdate).toEqual([edited]);
	});

	it('lässt abgeglichene Markierungen in Ruhe', () => {
		const plan = planAnnotationPush([local(annotation('a', '2026-01-02T00:00:00.000Z'))], []);
		expect(plan.toCreate).toEqual([]);
		expect(plan.toUpdate).toEqual([]);
		expect(plan.toDelete).toEqual([]);
	});

	it('reicht Grabsteine als Löschung nach', () => {
		const plan = planAnnotationPush([], ['weg-1', 'weg-2']);
		expect(plan.toDelete).toEqual(['weg-1', 'weg-2']);
	});

	it('legt nichts an, was zugleich zum Löschen vorgemerkt ist', () => {
		const doomed = annotation('a', '2026-01-02T00:00:00.000Z');
		const plan = planAnnotationPush([local(doomed, { serverKnown: false, dirty: true })], ['a']);
		expect(plan.toCreate).toEqual([]);
		expect(plan.toUpdate).toEqual([]);
		expect(plan.toDelete).toEqual(['a']);
	});
});

describe('planAnnotationMerge', () => {
	it('übernimmt Markierungen, die es lokal noch nicht gibt', () => {
		const incoming = annotation('a', '2026-01-02T00:00:00.000Z');
		const plan = planAnnotationMerge([], [incoming], []);
		expect(plan.toSave).toEqual([incoming]);
		expect(plan.toRemove).toEqual([]);
	});

	it('behält eine noch nicht hochgereichte Markierung, die der Server nicht kennt', () => {
		const offline = annotation('a', '2026-01-02T00:00:00.000Z');
		const plan = planAnnotationMerge(
			[local(offline, { serverKnown: false, dirty: true })],
			[],
			[]
		);
		expect(plan.toSave).toEqual([]);
		expect(plan.toRemove).toEqual([]);
	});

	it('löscht lokal, was der Server einmal kannte und nicht mehr führt', () => {
		const gone = annotation('a', '2026-01-02T00:00:00.000Z');
		const plan = planAnnotationMerge([local(gone)], [], []);
		expect(plan.toRemove).toEqual(['a']);
	});

	// "Löschung: löschen gewinnt" - auch gegen eine offene lokale Bearbeitung.
	it('löscht auch dann, wenn lokal noch eine Bearbeitung offen ist', () => {
		const edited = annotation('a', '2026-01-09T00:00:00.000Z', 'meine Notiz');
		const plan = planAnnotationMerge([local(edited, { dirty: true })], [], []);
		expect(plan.toRemove).toEqual(['a']);
		expect(plan.toSave).toEqual([]);
	});

	// "Löschung: löschen gewinnt" - gegen einen Server, der sie noch führt.
	it('sammelt eine hier gelöschte Markierung nicht wieder ein', () => {
		const stillOnServer = annotation('a', '2026-01-02T00:00:00.000Z');
		const plan = planAnnotationMerge([], [stillOnServer], ['a']);
		expect(plan.toSave).toEqual([]);
		expect(plan.toRemove).toEqual([]);
	});

	// "Notizen: zuletzt geschrieben gewinnt"
	it('übernimmt die neuere Fassung vom Server', () => {
		const mine = annotation('a', '2026-01-02T00:00:00.000Z', 'alt');
		const theirs = annotation('a', '2026-01-03T00:00:00.000Z', 'neu');
		const plan = planAnnotationMerge([local(mine, { dirty: true })], [theirs], []);
		expect(plan.toSave).toEqual([theirs]);
	});

	it('behält die neuere lokale Bearbeitung', () => {
		const mine = annotation('a', '2026-01-04T00:00:00.000Z', 'neu');
		const theirs = annotation('a', '2026-01-03T00:00:00.000Z', 'alt');
		const plan = planAnnotationMerge([local(mine, { dirty: true })], [theirs], []);
		expect(plan.toSave).toEqual([]);
		expect(plan.toRemove).toEqual([]);
	});

	it('behält bei gleichem Zeitstempel die noch offene lokale Bearbeitung', () => {
		const mine = annotation('a', '2026-01-03T00:00:00.000Z', 'lokal');
		const theirs = annotation('a', '2026-01-03T00:00:00.000Z', 'server');
		const plan = planAnnotationMerge([local(mine, { dirty: true })], [theirs], []);
		expect(plan.toSave).toEqual([]);
	});

	it('überschreibt einen sauberen lokalen Eintrag ohne Rücksicht auf den Zeitstempel', () => {
		// Ein nicht bearbeiteter lokaler Eintrag stammt selbst vom Server - dann
		// gibt es nichts zu verteidigen, und die Serverfassung gilt.
		const mine = annotation('a', '2026-01-04T00:00:00.000Z');
		const theirs = annotation('a', '2026-01-03T00:00:00.000Z', 'server');
		const plan = planAnnotationMerge([local(mine)], [theirs], []);
		expect(plan.toSave).toEqual([theirs]);
	});
});
