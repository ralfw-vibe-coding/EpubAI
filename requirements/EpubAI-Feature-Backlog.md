# EpubAI – Feature-Backlog nach dem Walking Skeleton

Stand: 2026-07-14

Der Walking Skeleton (Login, Katalog, Ausleihen, Lesen, Blättern) läuft und wurde auf dem iPhone verifiziert. Diese Liste hält fest, was als Nächstes ansteht – in der von AR priorisierten Reihenfolge. Häkchen setzen, wenn erledigt; Reihenfolge bei Bedarf direkt hier in der Datei ändern (einfach Zeilen verschieben).

- [x] **Katalog-Pflege** – Upload-UI, Metadaten bearbeiten, Buch löschen
- [x] **Zurückgeben-Flow** – Ausleihe beenden, lokale EPUB-Kopie löschen
- [x] **Inhaltsverzeichnis im Reader** – Kapitelnavigation
- [x] **Reader-Einstellungen** – Schriftgröße, Ränder, Hell/Dunkel/Sepia, Modus
- [x] **Echter Login** – individuelle Codes statt festem Secret, echter E-Mail-Versand (Resend ist schon vorbereitet)
- [x] **Notizen & Markierungen** – anlegen/bearbeiten/löschen, Sync bei App-Start
- [x] **Übersetzung & Worterklärung** – für markierte Textstellen im Reader
- [x] **Deployment** – Deno Deploy, echte Domains catalog./reader.epubai.com
- [x] **KI-Grundlage** – Volltext-Extraktion beim Upload, Prompt Caching
- [x] **Chat/Q&A pro Buch** – Fragen zum Buchinhalt (Kontext- und Buch-Chat, optionales Dossier, Kostenanzeige)
- [ ] **Service Worker & Offline-App-Shell** – App selbst offline startbar, nicht nur Bücher
- [x] **Archiv-Export** – Notizen als Download (Archivieren separat, EPUB-Download bewusst nicht gebaut)
- [x] **Katalog-Suche & Tag-Filter** – über die bisherige einfache Liste hinaus
- [x] **Duplikat-Erkennung im Upload-UI** – sichtbarer Hinweis statt nur Backend-Check (als Teil von Katalog-Pflege mitgeliefert)

## Erstmal ausgeschlossen

Nicht verworfen, nur zurückgestellt – bei Bedarf wieder in die Liste oben aufnehmen.

- **iOS-Install-Onboarding** – Anleitung zum Hinzufügen auf dem Home-Bildschirm
- **Sign in with Apple** – spätere, optionale Login-Methode
