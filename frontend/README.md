# EpubAI Reader — Frontend (`reader.epubai.com`)

Walking-Skeleton-Frontend für den EpubAI epub-Reader. SvelteKit (Svelte 5) +
Vite + TypeScript + Tailwind CSS v4. Client-seitige SPA: SQLite-Wasm/OPFS und
epub.js laufen ausschließlich im Browser.

## Scope (Walking Skeleton + Katalog-Pflege)

Login (E-Mail + Einmal-Code) → Bücherliste → Buchdetail → Ausleihen
(Download nach OPFS + Loan in SQLite) → Reader (epub.js, Fortschritt lokal
gespeichert und beim erneuten Öffnen wiederhergestellt). Dazu die
Katalog-Pflege: Bücher per Upload hinzufügen (inkl. automatischer
Metadaten-Erkennung und Duplikaterkennung anhand des Datei-Hashes), Titel/
Autor/Tags bearbeiten, Bücher aus dem Katalog entfernen. Bewusst **nicht**
enthalten: Notizen/Markierungen, Zurückgeben, Suche/Filter nach Tags,
Einstellungen, KI-Features.

## Architektur (Portal / Processor / Domain / Provider)

Gespiegelt zum Backend, vier Schichten (siehe Requirements §4.7):

- `src/portal/` + `src/routes/` — Svelte-Komponenten/Routen. Übersetzen Events
  in Processor-Aufrufe, keine Fachlogik. `src/portal/runtime.ts` ist die
  Composition Root (verdrahtet Provider + Domain + Processor als Singleton).
- `src/processor/` — die Reactors (`src/processor/reactors/*`), einer pro Aktion.
  Reine Composition; keine eigene Fachlogik. `index.ts` bindet sie an eine
  Dependency-Bag.
- `src/domain/` — ein kohärentes „Last Object" (`createReaderDomain`) für den
  Client-Zustand (Loans, Lesefortschritt). Interface = RPUs (`rpus.ts`, reine
  Funktionen). Kennt nur den dProvider (`domain/ports.ts`), keine xProvider.
- `src/providers/d/` — dProvider: SQLite-Wasm + OPFS in einem Web Worker
  (`worker.ts` + RPC-Bridge `dprovider.ts`). Einzige Persistenz, die die Domain
  kennt.
- `src/providers/x/` — xProvider: HTTP-Client (`http.ts`), OPFS-Dateispeicher für
  die EPUB-Binärdatei (`opfs-files.ts`), `navigator.storage.persist()`
  (`storage-persist.ts`), Device-ID (`device.ts`), Uhr (`clock.ts`),
  Auth-/Token-Store (`auth-store.ts`). Der Domain unbekannt, nur von Reactors
  genutzt.

## Setup & Start

```bash
cd frontend
npm install
npm run dev        # Dev-Server auf http://localhost:5173
```

Weitere Skripte:

```bash
npm run build      # Produktions-Build (adapter-static, SPA)
npm run preview    # Build lokal ansehen
npm run check      # svelte-check (TypeScript)
npm run test       # Vitest (Unit-Tests Domain + Reactors + HTTP-Provider)
npm run coverage   # Tests mit Coverage-Report
```

### Backend-URL konfigurieren

Umgebungsvariable `PUBLIC_API_BASE_URL` (Default `http://localhost:3000`). Für
lokale Entwicklung liegt eine `frontend/.env` mit diesem Wert bei (in `.gitignore`).

```
PUBLIC_API_BASE_URL=http://localhost:3000
```

## Ein Testbuch bereitstellen

Der übliche Weg ist jetzt die Upload-UI in der Bücherliste (Button
„+ Hochladen“, siehe „Was AR konkret abzunehmen hat“ unten). Alternativ lässt
sich ein Buch weiterhin direkt per curl gegen das Backend anlegen:

```bash
# 1) Token holen (OTP = AUTH_SECRET_OTP aus der Backend-Config)
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login/verify \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","code":"<OTP>"}' | jq -r .token)

# 2) EPUB hochladen -> liefert detectedMeta + fileHash
curl -s -X POST http://localhost:3000/books/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F 'file=@buch.epub;type=application/epub+zip'

# 3) Katalogeintrag anlegen
curl -s -X POST http://localhost:3000/books \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"...","author":"...","fileHash":"<hash aus Schritt 2>"}'
```

## Was AR konkret abzunehmen hat

Manueller Durchklick-Test für Katalog-Upload, Metadaten-Bearbeitung und
Löschen. Voraussetzung: Backend läuft und ist unter `PUBLIC_API_BASE_URL`
erreichbar (siehe oben), ein EPUB-Testbuch liegt lokal bereit.

1. **Server starten:** `npm run dev`, Browser öffnet `http://localhost:5173`.
2. **Einloggen** mit E-Mail + OTP (`AUTH_SECRET_OTP` aus der Backend-Config) —
   landet danach auf der Bücherliste (`/library`).
3. **Hochladen:** oben rechts im Header auf „+ Hochladen“ klicken → ein Panel
   öffnet sich mit einem Datei-Auswahlfeld → EPUB-Testdatei auswählen.
   - Erwartung: kurz „Wird hochgeladen…“, danach erscheinen der erkannte
     Titel und Autor sowie ein Button „Zum Katalog hinzufügen“.
4. **Hinzufügen bestätigen:** auf „Zum Katalog hinzufügen“ klicken.
   - Erwartung: Panel schließt sich, die Bücherliste lädt neu und zeigt das
     neue Buch.
5. **Duplikat testen (optional):** denselben Upload-Vorgang mit derselben
   Datei wiederholen.
   - Erwartung: statt der Metadaten erscheint „Bereits in deiner
     Bibliothek“ mit einem Link zum bestehenden Eintrag; kein
     „Hinzufügen“-Button.
6. **Metadaten bearbeiten:** das neue Buch in der Liste anklicken (öffnet
   Buchdetail), dort auf „Bearbeiten“ klicken.
   - Erwartung: Titel und Autor werden zu Eingabefeldern, darunter ein
     Tag-Bereich mit Eingabefeld.
   - Titel/Autor ändern, ein Tag eintippen und Enter drücken (erscheint als
     Chip mit „×“), Chip durch Klick auf „×“ wieder entfernen testen, dann
     ein Tag stehen lassen.
   - Auf „Speichern“ klicken.
   - Erwartung: zurück in der Ansicht mit den geänderten Titel-/Autor-Werten
     und dem gesetzten Tag als Chip unter dem Titel.
7. **Löschen:** unten auf der Buchdetail-Seite auf „Aus Katalog entfernen…“
   klicken.
   - Erwartung: Text „Wirklich entfernen?“ mit „Ja, entfernen“/„Abbrechen“.
   - Auf „Ja, entfernen“ klicken.
   - Erwartung: Navigation zurück zur Bücherliste, das Buch ist dort nicht
     mehr enthalten.
8. **Fehlerfall (optional):** Backend kurz stoppen und einen der obigen
   Schritte wiederholen (z. B. Speichern) — es muss eine sichtbare
   Fehlermeldung erscheinen, kein stiller Fehlschlag.

## Designentscheidungen / Notizen

- **Token-Ablage: `localStorage`** (nicht in SQLite). Der Token muss beim
  App-Start **synchron** verfügbar sein — bevor der SQLite-Worker gebootet ist —
  um Login vs. Bibliothek zu entscheiden und den `Authorization`-Header an die
  ersten Requests zu hängen. SQLite/OPFS bleibt dem relationalen Domain-Zustand
  (Loans, Lesefortschritt) vorbehalten.
- **SQLite OPFS-SAHPool-VFS** (`installOpfsSAHPoolVfs`): braucht — anders als der
  Default-OPFS-VFS — **kein** SharedArrayBuffer und **keine** COOP/COEP-Header,
  läuft daher auf iOS Safari und dem Standard-Dev-Server ohne Zusatzkonfiguration.
- **EPUB-Binärdatei** liegt als eigene Datei in OPFS (`books/<bookId>.epub`),
  nicht als Blob in SQLite.
- **Design-Tokens** (`src/app.css`): 1:1 aus dem UI/UX-Prototyp „EPUB
  Library.dc.html" (DesignSync-Projekt „EPUB-Browser-App Design",
  Modernist-Token-Sheet) übernommen, als CSS-Custom-Properties in `:root`.
  Flat, durchgängig Archivo, kein Corner-Radius, ein roter Akzent, kräftige
  2px-Trennlinien. Der Prototyp ist **light-only** (kein Dark-Variant
  definiert); die App übernimmt das unverändert statt einen eigenen
  Dark-Mode zu erfinden.

## Teststrategie

Unit-Tests (Vitest) decken Domain-RPUs, das Domain-Objekt, alle Reactors und den
HTTP-xProvider mit Fakes ab (100 % Lines/Functions der abgedeckten Module,
Schwelle 80 %). Ausgenommen — wie in Requirements §4.7 vorgesehen — sind die
Portale (Svelte-Komponenten) sowie die browser-only Provider (SQLite-Wasm/OPFS,
epub.js-Rendering), die nur auf einem echten Gerät geprüft werden können.
