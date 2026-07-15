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
Autor/Tags bearbeiten, Bücher aus dem Katalog entfernen. Die Bücherliste bietet
zwei Ansichten (Cover-Grid/Liste, umschaltbar), einen Tag-Filter (Chips,
ODER-Verknüpfung) und zeigt pro Buch den Lesefortschritt an. Bewusst **nicht**
enthalten: Notizen/Markierungen, Zurückgeben, Volltextsuche, Einstellungen,
KI-Features.

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

Manueller Durchklick-Test für Katalog-Upload, Metadaten-Bearbeitung,
Cover-Anzeige und Löschen. Voraussetzung: Backend läuft und ist unter
`PUBLIC_API_BASE_URL` erreichbar (siehe oben), ein EPUB-Testbuch liegt lokal
bereit.

1. **Server starten:** `npm run dev`, Browser öffnet `http://localhost:5173`.
2. **Einloggen** mit E-Mail + OTP (`AUTH_SECRET_OTP` aus der Backend-Config) —
   landet danach auf der Bücherliste (`/library`).
3. **Hochladen:** oben rechts im Header auf „+ Hochladen“ klicken → ein Panel
   öffnet sich mit einem Datei-Auswahlfeld → EPUB-Testdatei auswählen.
   - Erwartung: kurz „Wird hochgeladen…“, danach erscheinen der erkannte
     Titel und Autor sowie ein Button „Zum Katalog hinzufügen“.
   - **Cover-Vorschau (falls die Testdatei ein Cover-Bild enthält):** über den
     Titel-/Autor-Feldern erscheint eine kleine Bildvorschau des erkannten
     Covers.
4. **Hinzufügen bestätigen:** auf „Zum Katalog hinzufügen“ klicken.
   - Erwartung: Panel schließt sich, die Bücherliste lädt neu und zeigt das
     neue Buch.
   - **Cover in der Liste:** wurde beim Upload ein Cover erkannt, zeigt die
     Buchreihe jetzt das echte Cover-Bild anstelle der Farbfläche mit
     Anfangsbuchstabe.
5. **Duplikat testen (optional):** denselben Upload-Vorgang mit derselben
   Datei wiederholen.
   - Erwartung: statt der Metadaten erscheint „Bereits in deiner
     Bibliothek“ mit einem Link zum bestehenden Eintrag; kein
     „Hinzufügen“-Button.
6. **Metadaten bearbeiten:** das neue Buch in der Liste anklicken (öffnet
   Buchdetail), dort auf das kleine Stift-Icon direkt hinter dem Titel
   klicken (kein Textbutton mehr — Tooltip/Screenreader-Label „Metadaten
   bearbeiten“).
   - Erwartung: Titel und Autor werden zu Eingabefeldern, darunter ein
     Tag-Bereich mit Eingabefeld.
   - **Cover im Buchdetail:** hat das Buch ein Cover, erscheint links neben
     Titel/Autor eine größere Cover-Fläche mit dem echten Bild statt der
     Farbfläche.
   - Titel/Autor ändern, ein Tag eintippen und Enter drücken (erscheint als
     Chip mit „×“), Chip durch Klick auf „×“ wieder entfernen testen, dann
     ein Tag stehen lassen.
   - **Tag-Vorschläge (Autocomplete):** am besten mit mindestens zwei
     Büchern testen, die überlappende Tags haben sollen. Bei einem Buch
     einen Tag anlegen (z. B. „Sachbuch“, wie oben beschrieben, speichern),
     danach beim zweiten Buch in den Bearbeiten-Modus wechseln und im
     Tag-Feld die ersten Buchstaben tippen (z. B. „sach“).
     - Erwartung: unter dem Eingabefeld erscheint „Sachbuch“ als anklickbarer
       Chip-Vorschlag (case-insensitive Teiltreffer); Klick darauf übernimmt
       ihn wie ein per Enter eingegebener Tag.
     - Tippt man stattdessen etwas ein, das in keinem der eigenen Bücher als
       Tag vorkommt, erscheint statt der Vorschlagsliste der Hinweis „kein
       Treffer — Enter zum Anlegen von „…““.
     - Vorschläge, die dem aktuellen Buch schon zugewiesen sind, tauchen
       nicht noch einmal auf; die Liste verschwindet, sobald das Eingabefeld
       geleert oder verlassen wird.
   - Auf „Speichern“ klicken.
   - Erwartung: zurück in der Ansicht mit den geänderten Titel-/Autor-Werten
     und dem gesetzten Tag als Chip unter dem Titel.
   - **Lesefortschritt:** wurde das Buch bereits einmal ausgeliehen und im
     Reader geöffnet, erscheint auf der Buchdetail-Seite unter der
     Status-Zeile ein schmaler Fortschrittsbalken plus Prozentangabe (und,
     sobald epub.js die Seitenzahlen ermittelt hat, zusätzlich „Seite X von
     Y“) — sowohl während das Buch lokal vorliegt als auch danach. Wurde
     das Buch noch nie geöffnet, erscheint dort gar nichts.
7. **Löschen:** unten auf der Buchdetail-Seite auf „Aus Katalog entfernen…“
   klicken.
   - Erwartung: Text „Wirklich entfernen?“ mit „Ja, entfernen“/„Abbrechen“.
   - Auf „Ja, entfernen“ klicken.
   - Erwartung: Navigation zurück zur Bücherliste, das Buch ist dort nicht
     mehr enthalten.
8. **Fehlerfall (optional):** Backend kurz stoppen und einen der obigen
   Schritte wiederholen (z. B. Speichern) — es muss eine sichtbare
   Fehlermeldung erscheinen, kein stiller Fehlschlag.
9. **Cover-/Listen-Ansicht umschalten:** in der Bücherliste (`/library`)
   erscheint oberhalb der Bücher ein Umschalter mit den Optionen „Cover“ und
   „Liste“ (Segmented Control) — Standard ist „Cover“.
   - Erwartung: „Cover“ zeigt ein Raster aus Buch-Covers (Titel/Autor/Tags
     darunter); „Liste“ zeigt die kompakte Zeilen-Darstellung mit kleinem
     Cover links. Umschalten wechselt sofort zwischen beiden, ohne Neuladen.
10. **Tag-Filter:** sind Bücher mit Tags im Katalog vorhanden, erscheint eine
    horizontal scrollbare Reihe von Tag-Chips unterhalb des Cover-/
    Listen-Umschalters.
    - Auf einen Tag-Chip klicken → nur Bücher mit diesem Tag bleiben sichtbar
      (Chip ist optisch hervorgehoben), in beiden Ansichten.
    - Auf einen zweiten Chip klicken → Bücher mit *mindestens einem* der
      beiden aktiven Tags werden gezeigt (ODER-Verknüpfung).
    - Erneutes Klicken auf einen aktiven Chip hebt dessen Filter wieder auf;
      sind keine Chips mehr aktiv, sind wieder alle Bücher sichtbar.
    - Passt kein Buch zu den aktiven Tags, erscheint der Hinweis „Keine
      Bücher mit diesen Tags.“ statt einer leeren Liste.
11. **Lesefortschritt in der Bücherliste:** ein Buch im Reader (`/read/<id>`)
    ein Stück lesen, dann zurück zur Bücherliste navigieren.
    - Erwartung: bei diesem Buch erscheint jetzt — in Cover- wie in
      Listen-Ansicht — ein dünner Fortschrittsbalken mit Prozentangabe unter
      Titel/Autor, bei generierten Seitenzahlen zusätzlich „Seite X/Y“.
    - Bücher, die noch nie geöffnet wurden, zeigen konsequent keinen
      Fortschrittsbalken (keine leere Balken-Attrappe).
12. **Seitenzahl im Reader:** ein ausgeliehenes Buch öffnen (`/read/<id>`).
    - Direkt nach dem Öffnen steht in Kopf- und Fußleiste zunächst nur die
      Prozentangabe (z. B. „12 %“) — die Seitenzahl fehlt noch, weil epub.js
      im Hintergrund erst den Location-Index aufbaut (`locations.generate`).
    - Kurz warten (bei kleineren Testbüchern meist unter einer Sekunde) oder
      einmal weiterblättern: danach steht zusätzlich zur Prozentangabe in
      beiden Leisten „· 3/128“ (Kopfleiste, kompakt) bzw. „· Seite 3 von 128“
      (Fußleiste) — die tatsächlichen Zahlen hängen vom Testbuch ab.
    - Weiterblättern (Buttons, Tap-Zonen links/rechts oder Wischen) → beide
      Zahlen aktualisieren sich mit jeder Seite.
    - Buch schließen und erneut öffnen → Prozent und Seitenzahl springen
      sofort auf den zuletzt gespeicherten Stand (aus SQLite), bevor der
      Location-Index neu aufgebaut wird.
13. **Begrenzte Reader-Breite:** Browserfenster auf Desktop-Breite ziehen
    (deutlich breiter als ein Smartphone, z. B. > 900px) und den Reader
    öffnen (`/read/<id>`).
    - Erwartung: der Reader (Kopfleiste, Text, Fußleiste) bleibt auf max.
      520px Breite begrenzt und ist horizontal zentriert; links und rechts
      davon erscheint eine neutral-graue Fläche, keine über die volle
      Fensterbreite gezogene Textspalte.
    - Fenster schmaler ziehen (z. B. auf Handy-Breite) → der Reader füllt die
      volle Breite aus, keine seitlichen Ränder.

**Hinweis zu Cover-Bildern:** Bücher, die schon vor dieser Änderung angelegt
wurden, liefern `coverUrl: null` vom Backend — dort bleibt bewusst die
Farbfläche mit Anfangsbuchstabe stehen (kein Bug). Um ein echtes Cover zu
sehen, muss entweder ein Testbuch mit Cover frisch hochgeladen werden (Schritt
3/4 oben) oder das Backend-Team hat bereits ein Buch mit Cover angelegt. Falls
beim Test noch kein Buch mit Cover existiert, ist das kein Blocker für die
übrige Abnahme — einfach vermerken und mit den restlichen Schritten
fortfahren.

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
- **`ReadingProgress`-Spalten `page`/`totalPages`:** `CREATE TABLE IF NOT
  EXISTS` legt bei bereits existierenden lokalen Installationen keine neuen
  Spalten an einer bestehenden Tabelle an. `providers/d/worker.ts` versucht
  deshalb nach dem Table-Setup zusätzlich `ALTER TABLE ReadingProgress ADD
  COLUMN ...` für beide Spalten und ignoriert dabei gezielt den Fehler
  „duplicate column name“ (Spalten existieren schon) — jeder andere Fehler
  wird weitergereicht. So bekommen auch Bestandsinstallationen die neuen
  Spalten, ohne die lokale SQLite-Datenbank löschen zu müssen.
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
