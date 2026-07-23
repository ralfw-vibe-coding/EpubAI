// Swipe-to-turn-page gesture detection. Pure, portal-adjacent helper for the
// Reader page — mirrors how colors.ts/preferences.ts hold this page's other
// small pure pieces.

const SWIPE_MIN_DISTANCE = 50;
const SWIPE_MAX_DURATION_MS = 800;

/**
 * True if a touch drag looks like a deliberate horizontal page-turn swipe
 * rather than a scroll, a tap, or a text-selection drag: quick, and mostly
 * horizontal. Distance/duration only — the caller is responsible for the
 * complementary check that the touch didn't end with an active text
 * selection (that's a selection gesture, not a swipe, and can't be judged
 * from movement alone).
 */
export function isSwipeGesture(dx: number, dy: number, dt: number): boolean {
	return dt <= SWIPE_MAX_DURATION_MS && Math.abs(dx) >= SWIPE_MIN_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.5;
}
