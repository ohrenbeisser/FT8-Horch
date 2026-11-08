# Änderungen

Das Format folgt grob [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionen zählen nach [SemVer](https://semver.org/lang/de/).

## [0.3.0] – 2026-11-08

Gegenüber 0.2.0 (06.11.2026).

### Neu

- **Anruf an mich melden** (Einstellungen, Karte „Automatik“, Vorgabe an): Kommt eine Nachricht an das eigene Rufzeichen, zeigt die App kurz „Anruf von …“, lässt das Gerät vibrieren und setzt, solange die Seite im Hintergrund liegt, einen Punkt vor den Seitentitel. Ein Ton fehlt absichtlich, das Mikrofon würde ihn hören. Die Einstellung ist Teil der Sicherung.
- **Aufnahmeuhr wird nachgeführt:** Aus der Ankunft der Mikrofonblöcke schätzt die App laufend den Startzeitpunkt der Aufnahme (kleinste Verzögerung der letzten zwei Minuten). Eine einmalige Verzögerung beim Start und die Abweichung zwischen Audiotakt und Systemuhr (typisch 10 bis 100 ppm) verschieben DT nicht mehr dauerhaft.
- **Content-Security-Policy** in `index.html`: erlaubt nur den eigenen Ursprung, ein Nachladen aus dem Netz ist technisch ausgeschlossen. Das Manifest hat jetzt eine `id`.
- **Messwerkzeug** `tools/messung_decodezeit.mjs` für die Rechenzeit des Decoders (Bericht `docs/messung_decodezeit_2026-11-08.md`).

### Geändert

- **Takt der Station auch aus den Mikrofonblöcken**, nicht nur aus einem Timer. Chrome drosselt Timer in Hintergrundseiten, die Nachrichten des Mikrofons nicht.
- **Früher Decodierdurchgang bei Zeitfaktor 2 und höher** prüft nur noch die 30 besten Kandidaten. Fehlversuche kosten dort die meiste Zeit (am PC kt = 2 von 1,35 auf 0,99 s, kt = 4 von 3,8 auf 1,8 s, gleiche Treffer im synthetischen Band). Der späte Durchgang holt den Rest nach. Auf echten Bändern noch nicht belegt.
- **Schnellere Demodulation:** Die Träger in `symbolPowers` entstehen durch Zeigerdrehung, das Hann-Fenster wird einmal je Länge berechnet (rund 14 % je Versuch).
- Anleitung (Deutsch und Englisch) und alle Bilder nachgeführt.

### Behoben

- **Ausgabelatenz bei verspätetem Start:** Beginnt die Wiedergabe weniger als die Latenz vor dem Soll oder schon verspätet, überspringt die App jetzt den Teil der Latenz, den ein früherer Start nicht ausgleichen kann. Vorher kam der Ton um die fehlende Latenz zu spät an, mit Bluetooth-Zusatzlatenz mehr als 0,3 s.
- **RR73 ohne gehörten Rapport:** Das QSO gilt jetzt als unbestätigt statt als bestätigt und trägt keinen empfangenen Rapport. Das 73 wird weiter gesendet.
- Die IndexedDB-Verbindung wird bei einer Schemaänderung durch eine neuere App-Fassung freigegeben (`onversionchange`), ein alter offener Tab blockiert sie nicht mehr.

### Intern

- Neue Tests für Aufnahmestart-Schätzer, Ausgabelatenz, RR73 ohne Rapport und die Kandidatengrenze (393 Tests, einer übersprungen).

## [0.2.0] – 2026-11-06

Gegenüber 0.1.0 (22.10.2026).

### Neu

- **Auswahl von Mikrofon und Lautsprecher** in den Einstellungen (Karte „Audio“). Damit lassen sich zum Beispiel ein Funkgerät mit USB-Audio, eine USB-Soundkarte oder ein virtuelles Audiokabel wählen. Standard ist das Systemgerät. Fehlt das gewählte Gerät, nimmt die App das Standardgerät und meldet das im QSO-Fenster. Der Knopf „Geräte anzeigen“ holt die Gerätenamen, die Chrome erst nach einer Mikrofonerlaubnis herausgibt. Der Lautsprecher lässt sich in Chrome und Edge umschalten, in Firefox nicht. Die Wahl gilt für QSO, Codierung (Hörproben) und Verbindungstest.
- **Zusatzlatenz für die Ausgabe** (Einstellungen, Karte „Audio“): für Lautsprecher, deren Verzögerung der Browser nicht kennt, vor allem Bluetooth (oft 150 bis 300 ms). Die App sendet um diesen Wert früher. Die Laufzeitmessung im Labor zeigt den eingetragenen Anteil getrennt an und hilft, den richtigen Wert zu finden. Der Wert ist Teil der Sicherung.
- **Schleier über Wasserfall, Band-Aktivität und QSO-Fenster**, solange das Mikrofon aus ist: Weichzeichner und Transparenz zeigen, dass dort nichts mehr mitläuft.
- **Neue Über-Seite** im Stil üblicher Open-Source-Projekte: Version, Build-Datum, Lizenz (mit Link), Autor, Webseite, Projekt auf GitHub, verwendete Komponenten Dritter mit Lizenz, Danksagung, Datenschutz und Haftung. Deutsch und Englisch.

### Geändert

- **Navigation als Schublade** (Hamburger-Menü oben links) statt untere Leiste und Seitenleiste. Ab 1100 px Breite steht sie dauerhaft links. Unten in der Schublade stehen Einstellungen, Hilfe und Über. Die Kopfzeile zeigt den Namen der aktuellen Seite, dazu UTC-Uhr und Profil-Chip. Das Logo sitzt jetzt in der Schublade.
- **Gemeinsame Oberfläche mit SSTV-Horch:** `basis.css`, Farben, Schriften, Schublade und Audiogeräte-Modul kommen aus einer gemeinsamen Basis. Karten, Eingabefelder und Abstände sind an SSTV-Horch angeglichen. `theme.css` enthält nur noch, was FT8 allein braucht.
- Die Karte „Ausgabe“ in den Einstellungen heißt „Audio“.
- Der Hinweis (Snackbar) sitzt jetzt unten statt über der früheren Leiste.
- Anleitung (Deutsch und Englisch) und alle 50 Bilder an die neue Oberfläche angepasst.

### Behoben

- Der Seitentitel in der Kopfzeile folgt jetzt dem Sprachwechsel.

### Intern

- Neue Tests für Geräteliste, Mikrofon mit Fallback, Lautsprecherwahl und `AudioOut` (388 Tests, einer übersprungen).
- Der Service Worker steht auf `horch-90`.

## [0.1.0] – 2026-10-22

Erste veröffentlichte Fassung: QSOs über Lautsprecher und Mikrofon mit dehnbarer Zeit und einstellbarem Tonabstand, Wasserfall, Decoder, Auto-Antwort, QSO-Log mit ADIF, Codierungs-Tab, Labor, Anleitung auf Deutsch und Englisch, installierbar als PWA.

