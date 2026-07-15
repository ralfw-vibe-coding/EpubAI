import type { User } from "../../domain/types.js";
import { pool } from "./db.js";

interface UserRow {
  id: string;
  email: string;
  created_at: Date;
}

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, createdAt: row.created_at.toISOString() };
}

export async function findByEmail(email: string): Promise<User | null> {
  const result = await pool.query<UserRow>('select id, email, created_at from "user" where email = $1', [email]);
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

export async function insert(email: string): Promise<User> {
  const result = await pool.query<UserRow>(
    'insert into "user" (email) values ($1) returning id, email, created_at',
    [email]
  );
  return toUser(result.rows[0]);
}

export async function findOrCreateByEmail(email: string): Promise<User> {
  const existing = await findByEmail(email);
  if (existing) return existing;
  // Race-safe against concurrent logins for the same brand-new address.
  const result = await pool.query<UserRow>(
    'insert into "user" (email) values ($1) on conflict (email) do update set email = excluded.email returning id, email, created_at',
    [email]
  );
  return toUser(result.rows[0]);
}

export interface StoredOtp {
  hash: string | null;
  expiresAt: string | null;
  attempts: number;
}

/** Stores a freshly generated login code for a user, replacing any previous one. */
export async function setOtp(userId: string, hash: string, expiresAt: string): Promise<void> {
  await pool.query(
    'update "user" set otp_code_hash = $1, otp_expires_at = $2, otp_attempts = 0 where id = $3',
    [hash, expiresAt, userId]
  );
}

export async function getOtp(userId: string): Promise<StoredOtp | null> {
  const result = await pool.query<{ otp_code_hash: string | null; otp_expires_at: Date | null; otp_attempts: number }>(
    'select otp_code_hash, otp_expires_at, otp_attempts from "user" where id = $1',
    [userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    hash: row.otp_code_hash,
    expiresAt: row.otp_expires_at ? row.otp_expires_at.toISOString() : null,
    attempts: row.otp_attempts
  };
}

export async function incrementOtpAttempts(userId: string): Promise<void> {
  await pool.query('update "user" set otp_attempts = otp_attempts + 1 where id = $1', [userId]);
}

/** Invalidates the outstanding code after a successful verify (one-time use). */
export async function clearOtp(userId: string): Promise<void> {
  await pool.query(
    'update "user" set otp_code_hash = null, otp_expires_at = null, otp_attempts = 0 where id = $1',
    [userId]
  );
}
