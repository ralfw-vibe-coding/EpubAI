# EpubAI – Interface-Durchstich (Architektur- & Interface-Analyse)

Stand: 2026-07-13
Grundlage: `EpubAI-Requirements.md`, UI-Design-Prototyp `EPUB Library.dc.html` (14 Screens), sowie die im Gespräch beschlossenen Scope-Ergänzungen.

Diese Analyse ist **reine Interface-Ableitung** – kein Produktivcode, keine Tests. Ziel ist ein vollständiger Durchstich von den UI-Triggern über das Frontend-Processor-Interface und die Backend-Endpunkte bis zum Backend-Processor-Interface, entlang der vorgegebenen symmetrischen Service-Architektur (Portal / Processor = Summe der Reactors / Domain = Last Object mit RPUs / dProvider / xProvider).

## 0. Architektur-Kurzreferenz (Einordnung der Schichten)

| Schicht | Rolle | Client (Svelte) | Server (Fastify/Deno) |
|---|---|---|---|
| **Portal** | UI-/Technologiebindung, übersetzt Events ⇄ Processor-Aufrufe, **keine Fachlogik** | Svelte-Komponenten, epub.js-Rendering | HTTP-Router, Request/Response-Mapping |
| **Processor** | Summe aller **Reactors**; ein Reactor pro Interface-Funktion; **nur Composition/Orchestrierung** | Frontend-Reactors | Backend-Reactors (ein Reactor pro Endpunkt) |
| **Domain** | Ein kohärentes „Last Object", verwaltet App-Zustand; Interface = **RPUs** (nahezu reine Funktionen) | Reader/Catalog-Zustand lokal | Serverzustand (Users, Books, Loans, …) |
| **dProvider** | GENAU EINE Persistenz-Art der Domain (Append-and-Query) | SQLite Wasm + OPFS | Neon Postgres (+ pgvector später) |
| **xProvider** | Alles übrige Externe, der Domain unbekannt, nur von Reactors genutzt | HTTP-Client, OPFS-Dateispeicher, `navigator.storage`, Uhr, Device-ID, File-Picker/Download | R2/S3, Claude API, Voyage AI (später), E-Mail, EPUB-Parser, Queue, JWT/Uhr |

Die Portale selbst sind **nicht** Gegenstand dieser Analyse – sie sind nur die **Quelle der Trigger**.

---

## 1. Trigger-Inventar (alle 14 Screens)

Der Prototyp enthielt ursprünglich 100 Handler-Vorkommen / 85 distinkte Handler; `onFillDemo` ist seither entschieden entfallen (kein Demo-Button, s. §7 Punkt 12) → **99 Handler-Vorkommen / 84 distinkte Handler**. Format der Handler im Prototyp: `onX="{{ handlerName }}"`.

Legende Klassifikation (Spalte „Klasse"): **P-L** = Portal-lokal (reine UI-Zustandsänderung), **PROC** = Processor-Aufruf (berührt Domain-Zustand, Persistenz oder Server).

### Screen 1 – App (Root-Container)
Keine eigenen Handler (nur `sc-if`-Umschaltung der Screens über `showLogin`/`showCatalog`/… – reine View-Selektion, P-L).

### Screen 2 – Login
| Handler | Event | Tut | Klasse | Begründung |
|---|---|---|---|---|
| `onEmail` | onChange | E-Mail-Eingabefeld aktualisieren | P-L | reiner Feld-State |
| `onEmailKey` | onKeyDown | Enter → Code anfordern | P-L | Tastatur-Delegation an `onSendCode` |
| `onSendCode` | onClick | „Send code →": OTP an E-Mail anfordern | PROC | Server: E-Mail-Versand/Auth |
| `onOtp` | onChange | Code eintippen (alphanumerisch, > 6 Zeichen – **kein** rein numerisches Feld, keine feste Länge 6) | P-L | reiner Feld-State |
| `onOtpKey` | onKeyDown | Enter → verifizieren | P-L | Tastatur-Delegation an `onVerify` |
| `onVerify` | onClick | „Sign in →": Code prüfen, Session herstellen | PROC | Server: OTP-Verifikation → langlebiges JWT (≥ 1 Woche) |

_Entschieden: E-Mail + Einmal-Code (OTP) ist die MVP-Auth. Im MVP kein individuell generierter/versendeter Code, sondern fester Wert aus `AUTH_SECRET_OTP` (Server-Konfiguration, alphanumerisch, > 6 Zeichen), gegen den `onVerify` prüft. Der E-Mail-Versand-Provider (xProvider) ist trotzdem als Platzhalter implementiert und wird bei `onSendCode` tatsächlich aufgerufen (protokolliert nur, verschickt noch keine echte Mail) – damit die Architektur beim späteren Ersatz durch echten Versand unverändert bleibt. **Kein Demo-/Auto-Fill-Button** – der Code wird immer manuell eingegeben, auch im MVP. Weil das lästig genug ist, ist das JWT bewusst langlebig (≥ 1 Woche), keine kurze Session._

### Screen 3 – Catalog
| Handler | Event | Tut | Klasse | Begründung |
|---|---|---|---|---|
| `onOpenUpload` | onClick | Upload-Sheet öffnen | P-L | Sheet-Sichtbarkeit |
| `onOpenSettings` | onClick | User-Settings öffnen | P-L | Navigation |
| `onSearch` | onChange | Katalog nach Titel/Autor filtern | PROC | Query gegen Katalog (Client-Domain/Cache) |
| `t.onToggle` | onClick | Tag-Filter an/aus | PROC | Query/Filter gegen Katalogzustand |
| `onTabCovers` | onClick | Ansicht „Covers" | P-L | View-Modus |
| `onTabList` | onClick | Ansicht „List" | P-L | View-Modus |
| `b.onOpen` | onClick | Buchdetail öffnen (pro Buch) | P-L | Navigation; Detaildaten aus Katalog-Cache |

_(Implizit beim Betreten des Katalogs: `loadCatalog` – PROC, siehe §3.)_

### Screen 4 – On device
| Handler | Event | Tut | Klasse | Begründung |
|---|---|---|---|---|
| `b.onOpen` | onClick | Buchdetail öffnen | P-L | Navigation |
| `b.onRead` | onClick | Buch im Reader öffnen | PROC | lädt lokale EPUB-Datei + Lesefortschritt (dProvider/OPFS) |
| `b.onReturn` | onClick | Buch zurückgeben | PROC | Leihe beenden, lokale Kopie löschen, Notizen kanonisch übernehmen (Server + lokal) |

### Screen 5 – User settings
| Handler | Event | Tut | Klasse | Begründung |
|---|---|---|---|---|
| `onBackToCatalog` | onClick | Zurück zum Katalog | P-L | Navigation |
| `l.onPick` | onClick | „Translation language" wählen | PROC | persistiert Nutzer-/Geräte-Einstellung (jetzt MVP, s. §7) |
| `onSignOut` | onClick | Abmelden | PROC | Session/JWT verwerfen, lokalen Zustand räumen |

### Screen 6 – Book detail
| Handler | Event | Tut | Klasse | Begründung |
|---|---|---|---|---|
| `onBackToCatalog` | onClick | Zurück | P-L | Navigation |
| `onEditToggle` | onClick | Edit-Modus für Metadaten an/aus (auch „Done") | P-L | UI-Modus (Speichern erfolgt über Feld-Changes) |
| `onTitleChange` | onChange | Titel ändern | PROC | Katalog-Metadaten aktualisieren (Server) |
| `onAuthorChange` | onChange | Autor ändern | PROC | Katalog-Metadaten aktualisieren (Server) |
| `t.onRemove` | onClick | Tag entfernen | PROC | Tags aktualisieren (Server) |
| `onNewTagChange` | onChange | Neuen Tag tippen | P-L | Feld-State |
| `onNewTagKey` | onKeyDown | Enter → Tag hinzufügen | P-L | Delegation an `t.onAdd` |
| `onTagFocus` | onFocus | Tag-Vorschläge zeigen | P-L | UI |
| `onTagBlur` | onBlur | Tag-Vorschläge verbergen | P-L | UI |
| `t.onAdd` | onClick | Bestehenden/neuen Tag hinzufügen | PROC | Tags aktualisieren (Server) |
| `onReadCurrent` | onClick | „Read now →" (nur wenn ausgeliehen) | PROC | Reader öffnen: lokale Datei + Fortschritt laden |
| `onBorrowToggle` | onClick | Ausleihen / Zurückgeben | PROC | Leihe anlegen (Download EPUB) bzw. beenden – Server + lokal |
| `onExportNotes` | onClick | Notizen als `.json` exportieren | PROC | Annotationen (per fileHash) sammeln → Datei-Download (xProvider) |
| `onImportNotes` | onClick | Datei-Dialog für Notiz-Import öffnen | P-L | öffnet verstecktes File-Input via ref |
| `onImportFile` | onChange | gewählte JSON-Datei importieren | PROC | Annotationen parsen + persistieren (lokal + Sync) |
| `onRemoveAsk` | onClick | Löschbestätigung zeigen | P-L | UI |
| `onRemoveConfirm` | onClick | Buch + Notizen löschen | PROC | Buch aus Katalog entfernen (Server) |
| `onRemoveCancel` | onClick | Löschung abbrechen | P-L | UI |
| `onNavCatalog` | onClick | Bottom-Nav → Katalog | P-L | Tab-Wechsel |
| `onNavDevice` | onClick | Bottom-Nav → On device | P-L | Tab-Wechsel |

_Entschieden: Lesestatus (unread/reading/finished) und Bewertung entfallen komplett – bewusst kein Datenmodell-Feld, keine Controls nötig. Book detail zeigt nur **Progress** und **Ausleihe-Status**, das reicht vorerst._

### Screen 7 – Upload sheet
| Handler | Event | Tut | Klasse | Begründung |
|---|---|---|---|---|
| `onCloseUpload` | onClick | Sheet schließen | P-L | Sheet-Sichtbarkeit |
| `onPickFile` | onClick | Datei wählen → Upload + Metadaten-Extraktion starten | PROC | Datei-Upload + serverseitige OPF-Extraktion/Duplikatprüfung |
| `onUploadFinish` | onClick | „Add to catalog": mit erkannten Metadaten anlegen | PROC | Katalogeintrag anlegen (Server) |
| `onUploadEdit` | onClick | „Edit details" | P-L | zu Bearbeitungsformular wechseln |

_Sichtbare Zustände: `uploadPick` → `uploadParsing` („Extracting metadata…") → `uploadDone` („✓ Metadata detected") → **neu:** `uploadDuplicate` („Bereits in deiner Bibliothek" + Link zum bestehenden Katalogeintrag, kein „Add to catalog" möglich), s. §7 Punkt 5._

### Screen 8 – Reader
| Handler | Event | Tut | Klasse | Begründung |
|---|---|---|---|---|
| `onCloseReader` | onClick | Reader schließen | P-L | Navigation (Fortschritt-Flush via Lifecycle) |
| `onToggleToc` | onClick | Inhaltsverzeichnis-Sheet | P-L | Sheet |
| `onToggleNotes` | onClick | Notizen-Sheet | P-L | Sheet |
| `onOpenChat` | onClick | Chat-Sheet öffnen | P-L | Sheet |
| `onToggleBookmark` | onClick | Aktuelle Seite als Lesezeichen | PROC | Lesezeichen-Annotation anlegen/entfernen (persistiert) |
| `onToggleSettings` | onClick | Reader-Settings-Sheet | P-L | Sheet |
| `onReaderPointerUp` | onPointerUp | Textauswahl → Selektions-Popover | P-L | UI-Selektion |
| `onReaderClick` | onClick | Tap-Zonen (Menü/Blättern) | P-L | UI |
| `onReaderScroll` | onScroll | Scroll-Position/Fortschrittsbalken | P-L | UI; speist `saveReadingProgress` (§3) |
| `onPrevPage` | onClick | vorherige Seite | P-L | epub.js-Pagination; speist Fortschritt |
| `onNextPage` | onClick | nächste Seite | P-L | epub.js-Pagination; speist Fortschritt |
| `onNavBack` | onClick | „Back to …" (In-Reader-Sprung zurück) | P-L | In-Reader-Navigationsverlauf |
| `onClearHistory` | onClick | Sprung-Verlauf leeren | P-L | UI-Verlauf (nur Client) |
| `c.onPick` | onClick | Highlight-Farbe wählen (pro Farbe) | PROC | Highlight-Annotation anlegen (persistiert) |
| `onCancelSel` | onClick | Selektions-Popover schließen | P-L | UI |
| `onSelTranslate` | onClick | Auswahl übersetzen | PROC | Server: Claude (jetzt MVP, s. §7) |
| `onSelLookup` | onClick | Auswahl nachschlagen | PROC | Server: Claude (jetzt MVP, s. §7) |
| `onSelChat` | onClick | Chat mit Auswahl als Kontext öffnen | P-L | öffnet Chat-Sheet, vorbefüllt; Senden via `onChatSend` |

### Screen 9 – Reader settings
| Handler | Event | Tut | Klasse | Begründung |
|---|---|---|---|---|
| `onToggleSettings` | onClick | „Done" / Sheet schließen | P-L | Sheet |
| `onFontSerif` / `onFontSans` | onClick | Schriftart | P-L | Rendering-Präferenz (geräte-lokal, s. §7) |
| `onFontMinus` / `onFontPlus` | onClick | Schriftgröße | P-L | Rendering-Präferenz |
| `onMarginMinus` / `onMarginPlus` | onClick | Ränder | P-L | Rendering-Präferenz |
| `onModePaged` / `onModeScroll` | onClick | Blätter- vs. Scroll-Modus | P-L | Rendering-Präferenz |
| `onToggleToc` | onClick | zu TOC wechseln | P-L | Sheet |

### Screen 10 – Table of contents
| Handler | Event | Tut | Klasse | Begründung |
|---|---|---|---|---|
| `onToggleToc` | onClick | Sheet schließen | P-L | Sheet |
| `c.onJump` | onClick | zu Kapitel springen | P-L | epub.js-Navigation |
| `bm.onJump` | onClick | zu Lesezeichen springen | P-L | Navigation |
| `bm.onDelete` | onClick | Lesezeichen löschen | PROC | Lesezeichen-Annotation löschen (persistiert) |
| `onToggleNotes` | onClick | zu Notizen wechseln | P-L | Sheet |

### Screen 11 – Highlights and notes
| Handler | Event | Tut | Klasse | Begründung |
|---|---|---|---|---|
| `onToggleNotes` | onClick | Sheet schließen | P-L | Sheet |
| `onNotesSearch` | onChange | Notizen durchsuchen | P-L | Filter über geladene Notizliste des Buchs |
| `n.onJump` | onClick | zu Annotation springen | P-L | Navigation |
| `n.onEdit` | onClick | Notiz bearbeiten (Editor öffnen) | P-L | öffnet Note-Editor |
| `n.onDelete` | onClick | Annotation löschen | PROC | Annotation löschen (persistiert) |

### Screen 12 – AI result (Translate / Look up-Ergebnis)
| Handler | Event | Tut | Klasse | Begründung |
|---|---|---|---|---|
| `onCloseAi` | onClick | Ergebnis-Sheet schließen | P-L | Sheet |

_Zeigt `aiSheetTitle` + `aiResultEl` – Ergebnis eines vorangegangenen `onSelTranslate`/`onSelLookup`-Aufrufs._

### Screen 13 – Book chat
| Handler | Event | Tut | Klasse | Begründung |
|---|---|---|---|---|
| `onResetChat` | onClick | Konversation zurücksetzen | P-L | leert Chat-UI-State (stateless pro Anfrage) |
| `onCloseChat` | onClick | Chat schließen | P-L | Sheet |
| `onChatDraft` | onChange | Nachricht tippen | P-L | Feld-State |
| `onChatKey` | onKeyDown | Enter → senden | P-L | Delegation an `onChatSend` |
| `onChatSend` | onClick | Frage zum Buch senden | PROC | Server: Q&A/RAG mit Claude |

### Screen 14 – Note editor
| Handler | Event | Tut | Klasse | Begründung |
|---|---|---|---|---|
| `onNoteDraft` | onChange | Notiztext tippen | P-L | Feld-State |
| `onSaveNote` | onClick | Notiz speichern | PROC | Notiz-Annotation anlegen/aktualisieren (persistiert) |
| `onCloseNoteEditor` | onClick | Editor schließen | P-L | Sheet |

### Klassifikations-Übersicht

| Klasse | Anzahl distinkter Handler |
|---|---|
| Portal-lokal (P-L) | 62 |
| Processor-Aufruf (PROC) | 22 |
| **Summe distinkt** | **84** |

Die 22 PROC-Handler kondensieren zu **~20 Frontend-Processor-Funktionen** (mehrere Handler teilen sich eine Funktion, z.B. `onTitleChange`/`onAuthorChange`/`t.onAdd`/`t.onRemove` → `updateBookMetadata`; `onBorrowToggle`/`b.onReturn` → `borrowBook`/`returnBook`), plus **3 implizite** Funktionen ohne eigenen sichtbaren Handler (`loadCatalog`, `saveReadingProgress`, `syncOnForeground`).

---

## 2. Frontend Processor Interface

Notation: `funktion(eingabe) → ausgabe`. „Auflösung": **lokal** = allein über Client-Domain + Client-dProvider (SQLite/OPFS); **Backend** = benötigt xProvider (HTTP-Client) gegen einen Backend-Endpunkt; **lokal-first** = sofort lokal geschrieben, später via Foreground-Sync zum Backend.

### 2.1 Auth
| Funktion | Zweck | Ein → Aus | Auflösung |
|---|---|---|---|
| `requestLoginCode(email)` | OTP anfordern | email → ok/pending | **Backend** |
| `verifyLoginCode(email, code)` | Code prüfen, Session herstellen | email+code → session/JWT + userId | **Backend** |
| `signOut()` | Abmelden | – → void | lokal (JWT verwerfen, Cache räumen); optional Backend-Revoke |

### 2.2 Catalog / Suche
| Funktion | Zweck | Ein → Aus | Auflösung |
|---|---|---|---|
| `loadCatalog()` | Katalog laden + lokal cachen (implizit beim Start/Katalog-Mount) | – → Book[] | **Backend** (dann lokal gecacht) |
| `queryCatalog(search, tags)` | Filtern nach Titel/Autor/Tags | filter → Book[] | lokal (Query gegen Cache) |
| `openBookDetail(bookId)` | Detaildaten bereitstellen | bookId → BookDetail | lokal (aus Cache; ggf. Backend-Refresh) |

### 2.3 Upload / Metadaten
| Funktion | Zweck | Ein → Aus | Auflösung |
|---|---|---|---|
| `uploadEpub(file)` | Datei hochladen, Metadaten extrahieren, Duplikat prüfen – bei Duplikat wird abgebrochen, kein Katalogeintrag | file → {detectedMeta, fileHash} \| {duplicate: true, existingBookId} | **Backend** |
| `confirmAddBook(detectedMeta, fileHash)` | Buch mit (ggf. editierten) Metadaten anlegen | meta → Book | **Backend** |

### 2.4 Ausleihe / Loan
| Funktion | Zweck | Ein → Aus | Auflösung |
|---|---|---|---|
| `borrowBook(bookId)` | Ausleihen: EPUB nach OPFS laden, Loan anlegen | bookId → LocalLoan | **Backend** (Download) + lokal (OPFS-Schreiben) |
| `returnBook(bookId)` | Zurückgeben: Notizen kanonisch übernehmen, lokale Kopie löschen | bookId → void | **Backend** (Sync) + lokal (OPFS-Löschung) |
| `openBookForReading(bookId)` | EPUB + Fortschritt zum Lesen laden | bookId → {epubHandle, progress} | lokal (OPFS + SQLite) |

### 2.5 Lesefortschritt
| Funktion | Zweck | Ein → Aus | Auflösung |
|---|---|---|---|
| `saveReadingProgress(bookId, cfi, percent)` | Fortschritt speichern (getrieben von Scroll/Blättern/Close/Visibility) | pos → void | lokal-first (Sync zum Backend bei Vordergrund) |

### 2.6 Notizen / Annotationen (jeweils lokal-first, per-Annotation Last-Write-Wins)
| Funktion | Zweck | Ein → Aus | Auflösung |
|---|---|---|---|
| `createHighlight(bookId, cfi, color)` | Highlight anlegen | → Annotation | lokal-first |
| `saveNote(annotationId?, cfi, text)` | Notiz anlegen/aktualisieren | → Annotation | lokal-first |
| `toggleBookmark(bookId, cfi)` | Lesezeichen setzen/entfernen | → Annotation | lokal-first |
| `deleteAnnotation(annotationId)` | Annotation/Lesezeichen löschen | annotationId → void | lokal-first |
| `queryAnnotations(bookId, search)` | Notizen des Buchs filtern | → Annotation[] | lokal |
| `exportAnnotations(bookId/fileHash)` | Notizen als JSON exportieren | → Datei-Download | lokal (Cache) bzw. Backend-Archiv, s. §7 |
| `importAnnotations(bookId, file)` | Notizen aus JSON importieren | file → count | lokal-first (Datei via xProvider) |
| `syncOnForeground()` | Fortschritt + Annotationen bei App-Start/Vordergrund abgleichen (implizit) | – → void | **Backend** (bidirektional) |

### 2.7 Einstellungen / Account
| Funktion | Zweck | Ein → Aus | Auflösung |
|---|---|---|---|
| `setTranslationLanguage(lang)` | Übersetzungs-/Antwortsprache wählen (jetzt MVP) | lang → void | **Backend** (Account-Einstellung, geräteübergreifend) |
| `updateBookMetadata(bookId, {title?, author?, tags?})` | Metadaten/Tags ändern (Lesestatus/Bewertung entfallen, s. §7) | → Book | **Backend** + lokaler Cache |
| `deleteBook(bookId)` | Buch + Notizen entfernen | bookId → void | **Backend** |

### 2.8 KI Q&A / Chat (alle Backend, nur online)
| Funktion | Zweck | Ein → Aus | Auflösung |
|---|---|---|---|
| `askBook(bookId, question, history?)` | Q&A zum Buch (voller Buchtext als gecachter Kontext, kein RAG/Chunking im MVP) – deckt auch den Bedarf nach Zusammenfassungen ab | → Antwort | **Backend** (Claude, Prompt Caching) |
| `translateSelection(text, lang)` | Auswahl übersetzen (jetzt MVP) | → Text | **Backend** (Claude) |
| `lookupSelection(text)` | Wort/Konzept erklären (jetzt MVP) | → Erklärung | **Backend** (Claude) |

_Entschieden: `summarizeBook` entfällt als eigenständige Funktion – kein UI-Trigger im Prototyp, bei Bedarf fragt der Nutzer im Chat gezielt nach einer Zusammenfassung._

**Frontend-Processor-Funktionen gesamt: ~23** (20 aus sichtbaren Triggern + `loadCatalog`, `saveReadingProgress`, `syncOnForeground`), davon **~14 Backend-abhängig**.

---

## 3. Backend-Endpunkte

Ableitung aus allen Backend-abhängigen Frontend-Funktionen, abgeglichen mit Requirements §4.5. **`userId` stammt immer aus dem verifizierten JWT**, nie aus Client-Parametern; jede Query/Mutation ist konsequent auf `userId` gefiltert.

| # | Methode + Pfad | Zweck | Requirements §4.5-Kategorie |
|---|---|---|---|
| 1 | `POST /auth/login/request` | E-Mail → OTP versenden | Auth |
| 2 | `POST /auth/login/verify` | E-Mail+Code → JWT | Auth |
| 3 | `POST /auth/signout` | Session/Token invalidieren (optional) | Auth |
| 4 | `GET /books` | eigene Bücher listen (Katalog) | Katalog CRUD |
| 5 | `GET /books/:id` | Buchdetail | Katalog CRUD |
| 6 | `PATCH /books/:id` | Titel/Autor/Serie/Tags ändern (Lesestatus/Bewertung entfallen) | Katalog CRUD |
| 7 | `DELETE /books/:id` | Buch + Annotationen entfernen | Katalog CRUD |
| 8 | `POST /books/upload` | EPUB hochladen → Metadaten-Extraktion + Duplikatprüfung (Hash); bei Duplikat 409 Conflict, kein Eintrag | Upload |
| 9 | `POST /books` | Buch mit bestätigten Metadaten anlegen | Upload / Katalog |
| 10 | `POST /loans` | Buch auf Gerät ausleihen (Loan anlegen) | Ausleihen |
| 11 | `GET /books/:id/file` | EPUB-Binärdatei laden (aus R2, für OPFS) | Ausleihen |
| 12 | `POST /loans/:id/return` | Leihe beenden, finale Annotationen kanonisch übernehmen | Ausleihen |
| 13 | `PUT /progress` | Lesefortschritt hochsyncen | Sync |
| 14 | `GET /progress?bookId=` | Fortschritt abrufen | Sync |
| 15 | `POST /annotations` | Annotationen upserten (Batch, per-Annotation LWW) | Sync |
| 16 | `GET /annotations?bookId=&fileHash=` | Annotationen abrufen | Sync |
| 17 | `DELETE /annotations/:id` | Annotation löschen (bzw. Soft-Delete via Upsert) | Sync |
| 18 | `GET /books/:id/export?includesEpub=&includesAnnotations=` | Archiv-Export (EPUB/Notizen/beides) | Archiv-Export |
| 19 | `POST /books/:id/chat` | Q&A zum Buch (voller Buchtext, Prompt Caching, kein RAG im MVP) | KI |
| 20 | ~~`POST /books/:id/summary`~~ | **entfällt** – kein eigenständiges Zusammenfassungs-Feature, Chat deckt den Bedarf ab | – |
| 21 | `POST /ai/translate` | Text übersetzen (jetzt MVP) | KI |
| 22 | `POST /ai/lookup` | Wort/Konzept erklären (jetzt MVP) | KI |
| 23 | `PATCH /account` | Account-Einstellungen ändern (u.a. `translationLanguage`) | Einstellungen |
| — | `POST /search` (semantische Bibliothekssuche) | **derzeit außerhalb des Scope** (kein Chunking/Embedding), s. §7 | KI (zurückgestellt) |

Endpunkte 1–3 sind bereits final entschieden: **E-Mail + Einmal-Code (OTP)** statt E-Mail/Passwort – Requirements sind entsprechend angepasst (siehe Requirements 4.2b).

---

## 4. Backend Processor Interface (ein Reactor pro Endpunkt)

Jeder Reactor betreibt **nur Composition**: er verbindet Domain-RPUs (nahezu reine Funktionen auf dem Serverzustand) mit xProvidern zu einem Datenfluss. Domain-RPUs sind konzeptionell benannt; die einzige Persistenz der Domain ist der **dProvider (Neon Postgres)**.

| Endpunkt | Reactor | verbundene Domain-RPUs | verbundene xProvider |
|---|---|---|---|
| 1 `POST /auth/login/request` | `authRequestCode` | `findOrCreateUser(email)` | **E-Mail-Versand (Platzhalter)**, Uhr |
| 2 `POST /auth/login/verify` | `authVerifyCode` | `getOrCreateUserByEmail(email)` | **Code-Vergleich gegen `AUTH_SECRET_OTP`**, **JWT-Signer (Token-TTL ≥ 1 Woche)**, Uhr |
| 3 `POST /auth/signout` | `authSignout` | `invalidateSession` | (JWT/Blacklist – optional) |
| 4 `GET /books` | `listBooks` | `queryBooks(userId, filter)` | – (nur dProvider) |
| 5 `GET /books/:id` | `getBook` | `getBook(userId, bookId)` | – |
| 6 `PATCH /books/:id` | `updateBook` | `updateBookMetadata(userId, bookId, patch)` | – |
| 7 `DELETE /books/:id` | `deleteBook` | `removeBook(userId, bookId)` | **R2** (EPUB-Objekt löschen) |
| 8 `POST /books/upload` | `uploadEpub` | `computeFileHash`, `detectDuplicate(userId, hash)` (bei Treffer: Abbruch, kein `buildBookDraft`), `buildBookDraft(meta)` | **R2** (Datei ablegen), **EPUB-Parser (XXE-sicher, ≤25 MB entpackt)**, **Queue** (Textextraktion) |
| 9 `POST /books` | `createBook` | `addBook(userId, meta, fileHash)` | – |
| 10 `POST /loans` | `borrowBook` | `createLoan(userId, bookId, deviceId, fileHash)` | **R2** (Presigned URL / Streaming) |
| 11 `GET /books/:id/file` | `getBookFile` | `authorizeBookAccess(userId, bookId)` | **R2** (Objekt streamen) |
| 12 `POST /loans/:id/return` | `returnBook` | `closeLoan`, `mergeAnnotationsCanonical(loanId)` | – |
| 13 `PUT /progress` | `saveProgress` | `upsertReadingProgress(userId, bookId, cfi, percent, deviceId)` (LWW) | Uhr |
| 14 `GET /progress` | `getProgress` | `getReadingProgress(userId, bookId)` | – |
| 15 `POST /annotations` | `upsertAnnotations` | `mergeAnnotations(userId, batch)` (per-Annotation LWW über id/updatedAt) | Uhr |
| 16 `GET /annotations` | `getAnnotations` | `queryAnnotations(userId, bookId, fileHash)` | – |
| 17 `DELETE /annotations/:id` | `deleteAnnotation` | `removeAnnotation(userId, id)` | – |
| 18 `GET /books/:id/export` | `exportArchive` | `getBook`, `queryAnnotations` | **R2** (EPUB laden), **Zip/Archiv-Builder** |
| 19 `POST /books/:id/chat` | `chatBook` | `getBookText(userId, bookId)` (bzw. `getRelevantChunks` später) | **Claude API** (Prompt Caching: Buchtext als gecachter Prompt-Präfix; + ggf. **Voyage AI**/pgvector später) |
| 21 `POST /ai/translate` | `translateText` | – (zustandslos) | **Claude API** |
| 22 `POST /ai/lookup` | `lookupText` | – (zustandslos) | **Claude API** |
| 23 `PATCH /account` | `updateAccountSettings` | `updateUser(userId, {translationLanguage})` | – |

**Backend-Processor-Funktionen (Reactors) gesamt: 22** (Nr. 20 entfällt, `summarizeBook` kein eigenständiges Feature mehr; ohne den zurückgestellten `POST /search`).

**Scope-Konsequenz (aktualisiert):** Da semantische Bibliothekssuche vorerst raus ist und der Chat direkt mit dem Buchtext arbeiten darf, benötigt `uploadEpub` **kein** Embedding/Chunking (kein Voyage, kein pgvector) im MVP. Ausreichend: EPUB serverseitig parsen und **Klartext extrahieren + speichern** (Queue-Job), damit `chatBook` ihn (per Prompt Caching) als Kontext an Claude reichen kann. Voyage AI + pgvector bleiben als spätere Erweiterung optional.

---

## 5. dProvider / xProvider-Inventar

### Client (`reader.epubai.com` / `catalog.epubai.com`)
| Provider | Art | Wofür |
|---|---|---|
| SQLite Wasm (OPFS-backed, Web Worker) | **dProvider** | Relationaler Domain-Zustand: Katalog-Cache, Loans, Annotationen, Lesezeichen, Lesefortschritt, lokale Einstellungen (Append-and-Query) |
| OPFS-Dateispeicher (EPUB-Binärdateien) | xProvider | EPUB-Dateien als eigene Dateien (nicht in SQLite), von Reactors geschrieben/gelesen, an epub.js gereicht |
| HTTP-Client zum Backend | xProvider | Alle Backend-Aufrufe (§3) |
| `navigator.storage` (`persist()`) | xProvider | Eviction-Schutz für Offline-Persistenz |
| Uhr / Device-ID-Generator | xProvider | Zeitstempel (LWW), `deviceId` für Loans/Progress |
| File-Picker / File-Download (Browser-APIs) | xProvider | Upload-Auswahl, Notiz-Export/-Import |

_epub.js gehört ins **Portal** (Rendering), nicht zu den Providern._

### Server (Deno Deploy)
| Provider | Art | Wofür |
|---|---|---|
| Neon Postgres (+ pgvector, später) | **dProvider** | Gesamter Serverzustand: Users, Books, BookFiles, Loans, Annotations, ReadingProgress, ArchiveExport; Vektoren erst bei späterer semantischer Suche |
| R2 / S3-Objektspeicher | xProvider | EPUB-Binärdateien |
| Claude API | xProvider | Q&A/Chat (mit Prompt Caching des Buchtexts), Übersetzung, Lookup |
| Voyage AI | xProvider | Embeddings – **erst wenn semantische Suche/RAG-Chunking gebraucht wird** |
| E-Mail-Versand | xProvider | OTP-Versand; im MVP **Platzhalter** (protokolliert nur, kein echter Versand), aber tatsächlich aufgerufen |
| EPUB-Parser (XXE-sicher, Größenlimit) | xProvider | Metadaten-Extraktion + Klartext-Extraktion beim Upload |
| Queue | xProvider | Hintergrund-Textextraktion (serverloses Deno Deploy) |
| JWT-Signer / Uhr | xProvider | Token-Ausstellung, Zeitstempel |

---

## 6. Testbarkeits-Policy (nur Vermerk, keine Tests in dieser Analyse)

- **Mindestens 80 % Testabdeckung** für alles außer den Portalen (Portale sind reine UI-/Technologiebindung ohne Fachlogik).
- Reactors, Domain-RPUs und die meisten Provider-Adapter sind abzudecken.
- **Schwer testbare Provider** (z.B. R2/S3, Claude API, Voyage, E-Mail, OPFS, `navigator.storage`) werden **nur bei Änderung an ihnen** getestet und ansonsten von der Abdeckungsmessung ausgenommen („ignore").
- Die strikte Trennung Reactor (Composition) ↔ Domain (reine RPUs) ↔ Provider begünstigt Unit-Tests der Domain ohne Infrastruktur und der Reactors mit Provider-Doubles.

---

## 7. Offene Punkte / Widersprüche

1. ~~**Auth-Modell: OTP vs. E-Mail/Passwort.**~~ **Entschieden:** E-Mail + Einmal-Code (OTP), wie im Prototyp. Im MVP fester Code aus `AUTH_SECRET_OTP`, E-Mail-Versand als tatsächlich aufgerufener Platzhalter-Provider. Requirements sind entsprechend angepasst (§2, §4.2, §4.2b, §4.5, Datenmodell `User`).
2. ~~**Übersetzung & „Look up" im Prototyp vs. Post-MVP-Scope.**~~ **Entschieden:** Übersetzung und Lookup kommen ins MVP (Requirements §3.4 korrigiert). TTS bleibt Post-MVP, ist im Prototyp auch nicht sichtbar.
3. ~~**Zusammenfassung ohne UI-Verankerung.**~~ **Entschieden:** Kein eigenständiges Zusammenfassungs-Feature im MVP – der Chat deckt den Bedarf ab, falls ein Nutzer gezielt danach fragt. `summarizeBook`/`POST /books/:id/summary` entfallen (Requirements §3.4 korrigiert).
4. ~~**Lesestatus & Bewertung ohne Controls.**~~ **Entschieden:** Beide Felder entfallen komplett aus dem Datenmodell – nicht nur die Controls fehlen, das Feature wird nicht gebraucht. Book-detail zeigt nur Progress + Ausleihe-Status (Requirements §3.1, §6 korrigiert).
5. ~~**Duplikaterkennung ohne sichtbaren Konfliktfall.**~~ **Entschieden:** keine Duplikate zugelassen. Bei erkanntem Duplikat (Datei-Hash) wird der Upload abgebrochen (`409 Conflict`, kein Katalogeintrag), UI zeigt neuen Zustand `uploadDuplicate` mit Link zum bestehenden Eintrag (siehe Screen 7 oben).
6. ~~**Q&A auf vollem Buchtext – Kosten/Kontextfenster.**~~ **Entschieden:** Risiko für den MVP akzeptiert, keine Sonderbehandlung (kein Kapitel-Scope, kein RAG-Fallback). Bleibt als bekanntes Risiko vermerkt, RAG (Voyage + pgvector) ist der vorgesehene spätere Ausbau, falls es in der Praxis zum Problem wird.
7. ~~**Lesefortschritt hat keinen expliziten Save-Trigger.**~~ **Entschieden:** Speichern bei jedem Seitenwechsel (`onPrevPage`/`onNextPage`), zusätzlich bei Reader-Close/`visibilitychange` als Sicherheitsnetz; im Scroll-Modus gedebounced (~2–3s statt bei jedem Scroll-Event).
8. ~~**Reader-Display-Präferenzen: Persistenz-Scope offen.**~~ **Entschieden:** geräte-lokal (localStorage/xProvider), kein Sync – jedes Gerät hat eigene Anzeige-Vorlieben.
9. ~~**`setTranslationLanguage`: Ablageort.**~~ **Entschieden:** Account-Einstellung im Backend (`translationLanguage` an `User`, neuer Endpunkt `PATCH /account`, Reactor `updateAccountSettings`) – gilt geräteübergreifend, nicht pro Gerät.
10. ~~**Notiz-Export lokal vs. Backend-Archiv.**~~ **Entschieden:** `onExportNotes` ruft immer den Backend-Endpoint `GET /books/:id/export` auf (kanonischer Export) – funktioniert damit auch für nicht ausgeliehene Bücher, nur ein Implementierungsweg statt zwei.
11. **Multi-Tenancy-Durchsetzung.** Bestätigt als verbindliche Policy, keine Änderung nötig: `userId` ausschließlich aus dem JWT, nie aus Client-Parametern, in jeder Backend-RPU/Query als Filter erzwungen.
12. ~~**Prototyp-Artefakte für Produktion.**~~ **Entschieden:** kein Demo-/Auto-Fill-Button – weder im MVP noch später. Der Code wird immer manuell eingegeben (`onFillDemo` entfällt ersatzlos, auch im UI-Prototyp zu entfernen). Als Ausgleich: das Eingabefeld muss alphanumerische Codes > 6 Zeichen zulassen (nicht nur Ziffern, keine feste Länge 6), und das JWT ist bewusst langlebig (≥ 1 Woche), damit die manuelle Eingabe nicht zu oft nötig ist.
13. ~~**Chat-Zustandslosigkeit.**~~ **Entschieden:** Chat bleibt zustandslos auf dem Server; die Konversationshistorie lebt ausschließlich clientseitig und wird bei jeder Anfrage mitgeschickt (`onResetChat` löscht nur lokalen State). Das ist unkritisch, weil der teure Teil – der Buchtext – dank Prompt Caching serverseitig ohnehin nur einmal pro Cache-Fenster „echt" an Claude übertragen wird, unabhängig von der (kleinen) mitgeschickten Chat-Historie.
