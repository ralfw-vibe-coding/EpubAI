-- EpubAI Walking Skeleton - minimal schema (only the tables needed for the
-- 8 backend endpoints). Not a full migration framework: this file is applied
-- idempotently (all statements use IF NOT EXISTS) by db/migrate.ts.

create extension if not exists pgcrypto;

create table if not exists "user" (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

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

-- Enforces the "same hash + same user -> duplicate" rule at the storage
-- layer too, on top of the application-level check in uploadEpub.
create unique index if not exists book_user_hash_idx on book(user_id, current_file_hash);

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
