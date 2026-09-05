/**
 * In die Zwischenablage schreiben - mit Rückfall für ältere Browser.
 *
 * `navigator.clipboard` gibt es nur in sicheren Kontexten und auf iOS nur
 * innerhalb einer echten Nutzergeste. Schlägt es fehl, greift der ältere Weg
 * über ein unsichtbares Textfeld und `document.execCommand('copy')` - der ist
 * zwar abgekündigt, aber genau dort noch verfügbar, wo der neue Weg versagt.
 *
 * Der Rückgabewert sagt, ob es geklappt hat: Eine Kopier-Schaltfläche, die
 * stillschweigend nichts tut, ist schlimmer als eine, die es zugibt.
 */
export async function copyText(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// Verweigert oder nicht verfügbar - unten weiter.
	}
	return copyViaTextarea(text);
}

function copyViaTextarea(text: string): boolean {
	try {
		const field = document.createElement('textarea');
		field.value = text;
		// Außerhalb des Bildes, aber NICHT display:none oder visibility:hidden -
		// daraus lässt sich nichts auswählen, und ohne Auswahl kopiert der
		// alte Weg nichts.
		field.setAttribute('readonly', '');
		field.style.position = 'fixed';
		field.style.top = '-1000px';
		document.body.appendChild(field);
		field.select();
		const ok = document.execCommand('copy');
		field.remove();
		return ok;
	} catch {
		return false;
	}
}

/**
 * Titel und Autor als eine Zeile, wie man sie zitiert.
 *
 * Ohne Autor bleibt es beim Titel - ein Gedankenstrich, hinter dem nichts
 * steht, sähe nach einem Fehler aus.
 */
export function bookCitation(title: string, author: string): string {
	const t = title.trim();
	const a = author.trim();
	return a ? `${t} — ${a}` : t;
}
