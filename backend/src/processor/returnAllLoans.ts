import { authorizeBookAccess } from "../domain/bookRpu.js";
import * as bookRepo from "../providers/d/bookRepo.js";
import * as loanRepo from "../providers/d/loanRepo.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export type ReturnAllLoansBody = { returned: number } | { error: string };

/**
 * Reactor for POST /books/:id/return-all: beendet ALLE offenen Ausleihen
 * dieses Buchs, unabhaengig vom Geraet.
 *
 * Der Grund ist eine Sackgasse im bisherigen Ablauf: Zurueckgeben ging nur
 * von dem Geraet, das die Ausleihe haelt (returnLoan grenzt auf die
 * deviceId ein). Existiert dieser Geraetekontext nicht mehr - anderer
 * Browser, geloeschte Daten, oder der eigene Speicher der Home-Screen-App -,
 * bleibt die Ausleihe fuer immer offen. Und weil archiveBook jedes Buch
 * ablehnt, das noch irgendwo ausgeliehen ist, liess sich ein solches Buch
 * weder zurueckgeben noch archivieren. Aus der Oberflaeche gab es keinen Weg
 * heraus.
 *
 * Idempotent: Sind keine Ausleihen offen, ist das kein Fehler, sondern
 * `{ returned: 0 }` - der Zustand, den der Aufrufer wollte, besteht bereits.
 *
 * Die Datei auf dem AUFRUFENDEN Geraet raeumt der Client selbst weg (siehe
 * den gleichnamigen Reactor im Frontend). Andere Geraete behalten ihre
 * lokale Kopie, bis sie das naechste Mal online sind - dort verschwindet sie
 * dann beim Abgleich. Das ist hinnehmbar: Eine Datei ohne Ausleihe ist
 * verwaister Speicherplatz, kein Zugriff an der Ausleihe vorbei.
 */
export async function returnAllLoans(
  authorizationHeader: string | undefined,
  bookId: string
): Promise<ReactorResult<ReturnAllLoansBody>> {
  let userId: string;
  try {
    userId = requireUserId(authorizationHeader);
  } catch (err) {
    if (err instanceof AuthError) return ok(401, { error: "unauthorized" });
    throw err;
  }

  const book = await bookRepo.findById(bookId);
  if (!authorizeBookAccess(book, userId)) {
    return ok(404, { error: "not_found" });
  }

  return ok(200, { returned: await loanRepo.markAllReturned(bookId, userId) });
}
