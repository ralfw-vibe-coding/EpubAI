// Gemerkte Katalog-Ansicht: die Filter plus der Cover/Liste-Umschalter -
// alles, was beim nächsten Öffnen wieder so dastehen soll, wie man es
// verlassen hat. Gerätelokal (localStorage), bewusst nicht im Backend: das
// ist eine Ansichtssache dieses Geräts wie die Reader-Einstellungen (siehe
// read/[id]/preferences.ts, dessen Aufbau dieses Modul spiegelt) - kein
// Zustand, der über Geräte hinweg gelten oder Konflikte auflösen müsste.

export type LibraryViewMode = 'cover' | 'list';

const VIEW_MODES: readonly LibraryViewMode[] = ['cover', 'list'];

export interface LibraryFilters {
	query: string;
	/** Als Array statt Set gespeichert - ein Set überlebt JSON.stringify nicht. */
	tags: string[];
	includeArchived: boolean;
	onlyLocal: boolean;
	/** Streng genommen kein Filter, aber dieselbe Frage: "wie ich es verlassen habe". */
	viewMode: LibraryViewMode;
}

export const LIBRARY_FILTERS_STORAGE_KEY = 'epubai:library-filters';

export const DEFAULT_LIBRARY_FILTERS: LibraryFilters = {
	query: '',
	tags: [],
	includeArchived: false,
	onlyLocal: false,
	viewMode: 'cover'
};

/**
 * Liest gespeicherte Filter, feldweise geprüft. Alles Unerwartete fällt auf
 * den Standard zurück, statt die Bibliothek mit kaputtem Zustand zu starten -
 * der Inhalt stammt aus localStorage und kann aus einer älteren Version,
 * einem Tippfehler in den DevTools oder einem abgebrochenen Schreibvorgang
 * kommen.
 */
export function parseLibraryFilters(raw: string | null): LibraryFilters {
	if (!raw) return { ...DEFAULT_LIBRARY_FILTERS };
	try {
		const obj = JSON.parse(raw) as Partial<LibraryFilters> | null;
		return {
			query: typeof obj?.query === 'string' ? obj.query : DEFAULT_LIBRARY_FILTERS.query,
			tags: Array.isArray(obj?.tags) ? obj.tags.filter((t): t is string => typeof t === 'string') : [],
			includeArchived:
				typeof obj?.includeArchived === 'boolean'
					? obj.includeArchived
					: DEFAULT_LIBRARY_FILTERS.includeArchived,
			onlyLocal:
				typeof obj?.onlyLocal === 'boolean' ? obj.onlyLocal : DEFAULT_LIBRARY_FILTERS.onlyLocal,
			viewMode: VIEW_MODES.includes(obj?.viewMode as LibraryViewMode)
				? (obj!.viewMode as LibraryViewMode)
				: DEFAULT_LIBRARY_FILTERS.viewMode
		};
	} catch {
		return { ...DEFAULT_LIBRARY_FILTERS };
	}
}

export function serializeLibraryFilters(filters: LibraryFilters): string {
	return JSON.stringify(filters);
}

/**
 * Wirft gemerkte Tags weg, die es im Katalog nicht mehr gibt (Buch gelöscht
 * oder umgetaggt). Ohne das bliebe ein unsichtbarer Filter aktiv: Die
 * Tag-Chips werden aus den vorhandenen Büchern abgeleitet, ein verwaister Tag
 * erscheint dort also gar nicht - die Bibliothek wirkte leer, ohne dass etwas
 * zum Abschalten da wäre. Geprüft wird gegen den GESAMTEN Katalog, nicht die
 * gerade sichtbare Auswahl: sonst würde ein aktiver Ausleihen- oder
 * Archiv-Filter die Tags mit wegräumen.
 */
export function pruneMissingTags(stored: Iterable<string>, knownTags: Iterable<string>): Set<string> {
	const known = new Set(knownTags);
	return new Set([...stored].filter((tag) => known.has(tag)));
}
