# Firmen-Rollout per Gruppenrichtlinie (Chrome und Edge)

Diese Anleitung beschreibt, wie du die Erweiterung selbst hostest, per GPO auf
allen Rechnern installierst und eine Firmen-Whitelist zentral pflegst.

Die Firmen-Whitelist liegt ausschließlich in der GPO. Eine neue Domain ist dort
eine neue Zeile; die Erweiterung muss dafür nicht neu verteilt werden.

## Voraussetzungen

- Rechner in einer Active-Directory-Domäne. Chrome und Edge installieren
  selbst gehostete Erweiterungen unter Windows nur auf verwalteten Geräten.
- Chrome bzw. Edge ab Version 153.
- Ein interner Webserver, den alle Rechner erreichen (HTTPS empfohlen).
- Die offiziellen Richtlinienvorlagen von
  [Chrome](https://chromeenterprise.google/browser/download/) und
  [Edge](https://www.microsoft.com/edge/business/download) im zentralen
  Richtlinienspeicher.
- [Node.js](https://nodejs.org/) auf deinem Arbeitsrechner, um die Dateien zu
  erzeugen.

## Einmalige Einrichtung

### 1. Dateien erzeugen

Im Projektordner, mit der Adresse des Ordners auf eurem Webserver:

```bash
node scripts/enterprise.js --url https://intranet.example.com/extensions --key key.pem
```

Beim ersten Aufruf wird `key.pem` neu erstellt. Diese Datei legt die
Extension-ID fest und wird für jedes spätere Update gebraucht. Bewahre sie
sicher auf und gib sie nicht weiter; sie gehört nicht ins Repository.

Danach liegt in `dist/enterprise`:

| Datei / Ordner | Zweck |
| --- | --- |
| `domain-whitelist-protector/` | Die Erweiterung, bereit zum Packen |
| `update.xml` | Update-Beschreibung für den Webserver |
| `PolicyDefinitions/` | GPO-Vorlagen (`.admx`, `.adml` in Deutsch und Englisch) |
| `gpo-values.txt` | Extension-ID und die Werte, die du in die GPO einträgst |
| `Set-ProtectedLogins.ps1` | Optional: liefert der Erweiterung Anmeldename und E-Mail-Adressen der Benutzer |

### 2. Erweiterung packen

1. In Chrome `chrome://extensions` öffnen (in Edge `edge://extensions`) und
   den Entwicklermodus einschalten.
2. „Erweiterung packen“ wählen.
3. Stammverzeichnis: `dist/enterprise/domain-whitelist-protector`
4. Datei mit privatem Schlüssel: deine `key.pem`

Das Ergebnis ist `dist/enterprise/domain-whitelist-protector.crx`. Dasselbe
Paket funktioniert in Chrome und Edge.

Alternativ per Kommandozeile:

```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --pack-extension=C:\pfad\dist\enterprise\domain-whitelist-protector --pack-extension-key=C:\pfad\key.pem
```

### 3. Auf den Webserver legen

Lade `domain-whitelist-protector.crx` und `update.xml` in den Ordner, den du
bei `--url` angegeben hast. Beide Adressen stehen in `gpo-values.txt`.

Bei IIS muss für die Endung `.crx` ein MIME-Typ eingetragen sein
(`application/x-chrome-extension`), sonst liefert der Server die Datei nicht
aus.

### 4. GPO-Vorlagen einspielen

Kopiere den Inhalt von `dist/enterprise/PolicyDefinitions` in den zentralen
Richtlinienspeicher:

```
\\<domäne>\SYSVOL\<domäne>\Policies\PolicyDefinitions\
```

Die `.admx`-Datei kommt direkt in diesen Ordner, die `.adml`-Dateien in die
Unterordner `de-DE` und `en-US`.

### 5. Erweiterung per GPO installieren

In der Gruppenrichtlinienverwaltung eine GPO anlegen oder öffnen und unter
*Computerkonfiguration → Richtlinien → Administrative Vorlagen* die
Richtlinie `ExtensionInstallForcelist` aktivieren:

- Chrome: *Google → Google Chrome → Erweiterungen*
- Edge: *Microsoft Edge → Erweiterungen*

Trage dort den Wert aus `gpo-values.txt` ein. Er hat die Form:

```
<Extension-ID>;https://intranet.example.com/extensions/update.xml
```

### 6. Firmen-Whitelist eintragen

In derselben GPO unter *Computerkonfiguration → Richtlinien → Administrative
Vorlagen → Domain Whitelist Protector* gibt es je einen Ordner für
**Google Chrome** und **Microsoft Edge** mit denselben Einstellungen.

1. „Firmen-Whitelist“ öffnen und auf **Aktiviert** stellen.
2. **Anzeigen…** klicken.
3. Eine Domain pro Zeile eintragen, zum Beispiel:

   ```
   *.sharepoint.com
   *.office.com
   intranet.example.com
   ```

Ein Eintrag mit `*.` gilt für die Domain und alle Subdomains. Vollständige
Adressen wie `https://firma.sharepoint.com/sites/team` werden auf die Domain
gekürzt.

Chrome und Edge lesen ihre Richtlinien aus getrennten Bereichen. Wenn ihr
beide Browser nutzt, trage die Liste in beiden Ordnern ein.

## Alle Einstellungen

| Einstellung | Wirkung |
| --- | --- |
| Firmen-Whitelist | Domains, die für alle immer erlaubt sind |
| Benutzer dürfen eigene Domains erlauben | Deaktiviert: nur die Firmen-Whitelist gilt. Andere Seiten lassen sich nach der Warnung weiterhin öffnen, aber nicht dauerhaft erlauben |
| Bestätigungsseite für nicht erlaubte Domains erzwingen | Aktiviert: Benutzer können die Vorabprüfung nicht abschalten |
| Länderprüfung erzwingen | Schaltet die Länderabfrage fest ein oder aus |
| Abfragedienst für die Länderprüfung | Legt den Dienst fest: ipwho.is oder geojs.io (beide verschlüsselt, Auflösung über Google Public DNS) oder ip-api.com (unverschlüsselt). Vor gewerblicher Nutzung die Nutzungsbedingungen des Dienstes prüfen |
| Hinweistext auf der Bestätigungsseite | Frei wählbarer Text für die Benutzer, z. B. „Im Zweifel IT-Helpdesk anrufen: Durchwahl 123“ |
| Blockierte Länder | Zweistellige Ländercodes (z. B. `RU`), die immer blockiert sind |

Nicht konfigurierte Einstellungen bleiben in der Hand der Benutzer.

## Warnung bei Eingabe der Firmen-Anmeldung

Die Erweiterung kann warnen, sobald jemand seinen Anmeldenamen oder seine
E-Mail-Adresse in ein Feld auf einer nicht freigegebenen Seite eingibt: Das
Feld und die Passwortfelder der Seite werden rot markiert, und ein Hinweis
erscheint direkt am Feld. Der Vergleich findet nur im Browser statt.

Dafür muss die Erweiterung die Kennungen des jeweiligen Benutzers kennen:
Anmeldename und E-Mail-Adresse, auch wenn beide unterschiedlich aufgebaut sind
(zum Beispiel `MustermannM` und `max.mustermann@example.com`). Der Browser
kann sie nicht selbst auslesen; sie werden pro Benutzer in die Richtlinie der
Erweiterung geschrieben (`protectedLogins`). Dafür gibt es zwei Wege.

### Weg A: Skript liest alles aus dem Active Directory (empfohlen)

`dist/enterprise/Set-ProtectedLogins.ps1` trägt für jeden angemeldeten
Domänenbenutzer automatisch ein:

- Anmeldename (`MustermannM`) und `DOMÄNE\MustermannM`
- E-Mail-Adresse (`mail`)
- Benutzerprinzipalname (UPN)
- weitere E-Mail-Aliase (`proxyAddresses`); abschaltbar mit `-SkipAliases`

Das Skript muss als SYSTEM laufen, weil normale Benutzer unter
`HKCU\Software\Policies` nicht schreiben dürfen.

1. `Set-ProtectedLogins.ps1` auf eine Freigabe legen, die alle Computer lesen
   können, zum Beispiel `\\<domäne>\NETLOGON\`.
2. In der GPO unter *Computerkonfiguration → Einstellungen →
   Systemsteuerungseinstellungen → Geplante Aufgaben* eine neue geplante
   Aufgabe („Mindestens Windows 7“) anlegen:

   | Feld | Wert |
   | --- | --- |
   | Benutzerkonto | `NT AUTHORITY\SYSTEM` |
   | Trigger | Bei Anmeldung, jeder Benutzer, Verzögerung 30 Sekunden |
   | Aktion | Programm starten: `powershell.exe` |
   | Argumente | `-NoProfile -ExecutionPolicy Bypass -File "\\<domäne>\NETLOGON\Set-ProtectedLogins.ps1"` |

Das Skript enthält die Extension-ID. Nach einem Wechsel der ID muss es neu
erzeugt werden.

### Weg B: Feste Muster ohne Skript

Reicht der Anmeldename oder lässt sich die E-Mail-Adresse aus ihm ableiten,
genügen Registrierungselemente in den Gruppenrichtlinien-Einstellungen, weil
dort Variablen wie `%LogonUser%` aufgelöst werden.

In der GPO unter *Benutzerkonfiguration → Einstellungen → Windows-Einstellungen
→ Registrierung* pro Kennung ein Registrierungselement anlegen
(*Neu → Registrierungselement*):

| Feld | Wert |
| --- | --- |
| Aktion | Aktualisieren |
| Struktur | `HKEY_CURRENT_USER` |
| Schlüsselpfad | der Pfad aus `gpo-values.txt`, er endet auf `\policy\protectedLogins` |
| Name | `1` (für weitere Kennungen `2`, `3`, …) |
| Werttyp | `REG_SZ` |
| Wertdaten | die Kennung, siehe unten |

| Kennung | Wertdaten |
| --- | --- |
| Anmeldename | `%LogonUser%` |
| Anmeldename mit Domäne | `%LogonDomain%\%LogonUser%` |
| E-Mail-Adresse, wenn sie dem Anmeldenamen entspricht | `%LogonUser%@example.com` |

Für Chrome und Edge je eigene Elemente mit dem jeweiligen Schlüsselpfad
anlegen. Weg A und Weg B nicht mischen: Das Skript ersetzt die Liste jedes Mal
vollständig.

### Prüfen

Groß- und Kleinschreibung spielt beim Vergleich keine Rolle. Unter
`chrome://policy` bzw. `edge://policy` muss `protectedLogins` mit den Kennungen
des angemeldeten Benutzers erscheinen, zusätzlich zur Firmen-Whitelist.

## Im Alltag

### Domain hinzufügen oder entfernen

1. GPO öffnen → *Domain Whitelist Protector* → „Firmen-Whitelist“ →
   **Anzeigen…**
2. Zeile ergänzen oder löschen, mit OK bestätigen.

Die Rechner übernehmen die Änderung beim nächsten Richtlinien-Refresh
(standardmäßig etwa alle 90 Minuten, sofort mit `gpupdate /force`). Ein
Neustart des Browsers ist nicht nötig.

### Prüfen, ob die Richtlinie ankommt

`chrome://policy` bzw. `edge://policy` öffnen. Die Einstellungen stehen dort
unter dem Namen der Erweiterung. Im Popup der Erweiterung erscheinen die
Firmen-Domains unter „Von Ihrer Organisation verwaltet“.

### Neue Version der Erweiterung verteilen

1. Versionsnummer in `src/manifest.json` erhöhen.
2. Schritt 1 und 2 mit **derselben** `key.pem` wiederholen.
3. Die neue `.crx` und `update.xml` auf den Webserver legen.

Die Browser holen das Update innerhalb einiger Stunden selbst. Die GPO und die
Whitelist bleiben unverändert.

## Späterer Wechsel in einen Store

Chrome Web Store und Edge Add-ons vergeben eine eigene Extension-ID. Bei einem
Wechsel:

1. Vorlagen für die neue ID erzeugen:
   `node scripts/enterprise.js --url <egal> --id <neue ID>` und nur den Ordner
   `PolicyDefinitions` verwenden.
2. In der GPO die neue ID bei `ExtensionInstallForcelist` eintragen und die
   Firmen-Whitelist unter den neuen Vorlagen erneut eintragen.

Eigene Einträge der Benutzer hängen an der alten ID und müssen bei Bedarf über
Export/Import im Popup übertragen werden.
