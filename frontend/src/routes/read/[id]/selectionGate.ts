// Wann die Farbleiste zu einer Textauswahl erscheinen darf. Rein und ohne
// DOM, wie die anderen kleinen Teile dieser Seite (swipe.ts, tocHref.ts) -
// die Reihenfolge der Ereignisse ist hier das Kniffelige, und im Browser
// lässt sie sich kaum gezielt durchspielen.

/**
 * Die Leiste soll erst kommen, wenn das Auswählen abgeschlossen ist. Sonst
 * steht sie mitten im Weg, während man die Auswahl noch aufzieht.
 *
 * Das allein über epub.js zu lösen geht nicht: Es meldet eine Auswahl schon
 * 250 ms nach der letzten Änderung (contents.js, onSelectionChange). Wer beim
 * Ziehen kurz innehält, bekommt die Leiste mitten hinein - und sie bleibt
 * stehen, während er weiterzieht.
 *
 * Zwei Bedingungen müssen deshalb zusammenkommen:
 *   - Die Auswahl hat sich eine Weile nicht mehr geändert (`settled`).
 *   - Es liegt kein Finger mehr auf der Seite (`touching`).
 *
 * Die zweite ist die Kür, die erste die Pflicht: Auf iOS zeichnet das System
 * die Greifpunkte der Auswahl selbst, deren Berührungen erreichen die Seite
 * womöglich nie. Dann trägt allein das Abwarten.
 */
export interface SelectionGate<S> {
	/** Was die Oberfläche zeigt - `null` heißt: keine Leiste. */
	visible: S | null;
	/** Die zuletzt gemeldete Auswahl, noch nicht unbedingt gezeigt. */
	pending: S | null;
	/** Hat sich die Auswahl lange genug nicht geändert? */
	settled: boolean;
	/** Liegt gerade ein Finger auf der Seite? */
	touching: boolean;
}

export type SelectionEvent<S> =
	/** Die Auswahl im Dokument hat sich geändert (rohes selectionchange). */
	| { type: 'changed' }
	/**
	 * Die Wartezeit nach der letzten Änderung ist abgelaufen. `text` ist der
	 * dann noch ausgewählte Text - leer heißt, die Auswahl wurde aufgehoben.
	 */
	| { type: 'settled'; text: string }
	/** epub.js hat eine Auswahl samt CFI gemeldet. */
	| { type: 'candidate'; selection: S }
	| { type: 'touchStart' }
	| { type: 'touchEnd' }
	/** Fertig mit dieser Auswahl: markiert, abgebrochen, danebengetippt. */
	| { type: 'dismiss' };

export function initialGate<S>(): SelectionGate<S> {
	return { visible: null, pending: null, settled: false, touching: false };
}

/** Zeigen, sobald Auswahl UND Finger zur Ruhe gekommen sind. */
function reveal<S>(state: SelectionGate<S>): SelectionGate<S> {
	if (!state.settled || state.touching || !state.pending) return state;
	return { ...state, visible: state.pending };
}

export function nextGate<S>(state: SelectionGate<S>, event: SelectionEvent<S>): SelectionGate<S> {
	switch (event.type) {
		case 'changed':
			// Jede Änderung nimmt die Leiste sofort wieder weg und lässt die
			// Wartezeit von vorn laufen. Wer weiterzieht, bekommt sie nie zu sehen.
			return { ...state, visible: null, settled: false };
		case 'settled': {
			// Beim Aufheben der Auswahl feuert selectionchange ebenso. Dann ist
			// der gemerkte Stand veraltet und muss weg - sonst erschiene die
			// Leiste zu einer Auswahl, die es nicht mehr gibt.
			const pending = event.text ? state.pending : null;
			return reveal({ ...state, settled: true, pending });
		}
		case 'candidate':
			return reveal({ ...state, pending: event.selection });
		case 'touchStart':
			return { ...state, touching: true };
		case 'touchEnd':
			return reveal({ ...state, touching: false });
		case 'dismiss':
			// `pending` MUSS mit weg: Die markierte Stelle bleibt im Dokument oft
			// ausgewählt stehen, und sonst käme die Leiste gleich darauf von
			// selbst zurück.
			return { ...state, visible: null, pending: null };
	}
}
