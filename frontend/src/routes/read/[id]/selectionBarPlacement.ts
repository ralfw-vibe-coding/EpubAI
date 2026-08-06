// Wo die Farbleiste zu einer Auswahl steht. Rein und ohne DOM, wie die
// anderen kleinen Teile dieser Seite (swipe.ts, selectionGate.ts).

/**
 * Höhe der Leiste samt Rahmen und Innenabstand. Muss zum Markup passen (siehe
 * +page.svelte): Der höchste Knopf ist 36px (h-9), dazu 2x6px Innenabstand
 * (py-1.5) und 2x2px Rahmen (border-2) - macht 52.
 */
export const SELECTION_BAR_HEIGHT_PX = 52;

/**
 * Abstand zwischen Auswahl und Leiste. Groß genug, dass sie nicht an der
 * markierten Zeile klebt, klein genug, dass sie erkennbar dazugehört.
 */
export const SELECTION_BAR_GAP_PX = 12;

/**
 * Der obere Rand der Farbleiste, gemessen im sichtbaren Bereich der Seite
 * (0 = oben). Sie soll nah an der Markierung stehen, ohne sie zu verdecken.
 *
 * Drei Fälle, in dieser Reihenfolge:
 *
 *  1. Unterhalb des Auswahl-ENDES. Der Normalfall: Man wählt in aller Regel
 *     von oben nach unten aus, das Ende ist also die zuletzt berührte Stelle -
 *     dort sucht man die Leiste zuerst.
 *  2. Passt sie dort nicht mehr aufs Bild, oberhalb des Auswahl-ANFANGS.
 *     Bewusst der Anfang und nicht das Ende: Über dem Ende läge sie mitten in
 *     der eigenen Markierung.
 *  3. Reicht auch das über den oberen Rand hinaus - eine Auswahl, die fast die
 *     ganze Seite einnimmt -, bleibt kein freier Platz mehr. Dann mittig: Sie
 *     verdeckt dort zwar etwas, aber weder Anfang noch Ende der Auswahl, und
 *     sie ist sicher vollständig sichtbar.
 *
 * `startY` ist die Oberkante der ersten, `endY` die Unterkante der letzten
 * Zeile der Auswahl.
 */
export function selectionBarTop(startY: number, endY: number, paneHeight: number): number {
	const below = endY + SELECTION_BAR_GAP_PX;
	if (below + SELECTION_BAR_HEIGHT_PX <= paneHeight) return below;

	const above = startY - SELECTION_BAR_GAP_PX - SELECTION_BAR_HEIGHT_PX;
	if (above >= 0) return above;

	// Math.max, damit die Leiste auch auf einer Seite, die niedriger als sie
	// selbst ist, nicht nach oben aus dem Bild rutscht.
	return Math.max(0, (paneHeight - SELECTION_BAR_HEIGHT_PX) / 2);
}
