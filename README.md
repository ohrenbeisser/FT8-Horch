# FT8-Horch

FT8-Horch für den Browser (PWA): ein vollständiges QSO über Lautsprecher und Mikrofon des Handys. Zusätzlich lassen sich Zeit (15, 30, 60, 120 s) und Tonabstand (6,25 bis 100 Hz) ändern, und ein Offset legt die Töne in den hörbaren Bereich. Ein eigener Tab zeigt die Codierung Schritt für Schritt.

## Was die App kann

* QSO-Reiter mit Auto-Sequenz und Auto-Antwort, Mikrofon-Schalter, Statuszeile und Wasserfall, Meldung bei Anruf an das eigene Rufzeichen (Hinweis und Vibration)
* Codierungs-Tab: Senden und Empfangen Schritt für Schritt
* Labor: Pegeltest, Laufzeitmessung, Simulator, Verbindungstest zwischen zwei Geräten, WAV-Dateien speichern und decodieren
* Log mit ADIF-Export und -Import, Textprotokoll, Sicherung aller Daten
* Anleitung auf Deutsch und Englisch mit Bildern, Oberfläche in beiden Sprachen, Hell und Dunkel
* Installation als PWA, läuft offline

Alle Daten bleiben lokal im Browser. Es gibt keinen Server und kein Nachladen aus dem Netz, eine Content-Security-Policy erlaubt nur den eigenen Ursprung.

Nur das Standardprofil (Zeit und Tonabstand ohne Änderung) ist mit WSJT-X kompatibel. Alle anderen Profile sind FT8-Varianten und funktionieren nur zwischen zwei Instanzen dieser App. Varianten gehören nicht auf die Standard-FT8-Frequenzen.

Nachrichten mit Typ 4 (nichtstandardisierte Rufzeichen, zum Beispiel `OM/DL6LG` oder `DA100WM`) und mit `/P` unterstützt die App bewusst nicht.

## Anleitung

Die Anleitung steht in der App unter **Hilfe** (in der Sprache der Oberfläche) und als Datei: `help/hilfe.de.md` (Deutsch) und `help/hilfe.en.md` (English, full guide).

## Selbst ausprobieren

Die App braucht keinen Build-Schritt: Das Verzeichnis über HTTPS ausliefern (Mikrofon und Service Worker brauchen HTTPS), alle Pfade sind relativ.

## Lizenz und Nennung

GPL-3.0-or-later, siehe `LICENSE`.

Das FT8-Protokoll stammt von Joe Taylor (K1JT), Steve Franke (K9AN) und Bill Somerville (G4WJS). Die Protokollkonstanten (LDPC-Matrizen, Gray-Abbildung, Costas-Folge) stammen aus WSJT-X (GPL-3.0) und wurden über [ft8_lib](https://github.com/kgoba/ft8_lib) von Karlis Goba (YL3JG, MIT-Lizenz) übernommen. Weitere Quellen: QEX-Artikel „The FT4 and FT8 Communication Protocols“, [PyFT8](https://github.com/G1OJS/PyFT8) und MiniPyFT8 von G1OJS.

Hintergrundartikel: [FT8 – Mathematik statt Watt](https://ohrenbeisser.de/ft8-mathematik-statt-watt/) von Ohrenbeisser (DL6LG).
