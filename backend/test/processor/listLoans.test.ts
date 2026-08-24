import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/providers/d/loanRepo.js", () => ({ listOpenByDevice: vi.fn() }));

import { listLoans } from "../../src/processor/listLoans.js";
import * as loanRepo from "../../src/providers/d/loanRepo.js";
import { sign } from "../../src/providers/x/jwt.js";

const OFFEN = [
  {
    bookId: "b1",
    deviceId: "geraet-a",
    fileHash: "h1",
    borrowedAt: "2026-08-01T00:00:00.000Z",
    title: "Ein Buch"
  }
];

describe("listLoans reactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (loanRepo.listOpenByDevice as ReturnType<typeof vi.fn>).mockResolvedValue(OFFEN);
  });

  it("gibt 401 ohne Token zurück, ohne die Datenbank zu fragen", async () => {
    expect(await listLoans(undefined, { deviceId: "geraet-a" })).toEqual({
      status: 401,
      body: { error: "unauthorized" }
    });
    expect(loanRepo.listOpenByDevice).not.toHaveBeenCalled();
  });

  // Ohne Geraet keine Antwort: Kontoweit zu antworten wuerde fremde Ausleihen
  // auf dieses Geraet ziehen - ein Buch auf einem anderen Geraet fehlt hier
  // zu Recht.
  it("verlangt eine Geräte-ID", async () => {
    const token = `Bearer ${sign({ userId: "user-1" })}`;
    expect(await listLoans(token, { deviceId: undefined })).toEqual({
      status: 400,
      body: { error: "invalid_request" }
    });
    expect(await listLoans(token, { deviceId: "" })).toEqual({
      status: 400,
      body: { error: "invalid_request" }
    });
    expect(loanRepo.listOpenByDevice).not.toHaveBeenCalled();
  });

  // Der Titel muss mit: Der lokale Ausleih-Eintrag führt ihn, damit der Reader
  // ihn ohne Netz zeigen kann. Sonst bräuchte die Wiederherstellung je Buch
  // eine zusätzliche Abfrage.
  it("liefert die offenen Ausleihen des Nutzers samt Titel", async () => {
    const result = await listLoans(`Bearer ${sign({ userId: "user-1" })}`, {
      deviceId: "geraet-a"
    });

    expect(result).toEqual({ status: 200, body: { loans: OFFEN } });
    expect(loanRepo.listOpenByDevice).toHaveBeenCalledWith("user-1", "geraet-a");
  });

  it("liefert eine leere Liste, wenn nichts ausgeliehen ist", async () => {
    (loanRepo.listOpenByDevice as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    expect(
      await listLoans(`Bearer ${sign({ userId: "user-1" })}`, { deviceId: "geraet-a" })
    ).toEqual({ status: 200, body: { loans: [] } });
  });
});
