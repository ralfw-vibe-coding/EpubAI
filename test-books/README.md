# Test-Bücher für Agents/automatisierte Tests

EPUBs in diesem Ordner sind ausschließlich für automatisierte/agentengestützte Tests gedacht - niemals echte Nutzerdaten. Lokale Entwicklung und Live-Tests laufen gegen dieselbe echte Neon-Postgres-Datenbank und denselben echten Cloudflare-R2-Bucket wie Produktion; es gibt keine separate Testumgebung.

**Regeln für jeden Agent-Auftrag, der das Backend/Frontend live testet:**

1. Immer eine offensichtlich-fiktive Test-E-Mail-Adresse für den Login verwenden (z.B. `test-<feature>-<zufallszahl>@example.com`), niemals die echte E-Mail-Adresse des Nutzers - auch wenn `AUTH_SECRET_OTP` jede E-Mail-Adresse akzeptiert.
2. Immer eine EPUB-Datei aus **diesem Ordner** hochladen, niemals eine beliebige andere Datei vom Rechner (z.B. aus `example books/`, das für Design-/Doku-Zwecke gedacht ist, nicht als Test-Fixture).
3. Nach dem Test das eigene Test-Buch wieder löschen (`DELETE /books/:id`), damit keine Testdaten liegen bleiben.

Siehe die Memory-Einträge `feedback_no_real_account_for_testing` und `project_opfs_multitab_architecture` für den Vorfall, der zu dieser Regel geführt hat.
