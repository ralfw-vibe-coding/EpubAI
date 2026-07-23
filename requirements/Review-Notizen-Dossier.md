# Review: Markierungen/Notizen in Buchdetails + Dossier generieren

Deckt deine `todo.md`-Einträge „Markierungen und Notizen zum Buch in den Buchdetails anzeigen" und „Suchen in den Markierungen und Notizen in den Buchdetails" ab, plus „Dossier generieren lassen" aus derselben Anfrage. Inklusive der vier Verfeinerungen aus deinem Folge-Feedback.

Nicht committet, nicht gepusht. Läuft lokal (Backend :3000, Frontend :5173) gegen die **Test-Umgebung**.

---

## 1. Markierungen & Notizen in Buchdetails

- Zwei Zähler (Markierungen-Icon, Notizen-Icon) direkt unter Titel/Autor — **immer sichtbar**, unabhängig vom Ausleihstatus. Dieselben Icons+Zahlen jetzt auch im Katalog (Cover- und Listenansicht), nur wenn > 0.
- Eine Markierung ohne Notiztext zählt als „Markierung", mit Notiztext als „Notiz" — reine `note === null`-Unterscheidung, keine neue Datenstruktur.
- Neue Liste „Markierungen & Notizen" unter dem Notizen-Export/Import-Bereich — **nur sichtbar, wenn das Buch ausgeliehen ist** (dort ist der lokale Cache garantiert aktuell).
  - **Icon pro Zeile** zeigt, ob Markierung (Textmarker-Symbol) oder Notiz (Notizzettel-Symbol) — dein Feedback von eben, umgesetzt.
  - **Notizvorschau eingeklappt:** eine zweite, gekürzte Zeile unter dem Zitat deutet den Notiztext an, wenn einer da ist.
  - **Aufgeklappt:** volles Zitat + vollständiger Notiztext, jetzt mit korrekt erhaltenen Zeilenumbrüchen (vorher gingen die verloren).
  - Icon zum Öffnen im Reader an genau der Stelle (`?cfi=`-Deep-Link).
  - Suche (Volltext über Zitat + Notiztext), Paginierung (10/Seite).
  - Rein lesend — keine Änderung an Notizen an dieser Stelle.

**Zu prüfen:** Reicht die Vorschauzeile bei langen Notizen, oder soll sie mehr als eine Zeile zeigen?

## 2. Dossier generieren

- Neue Icons im Dossier-Bereich: Ansehen (Auge), Ersetzen/Hochladen (Upload), Löschen (Papierkorb), Generieren (Funken-Icon). Alle Buttons sind jetzt reine Icons mit Tooltip — auf deinen Wunsch von eben, außer Generieren, das zusätzlich die Kosten als Text neben dem Icon zeigt (ein reines Icon kann keinen Betrag transportieren).
- Generieren fragt vorher per Tap-to-arm/Tap-to-confirm nach (wie der Löschen-Button), weil es echtes Geld kostet — Kostenschätzung steht schon vor dem ersten Klick da.
- **Ansehen** öffnet ein Overlay mit dem vollen Dossier-Text, als Markdown gerendert (Überschriften, Fett, Listen) — vorher konntest du ein vorhandenes Dossier gar nicht einsehen.
- **Kosten getrennt:** „Status: … / Chats: ≈ $X / Dossier: ≈ $Y" statt einer vermischten Summe — dein Feedback von eben. Neue DB-Spalte `dossier_cost_usd`, komplett getrennt von den Chat-Kosten.

**Live getestet, echter Claude-Aufruf:** Dossier fürs Testbuch generiert (Volltext ~700k Zeichen), Antwortzeit real ~58 Sekunden, Kosten korrekt verbucht ($0,18 zusätzlich zu $0,06 Chat-Kosten), Ergebnis im Overlay sauber gerendert (KOPF/WORUM ES GEHT/AUFBAU-Struktur aus dem Dossier-Prompt).

**Zu prüfen:** ~58s Wartezeit beim Generieren — reicht ein simples „…" im Button, oder soll ein Fortschritts-/Wartehinweis her?

## 3. Was ich beim Bauen gefunden habe

**Sortier-Bug in der neuen Liste.** Der Contract verlangte „neueste zuerst", aber die Daten kamen unsortiert (ältestes zuerst) aus dem lokalen Cache — der bauende Agent hatte das nicht umgesetzt, obwohl im Code kommentiert. Beim Verifizieren gefunden und behoben (einfaches Reverse beim Laden, da die zugrundeliegende Query bereits aufsteigend sortiert).

**Reader-Deep-Link mit kaputten Test-Daten.** Beim Testen des „Im Buch öffnen"-Icons mit künstlich erfundenen Test-CFIs (aus früherem Backend-Testing, keine echten Textauswahlen) blieb der Reader hängen. Mit einer echten, per Textauswahl erzeugten CFI funktioniert es wie erwartet (bestätigt über das bereits bestehende „Notizen & Markierungen"-Menü im Reader selbst, das dieselbe epub.js-Funktion nutzt). Kein Fix nötig — nur meine eigenen Testdaten waren ungültig.

## 4. Zahlen

- Backend: **404 Tests grün** (38 Dateien), `tsc` sauber
- Frontend: **196 Tests grün** (8 Dateien), `svelte-check` 0 Fehler/0 Warnungen
- Migrationen (`dossier_cost_usd`, plus aus der vorherigen Runde `archived_at`/`original_filename`) gegen **Test** gelaufen. **Für Prod stehen sie noch aus** (`npm run migrate:prod`).

## 5. Offene Punkte

- Kein Fortschrittsbalken beim Generieren — nur ein „…" im Button für ~58s. Falls das zu lang wirkt, kann ich einen Hinweistext ergänzen ("Das kann eine Minute dauern").
- Die Vorschauzeile bei langen Notizen zeigt nur eine gekürzte Zeile — siehe Punkt 1.
