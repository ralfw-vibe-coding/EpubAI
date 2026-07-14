import type { FileStore } from '../../processor/ports';

/**
 * OPFS file-store xProvider. Stores each EPUB as its own binary file in the
 * Origin Private File System (NOT as a blob in SQLite, per §4.4). Browser-only;
 * excluded from unit-test coverage (see vitest.config.ts).
 */
const DIR = 'books';

function fileName(bookId: string): string {
	// bookId may contain characters unsafe for a file name; encode defensively.
	return `${encodeURIComponent(bookId)}.epub`;
}

async function booksDir(): Promise<FileSystemDirectoryHandle> {
	const root = await navigator.storage.getDirectory();
	return root.getDirectoryHandle(DIR, { create: true });
}

export function createFileStore(): FileStore {
	return {
		async write(bookId: string, data: ArrayBuffer): Promise<void> {
			const dir = await booksDir();
			const handle = await dir.getFileHandle(fileName(bookId), { create: true });
			const writable = await handle.createWritable();
			await writable.write(data);
			await writable.close();
		},

		async read(bookId: string): Promise<ArrayBuffer> {
			const dir = await booksDir();
			const handle = await dir.getFileHandle(fileName(bookId));
			const file = await handle.getFile();
			return file.arrayBuffer();
		},

		async delete(bookId: string): Promise<void> {
			const dir = await booksDir();
			await dir.removeEntry(fileName(bookId)).catch(() => undefined);
		},

		async exists(bookId: string): Promise<boolean> {
			try {
				const dir = await booksDir();
				await dir.getFileHandle(fileName(bookId));
				return true;
			} catch {
				return false;
			}
		}
	};
}
