import type { CatalogBook } from '../../domain/types';
import type {
	AuthStore,
	BookMetadataPatch,
	DetectedMeta,
	HttpClient,
	LoanResponse,
	LoginRequestResult,
	Session,
	UploadEpubResult
} from '../../processor/ports';

export class HttpError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
		this.name = 'HttpError';
	}
}

/** Minimal XHR surface `uploadEpub` needs — lets tests inject a fake. */
export interface XhrLike {
	open(method: string, url: string): void;
	setRequestHeader(name: string, value: string): void;
	send(body: FormData): void;
	status: number;
	responseText: string;
	upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
	onload: (() => void) | null;
	onerror: (() => void) | null;
}

/**
 * HTTP xProvider — the client to the EpubAI backend. Implements the backend
 * contract exactly. Framework-agnostic (base URL and auth store are injected),
 * so it is unit-testable with a mocked `fetch`.
 */
export function createHttpClient(
	baseUrl: string,
	auth: AuthStore,
	fetchImpl: typeof fetch = fetch,
	xhrFactory: () => XhrLike = () => new XMLHttpRequest() as unknown as XhrLike
): HttpClient {
	const base = baseUrl.replace(/\/$/, '');

	// Sent on every request, harmless against a normal server: it skips the
	// ngrok free-tier browser-warning interstitial page when the backend is
	// reached through an ngrok tunnel (e.g. for on-device testing), which
	// would otherwise return HTML instead of JSON to fetch() calls.
	const ngrokBypass = { 'ngrok-skip-browser-warning': 'true' };

	function authHeaders(): Record<string, string> {
		const session = auth.get();
		return session
			? { ...ngrokBypass, Authorization: `Bearer ${session.token}` }
			: { ...ngrokBypass };
	}

	async function readError(res: Response): Promise<string> {
		try {
			const body = (await res.json()) as { error?: string };
			return body.error ?? res.statusText;
		} catch {
			return res.statusText;
		}
	}

	return {
		async requestLoginCode(email: string): Promise<LoginRequestResult> {
			const res = await fetchImpl(`${base}/auth/login/request`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...ngrokBypass },
				body: JSON.stringify({ email })
			});
			if (!res.ok) throw new HttpError(res.status, await readError(res));
			return (await res.json()) as LoginRequestResult;
		},

		async verifyLoginCode(email: string, code: string): Promise<Session> {
			const res = await fetchImpl(`${base}/auth/login/verify`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...ngrokBypass },
				body: JSON.stringify({ email, code })
			});
			if (!res.ok) throw new HttpError(res.status, await readError(res));
			return (await res.json()) as Session;
		},

		async getBooks(): Promise<CatalogBook[]> {
			const res = await fetchImpl(`${base}/books`, { headers: authHeaders() });
			if (!res.ok) throw new HttpError(res.status, await readError(res));
			const body = (await res.json()) as { books: CatalogBook[] };
			return body.books;
		},

		async getBook(bookId: string): Promise<CatalogBook> {
			const res = await fetchImpl(`${base}/books/${encodeURIComponent(bookId)}`, {
				headers: authHeaders()
			});
			if (!res.ok) throw new HttpError(res.status, await readError(res));
			return (await res.json()) as CatalogBook;
		},

		async createLoan(bookId: string, deviceId: string): Promise<LoanResponse> {
			const res = await fetchImpl(`${base}/loans`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...authHeaders() },
				body: JSON.stringify({ bookId, deviceId })
			});
			if (!res.ok) throw new HttpError(res.status, await readError(res));
			return (await res.json()) as LoanResponse;
		},

		async getBookFile(bookId: string): Promise<ArrayBuffer> {
			const res = await fetchImpl(
				`${base}/books/${encodeURIComponent(bookId)}/file`,
				{ headers: authHeaders() }
			);
			if (!res.ok) throw new HttpError(res.status, await readError(res));
			return res.arrayBuffer();
		},

		// Uses XMLHttpRequest rather than fetch: it is the one request that needs
		// real upload-progress events for the progress bar, and unlike fetch's
		// streaming-body approach, `xhr.upload.onprogress` works reliably in
		// Safari/iOS - the platform this app cares most about (Requirements 4.3).
		uploadEpub(
			file: Blob | ArrayBuffer,
			filename: string,
			onProgress?: (percent: number) => void
		): Promise<UploadEpubResult> {
			const form = new FormData();
			const blob = file instanceof Blob ? file : new Blob([file]);
			form.append('file', blob, filename);

			return new Promise((resolve, reject) => {
				const xhr = xhrFactory();
				xhr.open('POST', `${base}/books/upload`);
				for (const [name, value] of Object.entries(authHeaders())) {
					xhr.setRequestHeader(name, value);
				}
				xhr.upload.onprogress = (e) => {
					if (onProgress && e.lengthComputable) {
						onProgress(Math.round((e.loaded / e.total) * 100));
					}
				};
				xhr.onerror = () => reject(new HttpError(0, 'Netzwerkfehler beim Hochladen.'));
				xhr.onload = () => {
					let body: {
						error?: string;
						existingBookId?: string;
						detectedMeta?: DetectedMeta;
						fileHash?: string;
						coverKey?: string;
						coverPreviewUrl?: string;
					};
					try {
						body = xhr.responseText ? JSON.parse(xhr.responseText) : {};
					} catch {
						reject(new HttpError(xhr.status, 'Unerwartete Antwort vom Server.'));
						return;
					}
					// 409 (duplicate) is an expected outcome the caller reacts to, not a
					// generic failure — resolved as a value instead of thrown.
					if (xhr.status === 409) {
						resolve({ duplicate: true, existingBookId: body.existingBookId as string });
						return;
					}
					if (xhr.status < 200 || xhr.status >= 300) {
						reject(new HttpError(xhr.status, body.error ?? `HTTP ${xhr.status}`));
						return;
					}
					resolve({
						detectedMeta: body.detectedMeta as DetectedMeta,
						fileHash: body.fileHash as string,
						coverKey: body.coverKey,
						coverPreviewUrl: body.coverPreviewUrl
					});
				};
				xhr.send(form);
			});
		},

		async createBook(
			title: string,
			author: string,
			fileHash: string,
			coverKey?: string
		): Promise<CatalogBook> {
			const res = await fetchImpl(`${base}/books`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...authHeaders() },
				body: JSON.stringify(coverKey ? { title, author, fileHash, coverKey } : { title, author, fileHash })
			});
			if (!res.ok) throw new HttpError(res.status, await readError(res));
			return (await res.json()) as CatalogBook;
		},

		async updateBookMetadata(bookId: string, patch: BookMetadataPatch): Promise<CatalogBook> {
			const res = await fetchImpl(`${base}/books/${encodeURIComponent(bookId)}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json', ...authHeaders() },
				body: JSON.stringify(patch)
			});
			if (!res.ok) throw new HttpError(res.status, await readError(res));
			return (await res.json()) as CatalogBook;
		},

		async deleteBook(bookId: string): Promise<void> {
			const res = await fetchImpl(`${base}/books/${encodeURIComponent(bookId)}`, {
				method: 'DELETE',
				headers: authHeaders()
			});
			if (!res.ok) throw new HttpError(res.status, await readError(res));
		}
	};
}
