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
