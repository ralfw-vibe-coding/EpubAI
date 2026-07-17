// Domain data types (Walking Skeleton scope).
// Owned exclusively by the Domain layer - Reactors and Providers translate to/from these,
// but only the Domain defines what they mean.

export type ProcessingStatus = "pending" | "processing" | "ready" | "failed";

// The 6 selectable highlight colors. "accent" is the default - it matches
// the app's original single hardcoded highlight color, so old/no-color
// annotations keep looking the same. The actual hex values are a
// frontend-only rendering concern; the backend only stores/validates the slug.
export type AnnotationColor = "accent" | "orange" | "yellow" | "green" | "blue" | "purple";

export interface User {
  id: string;
  email: string;
  translationLanguage: string;
  createdAt: string;
}

export interface Book {
  id: string;
  userId: string;
  title: string;
  author: string;
  tags: string[];
  // Despite the name, this is an R2 *storage key* (e.g. `<fileHash>-cover.jpg`),
  // not a directly fetchable URL - R2 is not publicly readable. A real,
  // time-limited URL is presigned fresh on every request by the Reactor
  // (never stored, since a stored presigned URL would eventually expire).
  coverUrl: string | null;
  addedAt: string;
  currentFileHash: string;
  processingStatus: ProcessingStatus;
  // ISO timestamp of the last dossier upload, or null when none exists yet.
  // Public projections only ever expose the derived `hasDossier` boolean
  // (see BookSummary) - the timestamp itself is an implementation detail.
  dossierUploadedAt: string | null;
}

export interface BookFile {
  id: string;
  bookId: string;
  storageKey: string;
  fileHash: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface Loan {
  id: string;
  bookId: string;
  userId: string;
  deviceId: string;
  fileHash: string;
  borrowedAt: string;
  returnedAt: string | null;
}

// Public projection returned to clients for a Book (matches the interface contract).
export interface BookSummary {
  id: string;
  title: string;
  author: string;
  tags: string[];
  // A real, presigned, time-limited fetchable URL - resolved by the Reactor
  // from the Book's `coverUrl` storage key (see comment there), never the
  // storage key itself. Null when the book has no cover.
  coverUrl: string | null;
  fileHash: string;
  processingStatus: ProcessingStatus;
  /** True once a dossier has been uploaded (dossier_uploaded_at is not null). */
  hasDossier: boolean;
}

export interface DetectedMeta {
  title: string;
  author: string;
  language?: string;
}

export interface Annotation {
  id: string;
  bookId: string;
  userId: string;
  cfiRange: string;
  excerpt: string;
  note: string | null;
  color: AnnotationColor;
  createdAt: string;
  updatedAt: string;
}

// Public projection returned to clients for an Annotation (matches the interface contract).
export interface AnnotationSummary {
  id: string;
  bookId: string;
  cfiRange: string;
  excerpt: string;
  note: string | null;
  color: AnnotationColor;
  createdAt: string;
  updatedAt: string;
}
