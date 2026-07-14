import { describe, expect, it, vi } from 'vitest';
import { fakeAuthStore } from '../../testing/fakes';
import { createHttpClient, HttpError } from './http';

function jsonResponse(body: unknown, init: Partial<{ ok: boolean; status: number }> = {}) {
	return {
		ok: init.ok ?? true,
		status: init.status ?? 200,
		statusText: 'OK',
		json: async () => body,
		arrayBuffer: async () => new ArrayBuffer(4)
	} as unknown as Response;
}

describe('createHttpClient', () => {
	it('posts email for a login code', async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
		const http = createHttpClient('http://api', fakeAuthStore(), fetchMock);
		const res = await http.requestLoginCode('a@b.de');

		expect(res).toEqual({ ok: true });
		const [url, opts] = fetchMock.mock.calls[0];
		expect(url).toBe('http://api/auth/login/request');
		expect(opts.method).toBe('POST');
		expect(JSON.parse(opts.body)).toEqual({ email: 'a@b.de' });
	});

	it('verifies a code and returns the session', async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ token: 't', userId: 'u' }));
		const http = createHttpClient('http://api', fakeAuthStore(), fetchMock);
		expect(await http.verifyLoginCode('a@b.de', 'hibiskus')).toEqual({ token: 't', userId: 'u' });
	});

	it('strips a trailing slash from the base URL', async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ books: [] }));
		const http = createHttpClient('http://api/', fakeAuthStore({ token: 't', userId: 'u' }), fetchMock);
		await http.getBooks();
		expect(fetchMock.mock.calls[0][0]).toBe('http://api/books');
	});

	it('attaches the bearer token when authenticated', async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ books: [] }));
		const http = createHttpClient('http://api', fakeAuthStore({ token: 'abc', userId: 'u' }), fetchMock);
		await http.getBooks();
		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer abc');
	});

	it('omits the auth header when unauthenticated', async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ books: [] }));
		const http = createHttpClient('http://api', fakeAuthStore(), fetchMock);
		await http.getBooks();
		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
	});

	it('unwraps the books array', async () => {
		const books = [{ id: 'b1', title: 'T', author: 'A', fileHash: 'h', processingStatus: 'ready' }];
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ books }));
		const http = createHttpClient('http://api', fakeAuthStore(), fetchMock);
		expect(await http.getBooks()).toEqual(books);
	});

	it('encodes the book id in the URL', async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'a/b' }));
		const http = createHttpClient('http://api', fakeAuthStore(), fetchMock);
		await http.getBook('a/b');
		expect(fetchMock.mock.calls[0][0]).toBe('http://api/books/a%2Fb');
	});

	it('creates a loan with bookId and deviceId', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(jsonResponse({ id: 'l1', bookId: 'b1', fileHash: 'h', borrowedAt: 't' }));
		const http = createHttpClient('http://api', fakeAuthStore({ token: 't', userId: 'u' }), fetchMock);
		await http.createLoan('b1', 'dev1');
		const [url, opts] = fetchMock.mock.calls[0];
		expect(url).toBe('http://api/loans');
		expect(JSON.parse(opts.body)).toEqual({ bookId: 'b1', deviceId: 'dev1' });
	});

	it('returns the raw file bytes', async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(null));
		const http = createHttpClient('http://api', fakeAuthStore(), fetchMock);
		const buf = await http.getBookFile('b1');
		expect(buf.byteLength).toBe(4);
		expect(fetchMock.mock.calls[0][0]).toBe('http://api/books/b1/file');
	});

	it('throws HttpError with the server error message', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(jsonResponse({ error: 'bad code' }, { ok: false, status: 401 }));
		const http = createHttpClient('http://api', fakeAuthStore(), fetchMock);
		await expect(http.verifyLoginCode('a@b.de', 'x')).rejects.toMatchObject({
			name: 'HttpError',
			status: 401,
			message: 'bad code'
		});
	});

	it('falls back to statusText when the error body is not JSON', async () => {
		const res = {
			ok: false,
			status: 500,
			statusText: 'Server Error',
			json: async () => {
				throw new Error('no json');
			}
		} as unknown as Response;
		const fetchMock = vi.fn().mockResolvedValue(res);
		const http = createHttpClient('http://api', fakeAuthStore(), fetchMock);
		await expect(http.getBooks()).rejects.toBeInstanceOf(HttpError);
	});
});
