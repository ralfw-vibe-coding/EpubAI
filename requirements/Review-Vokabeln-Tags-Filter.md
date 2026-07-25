# Review: Vokabeln merken, Tag-/Farbfilter, Markdown-Notizen

Deckt deine vier Anfragen ab: Vokabeln merken (#flashcard-Notizen), Filter nach Tags in den Buchdetails, Filter nach Markierungsfarbe in den Buchdetails, Markdown-Rendering für Notizentexte mit Vorschau/Edit-Toggle.

Nicht committet, nicht gepusht. Läuft lokal (Backend :3000, Frontend-Dev-Server je nach freiem Port) gegen die **Test-Umgebung**. Gebaut von zwei parallelen Agenten (Backend: Sonnet, Frontend: Opus).

---

## 1. Vokabeln merken

- Im Übersetzungs-Ergebnis (nach "Übersetzen" auf eine Selektion) gibt es jetzt ein Lesezeichen-Icon "Als Vokabel merken" neben dem Schließen-Button.
- Tippen legt eine neue Markierung an: Text = die Selektion, Notiz = die Übersetzung, Tag `#flashcard`, Farbe = deine konfigurierte Standardfarbe (Einstellungen → „Standardfarbe für Vokabelkarten", Default Gelb).
- Danach öffnet sich direkt der Notiz-Editor mit allem schon ausgefüllt, damit du sofort nachschauen/anpassen kannst.
- **Live getestet:** Wort „Schritt" selektiert, übersetzt, gemerkt — Markierung erschien sofort gelb im Buchtext, Editor zeigte Farbe/Tag/Rohtext korrekt.

## 2. Tags auf Notizen (frei vergebbar)

- Jede Notiz kann beliebig viele Tags bekommen — Textfeld im Notiz-Editor („Tag hinzufügen… (Enter)"), Tags als entfernbare Chips.
- `#flashcard` ist einfach ein Tag wie jeder andere — von der Vokabel-Funktion automatisch gesetzt, aber genauso entfernbar/ergänzbar.

## 3. Tag- und Farbfilter in den Buchdetails

- Über der Markierungen-&-Notizen-Liste: eine Chip-Zeile mit allen aktuell vergebenen Tags (nur sichtbar, wenn es welche gibt) plus die 6 Farb-Swatches als Filter.
- Tags kombinieren sich mit Oder (mehrere Tags gleichzeitig anwählbar), die Farbe ist Einzelauswahl (nochmal antippen hebt sie auf), beides zusammen mit Und, plus die bestehende Textsuche.
- **Live getestet:** zwei Markierungen angelegt (eine gelb mit `#flashcard`, eine blau ohne Tag) — Tag-Filter zeigte korrekt nur die getaggte, Farbfilter Blau/Gelb zeigte jeweils korrekt nur die passende.

## 4. Markdown-Rendering für Notizen

- Notiztexte sind Markdown; im Notiz-Editor gibt es jetzt ein Vorschau/Bearbeiten-Icon, das zwischen Rohtext (Textarea) und gerenderter Ansicht umschaltet.
- Default: neu angelegte/gerade erst erstellte Notizen öffnen roh (damit du erstmal siehst, was du geschrieben/bekommen hast); bestehende Notizen mit Text öffnen direkt in der gerenderten Vorschau.
- In den Buchdetails wird die aufgeklappte Notiz immer gerendert angezeigt (kein Toggle nötig, dort wird nie bearbeitet) — die eingeklappte Vorschauzeile bleibt bewusst reiner Text.
- **Live getestet:** Vorschau-Umschalter im Reader hin- und hergeschaltet (roh ↔ **fett**/nummerierte Liste), Buchdetails zeigten dieselbe Notiz korrekt gerendert mit sichtbarem `#flashcard`-Chip.

## 5. Zahlen

- Backend: **424 Tests grün** (38 Dateien), `tsc` sauber, Migration (`annotation.tags`, `user.default_flashcard_color`) gegen Test gelaufen.
- Frontend: **228 Tests grün** (10 Dateien), `svelte-check` 0 Fehler/0 Warnungen.
- Alle vier Punkte oben live im Browser nachvollzogen (echter Login, echtes Testbuch „Erbarmen", echte Claude-Übersetzung), nicht nur automatisiert getestet.

## 6. Nachtrag: „Notizen werden nicht verlässlich gespeichert" — die echte Ursache (zwei Bugs)

Nach deinem Konsolen-Screenshot ist die Ursachenkette vollständig — es waren **zwei** Fehler, beide mit den neuen Features eingeschleppt:

**Bug 1 (der eigentliche Blocker): Svelte-Proxy im Worker-Kanal.** Die Tag-Chips im Notiz-Editor sind Svelte-5-`$state` — und `$state`-Arrays sind Proxies. Dieses Proxy-Array wanderte ungefiltert bis zum `postMessage` an den SQLite-Worker, und Proxies sind nicht structured-clonebar → `DataCloneError` → und weil der Wurf *nach* dem Registrieren des wartenden Aufrufs passierte, hing der Speichern-Klick für immer (bzw. lief in den 5-s-Timeout). Vor dem Tags-Feature enthielt das gespeicherte Objekt nur Strings — deshalb war Speichern früher nie ein Problem. Betroffen: Notiz speichern **und** Farbe ändern.
**Fix:** `withEditedNote`/`withEditedColor` kopieren `tags` jetzt defensiv in ein frisches Plain-Array. Zusätzlich gehärtet: Wirft `postMessage` künftig irgendwo, lehnt der Aufruf sofort mit dem echten Fehler ab, statt stumm zu hängen — und ein Konsolen-Watchdog loggt hängende DB-Aufrufe samt Leader/Follower-Rolle.

**Bug 2 (verschärfte die Symptome): awaited „best effort"-Push + schlafende Neon-DB.** Der Speichern-Reactor wartete entgegen seiner „local-first"-Beschreibung auf den Backend-Push; die Neon-Test-DB braucht nach Inaktivität 5–15 s für die erste Query. Das machte Speichern nach frischem App-Start zusätzlich träge bzw. ließ den Timeout fälschlich anschlagen.
**Fix:** Push läuft jetzt wirklich im Hintergrund (Notiz, Farbe, Löschen); Feedback spiegelt das lokale Speichern; Push-Fehler heilen sich beim nächsten Sync.

**Verifiziert:** (a) Exakt die Fehlerform aus deiner Konsole (Proxy-Array) durch den echten Prozessor → speichert jetzt in **13 ms**, Tags intakt, Farbwechsel ebenso. (b) Unklonbares Objekt → sofortige, klare Ablehnung statt 5-s-Hängen. (c) Simulierte kalte DB (8 s PATCH-Delay) → Speichern in 9 ms, Push landet später mit 200 OK. 230 Frontend-Tests grün (inkl. zwei neuer Tests gegen Array-Aliasing).

## 7. Offene Punkte

- Für Prod steht die Migration noch aus (`npm run migrate:prod`).
