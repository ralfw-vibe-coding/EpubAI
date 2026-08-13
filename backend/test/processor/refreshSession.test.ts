import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/userRepo.js", () => ({
  findById: vi.fn()
}));

import { refreshSession } from "../../src/processor/refreshSession.js";
import * as userRepo from "../../src/providers/d/userRepo.js";
import { sign, verify } from "../../src/providers/x/jwt.js";
import type { User } from "../../src/domain/types.js";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "leser@example.com",
    translationLanguage: "de",
    defaultFlashcardColor: "yellow",
    ...overrides
  } as User;
}

describe("refreshSession reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gibt 401 ohne Token zurück, ohne die Datenbank zu fragen", async () => {
    const result = await refreshSession(undefined);
    expect(result).toEqual({ status: 401, body: { error: "unauthorized" } });
    expect(userRepo.findById).not.toHaveBeenCalled();
  });

  it("gibt 401 bei einem gefälschten Token zurück", async () => {
    const result = await refreshSession("Bearer nicht.echt.signiert");
    expect(result.status).toBe(401);
    expect(userRepo.findById).not.toHaveBeenCalled();
  });

  // Der Kern: Ein gültiger Token wird gegen einen frischen getauscht, damit
  // die Frist von der letzten NUTZUNG an läuft und nicht von der Anmeldung.
  it("tauscht einen gültigen Token gegen einen neuen, gültigen", async () => {
    (userRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeUser());
    const alt = sign({ userId: "user-1" });

    const result = await refreshSession(`Bearer ${alt}`);

    expect(result.status).toBe(200);
    const body = result.body as { token: string; userId: string };
    expect(verify(body.token)).toEqual({ userId: "user-1" });
    expect(body.userId).toBe("user-1");
  });

  it("liefert die Vorlieben mit, damit ein anderes Gerät sie durchreichen kann", async () => {
    (userRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeUser({ translationLanguage: "en", defaultFlashcardColor: "green" })
    );

    const result = await refreshSession(`Bearer ${sign({ userId: "user-1" })}`);

    expect(result.body).toMatchObject({
      userId: "user-1",
      translationLanguage: "en",
      defaultFlashcardColor: "green"
    });
  });

  // Sonst liefe eine Sitzung weiter, obwohl es das Konto nicht mehr gibt.
  it("gibt 401 zurück, wenn es den Nutzer nicht mehr gibt", async () => {
    (userRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await refreshSession(`Bearer ${sign({ userId: "geloescht" })}`);

    expect(result).toEqual({ status: 401, body: { error: "unauthorized" } });
  });

  // Ohne diese Prüfung wäre die Ablauffrist wirkungslos: Ein beliebig alter
  // Token ließe sich jederzeit wieder auffrischen.
  it("erneuert einen ABGELAUFENEN Token nicht", async () => {
    (userRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeUser());
    // Token, dessen Ablauf in der Vergangenheit liegt.
    const abgelaufen = (await import("jsonwebtoken")).default.sign(
      { userId: "user-1" },
      process.env.AUTH_SESSION_SECRET as string,
      { expiresIn: -60 }
    );

    const result = await refreshSession(`Bearer ${abgelaufen}`);

    expect(result).toEqual({ status: 401, body: { error: "unauthorized" } });
    expect(userRepo.findById).not.toHaveBeenCalled();
  });
});
