# Abnahme: Login-Kleinigkeiten

## OTP-Eingabe maskiert

Das Code-Eingabefeld beim Anmelden zeigt die Zeichen jetzt wie ein Passwortfeld verdeckt an (Punkte statt Klartext). Bitte einmal im Login-Flow prüfen, ob das so gewünscht war — insbesondere, ob das Fehlen von sichtbarem Text beim Tippen eines längeren, unbekannten Codes stört oder nicht.

## OTP-E-Mail: neues Layout

Die Anmeldecode-E-Mail hat jetzt ein HTML-Layout: EpubAI-Kopfzeile, mittig ein großer, deutlich hervorgehobener Code in Monospace-Schrift mit Rahmen, darunter ein Hinweis zur Gültigkeit (10 Minuten). Vorschau (ohne dass eine echte E-Mail verschickt wurde): https://claude.ai/code/artifact/ac06515f-1e40-47e1-8c01-58258f612961

Bitte bei nächster Gelegenheit eine echte Anmeldung durchführen und die tatsächlich ankommende E-Mail im eigenen Postfach ansehen — Vorschau und echtes Rendering im Mail-Client können abweichen.
