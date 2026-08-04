// Swipe-to-turn-page gesture detection. Pure, portal-adjacent helper for the
// Reader page — mirrors how colors.ts/preferences.ts hold this page's other
// small pure pieces.

const SWIPE_MIN_DISTANCE = 50;
const SWIPE_MAX_DURATION_MS = 800;
/**
 * Wie deutlich eine Achse überwiegen muss, damit die Geste als Wischen in
 * DIESE Richtung zählt. Ohne die Schwelle würde eine schräge Bewegung nach
 * gut Glück der einen oder anderen Achse zugeschlagen; so bleibt eine
 * unentschiedene Diagonale wirkungslos, statt zufällig zu blättern.
 */
const AXIS_DOMINANCE = 1.5;

/** In welche Richtung geblättert wird und auf welcher Achse gewischt wurde. */
export interface Swipe {
	direction: 'next' | 'prev';
	axis: 'horizontal' | 'vertical';
}

/**
 * Erkennt in einer Zieh-Geste ein bewusstes Umblättern - im Unterschied zu
 * einem Tippen, einem Scrollen oder dem Ziehen einer Textauswahl: schnell und
 * deutlich auf einer Achse.
 *
 * Beide Achsen blättern. Vertikal: nach oben wischen holt die nächste Seite
 * herein (die Bewegung entspricht der, mit der man den Text nach oben schöbe),
 * nach unten die vorige. Horizontal bleibt wie gehabt erhalten, damit die
 * gewohnte Geste weiter funktioniert.
 *
 * Nur Weg und Dauer werden hier bewertet. Ob die Berührung mit einer aktiven
 * Textauswahl endete, muss der Aufrufer ergänzend prüfen - das ist eine
 * Auswahl-Geste, kein Blättern, und an der Bewegung allein nicht zu erkennen.
 */
export function detectSwipe(dx: number, dy: number, dt: number): Swipe | null {
	if (dt > SWIPE_MAX_DURATION_MS) return null;

	const horizontal = Math.abs(dx) > Math.abs(dy) * AXIS_DOMINANCE;
	const vertical = Math.abs(dy) > Math.abs(dx) * AXIS_DOMINANCE;

	if (horizontal && Math.abs(dx) >= SWIPE_MIN_DISTANCE) {
		return { direction: dx < 0 ? 'next' : 'prev', axis: 'horizontal' };
	}
	if (vertical && Math.abs(dy) >= SWIPE_MIN_DISTANCE) {
		return { direction: dy < 0 ? 'next' : 'prev', axis: 'vertical' };
	}
	return null;
}
