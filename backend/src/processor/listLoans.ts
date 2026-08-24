import * as loanRepo from "../providers/d/loanRepo.js";
import type { OpenLoan } from "../providers/d/loanRepo.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export type ListLoansBody = { loans: OpenLoan[] } | { error: string };

export interface ListLoansInput {
  deviceId: unknown;
}

/**
 * Reactor for GET /loans?deviceId=...: die offenen Ausleihen DIESES Geraets,
 * samt Buchtitel.
 *
 * Damit kann ein Geraet erkennen, dass ihm Buecher fehlen, die es laut Server
 * ausgeliehen hat - der Fall nach einem Verlust des lokalen Speichers.
 *
 * Die Eingrenzung auf das Geraet gehoert hierher und nicht zum Client: Ein
 * Buch, das auf einem ANDEREN Geraet ausgeliehen ist, fehlt hier zu Recht.
 * Waer die Antwort kontoweit, muesste jeder Aufrufer daran denken zu filtern -
 * und ein Vergessen fiele nicht auf, sondern zoege ungefragt fremde Buecher
 * auf dieses Geraet.
 */
export async function listLoans(
  authorizationHeader: string | undefined,
  input: ListLoansInput
): Promise<ReactorResult<ListLoansBody>> {
  let userId: string;
  try {
    userId = requireUserId(authorizationHeader);
  } catch (err) {
    if (err instanceof AuthError) return ok(401, { error: "unauthorized" });
    throw err;
  }

  if (typeof input.deviceId !== "string" || input.deviceId.length === 0) {
    return ok(400, { error: "invalid_request" });
  }

  return ok(200, { loans: await loanRepo.listOpenByDevice(userId, input.deviceId) });
}
