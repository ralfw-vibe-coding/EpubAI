import type { Annotation } from '../../domain/types';
import type { ReactorDeps } from '../deps';

/**
 * Reactor: pull ALL of the user's annotations from the backend at app start and
 * replace the local cache with them (GET /annotations → replaceAllAnnotations).
 * The backend is the source of truth for which annotations still exist, so this
 * wipes and reinserts rather than merges. Returns the synced set.
 */
export async function syncAnnotations(
	deps: Pick<ReactorDeps, 'http' | 'domain'>
): Promise<Annotation[]> {
	const annotations = await deps.http.getAllAnnotations();
	await deps.domain.recordAnnotationSync(annotations);
	return annotations;
}
