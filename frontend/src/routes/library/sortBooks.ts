import type { BookDetail } from '../../domain/types';

/**
 * Reihenfolge der Bibliothek. Rein und ohne Provider, wie filterBooks.ts.
 */
export type LibrarySort =
	/** Nach Zugang - neue Bücher zuerst. Die bisherige und weiterhin die Standard-Sicht. */
	| 'zugang'
	/** Nach letztem Öffnen - zuletzt Gelesenes zuerst. */
	| 'zuletzt';

export const SORT_OPTIONS: { value: LibrarySort; label: string }[] = [
	{ value: 'zugang', label: 'Zugang' },
	{ value: 'zuletzt', label: 'Zuletzt gelesen' }
];

export function isLibrarySort(value: unknown): value is LibrarySort {
	return value === 'zugang' || value === 'zuletzt';
}

/**
 * Wann wurde das Buch zuletzt geöffnet?
 *
 * Der Lesezeitpunkt stammt aus der Leseposition: Beim Öffnen zeigt epub.js
 * die Seite an, das löst `relocated` aus, und das speichert die Position mit
 * frischem Zeitstempel. Er bedeutet also wirklich "zuletzt geöffnet" und
 * nicht nur "zuletzt weitergeblättert".
 *
 * Nie geöffnet? Dann gilt der Zugang - ein eben hinzugefügtes Buch steht
 * damit oben, wo man es erwartet, und ein vor Monaten hinzugefügtes,
 * ungelesenes weit unten. Ohne diesen Rückfall müsste man sich entscheiden,
 * ob ungelesene Bücher pauschal vorn oder hinten stehen; beides wäre falsch.
 */
export function lastOpenedAt(book: BookDetail): string {
	return book.progress?.updatedAt ?? book.addedAt;
}

/**
 * Sortiert eine Liste - ohne die Eingabe zu verändern.
 *
 * `zugang` lässt die Reihenfolge, wie sie kommt: Das Backend liefert bereits
 * nach Zugang absteigend (order by added_at desc), und der Offline-Spiegel
 * hält diese Reihenfolge fest. Hier noch einmal zu sortieren wäre bestenfalls
 * wirkungslos und schlimmstenfalls eine zweite, abweichende Wahrheit.
 */
export function sortBooks(books: BookDetail[], sort: LibrarySort): BookDetail[] {
	if (sort === 'zugang') return books;
	return [...books].sort((a, b) => lastOpenedAt(b).localeCompare(lastOpenedAt(a)));
}
