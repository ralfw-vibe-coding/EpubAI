# EpubAI Backend — Walking Skeleton

Minimal backend for the EpubAI Walking Skeleton (see `../requirements/EpubAI-Requirements.md`
and `../requirements/EpubAI-Interface-Durchstich.md`). Implements exactly the 8 endpoints of
the walking skeleton — no more.

## Architecture

Four layers, per Requirements §4.7:

- **Portal** (`src/portal/`) — Fastify routes. Pure HTTP-to-Reactor translation, no business logic.
- **Processor** (`src/processor/`) — one Reactor per endpoint (`authRequestCode`, `authVerifyCode`,
  `listBooks`, `getBook`, `uploadEpub`, `createBook`, `updateBook`, `deleteBook`, `borrowBook`,
  `getBookFile`). Composition only.
- **Domain** (`src/domain/`) — RPUs (nearly-pure functions) + shared types. Knows nothing about
  Postgres, R2, JWT, etc.
- **Providers**:
  - **dProvider** (`src/providers/d/`) — Neon Postgres, the only persistence the Domain concept
    is ever expressed through (`db.ts`, `userRepo.ts`, `bookRepo.ts`, `bookFileRepo.ts`, `loanRepo.ts`).
  - **xProvider** (`src/providers/x/`) — everything else external: `resend.ts` (real OTP email
    delivery via Resend), `otpCheck.ts` (generates real per-user codes, hashes them, and verifies
    with expiry + attempt-limit; also checks the optional `AUTH_SECRET_OTP` local-dev backdoor -
    see below), `jwt.ts` (sign/verify), `r2.ts` (Cloudflare R2 / S3, incl.
    presigned GET URLs), `epubParser.ts` (zip + OPF/XML metadata extraction incl. cover image,
    zip-bomb and XXE guarded).

## Setup

```bash
cd backend
npm install
npm run migrate   # applies db/schema.sql to DATABASE_URL from ../.env (idempotent)
```

`.env` lives at the repo root (`../.env` from `backend/`) and must define: `DATABASE_URL`,
`R2_BUCKET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `AUTH_SESSION_SECRET`,
`RESEND_API_KEY`, `AUTH_FROM_EMAIL`, `JWT_TTL_SECONDS`. `config.ts` fails fast (naming only the
missing variable names, never values) if any are absent.

`AUTH_SECRET_OTP` is optional: if set, `POST /auth/login/verify` accepts it as a fixed login code
for *any* email, with no expiry or attempt-limit - a deliberate local-dev shortcut so testing
doesn't require fetching a real code from an inbox/log each time. Leave it unset to disable the
shortcut entirely (e.g. for a real deployment); real per-user codes work either way.

## Run

```bash
npm run dev     # tsx watch, http://localhost:3000
npm start       # tsx, no watch
npm run build   # tsc -> dist/
```

## Tests

```bash
npm test            # vitest run
npm run coverage    # vitest run --coverage
```

Domain, Reactors, and the provider wrappers that don't need a real network connection
(`jwt.ts`, `otpCheck.ts`, `epubParser.ts`) are unit-tested with fakes/doubles
and are held to an 80%+ coverage bar (currently **94.2% statements/lines, 91.0% branches, 100%
functions**, 208 tests — see `vitest.config.ts`). `epubParser.ts` in particular has a dedicated test
(`test/providers/epubParser.test.ts`) that builds an in-memory zip-bomb-shaped fixture (tiny
compressed size, large decompressed size) and asserts the parser aborts mid-stream once the
~25 MB unpacked budget is exceeded — the actual zip-bomb defense, not just a config value — plus
cover-image extraction fixtures for both the EPUB3 `properties="cover-image"` manifest token and
the EPUB2 `<meta name="cover">` fallback (`test/providers/epubFixtures.ts`), including a case that
proves the byte budget is enforced while reading the cover entry too, not just the OPF/container.

Excluded from the coverage gate, per Requirements §4.7 ("schwer testbare Provider"): Portal
(pure routing), `providers/d/**` (real Neon connection), `providers/x/r2.ts` (real R2/S3
connection), and `providers/x/resend.ts` (real Resend API) — these are only exercised by the
manual smoke test below.

## Database

`db/schema.sql` is the entire schema (no migration framework, per scope): `user`, `book`,
`book_file`, `loan`. `db/migrate.ts` applies it idempotently (`create table/index if not exists`)
against `DATABASE_URL`. A unique index on `book(user_id, current_file_hash)` enforces the
duplicate-upload rule at the storage layer too, on top of the application-level check in
`uploadEpub`.

## Manual smoke test (curl)

Full flow exercised against the real test EPUB
(`../example books/Helgoland, The Strange and Beautiful Story of Quantum Physics-- Carlo Rovelli.epub`,
2.3 MB) with the server running locally on port 3000:

```bash
# 1. Request a login code - sends a real email via Resend AND logs the code
# server-side (`[auth] login code for you@example.com: <code> ...`), so it
# can be read straight off the server console for local testing without
# needing mailbox access.
curl -s -X POST http://localhost:3000/auth/login/request \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'
# -> {"ok":true}

# 2. Verify with the code from the email or the server log (valid 10 minutes,
# max 5 wrong attempts before it's invalidated - request a fresh one if it locks)
curl -s -X POST http://localhost:3000/auth/login/verify \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","code":"<code from step 1>"}'
# -> {"token":"<jwt>","userId":"<uuid>"}

TOKEN="<jwt from above>"

# 3. Upload the EPUB (metadata extraction + duplicate check, no catalog entry yet)
curl -s -X POST http://localhost:3000/books/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/Helgoland.epub;type=application/epub+zip"
# -> {"detectedMeta":{"title":"Helgoland","author":"Carlo Rovelli","language":"en"},"fileHash":"<sha256>"}

# Re-uploading the same file now returns 409:
# -> {"error":"duplicate","existingBookId":"<uuid>"}

# 4. Confirm the catalog entry with the (possibly edited) metadata
curl -s -X POST http://localhost:3000/books \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Helgoland","author":"Carlo Rovelli","fileHash":"<sha256 from step 3>"}'
# -> {"id":"<uuid>","title":"Helgoland","author":"Carlo Rovelli","fileHash":"<sha256>","processingStatus":"ready"}

BOOK_ID="<uuid from above>"

# 5. List / get the catalog entry
curl -s http://localhost:3000/books -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:3000/books/$BOOK_ID -H "Authorization: Bearer $TOKEN"

# 6. Borrow it on a device
curl -s -X POST http://localhost:3000/loans \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"bookId\":\"$BOOK_ID\",\"deviceId\":\"test-device-1\"}"
# -> {"id":"<uuid>","bookId":"<uuid>","fileHash":"<sha256>","borrowedAt":"..."}

# 7. Download the file
curl -s http://localhost:3000/books/$BOOK_ID/file \
  -H "Authorization: Bearer $TOKEN" -o downloaded.epub

# 8. Edit catalog metadata (only the given fields change; omitted fields are left as-is)
curl -s -X PATCH http://localhost:3000/books/$BOOK_ID \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Helgoland (Edited)","tags":["physics","quantum"]}'
# -> {"id":"<uuid>","title":"Helgoland (Edited)","author":"Carlo Rovelli","tags":["physics","quantum"],"fileHash":"<sha256>","processingStatus":"ready"}

# Invalid patches are rejected without touching the row:
curl -s -X PATCH http://localhost:3000/books/$BOOK_ID \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"title":"   "}'
# -> 400 {"error":"invalid_request"}

# 9. Delete the catalog entry (R2 object + book_file row(s) + loan rows + book row, in that order)
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE http://localhost:3000/books/$BOOK_ID \
  -H "Authorization: Bearer $TOKEN"
# -> 204, empty body

# Book is gone for good:
curl -s http://localhost:3000/books/$BOOK_ID -H "Authorization: Bearer $TOKEN"
# -> 404 {"error":"not_found"}
```

### Result of the last run against the real test EPUB

All 7 steps were run end-to-end against the real Neon database and real R2 bucket configured
in `.env`:

1. `POST /auth/login/request` → `200 {"ok":true}`; server log showed
   `[email-placeholder] would send OTP login email to ...` (no real send, `RESEND_API_KEY` untouched).
2. `POST /auth/login/verify` with the real `AUTH_SECRET_OTP` → `200` with a JWT + `userId`.
   A wrong code correctly returned `401 {"error":"invalid_code"}`.
3. `POST /books/upload` with the real 2.3 MB EPUB → `200` with correctly detected
   `{"title":"Helgoland","author":"Carlo Rovelli","language":"en"}` and a 64-char sha256 `fileHash`.
   Re-uploading the identical file returned `409 {"error":"duplicate","existingBookId":...}` as required.
4. `POST /books` → `201` with the catalog entry (`processingStatus: "ready"` — there is no
   background text-extraction pipeline in this walking skeleton, so books are marked ready
   immediately rather than getting stuck in `pending`).
5. `GET /books` and `GET /books/:id` → `200`, correctly scoped to the logged-in user.
6. `POST /loans` → `201` with a loan row referencing the book's current `fileHash`.
7. `GET /books/:id/file` → `200`, streamed 2,303,894 bytes whose sha256 matched the original
   file's hash exactly (byte-for-byte round trip via R2).
8. `PATCH /books/:id` with `{"title":"Helgoland (Edited)","tags":["physics","quantum"]}` → `200`
   with the updated summary (`author` left untouched since it wasn't in the patch); a follow-up
   `GET /books/:id` confirmed the change persisted. `{"title":"   "}` → `400
   {"error":"invalid_request"}`, and `{"tags":["ok",5]}` → `400 {"error":"invalid_request"}`,
   neither one touching the row.
9. `DELETE /books/:id` → `204` with an empty body. Verified `headObject` on the book's R2 key
   returned a real object (`{"sizeBytes":2303894}`) immediately before the delete and `null`
   immediately after — the R2 object is actually removed, not just the catalog row. A second
   `GET /books/:id` afterward → `404 {"error":"not_found"}`, and a second `DELETE` on the same
   (now-gone) id → `404` as well rather than erroring.

Negative paths verified: no/garbage bearer token → `401` (including on `PATCH`/`DELETE`);
accessing a book that exists but belongs to another user → `404` (never a distinguishing error
that would leak existence).

### One real bug found and fixed during the smoke test

The very first end-to-end run of step 7 (file download) came back with `Content-Length: 0` and
an empty file, even though the R2 object itself was intact (verified by streaming it directly
outside of Fastify). Root cause: the `GET /books/:id/file` route handler was `async` and called
`reply.code(...).send(stream)` without `return`ing it. In Fastify, when an async handler's
returned promise resolves to `undefined` while a stream is still being piped via a manually
invoked `reply.send()`, Fastify can tear down the response before any bytes are flushed —
this reproduced 100% of the time, independent of R2 (a plain `fs.createReadStream` hit the same
issue). Fix: every route handler in `src/portal/` now does `return reply....send(...)`. Re-ran
the full flow after the fix — file streamed correctly with a byte-for-byte matching sha256.

### Cover image smoke test (against the real test EPUB and real R2 bucket)

The real test EPUB (`../example books/Helgoland, ...epub`) does embed a cover: parsing it
directly confirmed `mediaType: image/jpeg`, `href: images/cover.jpg`, `713704` bytes, found via
the EPUB3 `properties="cover-image"` manifest token.

Full flow run against the real Neon DB and real R2 bucket (server on port 3000, path copied to
one without a comma first, see the note in the main smoke test above):

1. `POST /books/upload` → `200` with `coverKey` and a presigned `coverPreviewUrl` alongside the
   usual `detectedMeta`/`fileHash`.
2. `POST /books` with that `coverKey` → `201` with a real presigned `coverUrl`.
3. `GET /books` → `200`, same book's `coverUrl` freshly presigned (different signature/timestamp
   than step 2's, confirming it's generated per-request, not stored/cached).
4. That `coverUrl`, fetched with a real `GET` (not `curl -I` - see note below) → `200
   Content-Type: image/jpeg Content-Length: 713704`; downloaded bytes verified as a valid JPEG
   (1238×1900) with `file`.
5. Security check: `POST /books` with a `coverKey` prefixed with a different (nonexistent)
   `fileHash` than the one in the same request → accepted, but `coverUrl: null` in the response -
   the mismatched key was silently dropped rather than stored.
6. `DELETE /books/:id` on the book from step 2 → `204`; the same `coverUrl` from step 3, fetched
   again afterward → `404` - the R2 cover object is actually gone, not just the catalog row.

Note on `curl -I`: a presigned URL is signed for one specific HTTP method (`GET` here). `curl -I`
sends a `HEAD` request, which the signature doesn't cover and R2 correctly rejects with `403` -
this is expected S3/R2 presigned-URL behavior, not a bug. Reachability must be checked with an
actual `GET` (e.g. `curl -s -o /dev/null -D - "$URL"` to see headers without downloading the
body, or `curl -o file.jpg "$URL"` to download it).

## Known deviations / additions beyond the literal 8-endpoint contract

- `POST /books/upload` can also return `400 {"error":"invalid_epub"}` or
  `400 {"error":"epub_too_large"}` if the uploaded file isn't a valid zip/EPUB, or its unpacked
  content exceeds the ~25 MB zip-bomb guard. The contract only documents 200/409, but rejecting
  oversized/malformed uploads is a hard security requirement (Requirements §3.1), so a 400 was
  added rather than silently accepting the file.
- CORS is enabled permissively (`@fastify/cors`, `origin: true`) so the two frontends
  (`catalog.epubai.com` / `reader.epubai.com`) can call this API from the browser; not part of
  the given contract but operationally necessary.

## Catalog maintenance (beyond the 8-endpoint walking skeleton)

`PATCH /books/:id` and `DELETE /books/:id` were added on top of the walking skeleton to let users
edit metadata (title/author/tags) and remove books from their catalog:

- `PATCH /books/:id` — body `{ title?, author?, tags? }`; only the given fields change (omitted
  fields are left as-is; there is no upsert with empty values). A given field must still be
  well-formed: non-blank title/author after trim, `tags` an array of non-blank strings. Otherwise
  `400 {"error":"invalid_request"}`. `401`/`404` follow the same rules as every other book
  endpoint (ownership check via `authorizeBookAccess`, never a distinguishing error).
- `DELETE /books/:id` — `204` with an empty body on success. Since `book_file.book_id` and
  `loan.book_id` reference `book(id)` with no `ON DELETE CASCADE` (schema intentionally left
  unchanged), the Reactor cleans up explicitly and in order: the R2 object(s) for the book's
  `book_file` row(s), then those `book_file` rows, then any `loan` rows, then the `book` row
  itself.
- `GET /books` and `GET /books/:id` now also return `tags: string[]` (the `book.tags` column
  already existed but wasn't surfaced before), and `coverUrl: string | null` (see "Cover images"
  below).

## Cover images

Real cover images embedded in the uploaded EPUB replace the frontend's letter-avatar placeholder
once present. Important architectural point: `Book.coverUrl` / `BookSummary.coverUrl` is **not**
a stored URL - the DB column (and the `Book` domain type) actually holds an **R2 object storage
key** (e.g. `<fileHash>-cover.jpg`), because R2 is not publicly readable. A real, time-limited,
directly-fetchable URL is **presigned fresh on every request** (`r2.getPresignedUrl`, 1 hour
expiry) by the Reactor - never stored, since a stored presigned URL would eventually go stale.
This keeps `toBookSummary` in `domain/bookRpu.ts` a pure RPU (no R2 access): it now takes the
already-resolved `coverUrl` (or `null`) as a parameter, and every caller (`getBook`, `listBooks`,
`createBook`, `updateBook`) resolves it via R2 first.

Flow:

1. `POST /books/upload` - `epubParser.ts` looks for a cover image in the OPF manifest (EPUB3
   `properties="cover-image"` token, or the EPUB2 `<meta name="cover" content="ID">` fallback,
   resolved against the manifest item with that `id`; whichever the file actually uses). If
   found, the reactor uploads the cover bytes to R2 under `<fileHash>-cover.<ext>` (extension
   from the media type, or the original href, or `bin`) and returns `coverKey` (opaque, to be
   echoed back unchanged) and `coverPreviewUrl` (a presigned URL, for showing the cover in the
   edit-metadata step only - not persisted).
2. `POST /books` - accepts an optional `coverKey` from the client. **Security check**
   (`resolveCoverKey` in `bookRpu.ts`): only accepted if it starts with `<fileHash>-cover.` for
   *this* upload's own `fileHash` - otherwise silently dropped (`null`), so a client can never
   point a book at another upload's (or another user's) R2 object.
3. `GET /books` / `GET /books/:id` / `PATCH /books/:id` - all resolve the stored key to a fresh
   presigned URL before returning the summary.
4. `DELETE /books/:id` - deletes the cover's R2 object too, alongside the existing `book_file`
   object cleanup.

Books created before this feature have `cover_url = null` and simply have no cover (no
reprocessing job exists in this project state - expected, not a bug).

One implementation detail found only during the live smoke test below: the AWS SDK v3 default of
`requestChecksumCalculation`/`responseChecksumValidation: "WHEN_SUPPORTED"` appends flexible-
checksum query parameters to presigned URLs that Cloudflare R2 doesn't support, causing every
presigned GET to 403 the moment it's actually fetched by a plain client. `r2.ts` now pins both
back to `"WHEN_REQUIRED"` (the pre-3.729 SDK default) in the `S3Client` constructor.

## What's not built (out of scope for this walking skeleton)

Everything beyond the 8 listed endpoints plus the catalog maintenance above: signout, reading
progress, annotations sync, archive export, chat/translate/lookup (Claude API), account settings,
and the async text-extraction queue (§4.6) — `processingStatus` is set to `"ready"` immediately at
`POST /books` since no background pipeline exists yet to move it there later.
