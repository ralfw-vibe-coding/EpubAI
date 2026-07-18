-- EpubAI Walking Skeleton - minimal schema (only the tables needed for the
-- 8 backend endpoints). Not a full migration framework: this file is applied
-- idempotently (all statements use IF NOT EXISTS) by db/migrate.ts.

create extension if not exists pgcrypto;

create table if not exists "user" (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

-- Real per-user login codes (replaces the fixed AUTH_SECRET_OTP from the
-- walking skeleton, see Requirements 4.2b). Only ever one outstanding code
-- per user; requesting a new one overwrites the previous row and resets
-- otp_attempts. otp_code_hash is null when there is no outstanding code.
alter table "user" add column if not exists otp_code_hash text;
alter table "user" add column if not exists otp_expires_at timestamptz;
alter table "user" add column if not exists otp_attempts integer not null default 0;

-- Account setting: language used by the translate AI feature, geräteübergreifend
-- (Requirements 4.5 "Account-Einstellungen"). 'de' matches the app's own UI language.
alter table "user" add column if not exists translation_language text not null default 'de';

create table if not exists book (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references "user"(id),
  title text not null,
  author text not null,
  tags text[] not null default '{}',
  cover_url text,
  added_at timestamptz not null default now(),
  current_file_hash text not null,
  processing_status text not null default 'ready'
    check (processing_status in ('pending', 'processing', 'ready', 'failed'))
);

create index if not exists book_user_id_idx on book(user_id);

-- Dossier upload timestamp (Requirements 4.6 "KI-Grundlage" chat dossier).
-- Null means no dossier uploaded yet; the public API derives the boolean
-- `hasDossier` from "is not null" rather than storing that flag redundantly.
alter table book add column if not exists dossier_uploaded_at timestamptz;

-- Cumulative Claude API cost this book has run up, in USD, so the reader can
-- see the rough spend (Requirements 4.6). Only the book-grounded chat feeds
-- this - translate/lookup are per-selection and not attributed to a book.
-- numeric (not float) because it's money; every chat adds its call cost.
alter table book add column if not exists ai_cost_usd numeric(12, 6) not null default 0;

-- Enforces the "same hash + same user -> duplicate" rule at the storage
-- layer too, on top of the application-level check in uploadEpub.
create unique index if not exists book_user_hash_idx on book(user_id, current_file_hash);

-- Archive flag (Requirements "Archiv"). Null means active; the public API
-- derives the boolean `archived` from "is not null", same pattern as
-- dossier_uploaded_at -> hasDossier.
alter table book add column if not exists archived_at timestamptz;

-- The uploaded file's name at upload time (extension stripped), captured once
-- and never updated afterwards - used only to name the notes export download,
-- so it stays stable even if the (editable) title later diverges from it.
alter table book add column if not exists original_filename text;

create table if not exists book_file (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references book(id),
  storage_key text not null,
  file_hash text not null,
  size_bytes bigint not null default 0,
  uploaded_at timestamptz not null default now()
);

create index if not exists book_file_book_id_idx on book_file(book_id);

create table if not exists loan (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references book(id),
  user_id uuid not null references "user"(id),
  device_id text not null,
  file_hash text not null,
  borrowed_at timestamptz not null default now(),
  returned_at timestamptz
);

create index if not exists loan_user_id_idx on loan(user_id);
create index if not exists loan_book_id_idx on loan(book_id);

create table if not exists annotation (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references book(id),
  user_id uuid not null references "user"(id),
  cfi_range text not null,
  excerpt text not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists annotation_book_id_idx on annotation(book_id);
create index if not exists annotation_user_id_idx on annotation(user_id);

-- One of 6 selectable highlight colors (see Requirements: Notizen &
-- Markierungen color picker). 'accent' is the default, matching the app's
-- original single hardcoded highlight color.
alter table annotation add column if not exists color text not null default 'accent';
alter table annotation drop constraint if exists annotation_color_check;
alter table annotation add constraint annotation_color_check
  check (color in ('accent', 'orange', 'yellow', 'green', 'blue', 'purple'));
