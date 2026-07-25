import type { Annotation, AnnotationColor, AnnotationSummary } from "./types.js";

const MAX_EXCERPT_LENGTH = 2000;
const MAX_TAG_LENGTH = 40;

// Exported so annotationExportRpu.ts can validate colors on import without
// duplicating the list of the 6 allowed slugs.
export const ANNOTATION_COLORS: readonly AnnotationColor[] = [
  "accent",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple"
];

export interface AnnotationDraft {
  cfiRange: string;
  excerpt: string;
  note: string | null;
  color: AnnotationColor;
  tags: string[];
}

export type ParseCreateAnnotationResult = { valid: true; draft: AnnotationDraft } | { valid: false };

/**
 * Validates and normalizes a POST /books/:id/annotations request body.
 * `cfiRange` and `excerpt` are required, non-blank (after trim) strings;
 * `excerpt` is capped at MAX_EXCERPT_LENGTH so a client can't store the
 * whole book as one "highlight". `note` is optional - see `parseNote`.
 * `color` is optional and defaults to "accent" - see `parseColor`.
 * `tags` is optional and defaults to `[]` - see `parseTags`.
 */
export function parseCreateAnnotation(input: {
  cfiRange?: unknown;
  excerpt?: unknown;
  note?: unknown;
  color?: unknown;
  tags?: unknown;
}): ParseCreateAnnotationResult {
  if (typeof input.cfiRange !== "string") return { valid: false };
  const cfiRange = input.cfiRange.trim();
  if (!cfiRange) return { valid: false };

  if (typeof input.excerpt !== "string") return { valid: false };
  const excerpt = input.excerpt.trim();
  if (!excerpt || excerpt.length > MAX_EXCERPT_LENGTH) return { valid: false };

  const noteResult = parseNote(input.note);
  if (!noteResult.valid) return { valid: false };

  const colorResult = parseColor(input.color);
  if (!colorResult.valid) return { valid: false };

  const tagsResult = parseTags(input.tags);
  if (!tagsResult.valid) return { valid: false };

  return {
    valid: true,
    draft: { cfiRange, excerpt, note: noteResult.note, color: colorResult.color, tags: tagsResult.tags }
  };
}

export type ParseNoteResult = { valid: true; note: string | null } | { valid: false };

/**
 * Validates and normalizes a `note` field: must be a string, `null`, or
 * omitted (`undefined`) - anything else is invalid. A trimmed empty/
 * whitespace-only string normalizes to `null` (no note), matching "a
 * highlight can exist with note: null".
 */
export function parseNote(value: unknown): ParseNoteResult {
  if (value === undefined || value === null) return { valid: true, note: null };
  if (typeof value !== "string") return { valid: false };
  const trimmed = value.trim();
  return { valid: true, note: trimmed.length > 0 ? trimmed : null };
}

export type ParseColorResult = { valid: true; color: AnnotationColor } | { valid: false };

/**
 * Validates and normalizes an optional `color` field: must be one of the 6
 * allowed highlight color slugs (accent/orange/yellow/green/blue/purple) -
 * anything else (wrong type, unknown slug) is invalid. Omitted (`undefined`)
 * defaults to "accent", the app's original single hardcoded highlight color,
 * so old/no-color-specified highlights keep looking the same. Note that
 * `null` is *not* treated as "use the default" here (unlike `parseNote`) -
 * color always has a concrete value, there is no "no color" state.
 */
export function parseColor(value: unknown): ParseColorResult {
  if (value === undefined) return { valid: true, color: "accent" };
  if (typeof value !== "string") return { valid: false };
  if (!ANNOTATION_COLORS.includes(value as AnnotationColor)) return { valid: false };
  return { valid: true, color: value as AnnotationColor };
}

export type ParseTagsResult = { valid: true; tags: string[] } | { valid: false };

/**
 * Validates/normalizes an optional `tags` field: omitted -> empty array.
 * Must be an array of strings if present; each tag is trimmed, lowercased,
 * and a leading '#' stripped if present (tags are stored without '#' -
 * it's a display-only convention); blank tags are dropped; duplicates are
 * removed; any tag longer than 40 chars makes the whole input invalid.
 */
export function parseTags(value: unknown): ParseTagsResult {
  if (value === undefined) return { valid: true, tags: [] };
  if (!Array.isArray(value)) return { valid: false };

  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return { valid: false };
    let tag = item.trim().toLowerCase();
    if (tag.startsWith("#")) tag = tag.slice(1);
    if (tag.length > MAX_TAG_LENGTH) return { valid: false };
    if (!tag) continue;
    if (!tags.includes(tag)) tags.push(tag);
  }

  return { valid: true, tags };
}

/**
 * The multi-tenancy enforcement point for annotation access, mirroring
 * `authorizeBookAccess`: an annotation is only accessible to the user it
 * belongs to. Never trust an annotationId alone.
 */
export function authorizeAnnotationAccess(annotation: Annotation | null, userId: string): annotation is Annotation {
  return annotation !== null && annotation.userId === userId;
}

/**
 * Projects an Annotation into its public AnnotationSummary shape (camelCase,
 * no userId - the caller already knows it's theirs).
 */
export function toAnnotationSummary(annotation: Annotation): AnnotationSummary {
  return {
    id: annotation.id,
    bookId: annotation.bookId,
    cfiRange: annotation.cfiRange,
    excerpt: annotation.excerpt,
    note: annotation.note,
    color: annotation.color,
    tags: annotation.tags,
    createdAt: annotation.createdAt,
    updatedAt: annotation.updatedAt
  };
}
