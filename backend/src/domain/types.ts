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
  fileHash: string;
  processingStatus: ProcessingStatus;
}

export interface DetectedMeta {
  title: string;
  author: string;
  language?: string;
}
