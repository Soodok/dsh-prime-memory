<div align="center">

<img src="./assets/img/Hero.png" width="100%"
alt="DeepSeek Harness Hero-Banner: Unterhaltungen werden automatisch zu mehrschichtigen Erinnerungen destilliert und vor jedem Modellschritt abgerufen und injiziert — rechts lösen sich Chat-Bubbles Schicht für Schicht in drei zunehmend helleren Lichtbändern auf, die in eine Glaskapsel mit leuchtender Kugel und Farbverlaufsschiene münden (Skalenbeschriftung 日常·工作·智能·关闭, vier Stufen), zurückfließende Lichtfäden deuten die Abruf-Injektion an">

# dsh-prime-memory

**Layered-Distillation-Gedächtnis-Plugin für DeepSeek Harness: Konversationen werden im Hintergrund verarbeitet — L0-Erfassung → L1-atomare Erinnerungen → L2-Szenenkonsolidierung → L3-Profildestillation — und vor jedem Modellschritt werden die relevanten Erinnerungen automatisch in den Kontext injiziert.**

[English](README.en.md) · [中文](README.md) · [Neueste Version](https://github.com/drscrewdriver/dsh-prime-memory/releases/latest) · [Problem melden](https://github.com/drscrewdriver/dsh-prime-memory/issues)

[![npm version](https://img.shields.io/npm/v/dsh-prime-memory?color=6f83ff\&style=flat-square\&label=npm)](https://www.npmjs.com/package/dsh-prime-memory)
[![DSH 0.2.0-rc.1](https://img.shields.io/badge/DSH-0.2.0--rc.1-8b5cf6?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![MIT License](https://img.shields.io/badge/license-MIT-536990?style=flat-square)](LICENSE)

</div>

<details open>
<summary>🌐 Sprache / Language</summary>

- [中文 README](./README.md)
- [English README](./README.en.md)
- [日本語 README](./README.ja.md)
- [한국어 README](./README.ko.md)
- [README auf Deutsch](./README.de.md)
- [README en français](./README.fr.md)
- [README in italiano](./README.it.md)
- [README auf Russisch](./README.ru.md)
- [README auf Spanisch](./README.es.md)
- [安装指南（中文）](./INSTALL.md)
- [Installation guide (English)](./INSTALL.en.md)
- [日本語インストールガイド](./INSTALL.ja.md)
- [한국어 설치 안내](./INSTALL.ko.md)
- [Installationsanleitung (Deutsch)](./INSTALL.de.md)
- [Guide d'installation (français)](./INSTALL.fr.md)
- [Guida all'installazione (Italiano)](./INSTALL.it.md)
- [Руководство по установке (Русский)](./INSTALL.ru.md)
- [Guía de instalación (Español)](./INSTALL.es.md)
- [更新日志（中文）](./CHANGELOG.md)
- [Changelog (English)](./CHANGELOG.en.md)
- [日本語 changelog](./CHANGELOG.ja.md)
- [한국어 changelog](./CHANGELOG.ko.md)
- [Changelog auf Deutsch](./CHANGELOG.de.md)
- [Changelog en français](./CHANGELOG.fr.md)
- [Changelog in italiano](./CHANGELOG.it.md)
- [Changelog auf Russisch](./CHANGELOG.ru.md)
- [Changelog auf Spanisch](./CHANGELOG.es.md)

</details>

## DSH-Versionskompatibilitätsmatrix

| DSH-Version | Settings-Registrierungs-API | Status |
|---|---|---|
| 0.1.1-rc.2 | `settings.register()` (Live-Scope) | ✅ Verifiziert |
| 0.1.2-rc.1 | `settings.register()` (Fallback verfügbar) | ⚠️ Aus Framework-Dokumentation abgeleitet, nicht in der Praxis getestet |
| 0.1.3-rc.1 | `settings.register()` (Fallback verfügbar) | ⚠️ Nicht praktisch getestet (ab 0.1.3 sind Namespaces einfache Strings; dieses Plugin ist kompatibel) |
| 0.1.5-rc.2 | `settings.register()` (Fallback verfügbar) | ⚠️ Nicht praktisch getestet; Session-V3-Surface-Semantik sowie Eingabeleisten-/Einstellungsslots stehen noch auf dem Regressionstand |
| 0.2.0-rc.1 | `settings.register()` (Live-Scope) | ✅ Aktuelle Anpassungslinie (Verdrahtung des Ereignisses agent/session-start → agent/created) |

> Kompatibilitätsmechanismus: Die Settings-Registrierung durchläuft zur Laufzeit drei Zweige
> (`register` → `installSection`-Brücke → Dauerein-Notbetrieb), siehe Eintrag 0.11.0 im
> [CHANGELOG.md](./CHANGELOG.md). `dsh.plugin.json` deklariert
> `engines.dsh` 为逐 rc 精确枚举串（0.1.0-rc.2 → 0.2.1-rc.2，17 rc）.

## Schnellstart

Benötigt Node ≥ 22.16. Zwei Aufrufarten zur Wahl (das Präfix `npx` kann in jedem der folgenden Befehle `dsh` ersetzen):

```bash
# Variante 1: offizielle CLI direkt per npx ausführen (kein vorinstalliertes dsh nötig; Version pinnbar, z. B. dsh-prime-memory@0.8.4)
npx -y @deepseek-ai/dsh plugin --profile web add dsh-prime-memory

# Variante 2: dsh-CLI bereits installiert (dsh ist ein pnpm-Forwarder; falls pnpm fehlt, zuerst npm i -g pnpm)
dsh plugin --profile web add dsh-prime-memory

# Alternative Paketquellen: GitHub-Repository / lokaler Pfad (Entwicklung/Debug; link: verweist auf das Repository, npm run build + dsh-Neustart genügt)
dsh plugin --profile web add https://github.com/drscrewdriver/dsh-prime-memory
dsh plugin --profile web add /path/to/dsh-prime-memory
```

### Den Agenten installieren lassen (empfohlen)

Wenn der aktuelle Agent Terminalbefehle ausführen kann, schicken Sie ihm folgende Nachricht vollständig:

```text
Bitte installiere das Plugin dsh-prime-memory für das Web-Profil von DeepSeek Harness.

Führe ausschließlich die beiden folgenden Befehle aus und ändere keine anderen Profile:
dsh plugin --profile web add dsh-prime-memory
dsh --profile web --dump-config

Sobald dsh-prime-memory in der Ausgabe erscheint, melde mir das Installationsergebnis.
Beende oder starte den laufenden DSH nicht selbst neu; erinnere mich nach der Installation daran, den DSH Web Host manuell neu zu starten.
```

Der Agent soll das Installationsergebnis zurückmelden und ausdrücklich sagen, ob
`dsh-prime-memory` in der Konfiguration aufgetaucht ist.

Dieses Paket deklariert eine `dsh.bundle`-Kompositionsschicht (`cordis.patch.yml`); nach der Installation
**wird die Plugin-Zeile automatisch gemountet** — ein manuelles Bearbeiten von
`$DSH_HOME/profiles/web/cordis.patch.yml` ist nicht nötig. Starten Sie anschließend DeepSeek Harness neu und prüfen:
Erscheinen `conversations/ records/ scenes/` und `memory.db` unter
`~/.dsh/memory/`, wurde das Plugin erfolgreich angewendet; die Seite „Memory" in den Einstellungen und die Modus-Pill in der Eingabeleiste bedeuten, dass die Client-Hälfte bereit ist.

**Deinstallation**: `dsh plugin --profile web remove dsh-prime-memory` + Neustart. Die Daten bleiben in
`~/.dsh/memory/`; wenn Sie sie nicht mehr brauchen, löschen Sie das gesamte Verzeichnis von Hand.

### Entwicklung aus dem Quellcode

```bash
git clone https://github.com/drscrewdriver/dsh-prime-memory
cd dsh-prime-memory
npm install && npm run build
dsh plugin --profile web add .        # link:-Installation; nach Codeänderungen genügen npm run build + dsh-Neustart
npm run smoke                         # Rauchtest (zuerst neu bauen: siehe Befehl unten)
npx tsc src/smoke.ts --outDir dist-smoke --module nodenext --moduleResolution nodenext --target es2022 --strict --skipLibCheck --esModuleInterop
```

## Datenfluss zur Laufzeit

<p align="center">
  <img src="./assets/readme/flow.svg" width="100%"
       alt="Datenfluss zur Laufzeit von dsh-prime-memory: links fließen die Sitzungsereignisse von User und Assistant ins Plugin (L0-Erfassung, L1–L3-Destillation, Abruf, Gedächtnis-Tools), das Plugin injiziert relevante Erinnerungen über agent/pre-step in den DSH-Kern rechts; die Destillation nutzt das ctx.llm des Kerns, Daten werden doppelt nach ~/.dsh/memory/ geschrieben">
</p>

Das Plugin hängt an den nativen dsh-Ereignissen (`session/event` für die Erfassung, `agent/pre-step` für die Injektion); Destillationsaufrufe nutzen das `ctx.llm` des Hosts. Der Abruf erscheint als **Injektion auf Nachrichtenseite**: relevante Erinnerungen werden als synthetische Nachricht vor die neue Nutzernachricht gestellt und erscheinen im Sitzungsverlauf als Zeile \*\*„Kontextinjektion · memory"\*\* (aufklappen zeigt die getrefferten Inhalte) — der Nutzer sieht direkt, „die Erinnerung greift". Die Injektion unterliegt einem Längen- und einem Zeitbudget; bei Überschreitung wird abgeschnitten bzw. übersprungen, die Konversation wird niemals ausgebremst. **Intra-Sitzungs-Dedupe**: eine bereits injizierte Erinnerung wird nicht erneut injiziert (sie steckt schon im Modellkontext, spart Tokens bei Nachfragen zum selben Thema); wird der Kontext per `/compact` komprimiert oder geleert, setzt der Zähler zurück und die Erinnerung kann neu injiziert werden; eine aktualisierte Erinnerung (neue id bei Inhaltsänderung) bleibt von der alten Unterdrückung ausgenommen. **Frischegewichtung**: die Abrufsortierung gewichtet weich mit `Relevanz × max(0.5, 0.5^(Tage seit letzter Aktualisierung/30))` — zwischen Kandidaten ähnlicher Relevanz gehen frische Erinnerungen zuerst durch (die Plätze rotieren natürlich), während altgediente, ausreichend relevante Erinnerungen wie gewohnt abgerufen werden (der Floor begrenzt den Verlust auf höchstens die Hälfte des Sortierwerts: Langzeitfakten versinken nicht); `recall.decayHalfLifeDays` ist einstellbar, 0 = aus.

**Kosten-Dashboard**: die Token-Kosten jedes Destillations-LLM-Aufrufs (Extraktion/Dedupe/L2/L3) werden je `provider/model` in eine SQLite-Detailtabelle geschrieben (Aufbewahrung konfigurierbar, Standard 365 Tage, rollierende Bereinigung beim Schreiben; schlägt die Buchung fehl, gibt es nur eine Warnung — die Destillation wird niemals blockiert). Einstellungsseite → Memory → Tab **Kosten** zeigt: nach Modell eingefärbte Trendlinien (Tages-/Wochen-/Monatsgranularität + Fenster der letzten N Tage + L1/L2/L3-Filter), Tabelle Ebene × Zeitfenster (Aufrufe / Output- und Thinking-Tokens / Mittelwert / Median), kumulierte Werte je Modell — die Destillationskosten auf einen Blick. Eingänge zählen nach Zeichen (dsh-Streaming-usage enthält keine Input-Tokens), Output und Thinking nach Tokens.

**Gedächtnis-Tools (3):**

- memory\_search

- conversation\_search

- memory\_read\_scene

Echte Mitschnitte: so sehen Abruf-Injektion und Tool-Aufrufe in der Konversation aus — die Zeile „Kontextinjektion · memory" holt zuerst die relevanten Erinnerungen herbei, dann liest das Modell bei Bedarf den Szenenblock per `memory_read_scene` und antwortet direkt aus dem Gedächtnis:

<p align="center">
  <img src="./assets/img/MemoryTools.png" width="60%"
       alt="Echte Aufnahme der Chat-Oberfläche (helles Theme): über der Nutzernachricht „Was stehen wir demnächst an?" ist die Zeile „Kontextinjektion · memory" sichtbar; vor der Antwort listet der Assistant 4 memory_read_scene-Toolaufrufe (Parameter: .md-Dateinamen der Szenenblöcke) und rekapituliert dann aus dem Gedächtnis die aktuellen Ziele und die Roadmap">
</p>

In einer eingeschränkten Sitzung, in der nur der Codeausführungs-Eingang offen ist, ruft das Modell die Gedächtnis-Tools indirekt über `run_code` auf (SUBTOOL-Verschachtelung in der Trajektorienansicht):

<p align="center">
  <img src="./assets/img/ToolTrajectory.png" width="80%"
       alt="Trajektorienansicht der Toolaufrufe: farbige Zeitleiste oben und Schrittliste links (farbige Labels SYSTEM/CONTEXT/USER/ASSISTANT/TOOL/SUBTOOL), im run_code-Toolschritt sind 5 memory_read_scene-Subtool-Aufrufe verschachtelt (SUBTOOL-Markierung), rechts das Detailpanel des gewählten Schritts">
</p>

## Schichtgedächtnis (L0–L3)

<p align="center">
  <img src="./assets/img/Layers.png" width="100%"
       alt="Vier Schichten des Schichtgedächtnisses (Schicht für Schicht verfeinert, von oben links nach unten rechts): L0 Rohkonversation (Chat-Bubbles) → L1 atomare Erinnerungen (leuchtende Fakten-Partikel) → L2 Szenenblöcke (Glas-Dokumenttafeln) → L3 Kernprofil (leuchtender Kristallkern); die Schichten sind durch LLM-Extraktions-/Konsolidierungs-/Destillationsstrahlen verbunden, deren abnehmende Breite die schrittweise Verfeinerung der Daten zeigt">
</p>

## Sitzungsweise Gedächtnismodi

<p align="center">
  <img src="./assets/img/Modes.png" width="100%"
       alt="Sitzungsweise Gedächtnismodi: eine Glass-Kapselschiene mit vier Haltepunkten (日常·工作·智能·关闭 / Alltag·Arbeit·Intelligent·Aus), die leuchtende Kugel steht auf Intelligent (Standard); über jedem Modus eine Mikroszene — Alltag: private Chat-Bubble, Arbeit: Code-Dokumentfenster, Intelligent: zwei sich vereinigende Ströme am hellsten, Aus: verwässerte gestrichelte Geister-Bubble">
</p>

- **Das Steuerelement**: eine Pill in der Eingabeleiste, rechts neben dem Moduswähler (`Memory · auto`); ein Klick lässt darüber den Modusregler aufschweben, hell-/dunkelthemengerecht;

- die untere Hälfte des schwebenden Panels ist der **Sitzungsinformationsbereich**: Abruftreffer (Treffer/Suchrunden und Kumulativ), Akkumulationsfortschritt
  (Sitzungsscheibe x / wirksamer Schwellwert; im Aus-Modus erscheint die Zahl der pendingen Scheiben), in dieser Sitzung erzeugte Erinnerungen, Sitzungsnachrichtenzahl,
  dazu eine Zeile für Fehlzustände (Speicher degradiert / Vektorsuche nicht verfügbar) und eine globale Zusammenfassung (auf Destillation wartende Einträge, letzte Destillation);
  die Daten laufen über den Endpunkt `dsh-memory/session-stats` (rein residente Registertabelle + indexierter COUNT, null Datei-I/O),
  mit adaptivem Polling während des Offenstands (beschäftigt 2 s / ruhend 5 s); bei Schließung stoppt es;

- die Wahl pro Sitzung wird je sessionId in `session-modes.json` persistiert und überlebt Neustart/Wiederaufnahme;
  sie überlagert den globalen Schalter (der Globale ist der Hauptschalter); L2/L3 sind vollständig nach Familie klassifiziert, Inhalte überlagern sich nicht.

- **Nur Schreiben, kein Lesen (#38)**: Dreistellungsschalter „Injektion" im Schwebepanel (folge dem Globalen / ein / aus) — auf „aus" wird die Sitzung **nur schreibend**: Erfassung und Destillation laufen weiter (die Konversation sedimentiert normal als L0→L1→L2/L3), aber es wird nichts in diese Sitzung injiziert
  (Abrufinjektion, Profil-/Navigationsstabilzonen und Tool-Leitfaden stoppen mit; Lesetools wie `memory_search` antworten mit einem Nur-Schreiben-Hinweis). Die Pill wechselt zu `Memory · nur schreiben`; die Einstellung wird je Sitzung persistiert — zurück auf
  „folge dem Globalen" löscht sie und folgt wieder dem Abrufschalter der Einstellungsseite; ideal für Debug-/Evaluations-/sensible Sitzungen, die „nur aufnehmen, nicht stören" sollen.
  Orthogonal zum Aus-Modus: Aus bleibt vollständige Tarnung (selbst die Erfassung ist aus), Nur-Schreiben behält den Eingang und schließt den Ausgang.

## Oberflächen-Vorschau

<p align="center">
  <img src="./assets/img/ui-dark.jpg" width="49.5%"
       alt="Übersicht des Gedächtnis-Browsers auf der Einstellungsseite im dunklen Theme: Statuskarte (Plugin-Version, Status der Erfassungs-/Destillations-/Abrufschalter, FTS- und Vektorfähigkeiten, L1-Erinnerungszähler, Destillationsmodell) und Statistikfliesen, Glasoptik-Kontrollen mit kühler Blau-Akzentfarbe">
  <img src="./assets/img/ui-light.jpg" width="49.5%"
       alt="Derselbe Gedächtnis-Browser der Einstellungsseite im hellen Theme: gleiches Layout und dieselben Informationen, helle Kartenflächen und derselbe Akzentfarbsatz, Theme-Wechsel ohne Neuladen">
</p>

## Messvergleich (DSH-MemBench: automatisierter Benchmark)

Worauf die Antwortbilder hinauslaufen, zeigen die Grafiken; dieser Abschnitt beantwortet mit gemessenen Zahlen eines **automatisierten Benchmarks** die Frage „**was bringt es konkret, wenn er an ist**" ([`bench/`](./bench/), mit einem Befehl reproduzierbar). Methode: gleiche Szenenbibliothek, wortgleiche Eingaben, **Gruppe A (Speicher an) 3 Läufe mit zusammengeführten Werten, Gruppe B (Speicher aus) 1 Lauf** (langläufige Aufgaben ohne Speicher schlucken pro Scene ein Vielfaches an Tokens — daher dieses Kosten-Zäun); die Dialogspur lässt nur Gruppe A laufen (B-Sitzungen sind unabhängig und ohne Speicher, ein Scheitern ist zwingend — der Vergleich bringt keine Information und wurde abgeschaltet). Umgebung der Dialogspur: DeepSeek-Offizielles `deepseek-v4-flash`, Plugin 0.8.5 (Bewerter und Getesteter aus derselben Quelle, Antworttexte vollständig archiviert zur manuellen Nachprüfung), Windows; der Aufgabendesign lehnt sich an [LongMemEval](https://github.com/xiaowu0162/longmemeval) / [LoCoMo](https://snap-research.github.io/locomo/) / [AMB](https://github.com/vectorize-io/agent-memory-benchmark) an, erweiterte Aufgabentypen und Lifecycle-Spur an [MemoryAgentBench](https://arxiv.org/abs/2507.05257) / [GoodAI LTM](https://github.com/GoodAI/goodai-ltm-benchmark) / BEAM.

> Die Dialogspur bildet die **neue 0.8.5-Baseline** (korrigiertes Plugin + berichtigtes Bewertungsmaß); die Zahlen der Workflow-Spur bleiben das 0.8.3-Archiv (ab 0.8.5 wächst die Szenenbibliothek auf 8, mit neuer Prospective-Memory-Szene; Nachlauf steht aus).

### Dialogspur (20 Szenen × 10 Aufgabentypen × 3 Läufe = 420 Fragen): antwortet er richtig?

> 0.8.5-Baseline (Gruppe-A-Daten; Gruppe B der Dialogspur ist abgeschaltet, nur A läuft).

<p align="center">
  <img src="./assets/readme/bench-dialog.svg" width="100%"
       alt="Genauigkeitsgrafik der DSH-MemBench-Dialogspur (Gruppe A · Speicher an): Gesamtgenauigkeit 95,2 % (400/420); die sechs Kernaufgabentypen zu je 60 Fragen — Extraktion 58/60, Mehrfachsprünge 60/60, Zeitabfolge 56/60, Aktualisierung 55/60, Szenenerinnerung 52/60, Antwortverweigerung 60/60 und 0 Fabrikationen; die vier erweiterten Aufgabentypen zu je 15 Fragen — inkrementeller Aufbau 15/15, Kettenaktualisierungen 15/15, Ereignissortierung 14/15, synonyme Umformulierung 15/15">
</p>

**Zweikanaliger Abruf** (Gruppe A): Trefferquote der passiven Injektion **78,1 %** (die Kernpunkte der Frage tauchen in der Injektion auf, 281/360); beim Rest fragt das Modell **selbstständig die Gedächtnis-Tools ab** — 106 Fragen aktiv nachgefragt, **75 Fragen durch Tool-Einsatz gerettet**; die 95,2 % von Ende zu Ende sind das Ergebnis aus beiden Kanälen plus Modellnutzung. Während sich die Erinnerungsbibliothek über die Szenen hinweg aufbaute, mengten sich 295-mal Erinnerungen anderer Szenen in die Probe-Injektionen (ehrlich mitgezählt) — die Gesamtgenauigkeit stieg dennoch von 92,8 % im ersten auf 97,7 % im letzten Abschnitt: die Störungsresistenz hat die aufgeblähte Bibliothek bestanden (offline, bei weiteren 600 synthetischen Rauschsätzen, sinkt der recall\@5 der Suchschicht nur um 2,8 pp).

**Schwächen schichtweise betrachtet**: Offline-Kennzahlen der Suchschicht (recall\@5, kontrolliert reproduziert) insgesamt 73,3 %, darunter Ereignissortierung 0 % und Szenenerinnerung 50 % — die 93 %+ von Ende zu Ende verdankt sich der Robustheit des Modells, nachdem Nachbareinnerungen injiziert wurden; **Effizienz-Dreieck** (die Kosten des Gedächtnisses): Injektion kostet keine Latenz (injizierte Runden antworten im Schnitt 210 ms schneller als nicht injizierte), die Injektion belegt ~10,3 % der Eingabe pro Runde, und die komplette Destillationskette amortisiert ≈2727 Input- / 240 Output-Tokens pro erfasster Nachricht (1172 Aufrufe, 0 Fehlschläge).

### Workflow-Spur (0.8.3-Archiv · 7-Szenen-Fassung · Gruppe A 3× / Gruppe B 1×, echte Tool-Sandbox): handelt er richtig, handelt er sparsam?

<p align="center">
  <img src="./assets/readme/bench-workflow.svg" width="100%"
       alt="A/B-Vergleichsgrafik der DSH-MemBench-Workflow-Spur: Vollständigkeit des Probeabschnitts Gruppe A 59/69 (85,5 %) gegen Gruppe B 10/23 (43,5 %); Kostenvergleich (Gruppe B als volle Referenz, Mittel je Szene) — Schritte 24,3 gegen 41,4 (B +70 %), Toolaufrufe 37,7 gegen 62,1 (B +65 %), Input-Tokens 266k gegen 1,81M (B ×6,8); Probe der Stilvorgaben-Szene A 12/12 gegen B 0/4; Input-Tokens je Szene bei Langzeitaufgaben A 266k gegen B 1,81M">
</p>

**Vollständigkeit des Probeabschnitts 85,5 % gegen 43,5 % (+42 pp)**: In Lehr-/Änderungsabschnitten haben beide Gruppen den Kontext vor Ort; erst der Probeabschnitt (Fortsetzung der Aufgabe in einer neuen Sitzung) ist das reine Gedächtnisfenster — alle drei neuen Prüfszenen der Gruppe A (Prozesswissensaktualisierung / Zwilling-Disambiguierung / Stilvorgaben-Fortsetzung) erreichen 12/12 und in allen drei Durchgängen identisch; Gruppe B erreicht in der Stilvorgaben-Sonde **0/4** (Namens-/Struktur-/Tausendertrenn-/Fußzeilenkonventionen leben nur im Gedächtnis, die Sandbox verrät sie nicht); in der Prozessaktualisierungs-Szene kann es sich per Skriptlektüre rekonstruieren (Unterscheidungskraft durch Sandbox-Affordanzen begrenzt, ehrlich vermerkt).

**Kosten der Langzeitaufgaben: Gruppe B verbraucht je Szene das 6,8-fache an Input-Tokens gegenüber Gruppe A** (1,81M gegen 266k) — ohne Speicher tastet sich der Agent durch Neuerkundung voran; in der Thinking-Stufe high baut er sich sogar eigene Baustellen, um Prozesse zu sondieren, die eine einzelne Skriptkonvention geregelt hätte. Output-Tokens ×3 (46,2k gegen 15,4k), Schritte +70 %. Genau das ist der Kernwert des Gedächtnisses: **gespart wird nicht die Aufgabenschwierigkeit, sondern der sinnlose Verkehr und die doppelte Erkundung**.

### Methodik und Reproduktion

```bash
node bench/harness/run.mjs --arm A --repeats 3 --provider deepseek-official --model deepseek-v4-flash   # Dialogspur (nur Gruppe A)
node bench/harness/run.mjs --track workflow --arm AB --repeats 3 ...                                  # Workflow-Spur (Gruppen A/B parallel)
node bench/harness/run.mjs --track lifecycle --arm A ...                                              # Lifecycle-Spur (Gating/off/rebuild/Vergessen)
node bench/harness/report.mjs --latest [dialog|workflow]                                               # Sammelbericht
node bench/harness/retrieval-metrics.mjs <runDir> --flood 200,600                                     # Kennzahlen der Suchschicht + Flutungskurve
```

- Bewertung: programmatische `contains-all`-Prüfung + Bewertung durch ein Jurymodell Punkt für Punkt (Antworttexte und Bewertungsbegründungen vollständig in `result.json` archiviert, manuell nachprüfbar); bei Aufgaben mit stale (Aktualisierung/Kette/Vergessen) gilt nur „Altwert **als Lagebericht vorgetragen**" als FAIL — die bloße Schilderung der Entwicklung mit korrektem Endwert fällt nicht negativ an; Antwortverweigerungs-Aufgaben dürfen den realen Hintergrund zitieren, um zu erklären, „warum der Gefragte nichts darüber weiß"; Workflow-Vollständigkeit wird programmatisch über Erzeugnisse + Schlüsselinhalte geprüft (vier Kriterientypen: Positivprüfung/Verbotswörter/Abwesenheit des Erzeugnisses/Existenz);

- Kennzahlenfläche: neben der Genauigkeitsgesamttabelle (6 Kern- + 4 erweiterte Aufgabentypen) automatische Erzeugung von **Offline-Kennzahlen der Suchschicht** (recall\@5 / Injektionspräzision / Leck veralteter Informationen), des **Effizienz-Dreiecks** (differentielle Injektionskosten / Injektionsanteil / auf je Nachricht umgelegte Destillationsbuchung), der **Skalenpositionsanalyse** (Genauigkeit/Verschmutzung bei wachsender Bibliothek) und eines eignen Abschnitts für die Lifecycle-Spur (Gating-Matrix nach Familie / doppelte Assertion für off / rebuild-Treue / Vergessen);

- Live-Fortschritt: beim Benchmark-Start startet automatisch ein lokales Fortschrittspanel und öffnet den Browser (`--no-panel` schaltet ab) — Szenen-/Phasen-/Nachrichtenfeingranularer Fortschritt beider Arme A/B, Herzschlag und Aktivitätsfrische („hängt vs. Prozess tot" wird direkt entschieden), laufend wachsende Summenkosten;

- Alle Kennzahlen stammen aus dem vom Anbieter gemeldeten usage (Input inklusive Cache-Treffer-Aufschlüsselung) und dem Einklappen der Sitzungsereignisse; die stationäre Cache-Quote lässt die erste Anfrage je Sitzung weg (0.8.5-Baseline: 89,1 % — die Speicherinjektion schadet dem Cache nicht);

- Regressionszweck: je ein Lauf vor und nach der Plugin-Änderung, `compare.mjs` erzeugt die Vergleichstabelle (Umgebungskopf-Prüfung inkl. gitSha + Drift-Warnung der B-Vergangsgruppe + Vergleich der Suchschichtkennzahlen);

- Grenzen (ehrliche Erklärung): Einzelmaschine; Gruppe A ×3 zusammengeführt, Gruppe B ×1 (Kosten-Zäun, mehr Rauschen); Jury und Getesteter: für die Dialog-0.8.5-Baseline gleiche Quelle, im Workflow-Archiv heterogen (glm-5.3 bewertet v4-flash); vom Autor selbst gebaute Szenenbibliothek (zugunsten speichergünstiger Szenen verzerrt — gern selbst reproduzieren); die Affordanzen der Sandbox-Dateien können den Prozess teilweise verraten (Gruppe B kann Skripte lesen und rückrechnen; Stellen begrenzter Unterscheidungskraft sind ehrlich markiert); zweistufiges Tool-Audit (streng: Verstoß = FAIL / locker: Hinweis), in der Praxis 0 Verstöße auf beiden Seiten.

Vollständiger Bericht und Daten Frage für Frage: [`bench/baseline/`](./bench/baseline/).

## Speicherlayout

<p align="center">
  <img src="./assets/readme/storage.svg" width="100%"
       alt="Speicherlayout: Doppel-Schreib-Architektur (JSONL-Faktenquelle nur anfügend + memory.db als Hauptsuchbasis); Dateiformen: conversations/records/scenes/persona/state/pending/session-modes/embedding-source/Modellkatalog/Inferenzruntime/Logs und Rebuild-Archive; drei Suchstrategien keyword/embedding/hybrid (RRF k=60); die Degradationskette garantiert, dass der Host nie blockiert wird">
</p>

Die Vektorfähigkeit ist standardmäßig aus (reines FTS). DSHs `ctx.llm` hat keinen Embeddings-Endpunkt; die semantische Suche liefert eine **dreistufige Embedding-Quelle** (aus / remote / lokal), zur Laufzeit über die Einstellungsseite umschaltbar — siehe nächster Abschnitt.

## Semantische Suche (Embedding-Quelle)

Auf der Einstellungsseite (Memory → Übersicht → Semantische Suche) wählt man die Embedding-Quelle; sie greift sofort, ohne Konfigurationsänderung oder Neustart:

<p align="center">
  <img src="./assets/img/EmbeddingSource.png" width="70%"
       alt="Panel der semantischen Suche (Embedding-Quelle) auf der Einstellungsseite (helles Theme): Dreistufen-Wähler (Aus/Lokal/Remote, Lokal gewählt) zeigt die aktuelle Embedding-Quelle und den Hinweis auf automatische Runtime-Installation beim ersten Lokal-Wechsel; darunter listet der lokale Modellkatalog BGE small Chinesisch (in Nutzung/bereit), EmbeddingGemma 300M (316 MB herunterzuladen) und BGE-M3 (560 MB herunterzuladen) mit Dimensionen/Kontext/Umfang/Besonderheiten und Download-Einstiegspunkten">
</p>

Drei Embedding-Quellen: **aus** (Standard, reine BM25-Schlüsselwortsuche), **remote** (beliebiger OpenAI-kompatibler `/embeddings`-Dienst in Eigenregie; erst mit allen vier `embedding.*`-Schlüsseln wählbar), **lokal** (ein Modell aus dem eingebauten Katalog, quantisierte ONNX-**CPU-Inferenz** — kein API-Key nötig, Daten verlassen den Rechner nicht). Der lokale Modellkatalog ist eine Plugin-eigene Whitelist (revision je Modell verriegelt + sha256 je Datei; beliebige Repositories lassen sich nicht herunterladen).

- **Download**: Ein-Klick-Download von der Modellkarte (Standardspiegel `hf-mirror.com`, Fortsetzung nach Abbruch + sha256-Integritätsprüfung; wenn der direkte Weg unerreichbar ist, geht ein Proxy — standardmäßig automatische Erkennung der Umgebungsvariablen `HTTPS_PROXY`/`ALL_PROXY` usw., siehe `embedding.proxy`). Schlägt eine Einzeldatei fehl, erfolgt automatisch ein neuer Versuch mit gewechseltem Cache-Schlüssel (`?dshmem-retry=N`, um kaputte Cache-Objekte des Spiegel-CDN zu umgehen); bei Prüfsummenabweichung wird von Null neu geladen, bei Netzfehlern bleibt die Abbruchfortsetzung erhalten; die Daten landen in `models/<id>/` im Datenverzeichnis und lassen sich jederzeit auf der Einstellungsseite löschen;

- **Runtime auf Abruf**: erst beim ersten Lokal-Wechsel wird die Inferenz-Runtime installiert (transformers.js, rund 100~200 MB, in das Datenverzeichnis `runtime/` — außerhalb des Plugin-Abhängigkeitsbaums, das Plugin-Installationsverzeichnis bleibt unberührt); Modellladen und Inferenz laufen in einem **eigenen Worker-Thread**, ohne die Event-Loop des Hosts einzufrieren (während der Embedding-Berechnung laufen Konversation und Seiteninteraktion normal weiter);

- **Heißer Wechsel**: Quellenwechsel auf einen Klick — automatisches vollständiges Re-Embedding im Hintergrund (Fortschritt sichtbar, abbrechbar; währenddessen degradiert die Suche automatisch auf Schlüsselwörter, die Konversation bleibt unberührt; bei Dimensionswechsel wird die Vektortabelle mit der neuen Dimension neu gebaut); schlägt der Wechsel fehl, bleibt die alte Quelle, und auch nach dem Neustart läuft die ursprüngliche Quelle weiter;

- **Wirksamkeitsregel = Deployment-Obergrenze AND Laufzeitwahl**: `embedding.allowLocalModels=false` deaktiviert die lokale Stufe insgesamt; ohne die vier `embedding.*`-Schlüssel ist die Remote-Stufe nicht wählbar (für Unternehmens-Deployments verschließbar); der Zustand wird in `embedding-source.json` persistiert.

## Konfiguration

Überschreibende Einstellungen gehören in die eigene `cordis.patch.yml` des Profils, als **nackte Patch-Einträge auf oberster Ebene** (direkt `id:`, nicht in `insert:` verpackt — das nachträgliche Anfügen eines bundle-gleichen ids per `insert:` führt zum Startfehler `duplicate loader entry id`):

```yaml
- id: dsh-memory
  name: dsh-prime-memory
  config:                    # Schlüssel ersetzen die Zeile ganz (kein Deep-Merge); bei Bedarf alle zu erhaltenen Schlüssel ausschreiben
    family: auto             # Standardmodus neuer Sitzungen: auto | chat | work
    llm:                     # statisches Routing des Destillationsmodells (beide Felder gesetzt = Deployment-Pin, geht der
      provider: ''           # Einstellungsseiten-Route vor; leer = folgt Hauptroute der Einstellungsseite bzw. aktuellem Standardmodell)
      model: ''
```

| Feld | Standard | Beschreibung |
| ---------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `family`                     | `auto`                  | Standardgedächtnismodus neuer Sitzungen: `auto` (automatisch doppelfamiliär) \| `chat` (privat) \| `work` (Arbeit); in der Sitzung temporär über das Eingabeleisten-Steuerelement umschaltbar |
| `dataDir`                    | `$DSH_HOME/memory`      | Datenverzeichnis |
| `capture.enabled`            | `true`                  | L0-Erfassung |
| `capture.stripCodeBlocks`    | `true`                  | Codeblöcke aus Assistant-Nachrichten entfernen |
| `capture.maxMessageChars`    | `4000`                  | Maximale Zeichen je Nachricht |
| `capture.redactSecrets`      | `true`                  | Nutzdaten-Schwärzung: schon beim Erfassungsschreiben werden 8 Geheimnisklassen (PEM/Bearer/JWT/Cookie/Hersteller-API-Key/E-Mail/lange Nummern/IDs hoher Entropie) durch `[REDACTED:<KIND>]`-Platzhalter ersetzt — über L0, Destillationseingaben und manuelles Schreiben hinweg; `false` stellt Klartext wieder her (einmal aktiviert, ist der L0-Originaltext nicht mehr wiederherstellbar) |
| `trace.enabled`              | `true`                  | Strukturiertes Tracing: Abruf-/Destillationsereignisse als tägliche JSONL (`<dataDir>/trace/`), im „Logs"-Tab der Einstellungsseite umschaltbar |
| `trace.retentionDays`        | `14`                    | Aufbewahrung der Trace-Ereignisse in Tagen (`0` = dauerhaft) |
| `trace.captureContent`       | `false`                 | Nur bei `true` wird der Abruf-Query-Originaltext gespeichert (Standard: nur Länge + sha256) |
| `extract.enabled`            | `true`                  | L1-Extraktion |
| `extract.minMessages`        | `6`                     | Stationärer Auslöseschwellwert: sind N neue Nachrichten je Sitzung beisammen, läuft eine L1-Extraktion. In der Anlaufphase verdoppelt sich der wirksame Schwellwert von 1 bis zu diesem Wert (Erinnerung schon im ersten Zug, danach automatisches Bündeln zur Aufrufersparnis) |
| `extract.idleSeconds`        | `300`                   | Inaktivitäts-Auffangnetz: nach N Sekunden Stille der Sitzung werden undestillierte Scheiben verbucht (fängt „Nutzer ging vor Erreichen des Schwellwerts"); `0` deaktiviert |
| `extract.backgroundMessages` | `10`                    | Zahl der Kontextnachrichten, die der Extraktion beiliegen (je Sitzung frisch aus L0 erfragt, keine Verschmutzung zwischen Sitzungen) |
| `extract.candidatePool`      | `5`                     | Größe des Dedupe-Kandidatenpools |
| `l2.enabled`                 | `true`                  | L2-Szenenkonsolidierung |
| `l2.minNewMemories`          | `5`                     | Schwellwert neuer Erinnerungen seit der letzten L2-Konsolidierung |
| `l2.maxScenes`               | `12`                    | Obergrenze der Szenenblöcke |
| `l2.sceneContextLimit`       | `3`                     | Obergrenze ähnlicher Szenen im Volltext, die dem L2-Prompt beiliegen |
| `l3.enabled`                 | `true`                  | L3-Profildestillation |
| `l3.interval`                | `20`                    | L3-Destillationsintervall (in neuen Erinnerungen) |
| `recall.enabled`             | `true`                  | Automatischer Abruf |
| `recall.maxResults`          | `5`                     | Obergrenze der L1-Einträge, die vor jeder neuen Nutzernachricht injiziert werden |
| `recall.maxCharsPerMemory`   | `500`                   | Zeichenobergrenze je injizierter Erinnerung (bei Überschreitung abgeschnitten, mit Hinweis, den Volltext per Gedächtnis-Tool nachzuschlagen); `0` = unbegrenzt |
| `recall.maxTotalRecallChars` | `2000`                  | Gesamtzeichenobergrenze der Injektion je Runde (bei Überschreitung fällt das Ende nach Relevanz weg); `0` = unbegrenzt |
| `recall.timeoutMs`           | `5000`                  | Gesamtbudget des Abrufs (ms): bei Überschreitung wird die Injektionsrunde übersprungen, ohne die Konversation zu blockieren; `0` = unbefristet |
| `recall.includePersona`      | `true`                  | Profilkontext im System-Prompt injizieren (`<user-persona>`, stabile Zone) |
| `recall.includeSceneNav`     | `true`                  | Szenennavigation im System-Prompt injizieren (`<scene-navigation>`, stabile Zone) |
| `recall.strategy`            | `hybrid`                | Suchstrategie: `keyword` / `embedding` / `hybrid` |
| `recall.scoreThreshold`      | `0.3`                   | Abruf-Scoreschwelle (darunter keine Injektion; nur für die Strategien keyword/embedding wirksam, hybrid filtert vor der Fusion nicht; der Tool-Pfad filtert nicht) |
| `recall.decayHalfLifeDays`   | `30`                    | Halbwertszeit der Abruf-Frischekum (Tage, 0 = aus): die Sortierung gewichtet weich mit `Relevanz × max(0.5, 0.5^(Tage seit Aktualisierung/Halbwertszeit))` — zwischen ähnlich relevanten Kandidaten gehen frische zuerst (Plätze rotieren), alte Erinnerungen verlieren höchstens die halbe Sortierpunktzahl (Floor-Garantie: Langzeitfakten versinken nicht) |
| `embedding.enabled`          | `false`                 | Vektorsuch-Schalter; aus bedeutet reinen FTS-Betrieb |
| `embedding.baseUrl`          | leer                    | OpenAI-kompatible /embeddings-Adresse (z. B. `https://api.siliconflow.cn/v1`) |
| `embedding.apiKey`           | leer                    | API-Key |
| `embedding.model`            | leer                    | Embedding-Modellname |
| `embedding.dimensions`       | `0`                     | Vektordimension (bei Aktivierung Pflicht, muss zur Modellausgabe passen) |
| `embedding.maxInputChars`    | `5000`                  | Maximale Zeichen je Text (bei Überlänge abgeschnitten) |
| `embedding.timeoutMs`        | `10000`                 | Timeout eines einzelnen Embedding-Aufrufs (ms) |
| `embedding.allowLocalModels` | `true`                  | Lokale Embedding-Stufe erlauben (Deployment-Obergrenze: ausgeschaltet kann die Einstellungsseite keine Modelle laden und nicht auf Lokal schalten) |
| `embedding.mirror`           | `https://hf-mirror.com` | Wurzeladresse des Download-Spiegels für lokale Modelle (zurücksetzbar auf das offizielle `https://huggingface.co`) |
| `embedding.proxy`            | `''`                    | Modell-Download-Proxy, dreistufig: `''` (Standard) = Proxy-Umgebungsvariablen automatisch erkennen (`HTTPS_PROXY`/`ALL_PROXY` usw., respektiert `NO_PROXY`); `none` = deaktivieren, erzwungene Direktverbindung; anderer Wert = Proxy-URL (z. B. `http://127.0.0.1:7890`). Der direkte Spiegelzugriff ist in chinesischen Netzen zeitweise unerreichbar (abwechselnd Verbindungstimeouts und verdorbene Bytes); auf Maschinen mit Proxy empfiehlt sich die automatische Erkennung als Standard |
| `llm.provider/model`         | leer                    | Statisches Routing des Destillationsmodells (Deployment-Pin): sind provider und model **beide gesetzt**, wird die Destillationsroute verriegelt — vor der Laufzeit-Routenkette der Einstellungsseite und dem Standardmodell (das Deployment kann die Destillation auf eine bestimmte Route zwingen); leer = folgt „Hauptroute der Einstellungsseiten-Routenkette → Standardmodell". Laufzeit: im **Destillationsroutenkette-Editor** (Einstellungsseite → Memory → Übersicht → Destillationsparameter) lassen sich Hauptroute und Fallback-Kette konfigurieren (aus den **konfigurierten Anbietern** (inkl. der unter dsh → Einstellungen → Modelle hinzugefügten benutzerdefinierten Anbieter); die Hauptroutenzeile darf leer bleiben und folgt dann dem Standardmodell); sobald nicht leer, übernimmt sie diese statische Konfiguration vollständig — sofort wirksam, ohne Neustart |
| `llm.fallbacks`              | `[]`                    | Destillations-Fallback-Kette: Liste von Ausweichrouten, die bei Fehlschlag der Hauptroute (Fehler/Abschneidung/Netzfehler/**leere Ausgabe**) der Reihe nach durchprobiert werden; Eintrag = `{provider, model, reasoningEffort?}` (ein nichtleerer Wert überschreibt das globale `llm.reasoningEffort`, weiterhin an die Modellfähigkeiten geklemmt); Einträge, die exakt der Hauptroute entsprechen, werden übersprungen; **jede Route erhält die volle** **`timeoutMs`**; scheitern alle, übernimmt die bestehende Sitzungs-Backoff-Wiedervorlage. Leeres Array (Default) = Verhalten einer Einzelroute unverändert (siehe unten [Destillations-Fallback-Kette und Modelle mit langsamem TTFT](#destillations-fallback-kette-und-modelle-mit-langsamem-ttft)); ist die Laufzeit-Routenkette der Einstellungsseite (`distillChain`) nicht leer, **übernimmt sie Hauptroute und Fallback-Kette vollständig** (Einzeilerkette = ausdrücklich ohne Fallback), leer = folgt dieser Konfiguration |
| `llm.layerRoutes`            | `{}`                    | Destillations-**Routing je Schicht**: für jeden Schichtschlüssel `l1`/`l2`/`l3` eine **vollständige Kette** (Einträge wie `llm.fallbacks`, **Kopfzeile muss provider+model explizit doppelt nennen**); nicht leer ersetzt sie die Auflösung dieser Schicht **vollständig** (Hauptroute und Fallback der Schicht gehören zur Schichtkette, die globale Kette nimmt nicht teil); leer/fehlt = die Schicht folgt dem Globalen; `l1` verwaltet zugleich die beiden Aufrufpunkte Extraktion + Dedupe. Laufzeit: schichtweise im Segmentpanel „Destillationsparameter" der Einstellungsseite editierbar (geht vor dieser statischen Konfiguration); der Deployment-Pin hebelt statische Schichtketten nicht aus (beides Deployment-Konfiguration, gleiches Präzedenz wie bei der Fallback-Kette). Zur Fallback-Kette orthogonal und kombinierbar — je Schicht eine eigene Kette (ADR-0005) |
| `llm.maxTokens`              | `65536`                 | Notausgang für die Gesamtausgabe nicht geschichteter Aufrufe. Jede Destillationsschicht hat ein eigenes Budget (Extraktion 16k / Dedupe 8k / L2 32k / L3 16k; in den Thinking-Stufen high/xhigh/max automatisch ×4, damit das Reasoning das Budget nicht auffrist); Schichtbudgets sind zur Laufzeit einstellbar (Einstellungsseite → Memory → Übersicht → Destillationsparameter; leer/0 = eingebaute Standardwerte) |
| `llm.reasoningEffort`        | leer                    | Destillations-Denkstufe: leerer String = **auto** (nach Modellfähigkeit aufgelöst: Modellstandard → `high`); ein expliziter Wert (`off`/`none`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`) wird nur gesendet, wenn das Modell ihn deklariert — die Effort-Vokabulare unterscheiden sich je Anbieter (deepseek kennt `off`, OpenAI-artige sagen `none`, Modelle ohne deklarierte Stufe bekommen nichts), eine nicht unterstützte Stufe wird automatisch auf „nicht senden" herabgestuft, mit einmaliger Warnung; in den Stufen high/xhigh/max wird das Ausgabebudget automatisch ×4. Laufzeit: der Routenkette-Editor erlaubt die Übersteuerung **route für Route** (Inline-Dropdown, Vokabular erscheint live je nach deklarierten Modellfähigkeiten, Default folgt diesem Wert) |
| `llm.temperature`            | `0.3`                   | Destillationstemperatur |
| `llm.maxInputChars`          | `700000`                | Zeichenbudget der Eingabe je Destillationsaufruf (überlaufende L1-Eingaben werden automatisch geblockt extrahiert); zur Laufzeit einstellbar (Einstellungsseite → Destillationsparameter → Eingabebudget; leer/0 = folgt diesem Wert) |
| `llm.timeoutMs`              | `120000`                | Timeout eines einzelnen Destillationsaufrufs (ms) |
| `tokenCost.retentionDays`    | `365`                   | Aufbewahrung der Destillationskostendetails (Tabelle token\_cost) in Tagen, beim Schreiben wird rollierend aufgeräumt; `0` = dauerhaft aufbewahren. Die Obergrenze des Fensters „letzte N Tage" im Kosten-Dashboard entspricht diesem Wert |
| `tools`                      | `true`                  | Sollen die modellaufrufbaren Gedächtnis-Tools registriert werden |
| `benchControl`               | `false`                 | Registriert den Bench-Kontrolldienst (Rebuild-Auslösung im Prozess / Sitzungsmodus-Setzung / Destillationsnutzungs-Snapshot, für die Lifecycle-Spur des Benchmarks). Standardmäßig aus — null Angriffsfläche im Produktionsdeployment, nicht leichtfertig einschalten |
| `scope` | `global` | **Speicher-Geltungsbereich** (Sichtbarkeit): `global` (Standard) = arbeitsbereichübergreifend sichtbar; `workspace` = die **`work`-Familie** arbeitsbereichisoliert. Zu `family` (Inhaltstyp) **orthogonal** — beide Achsen fragen Verschiedenes, alle vier Quadranten existieren (`chat×global` / `chat×workspace` / `work×global` / `work×workspace`). Die `chat`-Familie bleibt standardmäßig global: private Erinnerungen sollen projektübergreifend wirken. **Bei `global` als Standard ist das Verhalten wortidentisch zu vor Einführung dieser Einstellung** — alle bestehenden Einrootdaten fallen an `global`; die Migration etikettiert nur die Zugehörigkeit, ohne zu verschieben oder zu löschen ([ADR-0008](./docs/adr/0008-storage-scope-vs-family.md) / [ADR-0009](./docs/adr/0009-workspace-identity-source.md)). Ist der Arbeitsbereich der Sitzung unbekannt, fällt es auf `global` zurück (ohne Ausnahme, ohne Blockieren) |
| `conflictFreeze.enabled`     | `false`                 | Hauptschalter des **Konflikt-Freeze**. Eingeschaltet erhält das Dedupe-Entscheidungsvokabular die Aktion `conflict`: beurteilt das LLM „beide Seiten scheinen richtig, die Maschine kann nicht entscheiden", **überschreibt bzw. verschmilzt es nicht mehr automatisch** (`update`/`merge`), sondern **parkt** das Paar in einer Klärungswarteschlange — die neue Erinnerung kommt ganz normal in die Bibliothek, **der Inhalt beider Seiten bleibt unangetastet**, und das neue Tool `memory_resolve_conflict` übergibt den Entscheid an den Menschen. Ausgeschaltet ist der Dedupe-Prompt **wortidentisch** zu ohne die Funktion (null Drift). Standardmäßig aus: Das Freeze kostet menschliche Aufmerksamkeit und kann nicht default-allsseitig an sein ([ADR-0010](./docs/adr/0010-conflict-freeze-default-off-and-timeout.md)) |
| `conflictFreeze.maxPending`  | `100`                   | Obergrenze der Klärungswarteschlange. Ist die Zahl der unentschiedenen Fälle erreicht, werden neue Konflikte **nicht mehr geparkt**, sondern an Ort und Stelle nach dem LLM-vorgegebenen winner/loser automatisch erledigt (das Paar **wird dennoch in der Warteschlange protokolliert**, mit `resolution` = `auto` zur Unterscheidung von manuellen Entscheidungen). Die Semantik ist „**keine neuen mehr annehmen**", nicht „alte heimlich löschen" — daraus folgt die Begrenztheit, ohne dass noch ungesehene Klärungsanfragen verloren gingen |
| `conflictFreeze.timeoutDays` | `30`                    | Timeout-Überleitung (Tage): länger als so viele Tage geparkte Paare werden **am Anfang der nächsten Destillationsrunde** automatisch erledigt (wie oben, protokolliert als `resolution=auto`). `0` = **keine** Timeout-Überleitung (ausdrückliche Abschaltung, nicht „sofort alles überlaufen lassen"). Ohne Sicherheitsventil bliebe „zwei widersprüchliche Erinnerungen dauerhaft nebeneinander abgerufen" für immer in der Bibliothek |

### Destillations-Fallback-Kette und Modelle mit langsamem TTFT

Bei manchen Inferenz-Anbietern erreichen Gratis-/Langsamstufen eine **Zeit bis zum ersten Token (TTFT) von über 20 Sekunden**, während manche Upstream-Gateways nach rund 20 Sekunden Verbindungsstille kappen — Destillationsaufrufe scheitern dann konstant bei ~20 s (`llm aborted`), und das 120-s-Timeout des Plugins kommt gar nicht erst zum Zug (Praxisszenario aus [#31](https://github.com/drscrewdriver/dsh-prime-memory/issues/31)). Drei Dämpfungsebenen, je nach Bedarf:

1. **Route wechseln** (am direktesten): Einstellungsseite → Memory → Übersicht → Destillationsparameter, im Routenkette-Editor die Hauptroute sofort ändern (oder eine schnelle Route auf Platz 1 setzen), oder statisch `llm.provider`/`llm.model` pinnen.

2. **Fallback-Kette** (automatische Degradation): scheitert die Hauptroute, springen die Ausweichrouten der Reihe nach ein, ohne menschliches Zutun:

   ```yaml
   llm:
     provider: opencode-go          # Hauptroute (auch ohne Pin: folgt Hauptroute der Einstellungsseiten-Routenkette / Standardmodell)
     model: ox-alpha-free
     fallbacks:                     # Eintragsreihenfolge = Degradationspriorität; ohne Konfiguration bleibt das Einzelroutenverhalten
       - provider: opencode-go
         model: deepseek-v4-flash
         reasoningEffort: low       # optional: Stufenübersteuerung dieser Route (Default: folgt dem Globalen)
       - provider: deepseek-official
         model: deepseek-v4-flash
   ```

3. **Routing je Schicht** (jede geht ihren Kanal): die Destillationsschichten haben unterschiedliche Ansprüche ans Modell (L1, sehr frequent, will billig, schnell und stabil sein;
   L3, selten, toleriert einen langsamen Erstpacket, braucht aber starke Fähigkeiten) — für abweichende Schichten lassen sich eigene Ketten konfigurieren: **eine vollständige Fallback-Kette je Schicht**,
   unkonfigurierte Schichten laufen weiter über die globale Kette:

   ```yaml
   llm:
     layerRoutes:                  # unabhängiges Routing je Schicht (#34); die Kopfzeile muss provider+model explizit nennen
       l1:                         # l1 verwaltet zugleich Extraktion + Dedupe: eine billige, schnelle, stabile Kette
         - provider: opencode-go
           model: deepseek-v4-flash
           reasoningEffort: low
         - provider: deepseek-official   # Fallback innerhalb der Schicht: ein L1-Ausfall degradiert nur bis hier, nicht in die globale Kette
           model: deepseek-v4-flash
       l3:                         # L3-Profildestillation: seltene, große Eingaben — eine Kette mit starken Fähigkeiten
         - provider: deepseek-official
           model: deepseek-v4-flash
           reasoningEffort: high
   ```

   Auch schichtweise zur Laufzeit editierbar im **Segmentpanel** (Globales / L1 / L2 / L3)
   der Einstellungsseite → Memory → Übersicht → Destillationsparameter; Priorität innerhalb der Schicht:
   Laufzeit-Schichtkette > statische YAML-Schichtkette > globale Standardkette,
   Stufe für Stufe als Rückfallebene.

   Scheitern = Fehler / Abschneidung / Netzfehler / **leere Ausgabe** (der Stream endet normal, aber mit 0 Zeichen — für die Destillation zwangsläufig schon in der Parse-Phase verloren; daher als Fehlschlag dieser Route umgestuft statt Leerstring zurückzugeben); eine aktive Abbruchung durch den Aufrufer löst keine Degradation aus; jede Route erhält die **volle** `llm.timeoutMs` (ein gemeinsames Budget gäbe einer TTFT-langen Ausweichroute ein kleineres Fenster, als ihr echter Erstpacket braucht — die Fallback-Kette wäre bloße Deko); die Token-Kosten werden je Versuch gebucht (auch die fehlgeschlagenen, inklusive der bis zum Streamabriss erreichten Tokens), der erfolgreiche Aufruf wird der tatsächlich dienenden Route zugeschrieben. Die Routenkette lässt sich auch zur Laufzeit im Editor „Destillationsroutenkette" (Einstellungsseite → Memory → Übersicht → Destillationsparameter) anpassen (ohne Konfigurationsänderung und Neustart); dieses YAML eignet sich für Deployments, die eine statische Kette festschreiben wollen.

4. **Timeout erhöhen**: `llm.timeoutMs` hilft nur, wenn die Route wirklich langsam ist, die Gateway aber nicht kappt; wenn das Gateway bei 20 s kappt, hilft ein höheres Plugin-Timeout nicht — nutzen Sie die ersten beiden Ebenen.

## Logs und Fehlerbehebung

Der dsh-Host schreibt die Plugin-Logs auf die Konsole; zusätzlich spiegelt das Plugin alles ab info in `memory.log` im Datenverzeichnis.
Typischer Logweg einer Konversationsrunde: `L0 捕获` → `L0 落盘` → `蒸馏管线开始` → `LLM 调用（输入/输出 字符数、耗时）` → `L1 阶段完成` → `管线结束`; die nächste Runde beginnt mit `召回注入 N 条 L1`. Eine leere LLM-Ausgabe
kommt mit vollständiger Diagnose (finish reason / Token-Zählung / Reasoning-Auszug); ein JSON-Parsefehler protokolliert die ersten 400 Zeichen
der rohen Modellausgabe; alle Fehlschläge warnen mit der ersten Stack-Frame. Die JSONL-Faktenquelle wird Runde für Runde angefügt und vertraut auf das Write-back des OS (kein
fsync pro Eintrag): bei Stromausfall o. Ä. geht höchstens ein kleines Endstück verloren; die Suchbasis lässt sich über „Gedächtnis neu aufbauen" vollständig aus der Faktenquelle neu importieren.

## Unterschiede zu MemoryCore

- Vollständige Pipeline eingebettet (keine Abhängigkeit von einem externen Gateway); die Destillation nutzt DSHs eigenes LLM;

- L2/L3 wandern von „LLM bedient Datei-Tools" zu „LLM liefert Operations-JSON / Volltextdokumente, die Engineering-Seite führt aus";

- Der Abruf-Injektionspunkt ist `agent/pre-step` (synthetische Nachricht auf Nachrichtenseite, offizielle Pre-Step-Ersetzungssemantik) + `systemPrompt.context` im Agent-Scope (Profil-/Navigationsstabilzonen, native DSH-Ereignisse/Dienste);

- Speicher/Suche: eine für den Einzelbetrieb zugeschnittene Version des offiziellen sqlite-Backends (ohne Multi-Tenant-Isolationsspalten, TCVDB-Cloud-Backend, Audit-Tabellen;
  die Tokenisierung entspricht der offiziellen mit jieba — vorkompiliertes Binary @node-rs/jieba + Vereinigung mit CJK-Bigrammen,
  die Tokens liefern BM25 exakte Ganzwort-Treffer, die Bigramme sichern die Teilwort-Abdeckung; schlägt das Laden fehl, Rückfall auf reine Bigramme,
  der FTS-Index wird automatisch nach Versionsstempel des Tokenizers neu gebaut).

## Rückzug, Wiederherstellung und Bereinigung von Erinnerungen

Das Löschen kennt **zwei Stufen**, bestimmt durch ihre Kosten: **die reversible Stufe ist der Standard**, die irreversible muss ausdrücklich verlangt werden und bringt ihren eigenen Export mit.

| Aktion | Endpunkt / Tool | Reversibel | Beschreibung |
| --- | --- | --- | --- |
| Rückzug (Soft-Delete) | `memory_delete` · `dsh-memory/records-delete` | ✅ | Haupttabellenzeile bleibt + `valid_to` wird geschlossen + Ersatzmarker geschrieben; nur die FTS-/Vektorzeilen werden gezogen. **Standardmäßig wird nur 1 Eintrag zurückgezogen**; für Mengen bitte exakte `ids` übergeben, nicht auf semantisches Matching vertrauen |
| Wiederherstellen | `dsh-memory/records-restore` | — | Rückzugsmarker entfernen + Indizes neu bauen; der Datensatz kehrt in den Abruf zurück |
| Physische Bereinigung | `dsh-memory/cleanup-retired` | ❌ | Die **einzige irreversible** Aktion des Plugins. **Standardmäßig Probelauf** (ohne `dryRun` wird nichts gelöscht); auch bei expliziter Ausführung wird zuerst ein Snapshot der ganzen Basis geschossen und **per Inhalts-Hash** geprüft — bei Abweichung Abbruch, ohne eine einzige Löschung |
| Snapshot-Liste | `dsh-memory/snapshots-list` | — | Listet Snapshots unter `snapshots/` mit gültigem Manifest (mit Grund und Eintragszahl) |
| Rückeinspeisung aus Snapshot | `dsh-memory/snapshot-restore` | — | Schreibt bereinigte Datensätze zurück. **Standardmäßig Probelauf**; nimmt nur Snapshot-Verzeichnisnamen, keine Pfade |

Die drei Rückzugswege — im Arbitrageurteil unterlegen, durch Dedupe ersetzt (`update`/`merge`), manuell gelöscht — **teilen sich dasselbe Primitiv**; „Löschen" hat also an allen drei Stellen dieselbe Semantik: alles ist wiederherstellbar.

### Wie das „Rückgängig-Sicherheitsnetz" der Bereinigung aufgebaut ist

Vor jeder physischen Löschung muss ein Snapshot geschossen und geprüft sein (siehe Tabelle oben). Der Rückweg lautet:

1. `dsh-memory/snapshots-list` — den Snapshot-Verzeichnisnamen holen (Form `l1-<Zeitstempel>-<Grund>`);
2. `dsh-memory/snapshot-restore` — erst im Probelauf `missing` ansehen (die wirklich zurückholbare Zahl, nicht die Snapshot-Gesamtzahl), dann mit explizitem `dryRun:false` zurückschreiben.

Der Wiederherstellungseingang **nimmt nur Verzeichnisnamen, keine Pfade**: sonst bekäme dieser RPC nebenbei die Fähigkeit „lies ein beliebiges Verzeichnis und schreib seinen Inhalt in die Suchbasis". Die Wiederherstellung selbst ist ein idempotenter Upsert und kann gefahrlos wiederholt werden.

> **Eine Semantik, die man kennen muss**: `cleanup-retired` räumt nur **bereits zurückgezogene** Datensätze weg, und der Snapshot entsteht **vor** der Löschung — deshalb trägt jeder über einen Bereinigungs-Snapshot zurückholbare Eintrag den Rückzugsmarker. Standardmäßig schreibt `snapshot-restore` die Zeilen nur in die Haupttabelle zurück (und meldet die `stillRetired` ehrlich mit): **„zurück in der Haupttabelle" ≠ „zurück im Abruf"**; wer den echten Rollback in einem Schritt will, ergänzt `unretire: true` oder ruft danach `records-restore` für diesen id-Stapel auf.

## Roadmap

Geplante Funktionen — Wünsche und Priorisierungen gern über die [Issues](https://github.com/drscrewdriver/dsh-prime-memory/issues) melden:

- [ ] **Git-Branch-Bewusstsein**: Erinnerungen an den aktuellen git-Branch koppeln; Abruf nach Branch filtern/gewichten (orthogonal zu den bestehenden Gedächtnismodi)

- [ ] **Erinnerungsimport aus Claude Code / Codex**: bestehende Gedächtnis-Assets (`CLAUDE.md`, Claude-Code-Gedächtnisdateien, Codex-`AGENTS.md` usw.) in einem Zug migrieren; nach dem Import fließen sie in die Schichtdestillations-Pipeline

## Danksagung

Das unmittelbare Upstream dieses Repositories ist [JunNanLYS/dsh-layered-memory](https://github.com/JunNanLYS/dsh-layered-memory)
— das Schichtdestillations-Gedächtnis-Plugin auf DSH-Seite. Dank an den Originalautor **JunNanLYS**, der das Projekt offengelegt hat: dieses Repository hat die Implementierungsschicht darauf neu geschrieben
(der erste Commit `0b506b8` ist bereits „Cleanroom-Rewrite-Räumung — alte Implementierung und Build-Artefakte entfernt"); Dokumentation, Bilder und Modularchitektur folgen dem Upstream.
Gegenüber dem Upstream fügt dieses Repository 12 agentenorientierte Gedächtnis-Tools hinzu (darunter die hochprivilegierten Schreibzugriffe `memory_add` / `memory_delete` /
`memory_import`, die Ruminate-Kontrollserie `memory_ruminate`, der Gedächtnisgraph `memory_search_graph` /
`memory_expand_graph_node`, die Entscheidungsrückverfolgung `memory_receipts`, die Konfliktentscheidung `memory_resolve_conflict`),
den werkzeugübergreifenden Erinnerungstransport `skills/memport` sowie die Shop-Screenshot-Deklaration.

Zwei dieser Tools dienen der **Nachvollziehbarkeit**:

- `memory_receipts` — rekonstruiert, „**wie** diese Erinnerung **zustande kam**". Jede L1-Dedupe-Entscheidung hinterlässt einen Beleg
  (**Zusammenfassung der Kandidatenpooleingabe im Entscheidungszeitpunkt** + Konklusion); je Datensatz lässt sich fragen „aus welcher Runde, welcher Kandidatenpool war sichtbar",
  je Stapel „was wurde in jener Runde entschieden". Der Beleg muss **vor** dem Ereignis existieren — der Eingabeschnappschuss lässt sich nicht nachträglich ergänzen
  ([ADR-0006](./docs/adr/0006-l1-decision-receipts.md)).
- `memory_resolve_conflict` — entscheidet die vom **Konflikt-Freeze** geparkten Paare (siehe die `conflictFreeze.*`-Konfiguration).
  Konklusionen `winner` / `loser` / `both`: wird eine Seite für wahr erklärt, zieht sich die andere aus der Suche zurück; `both` bedeutet,
  dass es sich um zwei voneinander unabhängige Fakten handelt und beide erhalten bleiben.

Der Kern der Gedächtnisfähigkeiten (Schichtdestillations-Pipeline, Prompt-Design, Doppel-Schreib-Speicherarchitektur) beruht auf dem **MemoryCore** des Projekts
[TencentCloud/TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory); Dank an das Originalprojekt für offen gelegtes Design und Implementierung.

## License

[MIT](LICENSE)
