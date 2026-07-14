# EpubAI Backend — Walking Skeleton

Minimal backend for the EpubAI Walking Skeleton (see `../requirements/EpubAI-Requirements.md`
and `../requirements/EpubAI-Interface-Durchstich.md`). Implements exactly the 8 endpoints of
the walking skeleton — no more.

## Architecture

Four layers, per Requirements §4.7:

- **Portal** (`src/portal/`) — Fastify routes. Pure HTTP-to-Reactor translation, no business logic.
- **Processor** (`src/processor/`) — one Reactor per endpoint (`authRequestCode`, `authVerifyCode`,
  `listBooks`, `getBook`, `uploadEpub`, `createBook`, `borrowBook`, `getBookFile`). Composition only.
- **Domain** (`src/domain/`) — RPUs (nearly-pure functions) + shared types. Knows nothing about
  Postgres, R2, JWT, etc.
- **Providers**:
  - **dProvider** (`src/providers/d/`) — Neon Postgres, the only persistence the Domain concept
    is ever expressed through (`db.ts`, `userRepo.ts`, `bookRepo.ts`, `bookFileRepo.ts`, `loanRepo.ts`).
  - **xProvider** (`src/providers/x/`) — everything else external: `emailPlaceholder.ts` (OTP
    "send", console.log only), `otpCheck.ts` (compares against `AUTH_SECRET_OTP`), `jwt.ts`
    (sign/verify), `r2.ts` (Cloudflare R2 / S3), `epubParser.ts` (zip + OPF/XML metadata
    extraction, zip-bomb and XXE guarded).

## Setup

```bash
cd backend
npm install
npm run migrate   # applies db/schema.sql to DATABASE_URL from ../.env (idempotent)
```

`.env` lives at the repo root (`../.env` from `backend/`) and must define: `DATABASE_URL`,
`R2_BUCKET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `AUTH_SESSION_SECRET`,
`AUTH_SECRET_OTP`, `JWT_TTL_SECONDS`. `config.ts` fails fast (naming only the missing variable
names, never values) if any are absent. `RESEND_API_KEY`/`AUTH_FROM_EMAIL` exist in `.env` for
later but are intentionally unused by this walking skeleton (see 4.2b) — the OTP "send" step is
a `console.log` placeholder only.

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
(`jwt.ts`, `otpCheck.ts`, `emailPlaceholder.ts`, `epubParser.ts`) are unit-tested with fakes/doubles
and are held to an 80%+ coverage bar (currently **92% statements/lines, 87% branches, 100%
functions** — see `vitest.config.ts`). `epubParser.ts` in particular has a dedicated test
(`test/providers/epubParser.test.ts`) that builds an in-memory zip-bomb-shaped fixture (tiny
compressed size, large decompressed size) and asserts the parser aborts mid-stream once the
~25 MB unpacked budget is exceeded — the actual zip-bomb defense, not just a config value.

Excluded from the coverage gate, per Requirements §4.7 ("schwer testbare Provider"): Portal
(pure routing), `providers/d/**` (real Neon connection) and `providers/x/r2.ts` (real R2/S3
connection) — these are only exercised by the manual smoke test below.

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
# 1. Request a login code (server logs "would send OTP..." — no real email is sent)
curl -s -X POST http://localhost:3000/auth/login/request \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'
# -> {"ok":true}

# 2. Verify with the fixed AUTH_SECRET_OTP value from .env
curl -s -X POST http://localhost:3000/auth/login/verify \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","code":"<AUTH_SECRET_OTP>"}'
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

Negative paths verified: no/garbage bearer token → `401`; accessing a book that exists but
belongs to another user → `404` (never a distinguishing error that would leak existence).

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

## Known deviations / additions beyond the literal 8-endpoint contract

- `POST /books/upload` can also return `400 {"error":"invalid_epub"}` or
  `400 {"error":"epub_too_large"}` if the uploaded file isn't a valid zip/EPUB, or its unpacked
  content exceeds the ~25 MB zip-bomb guard. The contract only documents 200/409, but rejecting
  oversized/malformed uploads is a hard security requirement (Requirements §3.1), so a 400 was
  added rather than silently accepting the file.
- CORS is enabled permissively (`@fastify/cors`, `origin: true`) so the two frontends
  (`catalog.epubai.com` / `reader.epubai.com`) can call this API from the browser; not part of
  the given contract but operationally necessary.

## What's not built (out of scope for this walking skeleton)

Everything beyond the 8 listed endpoints: signout, PATCH/DELETE books, reading progress,
annotations sync, archive export, chat/translate/lookup (Claude API), account settings, and the
async text-extraction queue (§4.6) — `processingStatus` is set to `"ready"` immediately at
`POST /books` since no background pipeline exists yet to move it there later.
