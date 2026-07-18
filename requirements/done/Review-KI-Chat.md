# Review: KI-Chat (Durchstich)

Deckt zwei Backlog-Punkte ab: **KI-Grundlage** (Volltext-Extraktion, Prompt Caching) und **Chat/Q&A pro Buch**.

Nicht committet, nicht gepusht. Die App läuft lokal (Backend :3000, Frontend :5173) gegen die **Test-Umgebung** — das Testbuch „Der dressierte Nachwuchs" ist dort schon hochgeladen, mit Dossier.

---

## 1. Icons in der Selektionsleiste

Die Wörter „Übersetzen"/„Nachschlagen" sind weg, dafür drei Icons plus Abbrechen:

| Funktion | Icon |
|---|---|
| Übersetzen | `Languages` |
| Nachschlagen | `BookOpenText` |
| **Chat zur Selektion** (neu) | `MessageCircleQuestion` |

Touch-Ziele sind 36×36 (vorher kleiner), `aria-label`s sind geblieben.

**Zu prüfen:** Sind die Icons auf dem iPhone eindeutig genug ohne Text? Besonders `BookOpenText` (Nachschlagen) vs. `MessageCircleQuestion` (Chat) — beide sind „irgendwas mit fragen/lesen". Falls nicht: sag welches, ich tausche es.

**Anmerkung:** Ich konnte die Selektionsleiste nicht selbst live sehen — eine echte Textmarkierung im epub.js-iframe von außen zu erzeugen ist mir nicht gelungen. Ich habe sie im Code verifiziert (Icons, aria-labels, Größen) und alles andere live. **Das ist der eine Punkt, den nur du prüfen kannst.**

## 2. Chat zum Buch

Neues Icon `MessagesSquare` in der Reader-Toolbar, neben Inhaltsverzeichnis/Notizen/Einstellungen.

**Zu prüfen:** Gehört der Einstieg dorthin, oder erwartest du ihn woanders?

## 3. Dossier-Upload (Buchdetails)

Bereich „Dossier" mit Erklärsatz, Upload einer `.txt`/`.md`, und Löschen/Ersetzen wenn eins da ist.

**Zu prüfen:** Reicht der Erklärsatz? Aktuell: *„Ein Dossier gibt dem Chat zum Buch Hintergrundwissen zum ganzen Buch mit — optional; ohne Dossier stützen sich Antworten nur auf die Textstelle bzw. die Gliederung."*

**Bewusst nicht gebaut:** der Generieren-Button. Du hattest in der Durchstich-Liste nur den Upload genannt — und ohne Generierung entfallen die $1,42 pro Buch komplett.

## 4. Chat ohne Dossier — funktioniert, sagt aber was er nicht weiß

Live getestet, Frage „Worum geht es in diesem Buch? Und was genau steht in Kapitel 4?" **ohne** Dossier:

> „Zur Gesamtthese des Buchs kann ich nur aus dem Titel, dem Kapiteltitel des Einstiegs und der groben Kapitelfolge schließen – ich habe keinen Dossier-Text und den Fließtext der meisten Kapitel nicht gesehen. […] Das ist aber eine Einordnung aus der Struktur, keine belegte Aussage zum Inhalt."

Und zu Kapitel 4 nennt es korrekt die drei „Hebel" — aus der Gliederung, um die du gebeten hast.

**Zu prüfen:** Ist dieser Ton richtig, oder zu defensiv? Der System-Prompt zwingt das Modell aktiv dazu, Lücken zu benennen, statt sie zu überspielen.

## 5. Chat mit Dossier

Dieselbe Frage mit Dossier liefert die vier Thesen, die drei Hebel mit Details (Bologna, Multiple-Choice, Burchardt, KMK Konstanz 1997) — und trägt die Einordnung aus dem Dossier mit:

> „Wichtig für die Einordnung: Es handelt sich um eine bewusst positionierte, herrschaftskritische Streitschrift […] das sind Positionen des Autors, keine gesicherten Fakten."

**Zu prüfen:** Genau das wolltest du bei einem Buch wie Meyen, oder nervt der Disclaimer bei jeder Antwort?

## 6. Kontext-Chat (Selektion)

Getestet mit einer Selektion, die absichtlich Zeilenumbrüche mittendrin hat — so liefert epub.js sie wirklich, und daran wäre ein simples `indexOf` gescheitert. Die Stelle wurde gefunden, das Modell zitiert aus dem **umgebenden** Fenster und trennt die Quellen sauber:

> „im Anschluss an Werner Hofmann (den er **laut Dossier** in Kapitel 3 ausführlicher entfaltet)"

**Zu prüfen:** ±10.000 Zeichen pro Seite — reicht das bei deinen Sachbüchern, oder schneidet es Argumente ab? Ist eine Konstante, ich kann dran drehen (±20.000 kostet ~$0,04 statt ~$0,02 pro Frage).

## 7. Kosten — gemessen, nicht geschätzt

Caching verifiziert:

```
Aufruf 1: write=8065  read=0
Aufruf 2: write=0     read=8065   ← Treffer
```

**Korrektur meiner früheren Zahl:** Ich hatte „Dossier ~2,5k Tokens" behauptet. Gemessen sind es **7,7k** (deutsche Prosa: ~3,9 Tokens/Wort). Damit:

| | vorher behauptet | gemessen |
|---|---|---|
| pro Chat-Frage | ~$0,02 | **~$0,04** |
| Ersparnis durchs Caching | ~$0,004/Frage | ~$0,015/Frage |

Immer noch 20–40× billiger als der Volltext-Ansatz ($0,74/Frage). Die Kostenanzeige selbst ist **nicht** gebaut — stand nicht in deiner Durchstich-Liste.

## 8. Was ich beim Bauen gefunden habe

**Ein echter Kostenbug, von den Tests gefangen.** Mein Ausrichten des Kontextfensters auf Zeilengrenzen hatte keine Obergrenze. Bei einem Buch ohne Zeilenumbrüche in Reichweite — ein einziger Riesenabsatz, was schlecht gebaute EPUBs produzieren — dehnte sich das Fenster bis ans Buchende: **das ganze Buch im Prompt, $0,74 statt $0,02**. Genau die Explosion, wegen der wir umgeplant haben, durch die Hintertür. Jetzt wird hart auf Budget geschnitten.

**Migration nötig gewesen.** `dossier_uploaded_at` fehlte in der Test-DB; `npm run migrate` habe ich gegen **Test** laufen lassen. **Für Prod musst du das selbst tun**, sonst schlägt dort jeder `/books`-Aufruf mit 500 fehl.

## 9. Zahlen

- Backend: **318 Tests grün**, `tsc` sauber
- Frontend: **147 Tests grün**, `svelte-check` 0 Fehler/0 Warnungen
- Coverage: Backend 92 %, Frontend 99 % (Schwelle 80 %)
- Extraktion: ~25–50 ms pro Buch, läuft inline beim Upload

## 10. Offene Punkte

- **Kostenanzeige** (Punkt aus einer früheren Runde, nicht in der Durchstich-Liste) — soll sie rein?
- **Bild-Transkription** — bei Keen-artigen Büchern fehlen Tabellen/Diagramme weiterhin. Der Prompt verhindert, dass das Modell sie erfindet. Bewusst zurückgestellt.
- **Chat-Verlauf** ist Sitzungs-lokal, beim Schließen weg (so entschieden).
- **Streaming** — Antworten erscheinen am Stück nach ~10 s. Bei längeren Antworten könnte das zu lang wirken.
