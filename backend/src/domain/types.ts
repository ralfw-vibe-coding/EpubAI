// Domain data types (Walking Skeleton scope).
// Owned exclusively by the Domain layer - Reactors and Providers translate to/from these,
// but only the Domain defines what they mean.

export type ProcessingStatus = "pending" | "processing" | "ready" | "failed";

export interface User {
  id: string;
  email: string;
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
}

export interface DetectedMeta {
  title: string;
  author: string;
  language?: string;
}
