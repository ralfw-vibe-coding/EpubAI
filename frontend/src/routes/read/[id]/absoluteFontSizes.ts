/**
 * Macht die absoluten Schriftgrößen-Schlüsselwörter eines Buches skalierbar.
 *
 * Manche EPUBs geben ihre Schriftgrößen als `small`, `x-small`, `large` an,
 * statt in em oder Prozent - das Menger-EPUB etwa setzt den gesamten Fließtext
 * über `.indent { font-size: small }`. Diese Schlüsselwörter sind laut CSS
 * *absolut*: sie rechnen gegen die Standardschriftgröße des Browsers und
 * ignorieren das Elternelement vollständig. Nachgemessen in Chromium, bei einem
 * Elternelement mit 32px:
 *
 *     small    -> 13px      (identisch bei 16px Elternelement)
 *     x-small  -> 10px
 *     larger   -> 38,4px    (= 32 x 1,2, denn `larger` ist relativ)
 *
 * `rendition.themes.fontSize()` von epub.js setzt aber genau dort an: ein
 * Inline-Stil auf `<body>` (contents.js, `css()`). Bei so einem Buch verpufft
 * die Schriftgrößen-Einstellung deshalb vollständig - nichts am Text ändert
 * sich, egal wie oft man drückt.
 *
 * Die Abhilfe schreibt die Schlüsselwörter in `rem` um. Bewusst rem und nicht
 * em: rem hängt am Wurzelelement des Kapiteldokuments, ist also wie das
 * Schlüsselwort gegen *eine* Bezugsgröße gerechnet. Mit em würden verschachtelte
 * Angaben sich multiplizieren - eine Fußnote (x-small) in einem Absatz (small)
 * wäre plötzlich 0,625 x 0,8125 statt 0,625. Der Aufrufer setzt dazu die
 * Schriftgröße auf dem Wurzelelement; steht die auf den 16px des Browsers,
 * rechnet jedes Schlüsselwort exakt auf seinen alten Pixelwert zurück. Das Buch
 * sieht also unverändert aus und lässt sich trotzdem vergrößern.
 */

/**
 * Faktoren gegen `medium`, in Chromium nachgemessen (siehe Kopf). Die
 * CSS-Spezifikation nennt nur eine ungefähre Skala und überlässt die Tabelle
 * dem Browser - deshalb gemessen statt aus der Spezifikation abgeschrieben.
 *
 * `larger` und `smaller` fehlen hier mit Absicht: die sind relativ zum
 * Elternelement, funktionieren also längst richtig und dürfen nicht angefasst
 * werden.
 */
export const ABSOLUTE_SIZE_FACTORS: Readonly<Record<string, number>> = {
	'xx-small': 0.5625,
	'x-small': 0.625,
	small: 0.8125,
	medium: 1,
	large: 1.125,
	'x-large': 1.5,
	'xx-large': 2,
	'xxx-large': 3
};

/**
 * Die rem-Entsprechung zu einem absoluten Schlüsselwort, oder null für alles
 * andere - relative Schlüsselwörter, Pixel, em, Prozent, leere Angaben.
 */
export function relativeFontSize(value: string | null | undefined): string | null {
	if (!value) return null;
	const factor = ABSOLUTE_SIZE_FACTORS[value.trim().toLowerCase()];
	return factor === undefined ? null : `${factor}rem`;
}

/**
 * Schreibt alle absoluten Schlüsselwörter im Dokument um: in den Stylesheets
 * des Kapitels und in style-Attributen am Element. Gibt zurück, wie viele
 * Angaben geändert wurden - null heißt "dieses Buch war nie betroffen".
 *
 * Fremde Stylesheets können beim Zugriff auf `cssRules` werfen (Herkunftsregel).
 * Das ist kein Fehlerfall, sondern der Normalfall für eingebundene Fremdstile:
 * dann bleibt dieses eine Stylesheet eben, wie es ist.
 */
export function rewriteAbsoluteFontSizes(doc: Document): number {
	let changed = 0;

	for (const sheet of Array.from(doc.styleSheets)) {
		let rules: CSSRuleList;
		try {
			rules = (sheet as CSSStyleSheet).cssRules;
		} catch {
			continue;
		}
		changed += rewriteRules(rules);
	}

	for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[style]'))) {
		changed += rewriteDeclaration(el.style);
	}

	return changed;
}

/**
 * Regeln durchgehen, auch die in @media/@supports verschachtelten.
 *
 * Erst die eigene Deklaration, dann die verschachtelten - und zwar *beides*,
 * nicht das eine oder das andere. Eine gewöhnliche Regel hat `cssRules` in
 * Chromium gar nicht, in jsdom aber als leere Liste, die wahrheitswertig ist;
 * eine Weiche darauf hätte jede normale Regel für eine Gruppe gehalten und ihre
 * Deklaration nie angefasst. Doppelt gezählt wird nichts: eine Gruppenregel hat
 * kein `style`, eine Stilregel keine gefüllte `cssRules` (ausser bei
 * verschachteltem CSS - und das gehört dann auch durchsucht).
 */
function rewriteRules(rules: CSSRuleList): number {
	let changed = 0;
	for (const rule of Array.from(rules)) {
		const style = (rule as CSSStyleRule).style;
		if (style) changed += rewriteDeclaration(style);

		const nested = (rule as CSSGroupingRule).cssRules;
		if (nested && nested.length > 0) changed += rewriteRules(nested);
	}
	return changed;
}

/**
 * Eine Deklaration umschreiben. Die Wichtigkeit (`!important`) wird dabei
 * übernommen, sonst würde eine Regel, die das Buch bewusst durchgesetzt hat,
 * beim Umschreiben ihren Vorrang verlieren.
 */
function rewriteDeclaration(style: CSSStyleDeclaration): number {
	const replacement = relativeFontSize(style.getPropertyValue('font-size'));
	if (replacement === null) return 0;
	style.setProperty('font-size', replacement, style.getPropertyPriority('font-size'));
	return 1;
}
