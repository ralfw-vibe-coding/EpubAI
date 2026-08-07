import { describe, expect, it } from 'vitest';
import { initialGate, nextGate, type SelectionEvent, type SelectionGate } from './selectionGate';

type Sel = { cfiRange: string; excerpt: string };
const SEL: Sel = { cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:9)', excerpt: 'ein Satz' };
const OTHER: Sel = { cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:20)', excerpt: 'ein längerer Satz' };

/** Ereignisfolge abspielen - so liest sich der Ablauf wie die echte Geste. */
function play(...events: SelectionEvent<Sel>[]): SelectionGate<Sel> {
	return events.reduce(nextGate<Sel>, initialGate<Sel>());
}

describe('selectionGate', () => {
	it('zeigt zu Beginn nichts', () => {
		expect(initialGate<Sel>().visible).toBeNull();
	});

	// Der Kernfall aus der Rückmeldung: Beim Aufziehen der Auswahl darf die
	// Leiste nicht im Weg stehen.
	it('zeigt nichts, solange der Finger noch auf der Seite liegt', () => {
		const state = play(
			{ type: 'touchStart' },
			{ type: 'changed' },
			{ type: 'candidate', selection: SEL },
			{ type: 'settled', text: SEL.excerpt }
		);
		expect(state.visible).toBeNull();
		expect(state.pending).toEqual(SEL);
	});

	it('zeigt die Leiste beim Loslassen, wenn die Auswahl still steht', () => {
		const state = play(
			{ type: 'touchStart' },
			{ type: 'changed' },
			{ type: 'candidate', selection: SEL },
			{ type: 'settled', text: SEL.excerpt },
			{ type: 'touchEnd' }
		);
		expect(state.visible).toEqual(SEL);
	});

	it('zeigt nichts beim Loslassen, wenn die Auswahl noch nicht still steht', () => {
		const state = play(
			{ type: 'touchStart' },
			{ type: 'candidate', selection: SEL },
			{ type: 'changed' },
			{ type: 'touchEnd' }
		);
		expect(state.visible).toBeNull();
	});

	// Der zweite Teil der Rückmeldung: Beim Nachjustieren der Greifpunkte muss
	// eine schon sichtbare Leiste wieder verschwinden.
	it('nimmt eine sichtbare Leiste beim Weiterziehen wieder weg', () => {
		const shown = play(
			{ type: 'candidate', selection: SEL },
			{ type: 'settled', text: SEL.excerpt }
		);
		expect(shown.visible).toEqual(SEL);

		const adjusting = nextGate(shown, { type: 'changed' });
		expect(adjusting.visible).toBeNull();
	});

	it('zeigt nach dem Nachjustieren die erweiterte Auswahl', () => {
		const state = play(
			{ type: 'candidate', selection: SEL },
			{ type: 'settled', text: SEL.excerpt },
			{ type: 'changed' },
			{ type: 'candidate', selection: OTHER },
			{ type: 'settled', text: OTHER.excerpt }
		);
		expect(state.visible).toEqual(OTHER);
	});

	// Ohne Berührungen (Maus, oder iOS-Greifpunkte, deren Berührungen die Seite
	// nie erreichen) trägt allein das Abwarten.
	it('kommt auch ohne Berührungsereignisse aus', () => {
		const state = play(
			{ type: 'changed' },
			{ type: 'candidate', selection: SEL },
			{ type: 'settled', text: SEL.excerpt }
		);
		expect(state.visible).toEqual(SEL);
	});

	it('verwirft den gemerkten Stand, wenn die Auswahl aufgehoben wurde', () => {
		const state = play(
			{ type: 'candidate', selection: SEL },
			{ type: 'changed' },
			{ type: 'settled', text: '' }
		);
		expect(state.visible).toBeNull();
		expect(state.pending).toBeNull();
	});

	// Sonst käme die Leiste direkt nach dem Markieren von selbst zurück: Die
	// markierte Stelle bleibt im Dokument ausgewählt stehen.
	it('bringt die Leiste nach dem Verwerfen nicht von selbst zurück', () => {
		const dismissed = play(
			{ type: 'candidate', selection: SEL },
			{ type: 'settled', text: SEL.excerpt },
			{ type: 'dismiss' }
		);
		expect(dismissed.visible).toBeNull();

		const later = nextGate(dismissed, { type: 'settled', text: SEL.excerpt });
		expect(later.visible).toBeNull();
	});

	it('zeigt eine neue Auswahl nach einem Verwerfen wieder an', () => {
		const state = play(
			{ type: 'candidate', selection: SEL },
			{ type: 'settled', text: SEL.excerpt },
			{ type: 'dismiss' },
			{ type: 'changed' },
			{ type: 'candidate', selection: OTHER },
			{ type: 'settled', text: OTHER.excerpt }
		);
		expect(state.visible).toEqual(OTHER);
	});

	it('zeigt nichts, wenn epub.js gar keine Auswahl gemeldet hat', () => {
		expect(play({ type: 'settled', text: 'Text ohne Meldung' }).visible).toBeNull();
	});

	// Sobald die Leiste steht, lösen wir die native Auswahl auf - sonst legt
	// iOS sein eigenes Menü als System-Oberfläche unerreichbar darüber.
	describe('nach der Übernahme der Auswahl', () => {
		const taken = () =>
			play(
				{ type: 'candidate', selection: SEL },
				{ type: 'settled', text: SEL.excerpt },
				{ type: 'taken' }
			);

		it('bleibt die Leiste stehen', () => {
			expect(taken().visible).toEqual(SEL);
		});

		// Das Auflösen der Auswahl feuert selbst ein selectionchange. Ohne diese
		// Sperre räumten wir uns die eigene Anzeige sofort wieder weg.
		it('nimmt das eigene selectionchange die Leiste nicht weg', () => {
			expect(nextGate(taken(), { type: 'changed' }).visible).toEqual(SEL);
		});

		it('bleibt sie auch bei einem nachlaufenden settled stehen', () => {
			// Der Wartezeit-Zeitgeber läuft womöglich noch und meldet jetzt leeren
			// Text - die Auswahl ist ja aufgelöst.
			expect(nextGate(taken(), { type: 'settled', text: '' }).visible).toEqual(SEL);
		});

		it('stören Berührungen sie nicht mehr', () => {
			const state = nextGate(nextGate(taken(), { type: 'touchStart' }), { type: 'touchEnd' });
			expect(state.visible).toEqual(SEL);
		});

		it('beendet nur ein Verwerfen den Zustand', () => {
			const done = nextGate(taken(), { type: 'dismiss' });
			expect(done.visible).toBeNull();
			expect(done.taken).toBe(false);
		});

		it('funktioniert die nächste Auswahl danach wieder normal', () => {
			const done = nextGate(taken(), { type: 'dismiss' });
			const next = [
				{ type: 'changed' } as const,
				{ type: 'candidate', selection: OTHER } as const,
				{ type: 'settled', text: OTHER.excerpt } as const
			].reduce(nextGate<Sel>, done);
			expect(next.visible).toEqual(OTHER);
		});

		it('zeigt eine neue Auswahl nicht ohne eigene Wartezeit', () => {
			// `settled` muss beim Verwerfen zurückgesetzt werden - sonst spränge
			// die Leiste bei der nächsten Auswahl sofort an.
			const done = nextGate(taken(), { type: 'dismiss' });
			expect(nextGate(done, { type: 'candidate', selection: OTHER }).visible).toBeNull();
		});
	});
});
