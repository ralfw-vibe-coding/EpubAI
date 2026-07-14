# EpubAI – Anforderungen & Architektur

Stand: 2026-07-13

## 1. Vision

Ein epub Reader für den privaten/kleinen Kreis (< 10 Nutzer), der:

- als Web-App (PWA) im Desktop-Browser und auf dem iPhone läuft – keine native App, kein App Store
- auf dem Desktop primär zur Katalogpflege dient
- auf dem iPhone primär zum Lesen dient, mit guter Lesbarkeit und Offline-Fähigkeit
- Bücher lokal auf dem Gerät vorhält, damit Lesen auch ohne Internetverbindung funktioniert
- Katalog, Lesefortschritt sowie Notizen/Markierungen zwischen Geräten synchronisiert
- KI-Funktionen bietet, die Kindle/iBooks fehlen (Chat/Q&A über den Buchinhalt, Übersetzung, Worterklärungen, später semantische Suche) – daher der Name "EpubAI"

## 2. Nutzungskontext

| Aspekt | Festlegung |
|---|---|
| Nutzerzahl | Multi-Tenant, aber klein: < 10 Nutzer |
| Bibliotheksgröße | insgesamt einige hundert Bücher |
| Bibliotheks-Isolation | isoliert pro Nutzer – jeder sieht nur seine eigenen Bücher, kein Teilen |
| Rollen | keine – alle Nutzer gleichberechtigt, jeder verwaltet nur seine eigene Bibliothek |
| Account-Erstellung | offene Registrierung (E-Mail + Einmal-Code) |
| Login-Methoden (MVP) | E-Mail + Einmal-Code (OTP); im MVP ein fester Code aus Server-Konfiguration statt individuell generiertem/versendetem Code, E-Mail-Versand-Provider aber schon als Platzhalter angebunden (siehe 4.2b); Sign in with Apple als spätere Option |
| Nutzer-Limits | keine Speicher-/Buchanzahl-Limits |
| Buch-Import | ausschließlich manueller Upload, keine externen Quellen/Importer (z.B. kein Calibre) |

## 3. Funktionale Anforderungen

### 3.1 Katalog (`catalog.epubai.com`, primär Desktop)

- Bücher per Upload hinzufügen (epub-Dateien); entpackte Größe pro Datei auf ca. 25 MB begrenzt (Schutz vor Zip-Bomben), OPF/XML-Parsing ohne DTD-/External-Entity-Unterstützung (Schutz vor XXE)
- automatische Metadaten-Extraktion aus der epub-OPF-Datei (Titel, Autor, Cover, Sprache), manuell überschreibbar
- Duplikaterkennung anhand des Datei-Hashes
- Bücher taggen, nach Titel/Autor/Serie/Tags suchen und filtern
- semantische Suche über die eigene Bibliothek (KI-Feature, siehe 3.4 – vorerst nicht Teil des MVP)
- Archiv-Export anstoßen (siehe 3.3)

### 3.2 Reader & Ausleihen (`reader.epubai.com`, primär iPhone)

Kernkonzept ist eine Ausleih-Metapher ohne Exklusivität:

1. Aus dem Reader heraus wird ein Buch aus dem Katalog auf dem aktuellen Gerät **ausgeliehen** – die epub-Datei wird lokal gespeichert, das Buch ist ab dann offline lesbar
2. Dasselbe Buch kann gleichzeitig auf mehreren Geräten ausgeliehen sein
3. Notizen/Markierungen, die während der Leihe entstehen, werden zwischen allen aktiv leihenden Geräten synchronisiert (bei App-Start/Vordergrund, siehe 5)
4. **Zurückgeben** beendet die Leihe auf diesem Gerät; Notizen/Markierungen werden als kanonischer Stand in den Katalog übernommen; die lokale epub-Kopie wird dabei automatisch vom Gerät gelöscht, um Speicherplatz freizugeben. Zentral (im Katalog) bleiben Notizen/Markierungen selbstverständlich erhalten.

Lesefunktionen: Vollbild-Ansicht, Schriftgröße/Theme (hell/dunkel/sepia), Wischnavigation, Fortschrittsanzeige, Notizen/Markierungen setzen, Chat/Q&A zum aktuellen Buch, Übersetzung und Worterklärung markierter Textstellen (KI-Features, siehe 3.4).

### 3.3 Archivierung

- Export einer Buchversion als Download: epub-Datei, Notizen/Markierungen, oder beides
- Notizen/Markierungen hängen an der **Buchversion** (Hash der epub-Datei), nicht nur an der Buch-ID – bleiben so auch nach einem Re-Upload/neuer Version eindeutig zuordenbar
- Notizen können später wieder zu einem Buch (bzw. einer Buchversion) importiert werden

### 3.4 KI-Funktionen (erste Ausbaustufe)

- **Chat/Q&A pro Buch:** Fragen zum Inhalt stellen, im Chat-Format; deckt vorerst auch den Bedarf nach Zusammenfassungen ab (Nutzer fragt gezielt danach), ein eigenes Zusammenfassungs-Feature ist im MVP nicht vorgesehen
- **Übersetzung und Worterklärung ("Look up"):** für im Reader markierte Textauswahl, je ein direkter Claude-API-Aufruf ohne zusätzliche Infrastruktur
- **Semantische Suche über die Bibliothek:** inhaltliche Suche über alle eigenen Bücher hinweg, nicht nur Volltext-Stichwortsuche – **vorerst nicht Teil des MVP** (siehe 4.6), da sie eine eigene Chunking-/Embedding-Pipeline voraussetzt; kann später nachgezogen werden, ohne die übrigen KI-Funktionen zu berühren
- nur online verfügbar (siehe 5); Buchinhalte werden dafür an externe KI-Anbieter übertragen (LLM, später ggf. Embedding-Modell) – bei privater/kleiner Nutzergruppe unkritisch, aber transparent zu kommunizieren

Spätere Ausbaustufen (nicht Teil des MVP): Vorlesen (TTS), semantische Bibliothekssuche, eigenständige Kapitel-Zusammenfassungen (falls der Chat dafür nicht ausreicht).

## 4. Systemarchitektur

### 4.1 Übersicht

Zwei getrennte Frontends, ein gemeinsames Backend/API, eine gemeinsame Datenbank:

- `catalog.epubai.com` – Katalogpflege
- `reader.epubai.com` – Ausleihen & Lesen

### 4.2 Technischer Stack

| Baustein | Wahl |
|---|---|
| Plattform | Progressive Web App, TypeScript/HTML, kein natives App-Store-Deployment |
| Frontend-Build | TypeScript + Vite, Tailwind CSS, **Svelte 5 / SvelteKit** (siehe 4.2a) |
| EPUB-Rendering | [epub.js](https://github.com/futurepress/epub.js) |
| Lokale Speicherung | SQLite Wasm + OPFS (siehe 4.4) |
| Backend-Sprache | Node.js / TypeScript (Fastify oder Express) |
| Backend-Hosting | Deno Deploy (serverlos/Edge, Node-kompatibel) |
| Datenbank | Neon – Serverless Postgres mit `pgvector`-Extension |
| Dateispeicher | S3-kompatibler Objektspeicher (z.B. Cloudflare R2) für epub-Dateien |
| Auth | E-Mail + Einmal-Code (OTP), JWT/Session (siehe 4.2b) |
| KI-Embeddings | z.B. Voyage AI – vorerst nicht benötigt, da semantische Suche nicht Teil des MVP (siehe 3.4/4.6) |
| KI-Generierung | Claude API |

### 4.2a Wahl der Frontend-Technologie

Anforderung: performant und modular. Empfehlung: **Svelte 5 mit SvelteKit**.

- Svelte kompiliert zu schlankem Vanilla-JS ohne Virtual-DOM-Overhead – kleinere Bundle-Größen und schnelleres Rendering als React/Vue, was auf dem iPhone spürbar ist (Safaris Cache-Obergrenze von ca. 50MB macht Bundle-Größe zu einem echten Budget-Thema, siehe 4.3/7)
- klar modularer Komponentenaufbau (`.svelte`-Dateien), SvelteKit bringt dateibasiertes Routing für die getrennten Bereiche in `catalog.epubai.com` und `reader.epubai.com` mit
- Alternative mit ähnlichem Profil: Solid.js/SolidStart (feingranulare Reaktivität, ebenfalls ohne Virtual DOM) – falls sich Svelte im Walking Skeleton (siehe 8) nicht bewährt, ist der Wechsel früh und mit überschaubarem Aufwand möglich

### 4.2b Auth im MVP: E-Mail + Einmal-Code

Ablauf: Nutzer gibt E-Mail-Adresse ein → Backend ruft den E-Mail-Versand-Provider (xProvider) auf, um den Einmal-Code zuzustellen → Nutzer gibt den Code ein → Backend prüft ihn → bei Erfolg JWT ausstellen.

Im MVP ist der E-Mail-Versand-Provider bereits als Platzhalter implementiert und wird auch aufgerufen (nicht nur vorgesehen) – er verschickt aber noch keine echte, individuelle E-Mail, sondern protokolliert nur den (fiktiven) Versand. Der Code selbst ist im MVP kein individuell generierter Einmal-Code, sondern ein fester Wert aus der Server-Konfiguration (`AUTH_SECRET_OTP`), gegen den die Eingabe verglichen wird. Das hält die Architektur (E-Mail als Auth-Kanal, OTP-Verifizierung) von Anfang an korrekt, ohne dass echter E-Mail-Versand und echte Codegenerierung schon gebaut werden müssen – beides lässt sich später ersetzen, ohne den Ablauf zu ändern.

Kein Auto-Fill/Demo-Button im UI – der Code wird immer von Hand eingegeben, auch im MVP. `AUTH_SECRET_OTP` ist eine Zeichenfolge aus Buchstaben und Zahlen mit mehr als 6 Zeichen; das Eingabefeld dafür muss entsprechend beliebige Zeichen zulassen (kein rein numerisches Tastaturlayout, keine feste Länge von 6).

Da der Code jedes Mal manuell eingegeben werden muss, ist das ausgestellte JWT bewusst **langlebig** (mindestens 1 Woche gültig) statt einer kurzen Session – sonst müsste der eher unbequeme Code zu oft erneut eingegeben werden.

Sicherheitshinweis: ein für alle Nutzer identischer Code ist eine bewusste Vereinfachung für den kleinen, vertrauten Nutzerkreis (< 10 Personen) und **kein** Sicherheitsmodell für einen größeren oder öffentlichen Nutzerkreis. Vor einer Öffnung des Nutzerkreises müsste das durch echte, individuelle Codes ersetzt werden.

### 4.3 Warum PWA statt native App

Bewusste Entscheidung, um kein Deployment über den Apple App Store zu benötigen (kein Apple-Developer-Account, kein Mac/Xcode-Zwang, keine wiederkehrenden Store-Prozesse). Eine spätere native Hülle (z.B. via Capacitor) bleibt möglich, ohne den Web-Code neu schreiben zu müssen, falls die Einschränkungen unten zu problematisch werden.

**Bekannte Einschränkung (EU):** Seit iOS 17.4 hat Apple aus DMA-Gründen den Standalone-Modus für installierte PWAs in der EU deaktiviert. Eine "zum Home-Bildschirm hinzugefügte" PWA öffnet dort aktuell in einem normalen Safari-Tab (Adressleiste sichtbar) statt im Vollbild, Push-Benachrichtigungen und Badges funktionieren nicht. Offline-Funktionalität (Service Worker, lokale Speicherung) soll davon unberührt bleiben. Da in Deutschland/EU gelesen wird, betrifft das den Reader direkt – akzeptiert, weil die native Alternative (App Store, TestFlight mit 90-Tage-Build-Ablauf, oder EU-Web-Distribution mit Organisations-Account) einen dauerhaften, wiederkehrenden Wartungsaufwand bedeuten würde. Der tatsächliche Stand sollte früh an einem echten iPhone verifiziert werden, da sich die Regulierung ändern kann.

### 4.4 Lokale Speicherung im Detail (SQLite Wasm + OPFS)

Es wird nichts im klassischen Sinn auf dem iPhone "installiert" – alles läuft über Browser-Mechanismen, die zur Web-App gehören:

- **OPFS (Origin Private File System)** ist ein Web-Standard, der jeder Website (jedem "Origin") einen eigenen, privaten Speicherbereich auf dem Gerät gibt – unsichtbar für den Nutzer (nicht in der Dateien-App), nur von unserem eigenen JavaScript erreichbar, mit echter Datei-Semantik (im Gegensatz zu IndexedDBs Key-Value-Modell)
- **SQLite**, nach WebAssembly kompiliert (`@sqlite.org/sqlite-wasm`), läuft als Teil unseres Frontend-Codes im Browser und legt seine Datenbankdatei in OPFS ab
- Struktur: SQLite-Datenbank für relationale Daten (Notizen, Markierungen, Ausleihe-Status, Lesefortschritt, Katalog-Cache); epub-Binärdateien als eigene Dateien direkt in OPFS (nicht als Blobs in SQLite)
- SQLite-Operationen laufen aus technischen Gründen in einem Web Worker, nicht im UI-Thread
- Aus Nutzersicht: einmal `reader.epubai.com` öffnen (optional zum Home-Bildschirm hinzufügen) – ab dann leben App-Code, Datenbank und heruntergeladene Bücher im privaten Browser-Speicher dieser Domain
- Speicher unterliegt denselben Persistenz-Regeln wie sonstiger Website-Speicher: `navigator.storage.persist()` wird angefragt, um Eviction unter Speicherdruck zu reduzieren; kritische Assets werden bei jedem App-Start neu gecacht

### 4.5 Backend-API (REST, von beiden Frontends genutzt)

- Auth (E-Mail hinterlegen, Einmal-Code anfordern/versenden, Einmal-Code verifizieren, JWT ausstellen)
- Katalog CRUD (Titel, Autor, Serie, Tags, Cover), immer gefiltert auf den eingeloggten Nutzer
- Upload von epub-Dateien inkl. Metadaten-Extraktion und Duplikaterkennung
- Ausleihen/Zurückgeben eines Buchs auf/von einem Gerät
- Sync von Lesefortschritt und Notizen/Markierungen
- Archiv-Export
- KI-Endpunkte: Chat/Q&A pro Buch, Übersetzung, Worterklärung; semantische Suche über die Bibliothek folgt später (siehe 3.4/4.6)
- Account-Einstellungen (u.a. Übersetzungssprache), geräteübergreifend

**Hintergrundverarbeitung:** Da Deno Deploy serverlos ist, läuft die Text-Extraktion (siehe 4.6) als Queue-Job statt als Dauerprozess.

### 4.6 KI-Pipeline

Beim Upload läuft asynchron (Katalogeintrag zeigt "wird verarbeitet"):

1. epub serverseitig parsen → Volltext extrahieren
2. Volltext ablegen (verknüpft mit `book_id`, `fileHash`), bereit für den Chat

Kein Chunking, keine Embeddings im MVP – die wären nur für die (vorerst nicht gebaute) semantische Suche nötig. Für Chat/Q&A pro Buch reicht es, den vollen Buchtext direkt an Claude zu geben:

Abfrage (Chat): Nutzerfrage → voller Buchtext + Frage als Kontext an Claude → Antwort generieren. Um wiederholte Fragen zum selben Buch (typisch innerhalb einer Lesesitzung) nicht bei jeder Anfrage neu in voller Länge abzurechnen, wird der Buchtext per **Prompt Caching** der Claude API als stabiler, gecachter Prompt-Präfix hinterlegt – nur die eigentliche Frage kommt pro Aufruf ungecacht dazu. Bei sehr langen Büchern (jenseits des Kontextfensters) muss ggf. später doch chunk-basiert vorgegangen werden; im MVP wird das nicht erwartet.

Übersetzung/Worterklärung: jeweils ein eigenständiger Claude-Aufruf mit der markierten Textstelle (plus etwas umgebendem Kontext) als Prompt, kein Bezug zum vollen Buchtext nötig.

### 4.7 Architektur-Ebenen (Portal/Processor/Domain/Provider)

Client und Server sind zwei symmetrisch aufgebaute Services. Jeder gliedert sich in vier Schichten:

- **Portal** – UI-technologiegebundene Schicht (Client: Svelte-Komponenten; Server: HTTP-Server/Router). Übersetzt Events/Requests in Aufrufe gegen den Processor und zurück ins Rendering/die Response, enthält keine Fachlogik.
- **Processor** – die Summe aller **Reactors**. Ein Reactor pro Interface-Funktion des Processors, mit genau einer Aufgabe: Composition. Er verbindet Domain-RPUs und Provider-Funktionen zu einem Datenfluss für eine Anfrage, implementiert selbst keine Fachlogik.
- **Domain** – ein einziges kohärentes Objekt pro Service ("Last Object"), zuständig ausschließlich für Erzeugung, Verwaltung und Evolution des Service-/Anwendungszustands. Ihr Interface besteht aus RPUs (Request Processing Units) – nahezu reine Funktionen, die nur domäneneigene Datentypen und den Domain-Zustand selbst kennen, keine Provider.
- **Provider** – zweigeteilt:
  - **dProvider** (Domain-Provider): die einzige Provider-Art, die die Domain kennt, zuständig für Persistenz des eigenen Zustands (Append-and-Query statt klassischem CRUD). Client: SQLite Wasm + OPFS. Server: Neon Postgres.
  - **xProvider** (externe Provider): alles andere Externe (HTTP-Client, R2/S3, Claude API, E-Mail-Versand, Uhrzeit, Device-ID, …) – der Domain unbekannt, nur von Reactors genutzt.

Diese Trennung hält UI-Technologie (Portal) strikt von Fachlogik (Domain) und Integration (Processor/Reactors) getrennt – Feature-Änderungen erzwingen so keine wachsende, unmodularisierte UI-Datei, ohne dass das UI/UX-Design selbst (siehe Schritt 0 der Roadmap) darunter leidet.

**Teststrategie:** mindestens 80% Testabdeckung für alles außer Portale. Provider, die schwer zu testen sind, werden nur bei Änderung an ihnen getestet, ansonsten von der Abdeckungsmessung ausgenommen ("ignore").

Ein konkreter Durchstich (Trigger-Inventar aus dem UI-Prototyp, abgeleitetes Frontend-/Backend-Processor-Interface, Backend-Endpunkte) ist in `EpubAI-Interface-Durchstich.md` festgehalten.

## 5. Sync-Strategie

| Daten | Strategie |
|---|---|
| Katalog-Metadaten | online vom Backend geladen, lokal gecacht fürs Offline-Browsen (read-only offline) |
| Buchdateien | kein Auto-Download – Download passiert explizit über die Ausleihe-Aktion |
| Lesefortschritt & Notizen/Markierungen | sofort lokal geschrieben, Sync zum Backend bei App-Start/Vordergrund (kein Background Sync, auf iOS nicht zuverlässig verfügbar) |
| Konfliktauflösung | "last write wins" nach Zeitstempel **pro Annotation** (jede Notiz/Markierung hat eigene id/createdAt/updatedAt) – nicht pro Buch/Gerät, sonst könnten unabhängig auf verschiedenen Geräten neu angelegte Notizen sich gegenseitig überschreiben |
| KI-Funktionen | nur online, im UI entsprechend gekennzeichnet |

## 6. Datenmodell (Skizze)

```
User            (id, email, translationLanguage, createdAt)

Book            (id, userId, title, author, series, tags[], coverUrl, addedAt,
                 currentFileHash, processingStatus[pending|processing|ready|failed])

BookFile        (id, bookId, storageKey, fileHash, sizeBytes, uploadedAt)

BookText        (bookId, userId, fileHash, text)

Loan            (id, bookId, userId, deviceId, fileHash, borrowedAt, returnedAt)

Annotation      (id, loanId, bookId, fileHash, cfi, type[note|highlight],
                 text, color, createdAt, updatedAt)

ReadingProgress (userId, bookId, cfi, percent, updatedAt, deviceId)

ArchiveExport   (id, bookId, userId, fileHash, includesEpub,
                 includesAnnotations, createdAt)
```

Alle Abfragen sind konsequent auf `userId` gefiltert – das ist die gesamte Mandantentrennung, es braucht kein separates `tenant`-Konzept. Die `userId` wird ausschließlich aus dem verifizierten JWT abgeleitet, nie aus Client-Parametern (Body/Query) übernommen – das muss an jeder einzelnen Zugriffsstelle konsequent eingehalten werden.

## 7. iOS-Besonderheiten (Zusammenfassung)

- kein automatisches Install-Prompt → Anleitung "Zum Home-Bildschirm hinzufügen" im Onboarding
- in der EU aktuell Safari-Tab statt Vollbild-Modus (siehe 4.3) – UI darf nicht auf Standalone-Modus angewiesen sein
- Speicher kann unter Speicherdruck geleert werden – `persist()` nutzen, kritische Assets bei jedem Start neu cachen
- Safe-Area-Insets (Notch/Home-Indicator) berücksichtigen
- Touch-Gesten: Wischen für Seiten, Tap-Zonen fürs Menü, Pinch-Zoom im Reader deaktiviert
- Dark/Sepia-Modus für augenschonendes Lesen
- Speicherplatz begrenzt: UI zeigt an, wie viel Platz ausgeliehene Bücher belegen

## 8. Vorgehen & Roadmap

Bevor die eigentliche Implementierung beginnt, wird ein **UI/UX-Prototyp** erstellt und mit AR abgestimmt (Design/Interaktion, kein Produktivcode). Danach folgt ein schneller **Walking Skeleton** – ein dünner, aber vollständiger Durchstich durch den gesamten Stack (Login, ein Buch hochladen, auf einem echten iPhone ausleihen und lesen). Das validiert früh und praktisch die kritischen Unbekannten dieses Plans, insbesondere das tatsächliche PWA-Verhalten (Standalone vs. Safari-Tab, Offline-Persistenz) auf einem echten iPhone in der EU sowie die Wahl von Svelte/SvelteKit.

0. **UI/UX-Prototyp:** Design und Interaktionsfluss für Katalog und Reader, zur Abstimmung vorgelegt
1. **Walking Skeleton:** dünner Durchstich durch den ganzen Stack (Deno Deploy + Neon + ein Frontend-Screen + Ausleihen eines Testbuchs auf echtem iPhone), deckt frühzeitig Risiken auf
2. **MVP:** Backend (Auth, Katalog CRUD, Datei-Upload/Storage), `catalog.epubai.com`, einfacher Online-Reader auf `reader.epubai.com` mit epub.js
3. **Ausleihen & Offline:** SQLite Wasm/OPFS, Service Worker, vollständiger Ausleihen/Zurückgeben-Flow inkl. automatischem Löschen der lokalen Kopie bei Rückgabe
4. **Notizen-Sync:** Notizen/Markierungen geräteübergreifend synchronisieren, Rückgabe übernimmt sie in den Katalog
5. **KI-Grundlage:** Volltext-Extraktion beim Upload, Prompt-Caching-Setup für den Chat
6. **KI-Features:** Chat/Q&A pro Buch, Übersetzung/Worterklärung im Reader; semantische Bibliothekssuche (Chunking/Embeddings) folgt erst später als eigener Schritt
7. **Feinschliff:** Archiv-Export, iOS-Install-Onboarding, Themes/Schriftgrößen, evtl. Sign in with Apple

## 9. Offene Punkte

Aktuell keine offenen architektonischen Fragen mehr. Der Walking Skeleton (siehe 8) dient als praktische Verifikation der bisher nur theoretisch getroffenen Annahmen (v.a. EU-PWA-Verhalten, Svelte-Performance auf echtem Gerät) und kann bei Bedarf zu Anpassungen führen.
