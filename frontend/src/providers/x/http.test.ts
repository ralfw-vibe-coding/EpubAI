import { describe, expect, it, vi } from 'vitest';
import { fakeAuthStore } from '../../testing/fakes';
import { createHttpClient, HttpError, type XhrLike } from './http';

function jsonResponse(body: unknown, init: Partial<{ ok: boolean; status: number }> = {}) {
	return {
		ok: init.ok ?? true,
		status: init.status ?? 200,
		statusText: 'OK',
		json: async () => body,
		arrayBuffer: async () => new ArrayBuffer(4)
	} as unknown as Response;
}

/** Fake XHR for `uploadEpub`: records method/url/headers, fires onload synchronously on send(). */
function fakeXhr(status: number, body: unknown) {
	const headers: Record<string, string> = {};
	let call: { method: string; url: string } | undefined;
	let sentBody: FormData | undefined;
	const instance: XhrLike = {
		open: (method, url) => {
			call = { method, url };
		},
		setRequestHeader: (name, value) => {
			headers[name] = value;
		},
		upload: { onprogress: null },
		onload: null,
		onerror: null,
		status,
		responseText: JSON.stringify(body),
		send(form) {
			sentBody = form;
			instance.onload?.();
		}
	};
	return { instance, headers, getCall: () => call, getSentBody: () => sentBody };
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

	it('ends a loan with bookId in the URL and deviceId in the body', async () => {
		const res = { ok: true, status: 204, statusText: 'No Content', json: async () => null } as unknown as Response;
		const fetchMock = vi.fn().mockResolvedValue(res);
		const http = createHttpClient('http://api', fakeAuthStore({ token: 't', userId: 'u' }), fetchMock);
		await http.returnLoan('b1', 'dev1');

		const [url, opts] = fetchMock.mock.calls[0];
		expect(url).toBe('http://api/loans/b1');
		expect(opts.method).toBe('DELETE');
		expect(JSON.parse(opts.body)).toEqual({ deviceId: 'dev1' });
	});

	it('throws on a failed returnLoan', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(jsonResponse({ error: 'not found' }, { ok: false, status: 404 }));
		const http = createHttpClient('http://api', fakeAuthStore(), fetchMock);
		await expect(http.returnLoan('b1', 'dev1')).rejects.toBeInstanceOf(HttpError);
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

	it('uploads an EPUB as multipart form data and returns detected metadata', async () => {
		const { instance, headers, getCall, getSentBody } = fakeXhr(200, {
			detectedMeta: { title: 'T', author: 'A' },
			fileHash: 'h1'
		});
		const http = createHttpClient(
			'http://api',
			fakeAuthStore({ token: 't', userId: 'u' }),
			fetch,
			() => instance
		);
		const file = new Blob(['epub bytes']);
		const res = await http.uploadEpub(file, 'buch.epub');

		expect(res).toEqual({ detectedMeta: { title: 'T', author: 'A' }, fileHash: 'h1' });
		expect(getCall()).toEqual({ method: 'POST', url: 'http://api/books/upload' });
		expect(headers.Authorization).toBe('Bearer t');
		expect(headers['ngrok-skip-browser-warning']).toBe('true');
		expect(getSentBody()).toBeInstanceOf(FormData);
		expect((getSentBody() as FormData).get('file')).toBeInstanceOf(Blob);
	});

	it('reports upload progress', async () => {
		const { instance } = fakeXhr(200, { detectedMeta: { title: 'T', author: 'A' }, fileHash: 'h1' });
		const http = createHttpClient('http://api', fakeAuthStore(), fetch, () => instance);
		const progressUpdates: number[] = [];

		const promise = http.uploadEpub(new Blob(['x']), 'buch.epub', (pct) => progressUpdates.push(pct));
		instance.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
		instance.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
		await promise;

		expect(progressUpdates).toEqual([50, 100]);
	});

	it('accepts an ArrayBuffer for uploadEpub', async () => {
		const { instance, getSentBody } = fakeXhr(200, {
			detectedMeta: { title: 'T', author: 'A' },
			fileHash: 'h1'
		});
		const http = createHttpClient('http://api', fakeAuthStore(), fetch, () => instance);
		await http.uploadEpub(new ArrayBuffer(4), 'buch.epub');
		expect((getSentBody() as FormData).get('file')).toBeInstanceOf(Blob);
	});

	it('passes through coverKey and coverPreviewUrl when the server detected a cover', async () => {
		const { instance } = fakeXhr(200, {
			detectedMeta: { title: 'T', author: 'A' },
			fileHash: 'h1',
			coverKey: 'cover-key-1',
			coverPreviewUrl: 'https://covers.example/preview.jpg'
		});
		const http = createHttpClient('http://api', fakeAuthStore(), fetch, () => instance);
		const res = await http.uploadEpub(new Blob(['x']), 'buch.epub');

		expect(res).toEqual({
			detectedMeta: { title: 'T', author: 'A' },
			fileHash: 'h1',
			coverKey: 'cover-key-1',
			coverPreviewUrl: 'https://covers.example/preview.jpg'
		});
	});

	it('returns a duplicate result on 409 instead of throwing', async () => {
		const { instance } = fakeXhr(409, { error: 'duplicate', existingBookId: 'b9' });
		const http = createHttpClient('http://api', fakeAuthStore(), fetch, () => instance);
		const res = await http.uploadEpub(new Blob(['x']), 'buch.epub');
		expect(res).toEqual({ duplicate: true, existingBookId: 'b9' });
	});

	it('throws on a non-409 upload failure', async () => {
		const { instance } = fakeXhr(413, { error: 'too large' });
		const http = createHttpClient('http://api', fakeAuthStore(), fetch, () => instance);
		await expect(http.uploadEpub(new Blob(['x']), 'buch.epub')).rejects.toMatchObject({
			name: 'HttpError',
			status: 413,
			message: 'too large'
		});
	});

	it('rejects with HttpError on an XHR network error', async () => {
		const { instance } = fakeXhr(0, {});
		instance.send = () => instance.onerror?.();
		const http = createHttpClient('http://api', fakeAuthStore(), fetch, () => instance);
		await expect(http.uploadEpub(new Blob(['x']), 'buch.epub')).rejects.toBeInstanceOf(HttpError);
	});

	it('creates a book with title, author and fileHash', async () => {
		const book = { id: 'b1', title: 'T', author: 'A', fileHash: 'h1', processingStatus: 'ready', tags: [] };
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(book));
		const http = createHttpClient('http://api', fakeAuthStore(), fetchMock);
		const res = await http.createBook('T', 'A', 'h1');

		expect(res).toEqual(book);
		const [url, opts] = fetchMock.mock.calls[0];
		expect(url).toBe('http://api/books');
		expect(opts.method).toBe('POST');
		expect(JSON.parse(opts.body)).toEqual({ title: 'T', author: 'A', fileHash: 'h1' });
	});

	it('includes coverKey in the body when provided', async () => {
		const book = { id: 'b1', title: 'T', author: 'A', fileHash: 'h1', processingStatus: 'ready', tags: [], coverUrl: null };
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(book));
		const http = createHttpClient('http://api', fakeAuthStore(), fetchMock);
		await http.createBook('T', 'A', 'h1', 'cover-key-1');

		const [, opts] = fetchMock.mock.calls[0];
		expect(JSON.parse(opts.body)).toEqual({ title: 'T', author: 'A', fileHash: 'h1', coverKey: 'cover-key-1' });
	});

	it('omits coverKey from the body when not provided', async () => {
		const book = { id: 'b1', title: 'T', author: 'A', fileHash: 'h1', processingStatus: 'ready', tags: [], coverUrl: null };
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(book));
		const http = createHttpClient('http://api', fakeAuthStore(), fetchMock);
		await http.createBook('T', 'A', 'h1');

		const [, opts] = fetchMock.mock.calls[0];
		expect(JSON.parse(opts.body)).toEqual({ title: 'T', author: 'A', fileHash: 'h1' });
	});

	it('includes tags in the body when provided', async () => {
		const book = { id: 'b1', title: 'T', author: 'A', fileHash: 'h1', processingStatus: 'ready', tags: ['sci-fi'], coverUrl: null };
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(book));
		const http = createHttpClient('http://api', fakeAuthStore(), fetchMock);
		await http.createBook('T', 'A', 'h1', undefined, ['sci-fi', 'favorit']);

		const [, opts] = fetchMock.mock.calls[0];
		expect(JSON.parse(opts.body)).toEqual({
			title: 'T',
			author: 'A',
			fileHash: 'h1',
			tags: ['sci-fi', 'favorit']
		});
	});

	it('throws on a failed createBook', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(jsonResponse({ error: 'invalid' }, { ok: false, status: 400 }));
		const http = createHttpClient('http://api', fakeAuthStore(), fetchMock);
		await expect(http.createBook('T', 'A', 'h1')).rejects.toBeInstanceOf(HttpError);
	});

	it('patches book metadata', async () => {
		const book = { id: 'b1', title: 'Neu', author: 'A', fileHash: 'h1', processingStatus: 'ready', tags: ['x'] };
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(book));
		const http = createHttpClient('http://api', fakeAuthStore(), fetchMock);
		const res = await http.updateBookMetadata('b1', { title: 'Neu', tags: ['x'] });

		expect(res).toEqual(book);
		const [url, opts] = fetchMock.mock.calls[0];
		expect(url).toBe('http://api/books/b1');
		expect(opts.method).toBe('PATCH');
		expect(JSON.parse(opts.body)).toEqual({ title: 'Neu', tags: ['x'] });
	});

	it('throws on a failed updateBookMetadata', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(jsonResponse({ error: 'invalid' }, { ok: false, status: 400 }));
		const http = createHttpClient('http://api', fakeAuthStore(), fetchMock);
		await expect(http.updateBookMetadata('b1', { title: 'x' })).rejects.toBeInstanceOf(HttpError);
	});

	it('deletes a book', async () => {
		const res = { ok: true, status: 204, statusText: 'No Content', json: async () => null } as unknown as Response;
		const fetchMock = vi.fn().mockResolvedValue(res);
		const http = createHttpClient('http://api', fakeAuthStore(), fetchMock);
		await http.deleteBook('b1');

		const [url, opts] = fetchMock.mock.calls[0];
		expect(url).toBe('http://api/books/b1');
		expect(opts.method).toBe('DELETE');
	});

	it('throws on a failed delete', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(jsonResponse({ error: 'not found' }, { ok: false, status: 404 }));
		const http = createHttpClient('http://api', fakeAuthStore(), fetchMock);
		await expect(http.deleteBook('missing')).rejects.toBeInstanceOf(HttpError);
	});
});
