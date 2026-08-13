import * as userRepo from "../providers/d/userRepo.js";
import * as jwtProvider from "../providers/x/jwt.js";
import { requireUserId, AuthError } from "./shared/requireUserId.js";
import { ok, type ReactorResult } from "./shared/result.js";

export type RefreshSessionBody =
  | { token: string; userId: string; translationLanguage: string; defaultFlashcardColor: string }
  | { error: string };

/**
 * Reactor for POST /auth/refresh: tauscht einen noch gültigen Token gegen
 * einen frischen mit voller Laufzeit.
 *
 * Damit läuft die Anmeldung nach NUTZUNG ab statt nach Anmeldung: Wer die App
 * innerhalb der Laufzeit öffnet, verlängert sie; erst eine Pause über die
 * volle Laufzeit hinweg erzwingt eine Neuanmeldung. Vorher war der Token
 * starr sieben Tage ab Anmeldung gültig - wer täglich las, wurde am siebten
 * Tag trotzdem ausgesperrt.
 *
 * Bewusst KEIN eigener Refresh-Token neben dem Sitzungs-Token: Das ist die
 * übliche Bauform, wenn ein kurzlebiger Zugriffs-Token von einem
 * langlebigen Erneuerungs-Token getrennt werden soll. Hier ist der
 * Sitzungs-Token ohnehin langlebig (Requirements 4.2b), ein zweiter Token
 * brächte also nur eine weitere Sache zum Speichern und Ablaufen.
 *
 * Ein abgelaufener Token wird NICHT erneuert - requireUserId prüft die
 * Signatur samt Ablauf. Sonst wäre die Ablauffrist wirkungslos.
 *
 * Zurück kommt dieselbe Form wie bei der Anmeldung, damit der Client sie
 * genauso ablegen kann. Die Vorlieben werden dabei mitgeliefert und sind
 * serverseitig maßgeblich - so zieht ein auf einem anderen Gerät geänderter
 * Wert beim nächsten Öffnen mit.
 */
export async function refreshSession(
  authorizationHeader: string | undefined
): Promise<ReactorResult<RefreshSessionBody>> {
  let userId: string;
  try {
    userId = requireUserId(authorizationHeader);
  } catch (err) {
    if (err instanceof AuthError) return ok(401, { error: "unauthorized" });
    throw err;
  }

  // Der Token allein genügt nicht: Ist das Konto inzwischen weg, darf die
  // Sitzung nicht weiterlaufen, nur weil der Token noch nicht abgelaufen ist.
  const user = await userRepo.findById(userId);
  if (!user) return ok(401, { error: "unauthorized" });

  return ok(200, {
    token: jwtProvider.sign({ userId: user.id }),
    userId: user.id,
    translationLanguage: user.translationLanguage,
    defaultFlashcardColor: user.defaultFlashcardColor
  });
}
