import type { CatalogBook } from '../../domain/types';
import type {
	AuthStore,
	HttpClient,
	LoanResponse,
	LoginRequestResult,
	Session
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

/**
 * HTTP xProvider — the client to the EpubAI backend. Implements the backend
 * contract exactly. Framework-agnostic (base URL and auth store are injected),
 * so it is unit-testable with a mocked `fetch`.
 */
export function createHttpClient(
	baseUrl: string,
	auth: AuthStore,
	fetchImpl: typeof fetch = fetch
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
		}
	};
}
