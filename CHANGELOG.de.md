# Changelog (Deutsch)

- [更新日志（中文）](./CHANGELOG.md)
- [Changelog (English)](./CHANGELOG.en.md)
- [日本語 changelog](./CHANGELOG.ja.md)
- [한국어 changelog](./CHANGELOG.ko.md)
- [Changelog auf Deutsch](./CHANGELOG.de.md)
- [Changelog en français](./CHANGELOG.fr.md)
- [Changelog in italiano](./CHANGELOG.it.md)
- [Changelog auf Russisch](./CHANGELOG.ru.md)
- [Changelog en español](./CHANGELOG.es.md)

Diese Datei dokumentiert die wesentlichen Änderungen von dsh-prime-memory (vor 0.5.0 als dsh-memory-plugin bekannt). Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionsnummern folgen der [semantischen Versionierung](https://semver.org/).

> **Konvention für UI-Screenshots**: Einträge mit Oberflächenänderungen archivieren echte Screenshots unter
> `assets/changelog/<Versionsnummer>/<zweistellige Nummer>-<Kurzbeschreibung>.png` und verweisen im Eintrag per relativer Pfadangabe darauf — im Changelog sieht man direkt, wie die neue Version aussieht.

<!-- Lücke: Die Einträge für 0.21.0 und 0.20.x sind noch nicht übersetzt. -->

## [0.24.0] — Unveröffentlicht (lokale Linie `0.24.0-local.0…3`, 2026-10-13)

### Hinzugefügt

- **Einzelne wahre Quelle des Typwortschatzes (`src/memory-types.ts`)**: die Originalnamen der 29 Wirtsgedächtnisklassen + die alten 7 Plugin-Klassen + `unclassified` als Auffangklasse, zusammen 37 Klassen. Die Whitelist des Projektionsverzeichnisses, die Schreib-Whitelist von `memory_add`, die Panel-Beschriftungen, die Enumerationsstrings der Extraktions- und Deduplizierungs-Prompts sowie die Typcodes der TS/Python-Zwillingsimplementierung von memport **leiten sich sämtlich daraus ab**. Zuvor war das „vollständige Typverzeichnis" an vier Stellen abgeschrieben und jeweils für sich weitergewachsen: `memory_add` schrieb fremde Klassifikationen **still in `episodic` um**, während der memport-Text „unverändert durchreichen" versprach — zwei Kaliber für dieselbe Sache.
- **Namensverdichtung (`cfg.naming`)**: die Extraktion erzeugt den `title` unmittelbar vor Ort, **getrennt definiert** von `content` (title ist die Nominalphrase, die beantwortet „worüber handelt dieser Eintrag", content ist der vollständige Erzähltext). Der Deduplizierungs-Merge erzeugt zusätzlich `merged_title`. Beim Speichern ist `title` bloß ein **Namens-Kandidat** und muss das Formtor `validateTitle` passieren; bei Ablehnung geht er weiterhin an den Namensgeber — die wahre Quelle der Namens-Eindeutigkeit bekommt nicht, weil eine weitere Herkunft dazukam, zwei Bewertungsskalen.
- **Beispielset im Few-shot-Standardformat (`src/prompts/examples.ts`)**: Musterbeispiele nach Typ + Gegenbeispiele, Gesamtlänge mit Budgetobergrenze (Beispiele sind eine fixe Kosten, die jede Verdichtungsrunde zahlt). Die Musterbeispiele müssen selbst das Tor passieren und das Skelett vollständig haben; die Testfälle ziehen direkt `auditFewShot()` heran, statt die Kriterien abzuschreiben.
- **Ausführbare Skelett-Kriterien (`SKELETON_ELEMENTS` + `scoreSkeleton`)**: macht aus dem Wunsch im Prompt „ohne Ursache und Folge, unvollständig geschrieben, unbrauchbar" ein messbares Kriterium, das sich zur Festlegung der Defaults verwenden lässt. Deklarierte Grenze: Keyword-Heuristik, nur für den relativen Vergleich zweier Arme bei derselben Eingabe brauchbar, kein absoluter Qualitätswert.
- **Verzeichnisgerüst + `_index.md` je Klasse (`memory-md-skeleton.ts`)**: in jedes Typverzeichnis eine Indexdatei (Klassenname + Anzahl der Einträge im Bestand). Leere Verzeichnisse werden von git und von Archivpaketen ausgespuckt, und „es gibt dieses Verzeichnis nicht" sieht für Menschen genauso aus wie „diese Klasse hat 0 Einträge". Idempotent: ohne Inhaltsänderung kein Schreibvorgang und kein mtime-Update; wenn die Projektionsseite abgeschaltet ist, gar keine Aktion.

### Geändert

- **Drei Defaults nach A/B-Messung umgelegt** (`narrativeTemplates.enabled` / `naming.enabled` / `naming.fewShot`). Grundlage sind zwei Messungen mit **entgegengesetzter Richtung**: im echten Sitzungsverdichtungspfad ohne Beispiele Skelett-Vollständigkeit **0.000** (0/23), mit Beispiele **0.703** (26/37); beim Umbenennen bestehender Einträge, also der Namensaufgabe, senkten Beispiele den Wert dagegen um **−0.113** (18/160 unbeantwortet). Fazit: **Beispiele dürfen nicht über Aufgaben hinweg verwendet werden** — sie gehören nur in den Extraktions-Prompt, nicht in das Namensskript.
- **md-Projektion standardmäßig an** (`memExport.enabled`): die ganze Planung steht auf der Prämisse „Datei ist die Autorität für den Inhalt + Datenbank ist der Index"; default aus hieße default unbenutzt. `mdSync.enabled` bleibt **weiter standardmäßig aus** — es schreibt in die Datenbank, das Risiko ist asymmetrisch.
- **Umbenennung der workspace-Zugehörigkeits-Konfigurationsseite `workspaceHints` → `workspaceSource`**: harter Umbau ohne Kompatibilitäts-Alias (der Key war nie mit einer Veröffentlichung nach außen gegangen; ein Alias hieße eine zweite Tatsachenquelle heranziehen). Standardmäßig an; der routing-`path` speichert nun die **workspace-Wurzel** (der alte Wert lautete `E:\test\rewrite-agently\.agents`, und `targetFor` hängt zusätzlich `.agents/memory` an → ergibt einen verwaisten Baum `.agents\.agents\memory\`; die Leitplanke „nur wenn die Wurzel fehlt, auf die Einzelwurzel zurückfallen" fängt diese Form nicht). Rückfüllung des Bestands auf der echten Maschine: **724/1166** Einträge bekamen ihre Zugehörigkeit, `hashRecords` Zeichen für Zeichen unverändert.

### Behoben

- **Der Ledger-Loader überschrieb absolute Keys in `relPath`**: seit N10 sind die Ledger-Keys absolute Pfade, und der Satz „bei Abweichung neu schreiben, mit dem Key als Maßstab" wurde bei jedem Laden zwingend ausgelöst — Verschmutzung gemessen an **1167/1241** Einträgen. Die nachgelagerten Symptome: die Archivierung verwaister Dateien baute einen illegalen Verzeichnisnamen mit Doppelpunkt zusammen, und 75 Umzüge schlugen sämtlich mit ENOENT fehl. Jetzt Ableitung aus `root` + Key (neu: `deriveRelPath`); die Archivseite vertraut dem gespeicherten `relPath` nicht mehr.
- **`--revert` ohne hooks-Absicherung**: `findArchivedOld` greift direkt auf `deps.hooks.exists`, während `runCli` beim revert-Aufruf keine hooks mitgibt (auf der apply-Seite gibt es `deps.hooks ?? defaultHooks`, auf der revert-Seite fehlte es). Im Sandbox-Lauf warf der erste Rollversuch 74 Fehler. Der springende Punkt ist die asymmetrische Schadenslage: Wenn apply schiefgeht, zieht man sich mit `--revert` zurück — **ein defekter Rollback heißt, das Backup ist der einzige Ausweg**.
- **Wurzelübergreifende Dubletten umgingen „bei Änderung auf beiden Seiten nichts tun"**: `roots = Zielwurzel des Eintrags ∪ die vom Ledger vermerkten Wurzeln`; derselbe Eintrag kann unter zwei Wurzeln je eine Datei haben. Die Bewertung nimmt die Datei der alten Wurzel, das Schreiben auf die Platte die von `targetFor` berechnete Fassung der neuen Wurzel — dadurch überschreiben die von einem Menschen in der alten Wurzel gemachten Editierungen die maßgebliche Fassung, und der Bericht sah völlig konform aus. Jetzt wird nur die aktuelle Zielwurzel anerkannt; der Rest zählt in das neue Feld `staleRootFiles` und erscheint im Panel.
- **Namenskollision drängte den ganzen Gedächtniseintrag aus dem Suchbestand**: die Schreibweise `{ ...alter Eintrag, id: neue id }` schreibt mit einem „bereits zu einer anderen Zeile gehörenden Namen" in die DB → Kollision auf dem partiellen Unique-Index → nach gebündeltem Fehlschlag zeilenweise Wiederholung, immer noch Fehler → das Merge-Ergebnis dieses Eintrags **verschwindet stillschweigend** (der alte Eintrag ist bereits ausgeschieden, von dieser Ersetzung bleibt nichts). Das Namens-Kriterium wurde von „name ist leer" auf **„dieser Name gehört ihm nicht"** umgestellt.
- **Vektor „nachzuziehen N" geht niemals auf null, während „Index-Rebuild nichts zu tun" meldet**: im Anzeigeteil enthält der Nenner von `missing = total − embedded` ausgeschiedene Zeilen, und ausgeschiedene Zeilen haben designgemäß berechtigt keinen Vektor; die beiden SQL, die das Nachziehen antreiben, schließen ausgeschiedene Zeilen aus. Auf demselben Bildschirm erschienen zugleich „nachzuziehen 114" und „nichts zu tun". Der Nenner wurde auf aktive Zeilen vereinheitlicht.
- **Die Projektionsleitplanke zählte „Durchlauf" statt „Aktion"**: `maxRecords` rechnete auch die als „unverändert" bewerteten Einträge ins Kontingent — der zweite Klick scannte wieder dieselben ersten N Einträge. Der Panel-Satz „nochmal klicken zum Fortsetzen" war eine Lüge (Symptom auf echter Maschine: `已写 9 · 未变 291 · 剩余 866` blieb konstant). Jetzt zählen nur Einträge, die die Platte berührt haben; die Gesamtmenge des Scans deckt `timeBudgetMs` ab.
- **Ledger-Fortschreibung O(n²)**: `set()` schrieb pro Eintrag einmal das gesamte JSON atomar neu. Bei 1200 Einträgen auf derselben Platte gemessen **9442ms → 1954ms** (Dirty-Flag + Batching-Fenster + erzwungenes `flush()`).
- **`NAME_MAX`(40) und `NAME_CLIP_MAX`(28) in zwei Zahlen getrennt**: die Zeichenzählung behandelt ASCII und Chinesisch gleich teuer; `dsh-agent-teams` / `Python-3.13` verbrauchen als ein Wort 15 Punkte, und zulässige Namen von faktisch ein, zwei Wörtern fielen durch `too-long`. Einheitlich auf 40 zu setzen ließ dagegen `deriveName` Erzählsätze bis zum Satzende abschreiben (gemessen). Nebenbei das hart geschriebene 28 in `validateTitle` korrigiert (zwei Tatsachenquellen für denselben Schwellwert).
- **Drei Fehltötungen am Namens-Tor**: Abschneide-Vorliste und Namens-Ablehnungsliste wurden **getrennt geführt** (ein nacktes Subjekt wie „Benutzer/Team" tötet jetzt Nominalphrasen wie „Benutzer npm-Konto Benutzername" nicht mehr mit, 10 Fälle auf echter Maschine); `has-id-fragment` wurde auf „4+ Ziffern nach einem Nicht-ASCII-Zeichen" verengt (`ADR-0006`, `Han-1413141` passieren jetzt, 4 Fälle auf echter Maschine).

### Bekannte Grenzen

- Die inkrementelle Projektion beim Ausklingen des Wiederkäuens hängt an der `id→updatedAt`-Baseline-Differenz, während Umbenennung und Ausscheiden über `patchMetadata` laufen und `updated_time` nicht anfassen ⇒ **metadata-only-Umschreibung wird in derselben Runde nicht neu projiziert**.
- Die P2-Rückwärtssynchronisation schuldet noch zwei Punkte: der automatische Haken beim Start (inzwischen auf Endpunkt + Schaltfläche umgestellt) und der `pending`-Trupp, der die `conflicts`-Wartefläche für Schlichtungen nicht erreicht.
- **Die Übersetzungen in 8 Sprachen sind seit 0.20.0 nicht nachgezogen** (diesmal wurden nur die Einträge ab 0.22.0 nachgetragen; die Lücke bei 0.20/0.21 besteht weiter, separat vermerkt).

## [0.23.0] — Unveröffentlicht (lokale Linie `0.23.0-local.1…8`, 2026-10-12…13)

### Hinzugefügt

- **Maßgebliche md-Projektionsseite (P0/P1/U/N10/N11)**: Spalte `l1_records.name` (Datei-Identitätsschlüssel + partieller Unique-Index); `renderRecord` + Doppel-Fingerabdruck-Ledger (`dbDigest`/`fileDigest`) + die Endpunkte `mem-export` / `mem-reconcile`; der Panel-Abschnitt „Externes Archiv"; die Projektionswurzel auf **workspace zuerst** umgestellt (`<ws>/.agents/memory/<Typ>/<Name>.memory.md`); die Bewertung als veraltet ist mit `.memory.md.disable` gekoppelt.
- **P2 Rückwärtssynchronisation (Datei → Index)**: anhand der beiden Ledger-Digests ein **Dreifelder-Schema** — nur die Datei geändert → Rückspeisung in die Datenbank und Umschreiben in der Normdarstellung (glättet die Schreib-Rückschleife); nur die Datenbank geändert → wiederverwendet `exportRecords` und schreibt die Datei neu; **beide geändert → beide Seiten bleiben unberührt**, nur `pending` wird gesetzt. `.disable` geht den Ausscheidungsweg, ohne die Datei zu löschen; neue Dateien unklarer Herkunft werden nur gezählt, nicht übernommen (der Import muss den Schreib-Kern passieren). Endpunkt `dsh-memory/mem-sync`.
- **P3 Archivierung + physisches Löschen**: das Gate von `exportThenPurge` wurde vom Datenbank-Gesamthash auf die **Batch-Projektion** umgestellt (sobald eine nebenläufige Verdichtung irgendetwas vom Batch Unabhängiges geändert hat, ließ die alte Implementierung das Aufräumen niemals etwas löschen); nach dem Löschen schreibt sie das menschenlesbare `retired.md` + verschiebt die projizierten Dateien des Batches (einschließlich `.disable`) ins Snapshot-Verzeichnis; der Trockenlauf von `cleanup-retired` gibt eine **Vorschau der Löschliste** zurück; in der Graph-Projektions-Tabelle neu `forgetRecords` (zuvor wuchs der ganze Bestand nur und nahm nie ab — aus einem Snapshot wiederhergestellte Einträge galten wegen ihrer fortbestehenden Projektionszeile als „bereits projiziert" und wurden **nie neu projiziert**; im Suchgraph fehlte still ein Eintrag, ohne einen Fehler zu melden).
- **P4.1 Standardklasse `unclassified` + P4.2 Normalisierung des Layouts im Haupttext** (`normalizeContentMd`). Idempotenz ist harte Anforderung: ohne Idempotenz ändert sich der `fileDigest` des Ledgers jede Runde, und die Schreib-Rückschleife brächte der Renderer selbst ein. Nur Layout, keine Semantik (Prosa nicht in Bullets, kein eingeschobenes H1, keine Metadaten im Haupttext).
- **Archivierung verwaister Projektionsdateien `dsh-memory/mem-orphans`**: verschickt nur Dateien, von denen „das Ledger vermerkt, dass wir sie geschrieben haben, und im Augenblick kein Eintrag diesen Pfad beansprucht". Dateien unklarer Herkunft, die nicht im Ledger stehen, bleiben **unberührt** (das können Eingaben sein, die ein Mensch ins Projektionsverzeichnis gelegt hat und die auf ihre Rücksynchronisation warten). Nicht gelöscht, nur verschoben; die relative Form und der Originaltext bleiben erhalten.

### Verhaltenskorrektur (Recall-Anzeigefläche)

- Aufgerufene Einträge verschwinden nicht mehr augenblicklich: der view trägt `body` / `retired`, das Abreißen der `session_recalled`-Zeilen wurde eingestellt, die pill zeigt die Durchstreich-Notiz „als veraltet bewertet".
- Bereinigung der Bestandsreste beim Start (auf diesem Rechner gemessen: 725 Zeilen waren in `l1_fts` noch schmutzig); die Ausscheidens-Invariante deckt jetzt zwei Umwege-Schreibpfade ab (behebt „nach der Ungültig-Markierung in der Suchseite wieder auferstanden").
- Recall-Bepunktung Ende-zu-Ende: `-1..5` (0..5 Relevanz; `-1` erklärt veraltet und scheidet aus), die Bewertung fließt in die Reife-Metrik ein (`-1/1/2` drücken und versenken, `4/5` heben und lassen auftauchen).
- Workspace-Inhalts-Routing erstmals gelandet (dsh-Ökosystem → `rewrite-agently`, nicht dsh → `agent-no-dsh`; **nur `workspace_id` geschrieben, `scope` und `updated_time` unberührt**, und die Zugehörigkeitsspalten der `l1_fts`-Zeile mit synchronisiert).

### Disziplin

- Zwei überlange memport-Funktionen in zwei Runden aufgeteilt (Extract Function, Verhalten erhalten, byte-genaue Regression gegen den CLI-Goldstandard).
- Die Disziplin „Endpunkt-Vertrag an **fünf Stellen gleichzeitig** ändern" wirkt weiter (`MEMORY_ENDPOINTS ≡ switch ≡ contract-Doppel-map ≡ contract-keys-Zählung ≡ config`), Zählkette 55→56→57→58→59.

## [0.22.2] — 2026-10-12

### Hinzugefügt

- Haut in drei Zuständen (auto/light/dark) + Token-Override-Block; Panel mit 11 Tabs auf eine Zeile verdichtet.
- `ext_key`-Idempotenz für `memory_import` (`l1_records.ext_key` + partieller Unique-Index + `deduped`-Quittung).
- **Memport Connect**: `.mem`-Parsing / Vorfilter / Scan + Herkunfts-Registry + Connect-Tab (sha256-Goldstandard implementierungsübergreifend ausgerichtet).
- **Skill-Kristallisation**: skill-store (JSON-Sidecar) + Kandidatenerkennung + Skill-Abruf-Injektion + Schalter `skillsEnabled` im Board.
- G4 kausale Graph-Kanten (führt zu / weil / reparierte / ersetzt); `projectorVersion` wird nicht hochgezählt.
- G3 Reife-Ableitung beim Lesen (Badge auf der Eintragskarte + Notiz in der Ansicht zur Konflikt-Schlichtung, nicht an automatischen Schlichtungen beteiligt).
- G1 `usageScenario`-Gating Ende-zu-Ende (Extraktion → `metadata.dsh_usage_scenario` → Feinranking beim Abruf; off zeichengleich unverändert).
- G2 typ-spezifische Erzähltemplates (gefilterte Prompt-Variante; off ist Präfix von on).
- Die zwei Achsen wing / kognitiver Saal vermischen sich nicht (orthogonale Accessoren + Regressionssperre auf disjunkte Wertebereiche).
- **G-live aktive Abrufmenge dieser Sitzung**: persistenter Sidecar + schreibgeschützter Endpunkt `session-recalled` + schreibgeschützte pill-Liste.
- Sitzungsbezogene Projektion von `memoryRecall` (Datenquelle für den Abschnitt „Abruf in dieser Sitzung" in der brief-Seitenleiste, `init(header).id`).
- `cfg.slots.migrateLegacy` (standardmäßig aus): scheidet rule-Slots weich aus, die als permanente angepinnt sind, deren Inhalt inzwischen von lebenden L1-Einträgen getragen wird.

### Behoben

- Die Rückspülung durch Wiederkauen setzte die Anzahl offener Aufgaben zurück oder vermehrte sie (ruminate übergibt jetzt eine leere Nachricht, gleiche Semantik wie `enqueueSessionSlices`).
- finalize des Wiederkauens und `doLightRefresh`: erzwungener echter L3-Lauf + Zähler-Nullsetzung + `state.save()` auf die Platte (behebt „nach L2/L3-Wiederkauen nicht gelöscht und nach Neustart wieder da").

### Disziplin

- Alle neuen Fähigkeiten standardmäßig aus; im off-Zustand bleiben Erzeugnisse und Injektion zeichengleich unverändert. Die plugin-übergreifende Anzeigevereinbarung (`memorySlots`-Projektion) bleibt verdrahtet.

## [0.22.1] — 2026-10-09

### Behoben

- **Unterseite der Overlays undurchsichtig**: das Memory-Overlay in der Eingabeleiste (`.dsh-mem-popover`) sowie Drop-down- / Filter-Panels (`.dsh-mem-pop`) folgten vorher dem Wirtswert `--dsw-specific-menu`, den der Host als halbtransparenten Glaswert auflöst ⇒ das Panel ließ den Hintergrund durchscheinen. Jetzt liegt die Alias-Schicht auf einem **undurchsichtigen `bg-primary`-Grund** (underlay-Technik), wodurch das Panel unabhängig vom Alpha des Hosts solide wirkt.

## [0.22.0] — 2026-10-09

### Geändert

- **Deklarationsseite an 15rc angepasst**: die 9 dsh-peers decken alle veröffentlichten Host-rc ab (`0.1.0-rc.2..0.2.0-rc.2`, einzeln per `npm view` belegt und je Linie deckungsgleich), alle optional; `engines >= 0.1.0-rc.2` als grober Zaun (das präzise Tor sind die peers), `package.json` und `dsh.plugin.json` synchron.
- **Versionen der Doppel-Manifiste geradegezogen**: `dsh.plugin.json` war zuvor auf `0.20.0-beta.6-dsh0.2.0.1` weggedriftet; in diesem Batch zeichengleich mit `package.json` abgeglichen (V1-Tor).
- **`dsh.client.inject` auf `ui-primitives` only verkleinert**: `dsh-client-connection` existiert als Paket erst ab 0.1.2; es zu deklarieren würde den gesamten client-Einstieg auf 0.1.0/0.1.1 hängen lassen (`rpc.ts` holt sich diese Verbindung längst lazily über `ctx.get`).

### Disziplin

- Allen build-Typ-Repos `prepack: npm run build` eingegeben — `npm pack` löst nur prepack aus, nicht `prepublishOnly`; das ist eine der drei Verteidigungslinien gegen den stale-build-Irrtum.

## [0.19.0] — 2026-09-29

### Geändert

- **DSH-0.2.0-Adaption (compat/0.2.0)**: peerDependencies und engines.dsh (package.json + dsh.plugin.json) vollständig umgestellt auf `>=0.2.0-rc.1 <0.2.1-0` (einzelner Bereichsersatz; die 0.1.7-Linie wird weiterhin vom Zweig compat/0.1.7 bedient); die 9 dsh-* devDependencies exakt neu gepinnt 0.1.1-rc.2 → 0.2.0-rc.1 und die rein typische Abhängigkeit `@deepseek-ai/dsh-compaction` ergänzt. Codeebene Anpassung an die API-Drift des 0.2.0-Hosts: das Ereignis `agent/session-start` geht in `agent/created` auf (Listener auf async umgestellt, um den Serial-Vertrag zu erfüllen); das Lesen von Sitzungsereignissen wechselt von `session.events` zu `session.snapshotEvents()` (der Host hat synchrone Vollzüge als veraltet markiert, die Degradationskette bleibt erhalten); Test-Stubs nachgezogen (Offset-Semantik des Projektionscursors).
- **Release-Metadaten**: Version 0.18.4 → 0.19.0; publishConfig.tag `dsh-0.1.7` → `dsh-0.2.0`; dsh.plugin.json version → `0.19.0-dsh0.2.0.1`.

## [0.18.4] — 2026-09-28

### Hinzugefügt

- **Crash-Wiederherstellung (§A)**: Stürzte der Host mitten im Zug ab, ging dieser Konversationszug bislang mit dem In-Memory-Capture-Puffer für immer verloren (die Kaltstart-Grenze des Resume verwarf den gesamten Verlauf). Beim Resume gleicht das Plugin jetzt mit dem vom Host persistierten Ereignisprotokoll ab: der größte bereits in L0 geschriebene Zug dient als Wasserzeichen, die vollständigen Folgezugriffe werden nachgeholt (Obergrenze 2 Züge; Crash-Verwaiste Züge schließt der Host mit `turn/end{reason:'interrupted'}` — auf dieser Maschine 98 Fundstellen). Idempotenz = Wasserzeichen + Existenzprüfung pro Zug; stehen die Lese-Dienste des Hosts nicht zur Verfügung, Degradation in Stufen (`sessionQuery.readSession` → `sessionPersistence.readFrom` → bisheriges Verhalten + einmaliger Hinweis), durchweg fail-open und ohne den Sitzungsstart je zu blockieren.
- **Nutzdaten-Schwärzung (§C, `capture.redactSecrets`, standardmäßig an)**: an der Capture-Schreibgrenze werden 8 Klassen von Geheimnissen (PEM-Schlüssel / Authorization-Header / Bearer & JWT / Cookies / herstellerspezifische API-Key-Formen / E-Mails / Nummern ≥ 9 Stellen ohne Datum / IDs hoher Entropie) durch typisierte Platzhalter `[REDACTED:<KIND>]` ersetzt — eine einzige Engstelle deckt L0-JSONL, L0-SQLite, Destillationseingaben und manuelles `memory_add`/`memory_import` ab (beide L1-Schreibgrenzen teilen dasselbe Vokabular). Sichere Werte (`example` / `$VAR` / `${{…}}` u. a.) bleiben unangetastet; die Platzhalter bewahren die Kategorie und bleiben suchbar. Hinweis: nach Aktivierung ist der L0-Originaltext verändert (Wiederaufbau holt ihn nicht zurück); `false` schaltet mit einem Griff auf Klartext zurück.
- **Anti-Injection der Destillations-Prompts (§B)**: alle sechs Destillations-Prompts (L1-Extraktion ×3 / L1-Dedupe ×3 / L2-Szene ×2 / L3-Profil ×2 / Graphprojektion / Abgleicher) erhalten eine Gesamtdeklaration „Inhaltsgrenze (Anti-Injection)" samt Abgrenzung der Datensteckplätze — in Prompts eingebetteter Konversationstext, bestehende Erinnerungspools und Szenenvolltexte sind Daten, keine Anweisungen, damit instruktionsartiger Text aus Konversationen Destillation, Dedupe und Schlichtung nicht mehr entführen kann. Entscheidungsvokabular und Ausgabeverträge sind unverändert.

### Verbessert

- **Injektionsbestätigung (§D)**: die Abrufinjektion markiert nicht mehr im Rückkehrmoment als gesehen, sondern folgt dem zweistufigen Schema „pending → Protokoll-Beleg" — erst wenn der Host die Injektionsnachricht tatsächlich ins Sitzungsprotokoll schreibt (`user/message` mit Signatur `plugin:memory` und stabiler id), folgt das `dedupe.mark`. Überschriebene oder abgebrochene Injektionen drücken eine Erinnerung nicht mehr fälschlich (nächste Runde kann neu injizieren); ohne Beleg nach 5 Minuten wird auf die bisherige Markierung degradiert (damit ein Ausfall der Bestätigungskette nicht die Dedupe lahmlegt), ohne Bestätigung wird verworfen.
- **Gezielte Nachinjektion nach Kompression (§E)**: nach `compaction/end` (ohne Fehler) macht die nächste Runde der Sitzung einen verstärkten, gezielten Abruf — Dedupe-Unterdrückung wird übergangen (die Kompression hat die alten Injektionen bereits aus dem Kontext getragen), das Profil wird sofort neu injiziert, das Belegungsregister auf null gesetzt; Konsum = Löschung. Der bisherige vollständige Sitzungsreset bei compact/clear bleibt als Rückfallweg erhalten; beide Wege sind idempotent.
- **Strukturiertes Tracing (§F, `trace.*`)**: Abruf- und Destillationsereignisse landen als tägliche JSONL (`<dataDir>/trace/`, Aufbewahrung standardmäßig 14 Tage, Schreibstopp bei 5 MB/Tag + Marker). Das Abrufereignis enthält den Query-Fingerprint (standardmäßig nur Metadaten: Länge + sha256; erst `trace.captureContent` speichert den Originaltext ≤ 200 Zeichen), Treffer-/Injektions-ids, Scores, Laufzeiten und vier Ausgänge (injected/suppressed/timeout/off); das Destillationsereignis enthält runId, die Sechs-Werte-Entscheidungsaggregation (gleiche Quelle wie `l1_receipts`, gegenprüfbar), Laufzeiten und Ausgang. Neuer Endpunkt `dsh-memory/trace-tail`; der „Logs"-Tab der Einstellungsseite erhält eine Umschaltung zwischen drei Datenquellen: Systemlog / Abruf-Trace / Destillations-Trace.

## [0.18.2] — 2026-09-27

### Behoben

- **Anpassung an die Signatur des Sitzungsformats v4 (Host ≥ 0.1.7-rc.1)**: die beiden Erinnerungsinjektionen (`hooks/recall.ts` für den situationsübergreifenden Abruf, `hooks/slot-recall.ts` für die dauerhafte Slot-Injektion) nutzen nicht mehr die alte Signatur `source: { kind: 'plugin', plugin: 'memory', form: 'recall' }`, die der v4-Host zurückweist (sie löste einen `SessionFormatError` und damit das Scheitern des ganzen Zugs aus — die Quelle der „Fehler beim Gedächtnisaufruf"), sondern die Producer-eigene Signatur `{ kind: 'plugin:memory', form: 'recall' }`. `form`, Injektionsinhalt und -zeitpunkt bleiben unverändert. Beweisgrundlage: die `source()` von `@deepseek-ai/dsh-session-format-v3-to-v4@0.1.7-rc.2` prüft nur, dass kind nicht leer und ≠ `'plugin'` ist, ohne Begleitfelder zu validieren.
- **Doppelform-Verträglichkeit beim Lesen**: das Signaturkriterium `isOwnRecallSource` der Abrufanteil-Schätzung akzeptiert sowohl die neue Signatur als auch v3-Altzeilen — nur die Schreibseite zu ändern hätte die „Abrufanteil der Erinnerung" im Belegungspanel stillschweigend auf null fallen lassen (ohne Ausnahme, ohne Fehler). `MessageSourceMap` registriert `plugin:memory` per Modul-Augmentation (die Map von dsh-llm 0.1.7 ist `user|model|tool|'system-prompt'`, ohne plugin-Auffangbecken, pro Producer merge-erweiterbar).
- **Nativ-Adaption des tool-result v4 (N1)**: der Beweistext-Lesezug von `store/evidence-source.ts` erhält einen nativen Zweig (v4-eigene `role:'tool'`-Nachrichten: content direkt aus text/reasoning-Blöcken, `isError` auf Nachrichtenebene; der `assertBlock` des Hosts weist alte `tool-result`-Wrapperblöcke strikt zurück), der alte Blockabstiegspfad bleibt als historische Verträglichkeit erhalten — sonst blieben Beweistexte unter v4 stillschweigend für immer leer. Die isError-Wache von `projection/slots.ts` wird zugleich nativ.

## [Unveröffentlicht]

### Hinzugefügt

- **Aktive Slots (Active Slot) — die „Regeln, die bei jedem Zug gelten sollen", aus dem semantischen Abruf herauslösen und zu einem über Sitzungen hinweg dauerhaften Kontext machen.** Ausgang war ein echter Ausfall: Die allgemeine Netzregel (Uploads offiziell, Downloads über Mirror) stand zwar im Gedächtnis, wurde in der nächsten Runde aber **nicht abgerufen** — die alte Fehlgewohnheit lief weiter. Der semantische Abruf ist probabilistisch, genau solche Regeln brauchen aber Determinismus — daher ein mechanischer Kanal nur für sie.
  - **Speicherung**: `<dataDir>/slots.json`, getrennt von `state.json` (Slots sind häufige Kleinständerungen; die atomare Checkpoint-Schreibung darf nicht in ihre Takt gezogen werden), unter Nutzung des `atomicWriteJson` aus `util/io.ts`; im Speicher wird nur in-place geändert, `list()/open()/alwaysOn()` liefern ausnahmslos Kopien (Lehre aus den Live-Referenzen von `StateStore.reset()`).
  - **Drei Werkzeuge**: `memory_slot_write` / `memory_slot_list` / `memory_slot_close`. Schreiben und Schließen unterliegen der bestehenden Hochprivilegien-Schranke `live.memoryMutate` (standardmäßig aus) — Zustandswechsel sind strenge Risikosteuerung; das Lesen unterliegt dem Sitzungsmodus-Gating, gleiche Semantik wie `memory_search`. Der neue Registrar lebt in einer eigenen Datei, null Eindringen in `tools/index.ts` (1156 Zeilen).
  - **Dauerhafte Injektion**: `hooks/slot-recall.ts` registriert ein eigenes `agent/pre-step` (Wasserfall-Prepend), kombinierbar mit dem bestehenden `recall.ts` (die Reihenfolge der beiden Injektionen ist testfestgenagelt). Slots mit `pinned && open` werden nach priority absteigend sortiert und auf das Byte-Budget gekürzt; darüber hinaus wird mit `… und N weitere` ausdrücklich verwiesen und der Weg zum Zurückfinden genannt — **Kürzung ist nie stumm**. `validUntil` wird vor der Injektion durch einen mechanischen Abgleich zu `expired` (purer Zeitstempelvergleich, kein LLM), sonst wäre „Gültigkeit" nur Schmuck.
  - **Serverprojektion `memorySlots`**: registriert über `ctx.inject(['sessionProjections'])` — hat der Host diesen Dienst nicht, **wird still auf die Registrierung verzichtet**, statt den Ladevorgang der gesamten Profilzeile scheitern zu lassen. Der `apply`-Closure liegt `SlotStore` vor, Verschmutzung wird über `revision()` geurteilt: **nur bei `tool/result` (settled, ohne Fehler) und geänderter Revision neu bauen** (`tool/call` commited vor der `execute()`-Änderung des Stores — nach call gefaltet würde man Veraltetes lesen); irrelevante Ereignisse liefern **dieselbe Referenz**; `view` hält die Referenzstabilität mit `WeakMap` und **enthält keinen body** (Urteil und Erzeugung sind orthogonal, der Text wird bei Bedarf nachgefragt). Diese Runde enthält keinerlei Client-Code: die Darstellung bleibt dem nächsten Briefing überlassen.
  - **Schema ohne neue Abhängigkeit**: `stateSchema` / `viewSchema` implementieren `parse` selbst (das Runtime-Register ruft nur diese eine Methode auf); gültige Zustände werden **unverändert mit derselben Referenz** zurückgegeben, ungültige werfen; kein zod (`package.json` und Lockfile stehen nicht auf der Änderungsweißliste dieser Runde).
  - Grenzen: ≤ 8 Slots (konfigurierbar) / dauerhaft ≤ 2048 Byte / body ≤ 512 / Titel ≤ 60.
- **Herkunftsanker (R7) — Erinnerungen finden jetzt ihre **wirkliche Position** in der Sitzung zurück.** Bislang war die Provenienzkette unterbrochen: L1 trug `source_message_ids`, aber das waren **L0-Nachrichten-ids** (`msg_<epoch_ms>_<hex>`), und die L0-Tabelle hatte keine Spalten `turn`/`step`; zudem wurde diese id-Liste **gar nicht in die Suchbasis geschrieben** (die Schreibseite nahm nur `metadata`, das Feld fiel stillschweigend unter den Tisch). Ergebnis: **keine einzige Erinnerung ließ sich auf den Originaltext lokalisieren**.
  - `l0_conversations` erhält die Spalten `turn`/`step` (idempotentes `ALTER TABLE`; Altzeilen bleiben NULL = kein Anker, **nie rückwirkend raten**), dazu ein Index `(session_id, turn)`.
  - Die Capture-Seite erhält einen `step/start`-Fold: `user/message` trägt in der Kernlast **kein** `step`, es wird aus dem `step/start` desselben Zugs abgeleitet; `assistant/message` nutzt das vom Ereignis mitgeführte `{turn, step}`. **Nachrichten vor dem ersten `step/start` lassen das step leer** — fehlende Koordinaten werden nicht erfunden, das ist die rote Linie.
  - Der Anker liegt im reservierten Schlüssel `dsh_source_anchors` von `metadata_json` (UI-Anzeige als `t12 s3`). Keine Spalte dazu, kein Datenträgervertrag angerührt. **Sowohl der Neuerstellungspfad als auch „Zusammenführen/Aktualisieren" tragen den Anker** — sonst würde schon eine einzige Fusion die Koordinaten verlieren, und Fusion ist die häufigste Aktion langer Sitzungen.
  - Neue Host-Lese-Schnittstelle `MemoryDb.l0ByAnchor(sessionId, turn, step?)`: L0-Nachrichten **nach Koordinaten** (nicht nach Zeit) holen; der einzige Zugang für den späteren „Beweisleser".
- **Das Aufzeichnungs-Panel zeigt den Herkunftsanker** (bisher zeigte diese Zeile immer nur „-").
- **Beweisleser (R1) — die Anker in den Originaltext der Sitzung zurückverwandeln.** Der Originaltext läuft über den **Kernel-`ctx.sessionQuery`** direkt (`readSession` / `listEvents`), ohne auf einen HTTP-Endpunkt eines externen Index-Plugins zu warten: dieses Plugin ist ein Host-Plugin, hat den `ctx` selbst in der Hand und spart damit eine Prozessgrenze und einen Fehlerpunkt. Diese Runde liefert die **Funktionsschicht aus reinen Funktionen** (Assemblierung und echte Maschinenaufrufe: spätere Einträge).
  - **Beide Formen der Sitzungs-id werden durchprobiert**: im Index kommen `session_id` mit `session-`-Präfix und reine uuid vor; nur eine zu proben **übersieht stillschweigend 124 Sitzungen** (ohne Fehler — sie bleiben einfach unauffindbar).
  - `foldEventAnchors` nutzt beim Lesen **dieselbe Fold-Regel wie beim Schreiben**, damit geschriebene und gelesene Koordinaten dieselbe Semantik haben.
  - **Treue Projektion**: kein `stripCodeBlocks`, keine Längenkürzung, keine „lohnt-sich-zum-Merken"-Sichtung — **die Erfassung darf für Tokens sparen, die Beweissicherung nicht**. Der einzige behaltene Filter: „vom Plugin injizierter Kontext gilt nicht als Nutzerwort".
  - **Klassifizierbare Fehler** (Kern dieses Eintrags): `no-service` / `no-anchor` / `session-unreadable` / `anchor-not-found` / `timeout` / `error`. Die Trennung der ersten vier ist zwingend — wer „nicht lesbar" für „nie besprochen" hält, wird die Erinnerungen archivierter Sitzungen systematisch falsch beurteilen.

- **Erinnerungsrückzug (Soft-Delete) und geschlossene Bereinigungsschleife: Löschen heißt nicht mehr Datenverlieren.** Bislang war „Löschen" **physische Löschung** — ein Versehen ließ nur das manuelle Bergen aus den Faktenquellen `records/*.jsonl` übrig. Jetzt gibt es zwei Stufen: **die reversible ist Standard**, die irreversible muss ausdrücklich verlangt werden und bringt ihren eigenen Export mit.
  - **Rückzug (Soft-Delete)**: Haupttabellenzeile bleibt + `valid_to` wird geschlossen + Ersatzmarkierung geschrieben (reservierter `metadata`-Schlüssel `dsh_superseded`, mit Zeitpunkt / Grund / Urteil / id des Konfliktpaars); nur die Zeilen `l1_fts` und `l1_vec` werden gezogen. **Das SQL der Suchseite bleibt Wort für Wort unverändert** — keine Abfrage-Drift. Die drei Rückzugswege (Urteil verloren / durch Dedupe ersetzt `update`·`merge` / manuell gelöscht) **teilen sich dasselbe Primitiv**, sonst entstünde irgendwann die Inkonsistenz „ein Weg löscht noch hart" — die sich erst beim Unfall offenbaren würde.
  - **Endpunkte 33 → 38**: `records-retired` (Liste der zurückgezogenen) / `records-restore` (Wiederherstellen) / `cleanup-retired` (physische Bereinigung) / `snapshots-list` (Snapshot-Liste) / `snapshot-restore` (Rückspeisung aus Snapshot). Die drei Listen (Zuordnungstabelle in `contract.ts` / `MEMORY_ENDPOINTS`-Weißliste in `stats.ts` / Verteil-`case`) und die Endpunkt-Gesamtzähl-Assertion werden synchron aktualisiert — lässt man nur eine der vier Stellen weg, liefert der Endpunkt ewig 404, während das `catch` des clientseitigen `rpc` die Ausnahme still verschluckt und das Panel als Ganzes verschwindet.
  - **`memory_delete` zieht standardmäßig nur 1 Eintrag zurück** (bisher 3) und erhält einen **exakten** Pfad über `ids` (ohne semantisches Matching). Die alte Implementierung löschte in Batches per semantischem Top-N und hat praktisch **zwei belanglose echte Erinnerungen zu Unrecht gelöscht** — Treffsicherheit beim Löschen muss der exakte ID garantieren, nicht der Ähnlichkeitsgrad.
  - **Physische Bereinigung läuft standardmäßig als Probe**: fehlt `dryRun`, gilt `true`. Selbst bei expliziter Ausführung wird zuerst ein **Voll-Snapshot** der Basis geschossen und **per Inhalts-Hash** geprüft; bei Abweichung Abbruch, ohne auch nur einen Eintrag zu löschen. Dazu wird `deleteL1Batch` auf **genau einen Aufrufer** verdichtet (`exportThenPurge`) und durch einen Quellcode-Wachtest festgenagelt — „es gibt keinen physischen Löschpfad, der den Export umgeht" wird zur strukturellen Tatsache statt zur Absichtserklärung.
  - **Die Rückfahrkarte wird ergänzt**: `restoreL1Snapshot` wurde bislang **nur von Tests aufgerufen** — der Grundsatz „erst Export, dann Bereinigung" galt also zur Hälfte: der Export war da, die Rückspeisung fehlte; im Ernstfall blieb nur das manuelle Zerlegen von `l1-records.json`. Jetzt kommen `snapshots-list` / `snapshot-restore`: sie nehmen nur Snapshot-**Verzeichnisnamen** (Pfade und `..` werden abgewiesen), laufen standardmäßig als Probe und melden `stillRetired` ehrlich mit. Dieser Eintrag ist notwendig: die Bereinigung räumt nur **bereits zurückgezogene** Einträge weg, und der Snapshot entsteht **vor** der Löschung — alles Gefundene trägt also die Rückzugsmarkierung — **zurück in der Haupttabelle ≠ zurück im Abruf**; ohne diesen Hinweis hielt man die Wiederherstellung für abgeschlossen. Für echtes Rollback in einem Schritt: `unretire: true` (nutzt das bestehende `restore` wieder, kein neuer Schreibpfad).
  - **Panel**: die Aufzeichnungsseite erhält den Bereich „Zurückgezogen (wiederherstellbar)" (standardmäßig zugeklappt, erst beim Aufklappen wird geladen — er soll die normale Navigation nicht bremsen); der Bestätigungstext des Löschens sagt nun ausdrücklich „wiederherstellbar". **Die physische Bereinigung bekommt bewusst keinen Panel-Eingang** — eine irreversible Aktion bleibt auf RPC / Modellweg beschränkt.
- **§C Konflikt-Freeze: Konflikte im selben Batch lassen sich jetzt ebenfalls einfrieren (behoben: „gerade der Satzklang des Modells wurde an der Tür abgewiesen").** Die forensische Prüfung ergab, dass Punkt ③ von `validateConflictPair` verlangte, „die Gegenseite müsse ein bekannter Eintrag im Kandidatenpool sein" — die ids der neuen Erinnerungen desselben Batches sind dort aber nicht (sie entstehen in dieser Runde und sind noch nicht in der Basis). Somit fielen selbst korrekt emittierte `conflict`-Entscheidungen in dem typischsten Fall von „die Maschine kann nicht entscheiden" — zwei neue Erinnerungen desselben Zugs widersprechen sich — zwangsläufig zurück auf `store`. Beleg: das Modell emittiert in 7/7 Fällen, doch dieser Sprung erreichte nie die Basis (`conflict_pending` seit Erstellung 0 Zeilen, `l1_receipts` 0 `conflict`-Belege, daneben `store 381 / merge 204 / update 172 / skip 7`). Lösung: `validateConflictPair` erhält das optionale `batchIds` (fehlt = altes Verhalten), weiterhin mit der Forderung „exakt eine Seite ist die vorliegende Erinnerung" zur Eindeutigkeit des Paares; und eine Leitplanke für die volle Warteschlange — **gehört der Verlierer zu den neuen Erinnerungen der Runde, erfolgt keine automatische Erledigung**; sonst verließen frisch extrahierte Erzeugnisse umgehend die Bühne, ohne dass jemand davon erfuhr: dann wird nicht geparkt und der Eintrag in die Basis läuft normal weiter.

- **§C Der Konflikt-Freeze versteht jetzt die „drei Zeitachsen" — inhaltlicher Widerspruch mit zeitlicher Abfolge landet nicht mehr pauschal beim Menschen.** Erinnerungseinträge tragen von Haus aus drei nicht gegeneinander austauschbare Zeitachsen (Aufnahmezeitpunkt `createdAt/updatedAt`, faktische Gültigkeit `validFrom/validTo`, Dauerhaftigkeit `persistence`), doch die Konflikterkennung nutzte nur den Aufnahmezeitpunkt: Beim Urteil `conflict` sah der Detektor weder Gültigkeit noch Dauerhaftigkeit und hielt „ein alter Fakt, der vom neuen abgelöst wurde" oft für einen menschlichen Schlichtungsfall; auch das Schlichtungspanel zeigte nur die Texte beider Seiten — ohne Gültigkeitsvergleich blieb nur blindes Urteilen. Diese Runde schließt die drei Achsen an beide Enden des Freeze an:
  - **Detektionsseite**: der vereinheitlichte Kandidatenpool übermittelt dem Detektor **bei eingeschaltetem Freeze** `valid_from_ms` / `valid_to_ms` / `persistence` jeder Erinnerung; die Klausel der `conflict`-Aktion erhält eine „Hilfsentscheidung über drei Achsen" — bei Inhaltskonflikt zuerst Gültigkeit/Dauerhaftigkeit vergleichen; ist eine Seite bereits abgelaufen oder deutlich später, zu `update`/`merge` lenken statt `conflict`. **Alle drei Schlüssel und die Klausel stehen unter `conflictFreeze`-Gating**: im aus-Zustand ist der User-Prompt **byteweise identisch** mit dem vor dem Upgrade (siehe „Behoben" unten und [ADR-0012](./docs/adr/0012-conflict-3axis-advisory-time-axes.md)).
  - **Schlichtungsseite**: `ConflictPairView` erhält optionale Achsen-Felder `winner_*` / `loser_*` (rückwärtskompatibel); die Warteliste und das Rendern hängen jeder Paare den Vergleich „Gültigkeit von/bis, Dauerhaftigkeit" an, damit auf einen Blick erkennbar ist, wer jünger, wer bereits abgelaufen ist.
  - Die Maschine **entscheidet weiterhin nicht selbst**: die drei Achsen sind nur Hilfsfakten; die Schlussfolgerung schreibt weiterhin der Mensch (oder das Sicherheitsventil: Timeout / volle Warteschlange) — die Werte von `ConflictResolution` bleiben unverändert.

- **§C Drei Konfliktklassen + claim-Gruppierung + Verwurfspuren (Phase 3-4).** Der Konflikt ist nicht mehr nur die eine „harte Widersprüchlichkeit" — das LLM kann nun `hard` (sich gegenseitig ausschließende Fakten), `conditional` (Widerspruch nur bei anderen Voraussetzungen), `supersession` (das Neue ersetzt das Alte) unterscheiden. Das Panel zeigt nach den drei Klassen segmentiert, jede mit eigener Überschrift und Erläuterung; der `defer`-Knopf erlaubt „gesehen, aber noch nicht entschieden" (Timeout zurücksetzen, Blickwiederholungen zählen). Die Spalte `claim_key` erlaubt, mehrere Konfliktpaare zum selben Thema zu markieren, das Panel gruppiert danach. Verworfene, unzulässige Konfliktentscheidungen lassen sich über das Werkzeug `memory_conflicts_rejected` und den Endpunkt `dsh-memory/conflicts-rejected` abfragen.
  - `conflict_pending` erhält zwei Spalten `conflict_type` / `claim_key` (idempotente `ALTER TABLE`-Migration).
  - Die Quotenzählung zählt nur `hard`: `pendingHardTotal` filtert nach Typ; `conditional` / `supersession` verbrauchen keine Quote.
  - Projektions-Hash eingefroren: die 7-Feld-Spaltenprojektion `projectConflictsForHash` enthält die neuen Spalten nicht, die Prüfung vorhandener Snapshots bleibt unverändert.
  - Panel: `ConflictsTab` mit Drei-Klassen-Segmentierung + defer-Knopf + Drei-Achsen-Texten + Blickzähler + claim-Schlüsselanzeige.

### Behoben

- **Im aus-Zustand trugen Prompts heimlich drei Achsenfelder (betroffen: Deployments mit Standard).** Die erste Fassung injizierte `valid_from_ms` / `valid_to_ms` / `persistence` **bedingungslos** in den Kandidatenpool, während dieser LLM-Aufruf den Schalter nur für den System-Prompt las ⇒ bei `conflictFreeze=false` (Deployment-Standard) sah das Modell pro Kandidat 3 zusätzliche Schlüssel **ohne jede erklärende Klausel**: verschwendete Tokens und eine veränderte Eingabe. Die drei Schlüssel stehen jetzt unter `conflictFreeze`-Gating, der aus-Zustand liefert einen User-Prompt **byteweise identisch** mit dem vor dem Upgrade; das Kriterium steigt zugleich von „enthält Teilzeichenfolge nicht" auf **sha1-Golden-Anker + Rückwärtsprüfung** (bricht das Gating, muss der Test rot werden).
- **Das Panel sagte „Konflikt-Freeze nicht aktiviert", obwohl der Schalter klar an war.** Die Endpunkte `conflicts` / `conflict-resolve` lasen die **statische Deploy-Konfiguration** `cfg.conflictFreeze.enabled`, während das Panel in die **Laufzeiteinstellungen** (live) schrieb. Der Deployment-Standard ist stets `false` — der Schalter war an, in `settings.yaml` stand `true`, und die Seite meldete dennoch „aus". Umgestellt auf `effectiveCfg(cfg, live)`, dieselbe Auflösung wie die Dedupe-Pipeline — der Schalter hat nur **eine** Quelle der Wahrheit, Leser und Schreiber müssen auf denselben Zustand sehen, sonst ergibt sich „die Liste sagt an, die Schlichtung sagt aus", ein Selbstwiderspruch.
- **`dsh-memory/embedding-reindex` war deklariert und lieferte doch stets 404.** Der Endpunkt stand im Vertrag, fehlte aber sowohl in der `MEMORY_ENDPOINTS`-Weißliste als auch im Verteil-`case`; zugleich war `startReindex()` **toter Code** — der Block „Vektorindex" der Einstellungsseite bot daher nur „Abbrechen", nie „Starten". Weißliste + `case` + Tests ergänzt.
- **`UiRecord.sourceMessageIds` war ein totes Feld.** Es las aus `l1_records` eine **nie existierende Spalte**, fiel also stets auf `[]` zurück, und die Herkunftszeile des Panels **wurde nie gerendert**. Ersetzt durch `sourceAnchors`, das echte Daten liest.

## [0.17.0-dsh0.1.7.1] — 2026-09-25

> Erstveröffentlichung der **Host-0.1.7**-Kompatibilitätslinie (dist-tag `dsh-0.1.7`, aufbauend auf main @ 85d9b05). **Nur für Hosts ≥ 0.1.7-rc.1**;
> Hosts 0.1.5 / 0.1.6 sollten weiterhin die Versionslinie des Tags `dsh-0.1.5` nutzen. Inhalt = main vollständig + die folgende Adaption.

### Geändert

- **Laufzeitschalter ziehen in eine volatile Config-Sektion (0.1.7 deklarative Einstellungsfläche).** Der Host 0.1.7 hat beide Generationen der imperativen Registrierungs-APIs (`settings.register` / `installSection`) entfernt; die Laufzeitschalter (Gesamt/Capture/Destillation/Abruf, Destillationsroutenketten, Remote-Embedding-Übersteuerungen, Schreib-Lösch-Sperre — 20 Schlüssel) trägt nun eine ganze `.volatile()`-Sektion auf `memorySchema.live`: der Host projiziert volatile Felder automatisch in ein Einstellungsformular, und Laufzeitänderungen laufen über `ctx.settings.update` → configEditor → Profil-Patch → volatile-only-Commit des Loaders (ohne Plugin-Remount). Der `LiveSettingsHandle`-Vertrag bleibt unverändert, RPC und alle Konsumenten bleiben unberührt. **Eigene Einstellungsseite an Bord → das automatisch erzeugte Formular des Hosts ist abgeschaltet** (`suppressAutoSettingsForm`).
- **⚠️ Alte Einstellwerte migrieren nicht automatisch**: die `dsh-memory`-Sektion des alten `settings.yaml` hält flache Top-Level-Schlüssel, die zu den neuen `live.*`-Pfaden nicht passen (und ihr Boolescher `conflictFreeze` kollidiert mit der gleichnamigen Objektsektion des neuen Config), weshalb der Host-Importeur die ganze Sektion zurückweist. Nach dem Upgrade bitte die alten Werte von Hand in den Profil-Patch als `- id: dsh-memory / config: { live: {…} }` schreiben (Schlüsselnamen identisch mit dem alten Namespace, nur eine Ebene `live.` tiefer).
- devDeps auf den 0.1.7-Stack angehoben (cordis 4.0.4 / schemastery 3.18.4 / cordis-plugin-loader 1.0.5), ohne an Konsumenten ausgeliefert zu werden.

### Behoben

- **Regression des stillen Verlusts der Erstschreibung**: Lock-Dateien wurden vor der Schreibung angelegt; existierte das Elternverzeichnis des Ziels noch nicht, schlug `open('wx')` mit ENOENT fehl und die Stores verschluckten es als Warn → Erstschreibung still verloren. `rmwJson` macht jetzt vor dem Lock `ensureDir` (aus der Main-Linie übernommen).
- Enthält zudem alles aus der Main-Linie: Härtung der Dateischicht (atomare Schreibungen / Leseseiten-Klassifikation / Version fail-closed / Dateisperren / Pfadsicherheit — siehe die Einträge [0.16.1] und Unveröffentlicht).

## [0.16.1] — 2026-09-24

### Hinzugefügt

- **„Rückzugs-Sichtung" im Aufzeichnungs-Panel**: Soft-Deleted-Einträge bleiben der Absicht nach sichtbar (wiederherstellbar), aber gemischt mit aktiven Einträgen waren sie schwer auseinanderzuhalten — die Werkzeugzeile der Liste erhält nun einen dreistufigen Filter „**Alle / nur aktive / nur zurückgezogen**". Das Backend-`listL1` bekommt denselben dreistufigen Filter, gleiches Kriterium (Standard: alles; Snapshots/Rebuild unberührt; das Kriterium von `retired:true` und das von `listRetiredL1` sind dasselbe, beide Sichten zeigen dieselben Zeilen); Vertrag `ListRecordsRequest.retired?: boolean`. Die Sichtung greift nur auf dem Browsing-Pfad — die Schlüsselwortsuche deckt nur die Suchfläche ab, zurückgezogene Einträge sind dort ohnehin nicht. „Mehr laden" und die automatische Aktualisierung nach Löschen/Wiederherstellen bewahren den aktuellen Sichtungsstand.

### Behoben

- **Nach dem Bestätigen von „Erinnerung löschen" reagierte das Panel scheinbar gar nicht — der Rückzugszustand wurde nicht an die UI übermittelt.** Soft-Delete (retire) funktionierte serverseitig stets (`valid_to` geschlossen + aus der Suchfläche gezogen + wiederherstellbar), aber nach Absicht **behält** die aktive Liste die zurückgezogenen Einträge (der Test `l1-retire` nagelt „der Panel-Browsing-Pfad versteckt keine zurückgezogenen Einträge" fest), während der Vertrag `UiRecord` gar kein Feld „bereits zurückgezogen" hatte, die Zeilen der aktiven Liste ohne jeden visuellen Unterschied blieben und der Bereich „Zurückgezogen" standardmäßig zugeklappt war — nach der Bestätigung sah der Nutzer **einen haargenau gleichen Eintrag** und schloss selbstverständlich, „das Löschen hat nicht gegriffen".
  - Der Vertrag erhält `UiRecord.retired` / `retiredReason`: abgeleitet durch `hitToUiRecord` aus `valid_to` + Ersatzmarkierung, einheitlich an aktive Liste und Suchtreffer übermittelt.
  - Die aktive Liste rendiert zurückgezogene Einträge mit einem **Badge „zurückgezogen · Grund" + komplett eingegrauter Karte**, und der Inline-Knopf wechselt von „✕ Löschen" zu „Wiederherstellen" (über `records-restore`, mit automatischer Aktualisierung nach Erfolg) — im Moment des Löschens verändert sich die Oberfläche sofort, und die Verwirrung des zweiten Klicks (idempotenter No-op) entfällt.
  - Neuer `tests/ui-retired-flag.test.ts`, der die Zuordnung festnagelt (aktiv / manuell zurückgezogen / durch Ersatz zurückgezogen / Form ohne `validTo`).

## [0.16.0] — 2026-09-24

### Behoben

- **Die gesamte Wing-Markierungskette von Neukalibrierung / Ein-Klick-Rückfüllung war unbrauchbar**: der Prompt verlangte vom Modell `{"id":…,"wing":…}`, das Parsing las aber `item.hall` → nie etwas erhalten → der ganze Batch still verworfen **(praktisch gemessen: `wingLabeled=0 / tagged=0 / llmSkipped=60`, während das Log den LLM-Erfolg auswies)**. Dies ist der **3. Kollateralschaden derselben Art** seit der hall→Wing-Umbenennung (die ersten beiden: `cfg.hall`, das `hall` von session-modes) — JSON-Feldnamen in Prompts gehören zum **Drahtprotokoll** und dürfen Umbenennungen von UI-Texten nicht folgen. Das Parsing liest jetzt `wing` mit Enum-Validierung; **jeder Verwurf muss eine Logspur hinterlassen** (eine Warn für missglücktes id-Pairing, eine für ungültige Werte), der nie ausgelöste tote `catch` wird gestrichen.
- **`embedding-state-get` sinkt von 2,5–3,1 s auf Millisekunden.** Er führte je Aufruf 6 COUNT vor Ort aus, zwei davon in der Form `l1_records LEFT JOIN l1_vec … IS NULL` — `l1_vec` ist eine **vec0-Virtuelltabelle (1024 Dimensionen)**, die unter gewöhnlichen Prädikaten zu zeilenweisen Probes degeneriert. Ersetzt durch Subtraktion „Gesamt − bereits eingebettet − skip" (gemessen: L1 55 ms → 0 ms, L0 371 ms → 3 ms), dazu ein **gestufter TTL-Cache** (beschäftigt 1 s / ruhend 30 s + explizite Invalidierung bei Abschluss von Rebuild/Umschaltung/Auffüllung).
- **Der mechanische Teil der Neukalibrierung lädt nicht mehr alles auf einen Schlag** per `l1.all()`. Umstellung auf Cursor-Paginierung + nur die Spalten `id/type/metadata` (`getAllL1Lite`), mit Nachgeben nach je 200 Einträgen; das Zurückschreiben läuft über `patchL1Metadata` (**nur metadata, niemals der Text**, testfestgenagelt).

### Hinzugefügt

- **Room-Ebene: selbstwachsende Klassifikation nach Etiketten**. In den fünf MemPalace-Schichten liegt Room unter den Wing/kognitiven Halls und wird aus `metadata.tags` **dynamisch abgeleitet** (`json_each`-Aggregat, null Schema, null Register) — sobald ein neues Etikett in der Basis landet, wird es zum neuen Room. Neuer Endpunkt `rooms-get` und ein Room-Klassifikationsblock im Aufzeichnungs-Panel (Klick filtert nach dem Etikett; `list-records` erhält einen `tag`-Filterkanal). Auf dieser Maschine gemessen: **78 Rooms** (Aggregat in 2 ms).
- **Gemeinsames Validierungsmodul `src/metadata-validators.ts`**: `isWingId` / `isCognitiveHall` / `isTag` / `normTags` an einem Ort gebündelt. Bisher hatte die Wing-Seite **überhaupt keine Validierung** (jede nichtleere Zeichenkette durfte in `metadata.hall` geschrieben werden), während die kognitive Hall-Seite ein strenges `isCognitiveHall()` hatte — diese Asymmetrie der Enums war eine Lücke in der Datenintegrität.
- **Worker-Isolation der Hintergrundverarbeitung (enge Teilung von B)**: Herausziehen einer `MemoryBackend`-Grenze, die SQLite-Zugriffe der Hintergrundstapelverarbeitung (Rumination/Rückfüllung/Neukalibrierung) ziehen in `worker_threads` um und belegen nicht mehr die Haupt-Event-Loop des Hosts; scheitert der Start, Rückfall in den Prozess mit Warn (**das Scheitern der Isolation darf die Hintergrundverarbeitung nie wertlos machen**). Die heißen Pfade (Abruf/Capture) bleiben zeilengleich — sie fragen die Datenbank in jeder Runde; Threading würde sie die IPC-Steuer zahlen lassen.
- **Batch-Fortschritt nach Segmenten unterscheidbar**: mechanische Inspektion / Wing-Nachtrag / Etikettengewinnung bekommen je eigenes Label und eigenen Batch-Fortschritt (bisher hatte `sub` nur in der LLM-Phase einen Wert; während der 1439 Zurückschreibungen der mechanischen Phase blieb das Panel völlig leer).

### Geändert

- Das Zurückschreiben des Metadatas bei der Neukalibrierung wechselt von `l1.upsert` zu `patchMetadata`. **Nur das Metadata anzufassen hätte ohnehin nie das Embedding neu berechnen dürfen** — bisher lief bei jeder Zurückschreibung eines Eintrags ein Embedding, eine einzige Neukalibrierung konnte bis zu 900 Embedding-Aufrufe verschwenden.


## [0.12.0] — 2026-09-17

### Hinzugefügt

- **Manueller Neuaufbau des Vektorindex (Endpunkt `dsh-memory/embedding-reindex` + Block „Vektorindex" auf der Einstellungsseite)**. Bislang gab es für den Neuaufbau nur zwei Wege: die Änderungserkennungskette des `db.init` beim Start und die Lückennachfüllung des periodischen Backfills — **der Nutzer hatte keinen manuellen Zugang**. Auf der Einstellungsseite war nur „Abbrechen" zu sehen (und das nur während eines laufenden Rebuilds), weder „Starten", noch wie viele bereits eingebettet oder wie viele fehlten. Jetzt geschlossen:
  - **Endpunktfläche 31 → 32**. Neues `EmbeddingReindexStartResponse` (`{accepted:true}`), **Rückkehr bei Annahme, der Fortschritt läuft nicht hier** — der Client sondiert wie gehabt das `reindex`-Feld von `embedding-state-get`. Zwei Fortschrittssemantiken, die sich widersprechen, waren ein schwebender Unfall: bewusst bleibt nur eine. Die drei Listen (Zuordnungstabelle in `contract.ts` / `MEMORY_ENDPOINTS`-Weißliste in `stats.ts` / Verteil-`case`) und die Endpunkt-Gesamtzähl-Assertion werden synchron aktualisiert; fehlt nur eine der vier Stellen, liefert der Endpunkt ewig 404, während das `catch` des clientseitigen `rpc` die Ausnahme still verschluckt und das Panel als Ganzes verschwindet.
  - **`EmbeddingStateView` erhält `vectors`**: für L1 / L0 getrennt `embedded` / `total` / `missing` / `skipped`. Daraus wird „X eingebettet / Y gesamt". Der **`-1`-Sentinel der db-Schicht wird unverändert durchgereicht** — „Vektorfähigkeit nicht verfügbar" und „kein einziger eingebettet" müssen zwei verschiedene Sätze auf der Oberfläche sein; faltet man sie zu einer Zahl zusammen, klickt der Nutzer auf einen Knopf, der nie reagieren wird.

### Behoben

- **Rebuild-Anfragen ablehnen, die „angenommen werden, aber nie laufen"**. Die erste Zeile von `L1Store.reindex` / `L0Store.reindex` **verzweigte stillschweigend** auf `0/0/0`, wenn die Vektorfähigkeit nicht bereit war. Ohne Schwelle am Eingang hätte die UI angezeigt „Rebuild abgeschlossen, null nachzufüllen" — während die Wahrheit war, dass er **nie begonnen** hatte. Diese Falle stand schon als Kommentar bei `src/index.ts:240`, aber das deckte nur die Startkette ab; der manuelle Zugang war ein neues Einfallstor. `startReindex()` zieht nun alle fünf Schwellen nach vorn, jeder mit **handlungsorientiertem** Text: Plugin deinstalliert / Rebuild läuft bereits / Umschaltung der Embedding-Quelle belegt / **Embedding-Quelle ausgeschaltet** (`currentInfo` leer) / **Embedding-Dienst nicht bereit** („erst aktivieren" und „noch warten" sind zwei verschiedene Sätze, sie dürfen nicht zusammengelegt werden). Dazu bekommen beide Stores denAccessor `vectorsReady()` — der `helper` ist privat, von außen konnte niemand fragen.
- **Der `db`-Stub von `embedding-subsystem.test.ts` war unvollständig.** Er hatte nur `swapProvider` / `markEmbeddingSynced` und umging die Typenprüfung per `as never`, weshalb er nie entdeckt wurde; sobald `snapshot()` Vektorzählungen beilegte, explodierte er (`getVecSkipSet is not a function`). **Den Stub ergänzen statt `vectorCounts` defensiv zu machen**: die Typensignatur deklariert ein vollständiges `MemoryDb`; fehlende Methoden zu verschlucken versteckt auch echte Verdrahtungsfehler.

### Tests

- 5 neue Fälle: Ablehnung im aus-Zustand / Ablehnung wenn nicht bereit / Annahme und Antrieb von L1+L0 mit sofortiger Ablehnung eines zweiten parallelen Aufrufs / Ablehnung nach Deinstallation / Zählkriterien von `snapshot`. **Jeder Ablehnungspfad behauptet zugleich „Wurf" und „nachgelagerter Aufruf nullfach"** — nur den Wurf zu behaupten, und eine Implementierung, die „erst nachgelagert aufruft, dann wirft", würde trotzdem bestehen.
- **Gegenbeweis**: nach vorübergehendem Entfernen der Bereitschaftswache wurde `Vektorfähigkeit nicht bereit → Ablehnung, nicht „angenommen" lügen` tatsächlich rot (`expected [Function] to throw an error`), nach Wiederherstellung wieder grün.
- Gesamt **39 Dateien / 403 Fälle** grün; `typecheck` (drei tsconfigs), `build`, `smoke` ebenfalls grün.

## [0.11.0] — 2026-09-13

### Kompatibilität (adaptiert nach der Dokumentation des DSH-Plugin-Frameworks)

- **Multi-Versions-Kompatibilität der Settings-Registrierung (0.1.1-rc.2 ~ 0.1.5-rc.2)**. `src/settings.ts` **importierte als Wert** `settingsNamespace()` aus `@deepseek-ai/dsh-settings`, ein Symbol, das ab v0.1.3+ entfernt wurde — auf einem 0.1.3+-Host warf bereits das Laden des Moduls `Failed to load plugins` und riss den ganzen Plugin-Baum mit. Nun:
  - der Namespace ist das Zeichenkettenliteral `'dsh-memory'` (die Browser-Hälfte sieht nur den rohen String, zwischen alten und neuen Hosts äquivalent); nur der Typimport bleibt (bei der Kompilation getilgt, kein Laderisiko);
  - die Registrierung geht drei Laufzeit-Zweige: vorrangig `settings.register()` (auf allen Zielversion vorhanden, liefert get/watch/update-Scope, Live-Schalter und UI-Schreibungen laufen darüber); Rückfall auf die `settings.installSection()`-Brücke (Dienstfläche v0.1.2+, nur wenn register fehlt; Laufzeit-Schreibungen werfen ausdrücklich einen Geschäftsfehler); haben beide nichts, Degradierung zum Dauer-Ein — die eiserne Regel „fehlende Settings dürfen den Host nie zu Fall bringen" bleibt unangetastet;
  - `SettingsScope` wird zu einem lokalen strukturellen Typ, keine Abhängigkeit mehr von Paket-Typexporten.
- **Neu: `dsh.plugin.json`** (DSH-Entdeckungsmanifest: id / engines.dsh `>=0.1.1-rc.2 <0.2.0-0` / components zeigen auf `dist/`), ausgerichtet an der Standarddateistruktur von `dsh-plugin-template`.
- **`@deepseek-ai/dsh-*` zu optionalen peerDependencies und entspannten Bereichen** (`^0.1.1-rc.2 || ^0.1.2-rc.1 || ^0.1.3-rc.1 || ^0.1.5-rc.2`), `@deepseek-ai/cordis` bleibt Pflicht — ausgerichtet auf Anforderung B.3 der awesome-dsh-plugin-Einreichung.
- **Neu: `screenshots.json`** (8 Screenshots, verweisen auf `assets/img/`), die Einreichungskarte kann sie zeigen.

### Geändert

- `package.json` `version` steigt auf 0.11.0; npm `files` ergänzt `dsh.plugin.json` (`screenshots.json` lebt nach der Erkennungskonvention von awesome-dsh-plugin nur im Git-Repository, nicht im npm-Paket).

### Praxis-Tests ausstehend

- Auf v0.1.5-rc.2 ist die Semantik der Slots `conversation.input.left` / `settings.section` und von Session V3 `session.surface.nodes` (Occupancy-Schätzung) noch nicht im Feld getestet; siehe Kompatibilitätsmatrix im README.

## [Unveröffentlicht]

> 📘 **Handbuch der Stolpersteine und Lösungsrichtungen**: die in dieser und den beiden letzten Runden tatsächlich gestolperten Fallen und falsch eingeschlagenen Wege sind systematisch in
> [`ENGINEERING-NOTES.md`](./ENGINEERING-NOTES.md) niedergelegt (eine Schnellübersicht + je Eintrag „Symptom / Grundursache / richtiges Vorgehen / wie verifizieren"
> + Verifikationsliste vor der Auslieferung). Behandelt werden: `nullable`, das den ganzen Plugin-Baum zum Einsturz bringt, nicht injizierte deps, die von einer Fallback-Verzweigung verdeckt werden,
> doppelte Parser, die zwangsläufig verrotten, Wachen-Flags im `finally`, die gleichbedeutend mit keinem sind, Langläufer ohne `running`, weshalb die Oberfläche keinen Fortschritt zeigt,
> optionale Felder, die `tsc` nicht mehr auf undefinierte Bezeichner aufmerksam machen, Testdatenleere, die katastrophale Defekte verdeckt, `vitest`, das nur transpiliert und Vertragsdrift zulässt,
> Sandbox-`spawn EPERM` (darin: warum `ESBUILD_BINARY_PATH` nichts nutzt), PowerShell-Rohrfang, der die `tsc`-Fehlerzahl auf null drückt,
> Encoding-BOM/Zeichensalat/Zeilennummern-Versatz, sowie Git-Fallen wie `git amend -m`, das den Commit-Körper leert.

### Hinzugefügt

- **§E Speicher-Geltungsbereich `scope` (Sichtbarkeit, orthogonal zu `family`)**. Bislang teilten sich alle Projekte eine Erinnerungsbasis: die in Projekt A abgelagerten `work`-Erinnerungen wurden auch in Sitzungen des Projekts B abgerufen. Neue Konfiguration `scope` (`global` als Standard / `workspace`), **orthogonal** zum bestehenden `family` (Inhaltstyp) — `family` fragt „was ist das für ein Inhalt", `scope` fragt „in welchem Umfang soll er sichtbar sein"; alle vier Quadranten existieren. „Im `workspace`-Modus die `work`-Familie nach Arbeitsbereich isolieren, `chat` standardmäßig global" ist eine **Standardwert-Entscheidung, keine Ableitungsregel** (private Erinnerungen sollen projektübergreifend wirken; die Verschmutzungsfläche liegt genau zwischen Projekten).
  - **Null-Drift ist konstruktiv, nicht abgeglichen**: solange `cfg.scope` nicht `workspace` ist, liefert das vereinheitlichte `scopeFilterOf` stets `undefined` (= nicht filtern); kein Aufrufpunkt kann versehentlich eine Arbeitsbereichkennung hineinreichen. Bestehende Deployments (ohne den Schlüssel) verhalten sich **wortgleich** zu vor der Änderung.
  - **Die Isolation liegt auf derselben Ebene wie die Familienisolation**: nicht nur am Suchausgang — **der Dedupe-Kandidatenabruf** filtert ebenfalls. Der Kandidatenpool entscheidet über neue Dedupe-Entscheidungen; hier würden arbeitsbereichübergreifende Einträge „im Projekt B unsichtbar, aber bereits über den Verbleib der Erinnerungen des Projekts A entschieden" hervorbringen — schlimmer als gar keine Isolation ([`ADR-0008`](./docs/adr/0008-storage-scope-vs-family.md)). Der Graphweg filtert auf derselben Ebene nach der Zugehörigkeit des **Quelleintrags**; die Schreibpfade (Extraktionspipeline / `memory_add` / `memory_import`) teilen sich das gleiche `resolveRecordScope`.
  - **Die Arbeitsbereichkennung nimmt den kanonischen cwd, nicht die `WorkspaceId` (uuid) des Host-`dsh-workspace`**: gleicher Header-Kanal wie das `parentSession` aus §A, synchron verfügbar; ein deklarierter `inject` würde den Baum auf einem Host ohne diesen Dienst zum Absturz bringen; das Mitgliedschaftskriterium des Hosts selbst lautet ohnehin „kanonischer cwd des Sitzungsheaders == Arbeitsbereichspfad"; die uuid bräuchte „einen registrierten Arbeitsbereich", in unregistrierten Verzeichnissen versagte die Isolation stillschweigend. Bekannte Grenze: **symbolische Links werden nicht aufgelöst**, die Folge ist Über-Isolation (in die sichere Richtung), kein Leck ([`ADR-0009`](./docs/adr/0009-workspace-identity-source.md)).
  - **Die Migration etikettiert nur die Zugehörigkeit, ohne Umzug und Löschung**: `l1_records` / `l1_fts` bekommen je die Spalten `scope` + `workspace_id`, Bestandsdaten werden über den `DEFAULT` des `ALTER` direkt auf `global` gesetzt — Zeilenzahl, id, content, created_time wortidentisch.
  - **In der Ausführung zwei echte Probleme aufgespürt**: ① **die Rückfüllung des FTS-Neuaufbaus ohne scope ebnet die Isolation stillschweigend ein** (stimmen die Parameter von `backfillL1Fts` nicht mit dem Insert überein, wird es vom eigenen zeilenweisen `catch` verschluckt; Symptom: leerer Index mit `count=0`); ② **fehlende Formnormalisierung auf der Schreibseite → die Erinnerung geht hinein und kommt nie wieder heraus** (die Suchseite übergibt den normalisierten Kleinbuchstabenpfad, die Schreibseite speichert den Großbuchstaben des Aufrufers unverändert — der Zeichenketten-Gleichheitsvergleich kann nur scheitern). Beide durch End-to-End-Tests und Mutationsproben aufgespürt und behoben.
- **§F Graph-Knoten-Vektorspalte `graph_node_vec` (Lager- und Degradationsfundament)**. Der Graph hatte bislang nur lexikalisch gewichtete Bewertungen, keine Vektorspalte — **semantisch gleichwertige, aber schriftlich verschiedene** Entitäten wie „Wolken Tiefe" und „DeepRobotics" konnten sich nicht gegenseitig auflösen. Neue vec0-Virtuelltabelle **im selben Schema** wie `l1_vec` (dieselbe Kodierung, dieselbe `float[N] distance_metric=cosine`-Deklaration), deren Dimension das bestehende Fähigkeitserkennungsergebnis **wiederverwendet** — keine zweite Röhre.
  - **Degradation innerlich verdaut**: fehlt vec0, wirft die Tabellenanlage; stiege die Ausnahme bis zum äußeren `catch` von `GraphStore.init`, fiele der Graph von „Vektorweg nicht verfügbar" auf „**die gesamte Graph-Domäne nicht verfügbar**" — Lexiksuche, Projektion, Schlichtung, alles fiele mit. Die Vektorspalte trägt daher ein eigenes schmales `try/catch`. In aus-Gesetzen antwortet die Schnittstelle no-op, der Aufrufer muss nicht nach dem Fähigkeitsbit fragen ([`ADR-0011`](./docs/adr/0011-graph-node-vector-storage-and-degradation.md)).
  - **Diese Welle liefert nur das Tor, ohne Produzent und Konsument**: die Projektionspipeline ist noch nicht verdrahtet, um Embeddings zu berechnen. Ehrlich als unvollständig verbucht — sie ist der Beginn des §F, nicht sein Abschluss.
- **§B L1-Entscheidungsbelegkette (Infrastruktur der Nachvollziehbarkeit)**. Jeder L1-Eintrag in `memory.db` ist **das Ergebnis einer Dedupe-Entscheidung** (store / update / merge / skip), doch die Entscheidung selbst hinterließ keine Spur — im Nachhinein sah man nur „so sieht das Ergebnis aus", nie „woran es festgemacht war". Neue Tabelle `l1_receipts`: jede Dedupe-Entscheidung hinterlässt einen Beleg (`run_id` / `record_id` / `kind` / **sha256-Digest der geordneten Kandidatenpool-Folge** `input_digest` / `decided_at`), dazu das neue Werkzeug **`memory_receipts`** und der RPC-Endpunkt **`dsh-memory/receipts`** für die Rückverfolgung in zwei Dimensionen, je Eintrag oder je Batch (beide angegeben = UND). Der Beleg muss **vor** dem Ereignis existieren — der Eingabeschnappschuss lässt sich **nicht nachträglich ergänzen**, deshalb ist die Fähigkeit vorgelagert, ohne symptombasierten Auslöser ([`ADR-0006`](./docs/adr/0006-l1-decision-receipts.md)).
  - **Drei absichtliche Entwürfe für `input_digest`**: **reihenfolgeempfindlich** (der Pool ist geordnet; „welche Kandidaten sichtbar waren und in welcher Reihenfolge" ist gerade die zu rekonstruierende Eingabe), **Duplikate werden nicht gefaltet** (Duplikate im Pool sind selbst ein Fakt), **Längenvorzeichencodierung** (sonst kollidierten `['a|b']` und `['a','b']` — ist die Serialisierung nicht injektiv, verliert der Digest seine Fingerabdruckkraft).
  - **Aufbewahrungspolitik**: Ausdünnung nach **Run-Zahl** (`RECEIPTS_MAX_RUNS = 1000`) — ein Zeitfenster **liefert keine Obergrenze für Zeilen** (der Schwellwert ist unabhängig von der Schreibrate; ein Vielschreiber kann in 90 Tagen beliebige Zeilenmengen schreiben, das unbeschränkte Wachstum wäre nur **aufgeschoben**); die Ausdünnungsgranularität ist der Run, nicht die Zeile — Zeilenweise Ausdünnung würde „halbe Batches" schneiden und die Frage „was wurde in jener Runde entschieden" mit einer **scheinbar vollständigen, tatsächlich lückenhaften** Antwort beantworten; der Schaden ist **höher** als „nicht auffindbar".
  - **Rote Linie**: die Ausdünnung **fasst nur `l1_receipts`, niemals `l1_records`** — ersteres sind wegwerfbare Beobachtungsdaten, letzteres die Faktenquelle des Nutzers; um ein paar MB zu sparen die Erinnerung selbst anzufassen, verwandelt eine Kapazitätsoptimierung in einen Datenverlust.
  - **Fehlerisolation**: der Beleg ist ein Umweg-Bauwerk; sein Schreibfehler notiert nur ein `warn` und **bricht die L1-Destillation nie ab**.

- **§C Konflikt-Freeze (optional, standardmäßig aus)**. Bislang umfasste das **Entscheidungsvokabular** der Dedupe nur `store` / `update` / `merge` / `skip` — der „Konfliktdetektor" (`CONFLICT_DETECTION_SYSTEM_PROMPT`) stellte den Widerspruch fest und **das LLM entschied und schrieb direkt weg** (`update` zum Überschreiben oder `merge` zum Verschmelzen), **ohne die Option „anhalten und auf menschliches Urteil warten"**. Mit `conflictFreeze.enabled` erhält das Vokabular die Aktion `conflict`: urteilt das LLM „beide scheinen richtig, die Maschine kann nicht entscheiden", wird das Konfliktpaar in der Warteschlange `conflict_pending` **geparkt** — **die neue Erinnerung kommt ganz normal in die Basis, der Inhalt beider Seiten bleibt unangetastet**, und das neue Werkzeug **`memory_resolve_conflict`** (RPC: `dsh-memory/conflict-resolve`) übergibt das Urteil an die Person, mit den Schlusswerten `winner` / `loser` / `both`.
  - **Der Freeze ist kein „Schreibblock", sondern „kein Automatikurteil"** — ihn als Ersteres zu bauen würde Information verlieren, schlimmer als das Problem, das er lösen will.
  - **Sicherheitsventil**: `maxPending` (Warteschlangengrenze) / `timeoutDays` (Degradation durch Ablauf). Die Semantik lautet „**keine neuen mehr annehmen**", nicht „alte heimlich löschen": automatisch erledigte Paare **bleiben in der Warteschlange protokolliert**, mit `resolution` = `auto` zur Unterscheidung von menschlichen Schlüssen. Ohne Ventil sind zwei Folgen gewiss: unbegrenztes Warteschlangenwachstum; „zwei widersprüchliche Erinnerungen dauerhaft nebeneinander abgerufen" für immer in der Basis.
  - **Graphseite**: die Graphknoten, die die Quellen eines eingefrorenen Eintrags getroffen haben, werden als `disputed` markiert (bestehender Zustand, wiederverwendet; er bleibt in den Suchkandidaten — ein Zwischenzustand „normal abgerufen, aber sichtbar"). Die Markierung ist **abgeleitete Synchronisation**, kein Einweg-Stempel — die Schlichtung **hebt** den Streit auf; ein Einweg-Stempel ließe bereits geschlichtete Knoten für immer auf `disputed` stehen, und das wäre **der abgeleitete Graph, der lügt**.
  - **Null-Drift**: im aus-Zustand ist der Dedupe-Prompt **byteweise identisch** mit dem vorherigen — eine **konstruktive** Garantie (aus-Zustand macht direkt `return base`), kein manueller Abgleich ([`ADR-0010`](./docs/adr/0010-conflict-freeze-default-off-and-timeout.md)).

### Geändert

- **Neue Konfigurationen** `conflictFreeze.enabled` (standardmäßig aus) / `conflictFreeze.maxPending` (100) / `conflictFreeze.timeoutDays` (30, `0` = keine Ablauf-Degradierung); **neue Endpunkte** `dsh-memory/receipts` und `dsh-memory/conflict-resolve` (Endpunktfläche 26 → 28).
- **`L1ReceiptKind` erhält `conflict`**. Beim Erweitern eines Vokabulars müssen **alle Verbrauchsorte** geprüft werden (Beleg-Normalisierung, Statistik-Logs, Rendertexte, Schema-Beschreibungen) — im Praxislauf gemessen: ein fehlender Registereintrag führt dazu, dass „das Modell **ausdrücklich** sagte, es könne nicht entscheiden" als `skip_missing` (= „das Modell **hat nicht geantwortet") gebucht wird, während die gesamte Auditierbarkeit der §C-Schlichtung an der Belegkette hängt — das Auditurteil wäre **genau das Gegenteil des Sachverhalts** (schlimmer als ein fehlender Beleg: fehlen heißt „nicht gefunden", falsch heißt „gefunden, aber falsch").
- **`GraphStore.markSourcesDisputed` (Einweg-Stempel) → `syncDisputed` (abgeleitete Synchronisation)**: `active` und Quelltreffer → `disputed`; `disputed` und Quellen treffen nicht mehr → zurück auf `active`; `archived`-Grabsteine bleiben unberührt. Die Pipeline übergibt den **Gesamtsatz der Einträge aller unentschiedenen Paare des Augenblicks**, nicht nur das neue Paar dieser Runde.
- **Die Reihenfolge der Schlichtung ist Absicht**: erst `resolved_at` setzen, dann den Verlierer zurückziehen — umgekehrt würde man erst beim nächsten Klick merken, dass „der Eintrag verschwunden ist, während die Warteschlange ihn noch als unentschieden zeigt"; die Markierung nutzt `WHERE resolved_at = ''`, **eine zweite Schlichtung überschreibt nicht die erste Schlussfolgerung**.

### Tests

- **§B: 5 neue Testdateien** (Belegtabelle und Digest, Schreibpunkte und Fehlerisolation, Aufbewahrungspolitik, Zweidimensional-Abfragen, End-to-End-Rückverfolgung), inklusive **Mutationsprobe**: ersetzt man die Ausdünnungstabelle durch `l1_records`, schlägt der Rote-Linien-Fall tatsächlich fehl.
- **§C: 7 neue Testdateien** (Vokabular / Tabellenanlage / Schalter / Freeze-Semantik / Ventil / Schlichtung / geschlossene Schleife), alle nach TDD mit beobachtetem RED zuerst. Drei **unterscheidende** Kriterien sind erwähnenswert: `version===0` (trennt die store-Semantik von merge/update), das End-to-End-Ergreifen des tatsächlich von der Pipeline gesendeten Prompts (grüne statische Funktionen **beweisen nicht**, dass die Pipeline den Schalter weiterreicht), und die Mutation des `both`-Zweigs, die den Fall tatsächlich rot werden lässt.
- Insgesamt **34 Dateien / 341 Fälle**; die CI-Sieben-Ketten (`typecheck` / `test` / `lint` / `build` / `build:smoke` / `smoke` / `verify-catalog`) komplett grün.
- Geschlossene Schleife mit Belegen: zwei echte `runExtraction` (nur die LLM-Transportschicht gestubbet) → echter Schlichtungsendpunkt, das rohe JSON archiviert in `evidence/` der Planungsdomäne.

### Behoben

- **Nicht erkannte Aktionen wurden stillschweigend vom Fallback-Zweig geschluckt.** Die Anwendungsschleife von `pipeline/l1.ts` verzweigte nur explizit auf `store` / `skip`, **alles andere fiel in den update/merge-Zweig**. conflict-Entscheidungen tragen per Entwurf kein `target_ids`, also `targets=[]` → der Eintrag wurde als Fusionsprodukt „hat 0 Einträge ersetzt" angehängt und `version` auf `1` berechnet. **Kein Fehler, kein Verlust — die einzige Spur ist eine Versionszahl** — also „conflict still zu merge/update degradiert", exakt das Verhalten, das §C beseitigen wollte. **Lösung**: expliziter `conflict`-Zweig; bei gescheiterter Validierung oder ausgeschaltetem Schalter **Rückfall auf `store`**, nie in den Fallback-Zweig.
- **Der Endpunktwächter war eine handkopierte Kopie.** Das `ENDPOINTS` von `tests/contract-keys.test.ts` ist eine **manuell abgeschriebene Kopie** des echten Registers (`MEMORY_ENDPOINTS` aus `src/stats.ts`); seine zwei Assertionen waren nur innerhalb dieser Kopie stimmig (`ENDPOINTS.length === 26`). Als §B mit `dsh-memory/receipts` das echte Register auf 27 hob, folgte die Kopie **nicht**, die Zähl-Assertion blieb bei 26 — und „Assertion stimmt mit der Kopie, die Kopie nicht mit den Fakten" lief **durchgehend grün**; nach dem diesmaligen Hinzufügen von `conflict-resolve` **weiterhin komplett grün**. Der Wächter prüfte seinen eigenen Schatten: bei welchem getesteten System auch immer, er wird nie rot. **Lösung**: neue Assertion `expect([...ENDPOINTS].sort()).toEqual([...MEMORY_ENDPOINTS].sort())` — die lokale Liste muss **postenweise** mit der einzigen Quelle der Wahrheit übereinstimmen; die Zähl-Assertion bleibt als expliziter Wegweiser bei Änderungen.

- **Plugin-Baum-Ladefehler: das Ausgabeschema der Werkzeuge nutzte das DSL-unverträgliche `nullable`-Schlüsselwort** (Regressionsfix, ließ DSH vollständig nicht starten). Die Ausgabeschemata von `memory_ruminate` und `memory_ruminate_status` deklarierten `nullable: true` auf `startedAt`/`finishedAt`/`error`, während das Value-Schema-DSL von DSH nur eine Weißliste von Autorenschlüsseln akzeptiert (`description`/`title`/`default`/`examples`/`required`/`enum`/`const` und je Typ `type`/`properties`/`additionalProperties`/`items`/`oneOf`). Beim Schema-Kompilieren von `defineTool()` wurde `JsonSchemaError: schema.properties.startedAt.nullable is not supported by the value schema DSL` geworfen, der Loader bewertete den Eintrag `dsh-memory (dsh-prime-memory)` als gescheitert, das Anwenden des ganzen Baums brach ab und der Prozess schied mit unbehandelter Ausnahme aus.
  **Lösung**: die 4 `nullable: true` gestrichen. Semantik unverändert — in diesem DSL ist eine Eigenschaft standardmäßig optional; nur explizites `required: true` macht Pflicht; und die Laufzeitvalidierung überspringt `undefined`, sodass das von `execute` gelieferte `startedAt: undefined` weiterhin legal bleibt. Verifikation: `tsc` kompiliert + im dist-Artefakt kein Schlüsselwort mehr + neuer Werkzeug-Registrierungs-Regressionsfall.
- **Ruminate-RPC-Endpunkte allesamt unerreichbar: dem Controller wurden die Endpunkt-deps nie injiziert.** `dsh-memory/ruminate-status` lieferte stets `{supported:false,running:false,phase:'idle'}`, `ruminate-start`/`ruminate-cancel` warfen stets „Ruminate-Controller nicht initialisiert". Grundursache: `EndpointDeps.ruminate` war zwar deklariert und die drei Endpunkt-Implementierungen geschrieben, aber `registerMemoryRpc` injizierte bei der Deps-Zusammenstellung den Controller nicht — `deps.ruminate` blieb `undefined`, die Endpunkte wurden dauerhaft an den Degradationszweig genagelt.
  **Nutzer­sichtbarer Einfluss**: das Ruminate-Panel (`RuminatePanel.tsx`) macht bei `supported === false` ein komplettes `return null`, es stellte sich also als „Funktion nicht vorhanden" statt als Fehler dar — deshalb blieb der Fehler so lange unbemerkt; nach dem Fix rendiert das Panel zum ersten Mal wirklich.
  **Lösung**: die Deps-Zusammenstellung wird zur testbaren Naht `buildEndpointDeps()` extrahiert (einziger Besitzer), die den Controller ausdrücklich ins `ruminate`-Feld schreibt; `rebuild`/`embedManager`/`sessionInfo` laufen dadurch exakt denselben Injektionspfad wie `ruminate`, kein zweiter Positionsparameter mehr.
  **Verifikation**: nach Stub-Injektion liefert `dsh-memory/ruminate-status` `supported !== false`.

- **Rumination zwingend abgestürzt: `pending.json` wurde doppelt geparst, ohne `buckets` auszupacken, `TypeError: messages is not iterable`**. Der `RuminateController.start()` behauptete `JSON.parse(readFileSync(file))` über sein eigenes `readPendingBuckets()` direkt als `PendingBuckets` (`{auto,chat,work}`), doch die echte Datenträgerform ist `PendingFile` (`{version,buckets:{auto,chat,work},warmup}`) — **es fehlte das Auspacken einer `buckets`-Schicht**, also blieb `buckets[mode]` stets `undefined`, und das `for (const m of messages)` in `groupPendingBySession` warf.
  **Nutzer­sichtbarer Einfluss**: **diese Funktion hat nie ein einziges Mal funktioniert**. Der Fehler wurde nur beim „Datei nicht vorhanden" vom `catch` in leere Bucket-Pfade geführt; doch `persistPending` schreibt diese Datei in jeder Runde, also scheiterte ein Klick auf Ruminate in jeder echten Bereitstellung mit Puffer, das Panel zeigte Rot. **Achtung, gegen die Intuition**: das Werfen hat **nichts** mit dem Bucket-Inhalt zu tun — leere Buckets warfen genauso; das bisherige Urteil „drei leere Buckets, deshalb nie sichtbar" war falsch, der wahre Grund war, dass die Rumination nie ausgelöst wurde (`memory.log` trägt kein `反刍开始`).
  **Lösung**: `readPendingBuckets()` und `readFileSync` gestrichen, stattdessen wird das `loadPending()` aus `store/pending.ts` wiederverwendet — die **einzige Autorität** der Bucket-Form, die gratis Formvalidierung, zeilenweise `Array.isArray`-Prüfung je Bucket, Zählung verworfener `isMessage`-Schlechtzeilen, Gruppierung des Altformats `LEGACY_SESSION` und `warmup`-Validierung mitbringt. **Kein zweiter Zugang in `pending.ts`** (genau das war die Ursache des Defekts: zwei Implementierungswege derselben Semantik, von denen einer verrottet und niemand bemerkt es).
  **Verifikation**: neuer Controller-Testfall, erst rot dann grün (rot: `TypeError: messages is not iterable` @ `pending.ts:104` ← `ruminate.ts:75` ← `:139`; grün: `total` == Zahl der Sitzungsgruppen, `mode` aus Bucket-Schlüsseln abgeleitet); `dist/pipeline/ruminate.js` enthält kein `readPendingBuckets` mehr.
- **Nach Ruminate-Fehlschlag widersprachen sich Zustand und Oberfläche.** Der Fehlerpfad schrieb nie `this.status` (Original `:149-155` wies nur auf dem Erfolgspfad zu), also lieferte `ruminate-status` weiterhin `phase:'idle'`/`error:null` und der `failed`-Zweig der UI leuchtete nie — der Nutzer sah die rote Fehlermeldung, der Statusendpunkt behauptete alles in Ordnung. **Lösung**: im `catch` werden `phase:'failed'` und `error` geschrieben, mit `logger.warn` vor dem Weiterwerfen.
- **Ruminate-Fortschritt und -Ertrag stets 0, dadurch war die Wirkung der Fixes nicht beurteilbar.** `totalL1` wurde nur deklariert/genullt/gelesen, **nie akkumuliert**; `status.done` hatte keinen Inkrementpunkt, also blieb `recordsBuilt` stets `0` und das Abschluss-Log lautete immer `0/N Sitzungen, 0 Einträge erzeugt`. **Lösung**: `PipelineTask` erhält einen Abschluss-Rückruf `onDone` (in `drain` aufgerufen, eine Rückruf-Ausnahme beeinträchtigt die Pipeline nicht), `enqueue` führt `onTurnDone` heraus, die Rumination akkumuliert darüber echte Eintragszahlen; `doEnqueue` setzt beim Abschluss `status.done = index`.
- **Drei stillschweigende Fehlerpunkte**: das `catch` von `loadPending` und das `.catch(() => {})` von `doLightRefresh` pressten „Datei nicht vorhanden (normal)", „unlesbar/beschädigt (warnenswert)", „Form unpassend (warnenswert)" in dieselbe stille Degradation, im Log und Status nicht vom „leichten Refresh eines legitim leeren pending" unterscheidbar — der Nutzer sah `phase:'done'` und hielt es für Erfolg. **Lösung**: `loadPending` unterscheidet `ENOENT` (stillschweigend) vom Rest (`warn` mit Dateipfad und Grund), unpassende Form ebenfalls `warn`; `doLightRefresh` wird `await` und **setzt das Flag erst nach Erfolg auf null** (zuvor wurde es auch bei Fehlschlag genullt — man verschluckte damit die Wiederholchance).
- **Während des „leichten Refreshs" der Rumination: Falschmeldung „inaktiv", kein Fortschritt, kein Abbruch** (Nutzerpraxis-Rückmeldung). `start()` machte bei keiner pending-Scheibe `return await this.doLightRefresh()`, und dieser Zweig **setzte nie `running`** — währenddessen lieferte `ruminate-status` weiterhin `phase:'idle'`/`running:false`. Doch das L2/L3 hier ist ein **echter LLM-Aufruf** (gemessen über 70 Sekunden je Aufruf); `start()` blieb am Await hängen und belegte die Wache.
  **Nutzer­sichtbarer Einfluss**: nach dem Klick gab es nur einen statischen Satz, **keine Fortschrittsleiste, kein Abbruchknopf, keine Phase, keine Dauer**; ein erneuter Klick ergab „Rumination läuft bereits" — korrekt, aber ohne jede Information, unmöglich zu sagen, ob es läuft oder hängt.
  **Lösung**: der leichte Refresh **meldet ehrlich** — registriert `total` nach der Zahl der wartenden L2/L3-Familien, erhöht `done` schrittweise, erhält `RuminatePhase='refreshing'` und ein `detail`, das die laufende Aktion beschreibt (z. B. „L2-Szenenkonsolidierung (chat)"); das Abschluss-Log wechselt von stumm zu `Leichter Ruminate-Refresh beendet: 2/3 Schritte, 84 s`. Das Panel zeigt Phasennamen, `abgeschlossen/Gesamtschritte (Prozent)`, **verstrichene Echtzeit** und die laufende Aktion und behandelt `refreshing` als Laufzustand.
- **Keine verstrichene Zeit während der Rumination angezeigt**: ein einzelner L2/L3-Aufruf kann Minuten dauern; nur „läuft" zu zeigen unterscheidet nicht „läuft" von „hängt". **Lösung**: während des Laufs wird sekündlich neu berechnet und `verstrichen X min Y s` angezeigt.

### Geändert

- **`RuminateStatus` erhält `detail`; `RuminatePhase` erhält `refreshing`**: Beobachtbarkeit für minutenlange Schritte (rückwärtskompatibel: optionales Feld + neues Union-Mitglied). `detail` nennt in der Destillationsphase „Sitzung <id> (i/N)", in Abschluss-/Refresh-Phase die laufende L2/L3-Aktion.
- **`DshMemoryRequestMap` ergänzt die drei Ruminate-Schlüssel** (Vertragsfix, stellt die CI-Typenschranke wieder her): die Antwortzuordnungstabelle deklarierte längst `dsh-memory/ruminate-status|start|cancel`, und `DshMemoryEndpoint = keyof DshMemoryResponseMap` nahm sie damit in die Endpunkt-Union auf; aber der **Anforderungstabelle fehlten die drei Schlüssel** — das `DshMemoryRequestMap[K]` in `client/src/rpc.ts` meldete `TS2536`, `tsc -p tsconfig.client.json` scheiterte stets, **der `npm run typecheck` von CI rotierte garantiert**. Gefixt mit drei Zeilen `Record<string, never>` gleicher Form wie `rebuild-*` (keiner der drei Endpunkte nimmt Eingaben). Verifikation: alle drei tsconfigs exit 0, die vollständige Kette von `npm run typecheck` exit 0.
- **`registerMemoryRpc`-Deps-Zusammenstellung zu `buildEndpointDeps()` extrahiert**: testbare Naht für „welcher Controller fällt in welches Feld", mit dem Typ `EndpointDepsInput` zur Begrenzung der Injektionsfläche, sodass fehlende Injektionen bereits zur Kompilationszeit sichtbar werden (dieser Defekt war zuvor eine stillschweigende Laufzeit-Degradation). `handleEndpoint` und `EndpointDeps` werden mitexportiert, für direkte Testaufrufe.
- **Startsperre `starting` für die Rumination**: `loadPending` erzeugt zwischen Wache und `status.running`-Setzung einen Event-Loop-Übergabepunkt; Doppelklick/Rapidfire-RPC können die Wache doppelt durchdringen und zwei `sessions` überschreiben sich gegenseitig. Ein neues Flag schließt das Fenster. **Achtung**: das Flag wird am Ende des distilling-Zweigs ausdrücklich zurückgesetzt, nicht im `finally` — denn `doEnqueue` reiht asynchron ein, ein `finally` würde das Flag sofort löschen und die Wache entwerten; die über `await` hinweg dauernde Wache ist `status.running`.

### Tests

- Neue „Controller-Endpunkt-Injektionswachen" der RPC-Schicht, 5 Fälle: für beide Familien `rebuild` und `ruminate` je „zusammengesetzt → status/start/cancel erreichbar" und „nicht zusammengesetzt → status degradiert, start/cancel meldet nicht initialisiert", dazu der Speicher-Degradationswachen-Zweig von `rebuild-start`. Beide Familien teilen dasselbe Muster (optionaler Controller + Degradationsantwort + Deps-Injektion); `rebuild`, dessen Injektion schon korrekt war, dient als Vergleichsgruppe, um die Musterform festzunageln. Testfälle 194 → 199.
- Neue `tests/ruminate.test.ts`, 5 Fälle, festnagelnd **den echten Lesepfad des Controllers**, einen bis dahin null abgedeckten Vertrag: drei Buckets mit echten Nachrichten → kein Wurf, korrektes `total`/`mode`; handgeschriebenes JSON in Datenträgerform (**ohne `savePending`-Hin und Rück**, damit nicht beide Seiten sich gleichzeitig falsch ändern und trotzdem bestehen); drei leere Buckets → leichter Refresh; fehlende Datei → leichter Refresh (ENOENT als Normalweg); parallele `start()`, nur einer geht durch. Testfälle 199 → 204.
- **Nebenbei 10 bestehende Lint-Fehler in `tests/` bereinigt** (unbenutzte Imports/Variablen, `require()` zu ESM-Top-Imports, stets wahre Bedingungen), damit `lint` `tests` umfassen kann. **Bisher lag das Testverzeichnis vollständig außerhalb des Lints.**
- **`npm test` und `npm run lint` erstmals in CI eingebunden**: `.github/workflows/ci.yml` lief nur `typecheck → build → build:smoke → smoke → verify-catalog` und **hatte nie Tests ausgeführt** — Tests schreiben ohne CI ist gleichwertig zu gar keinen. Die Schranke ist jetzt drin.

### Bekannte Grenzen

- **Die Typenschranke von `tests/` ist nur teilweise geöffnet (Ratchet)**: neues `tsconfig.test.json` in `npm run typecheck` aufgenommen, aber da 8 bestehende Testdateien rund 60 Typfehler tragen (versetztes `MemoryConfig`-Modul, `DistillBudgets` ohne `graph`, `UserMessage.turn`, Zuweisung nur-lesbarer Arrays, viele nackte `as` in `rpc.test.ts` u. a.), sind derzeit nur `tests/ruminate.test.ts` und `tests/stores.test.ts` einbezogen. Siehe `pending-issues.md` P8 — **das zeigt, dass die Tests von den Typverträgen abgedriftet sind und vitest nur transpiliert ohne zu prüfen; daher lief alles grün, ohne dass jemand es bemerkte**.
- **Die Rumination hat eine Doppel-Wahrheitsquelle auf Datenträger und im Speicher**: die Sitzungsliste stammt aus der `pending.json`-Datei, doch die echte Extraktion nimmt in `runner.ts:667` die Nachrichten aus den **Speicher-Buckets** je `sessionId` — das übergebene `session.messages` beeinflusst das Ergebnis also nicht. In der Fensterzeit sind verpasste Destillationen oder Leerläufe möglich (`total` aufgebläht). Empfehlung: der Runner soll eine schreibgeschützte Speicheransicht aussetzen, siehe `pending-issues.md` P9.
- **Abschluss-Wettlauf der Rumination**: die `setImmediate`-Kette wartet nicht auf die geleerte Warteschlange, schon eine einzelne Session löst sofort `finalize` aus und lässt L2/L3 gegen veraltetes L1 umsonst laufen (Einträge werden später über `l1.ts:264` nachkonsolidiert, **nicht verloren**). Siehe `pending-issues.md` P10.
- **Ein laufender LLM-Aufruf während der Rumination ist nicht abbrechbar**: „Aufräumen abbrechen" stoppt erst **nach Abschluss des laufenden Schritts**. Ein L2/L3 kann Minuten dauern — daher die Verzögerung des Abbruchs.

## [0.10.0] — 2026-09-06

### Hinzugefügt

- **Wissensgraph-Projektion** (rekonstruierbare Projektion von L1; beantwortet „welchen Zustand haben Personen/Projekte/Organisationen/Werkzeuge/Orte aktuell"): die aus der L1-Destillation stammenden Einträge werden stapelweise dem Modell zur Vorschlage von Entitäten und gerichteten Beziehungen vorgelegt; `applyGraphProjection` validiert hart vor dem Schreiben — **null fakten ohne Quelle**: die `sourceRecordIds` jedes Knotens/fakts/der Kanten müssen vollständig zu den vom Batch beanspruchten Einträgen gehören, stapelfremde Vorschläge werden ganz still verworfen, und jede Graphkonklusion lässt sich über `Knoten → sourceRecordIds → L1-Einträge → JSONL-Faktenquelle` zurückverfolgen. Entitätsdisambiguierung (NFKC-Normalisierung + Vereinigung bei gleichem Typ, Alias-Akkumulation), Zustandshistorie (supersede + validTo-Schluss, `currentState` nur aus aktiven Fakten wiederaufgebaut), vierstufige Zeitanker-Kette (`activity_start_time → activity_end_time → timestamps → createdAt`, ohne Beleg kein eratenes Datum). Die Graph-Tabellenfamilie kann jederzeit gedroppt und neu errichtet werden, sie dient nicht als Faktenquelle.
- **Projektionsaufgaben-Warteschlange** (GraphStore, unabhängige Degradation: schlägt die Initialisierung fehl, wird nur der Graph no-op, ohne den Hauptspeicher anzustecken): persistierter Job-Zustandsautomat pending → running → completed/dead, Dedupe ins SQL gepusht (in-Bearbeitung-Mapping + Projektionsregister, zwei Indextabellen, kein Vollscan aller Jobs); keine Prioritätsinversion (neue Destillation 10000 > Bestandsnachprojektion 100); attempts gedeckelt → dead, `nextAttemptAt` mit exponentiellem Backoff, Startrecovery running→pending; nach `deleteL1Batch` Löschausbreitung (Knoten/Kanten mit sämtlich ungültigen Quellen werden träge als archived markiert). LLM-Aufrufe treten nie in eine Transaktion ein (claim und complete sind zwei Transaktionsnähte; complete committet atomar in einer einzigen).
- **Graphsuche und Werkzeuge**: feldgewichtete Suche (name×6/aliases×5/tags×5/currentState×4/facts×4/relations×3/type×2), Filter für Adjazenzrauschen, wenn nur Beziehungswörter treffen, erklärbare Ausgabe mit `matchedFields` + `matchReason` auf Chinesisch; neue Werkzeuge `memory_search_graph` (kompakte Knotenkarten) und `memory_expand_graph_node` (facts vollständig mit Historie + Beziehungskanten), unter derselben Modus-/Injektions-Leseverweigerung wie `memory_search`, und nach Sitzungsfamilie gefiltert (der reine Modus sieht nur von seiner Familie abgeleitete Knoten).
- **RPC-Endpunkte 24 → 26**: `dsh-memory/graph-search` (Suche) und `dsh-memory/graph-node-get` (Detailausklappung; hängende id liefert `node=null`, ohne zu werfen); Vertrag mit einziger Wahrheitsquelle synchron, die generische Aufruffläche des Clients erhält die neuen Endpunkttypen ohne jede Änderung automatisch.
- **Budgetschlüssel-Erweiterung**: `DistillBudgets` erhält den Schlüssel `graph` (Standard 8000, in der Graphzeile der Einstellungsseite editierbar); `layerKeyFor('graph')` kehrt ausdrücklich zur globalen Auflösung zurück, fällt nie in die l1-Ebenenkette; die Kosten der Graphprojektion gehen in Gesamtsumme und Modellgruppierung ein, aber nicht in die l1→l2→l3-Schichtungstabelle und die Trends (Umweg-Exemption).

### Geändert

- **Neue Konfiguration**: `config.graph.enabled` (Deployment-Ebene, Standard **false** — selbst eingeschaltet muss zusätzlich der Laufzeit-Destillationsschalter wahr sein; Pumpen-Leitplanke: höchstens eine Graphaufgabe je Drain, stets Vorfahrt für Echtzeit-Destillationsrunden).
- Plugin-Version 0.9.0 → 0.10.0 (Änderung der Endpunktfläche).

## [0.9.0] — 2026-09-01

### Hinzugefügt

- **Hall-Grobklassifikationskanal**: eine Grobattributebene orthogonal zu `family`/`type`. `types.ts` definiert `HALL_CATALOG` (einzige Quelle der Wahrheit: die Hauptlinie `work`/`relationships`/`general` standardmäßig aktiv, die experimentellen `finance`/`journey` mit `experimental`-Marke); `config.hall.enabled` steuert, welche Halls an der Markierung teilnehmen. In der L1-Extraktionsphase wird `metadata.hall` nach der Aktivliste automatisch etikettiert (bei unklarer Zuordnung wird das Feld weggelassen, ohne General zu erzwingen); der Vertrag `ListRecordsRequest.hall` und `UiRecord.hall` wird erweitert, der Erinnerungsbrowser erhält ein Hall-Filterdropdown und die Karten ein Hall-Abzeichen.
- **Laufzeitübersteuerung des Remote-Embeddings**: `baseUrl`/`apiKey`/`model`/`dimensions` des Embeddings werden **auf der Einstellungsseite editierbar** und übersteuern zur Laufzeit das Deployment-YAML (`effectiveCfg` injiziert den `cfg.embedding`-Teilbaum, unabhängig vom llm-Kanal); `EmbeddingManager` erhält `getEff()`, um die nach der Übersteuerung wirksame Konfiguration zu lesen, sodass das Editieren auf der Einstellungsseite sofort greift.
- **Schreib-/Löschwerkzeuge mit hohen Privilegien**: Registrierung von `memory_add` (explizites „merk dir X" → schreibt direkt einen L1-Eintrag in die Basis, optionales `hall`) und `memory_delete` (Löschen nach semantischem Suchtreffer, höchstens 10 Einträge), beide unter der Sperre `live.memoryMutate` (Hochprivilegien-Modus der Einstellungsseite); der Erinnerungsbrowser erhält einen Hochprivilegien-Schalter (mit Doppelbestätigung) und einen Einzel-löschen-Knopf.
- **Mehrsprachige Dokumentation** (ausgerichtet an `multilingual-docs-skill`): `README`/`INSTALL`/`CHANGELOG` in `zh`/`en`/`ja`/`ko` abgedeckt, mit Sprachumschalt-Verlinkung am Kopf jeder Seite (in der Muttersprache geschrieben), die `ja`/`ko`-Seiten mit DSH-Kompatibilitätshinweis.
- **Werkzeugkette**: Anbindung von ESLint 9 in flacher Konfiguration und Vitest, neu `npm run lint`/`npm run test`, dazu die ersten Unit-Tests für `HALL_CATALOG` und den Hall-Extraktionsprompt.

### Geändert

- **`apiKey` des Remote-Embeddings wird optional**: Annahme selbst gehosteter `/embeddings`-Dienste ohne Schlüssel (`remoteCeiling` erzwingt kein `apiKey` mehr); ohne Schlüssel wird kein `authorization`-Header injiziert, damit ein leerer `Bearer` nicht abgewiesen wird.

### Behoben

- Das Remote-Embedding sendet bei leerem `apiKey` keinen leeren `Bearer`-Header mehr.

### Bekannte Grenzen

- Die Konstruktionsstelle des `EmbeddingManager` (`src/index.ts`) erhält noch kein `getEff`; die Laufzeitübersteuerung fließt noch nicht in den internen Embedding-Dienst des Managers, Anschluss steht noch aus.

## [0.8.11] — 2026-08-29

### Behoben

- **Mobile Anpassung des Sitzungsmodus-Steurelements**: Pill und Gleitwahl waren bisher nur für das Desktop-Web-Layout gedacht — die Schicht schwebte um den Pill-Mittelpunkt nach oben, doch die Pill sitzt links in der Eingabeleiste: auf schmalen Handy-Viewports wurde die linke Hälfte der Schicht vom Bildschirm abgeschnitten. Die Schicht macht jetzt horizontales Viewport-Klemmen: einmalig beim Öffnen gemessen, bei Beschneidung (auch Layoutverschiebungen wie das Öffnen der Seitenleiste, das den Eingabebereich zum Rand drückt) wird automatisch am Rand angedockt; auf dem Desktop liegt sie natürlich im Bild, null Verhaltensänderung;
  das Schließen per Klick nach außen wechselt von `mousedown` zu `pointerdown` (auf iOS synthetisiert die reine Textzone keine Mausereignisse — die alte Implementierung ließ die Schicht auf dem Handy offen); die Trefferflächen von Pill und Schiene werden nach oben und unten um die unsichtbare Hitzone nach dem 44px-Touchstandard erweitert (visuell kein Pixel verändert, Geometrie der Schicht unverändert, auf allen Endgeräten einheitlich — auf dem Desktop wächst die getroffene Zielzone mit). Die Interaktionslogik des Gleitwahlschalters (Modus per Klick setzen, Schwungprojektion beim Loslassen mit Magnetandock) bleibt unverändert.

## [0.8.10] — 2026-08-28

### Hinzugefügt

- **„Nur schreiben, nicht lesen" auf Sitzungsebene (Issue #38)**: manche Sitzungen wollen vom Gedächtnissystem „nur herein, nichts heraus" — die Konversation weiter erfassen und an der Destillation teilhaben lassen, aber nichts in die laufende Sitzung injizieren. Bisher war der aus-Modus vollständige Tarnung (sogar die Capture ist aus, undisstillierte Scheiben wurden aufgeschoben), und der Abrufschalter hatte nur globale Granularität — diese Kombination ließ sich nicht ausdrücken. Das Schwebepanel erhält nun einen **dreistufigen „Injektion"-Schalter (folge dem Globalen / an / aus)**: auf „aus" wird die Sitzung nur schreibend — L0-Capture und L1→L2→L3-Destillation laufen wie gewohnt, während Abrufinjektion, Profil-/Navigationsstabilzonen und Werkzeugleitfaden zusammen stoppen;
  Lesewerkzeuge wie `memory_search` antworten mit dem Nur-Schreiben-Hinweis (die Schreibung läuft über den Capture-Hook, nicht über Werkzeuge — keine semantische Lücke).
  Die Pill-Fläche wechselt mit dem Zustand zu `记忆·只写` (der Injektionszustand hat Vortritt auf der Fläche, der Familienname weicht in die Schiene); die Übersteuerung wird je Sitzung
  persistiert und ist orthogonal zum Modus (Moduswechsel verliert sie nicht); „folge dem Globalen" löscht sie; die umgekehrte Kombination
  „global aus + einzelne Sitzung an" gilt ebenso. Prioritätskette: Deployment-Obergrenze > globaler Schalter > Sitzungsübersteuerung > aus-Modus (die Semantik der vollen Tarnung
  bleibt). Die Deaktivierungsgründe von „Abruftreffer" auf der schwebenden Karte werden zugleich feiner unterschieden (neuer Grund „Sitzung nur schreibend").
  Passt für Debug-/Evaluations-, sensible/forget-morrow- und langlebige Hintergrund-Sitzungen — alles, was „aufnehmen ohne zu stören" will.

  ![Nur-schreibende Sitzung: Pill-Text geändert und dreistufiger Injektionsschalter](assets/changelog/0.8.10/01-write-only-pill.png)

## [0.8.9] — 2026-08-27

### Hinzugefügt

- **Layerweises unabhängiges Destillationsrouting (Issue #34 / ADR-0005)**: die Destillationsschichten stellen unterschiedliche Ansprüche ans Modell (L1
  sehr häufig will billig, schnell und stabil sein; L3 selten mit großen Eingaben will starke Fähigkeiten); jetzt kann **jede Schicht eine vollständige eigene Fallback-Kette** bekommen.
  Doppelter Eingang: Deployment-YAML `llm.layerRoutes` (Schichtschlüssel l1/l2/l3, Kopfzeile muss Anbieter+Modell explizit nennen)
  und `distillLayerChains` zur Laufzeit über die Einstellungsseite; Priorität in der Schicht **Laufzeit-Schichtkette > statische Schichtkette > globale
  Standardkette**, Stufe für Stufe als Rückfallebene; nicht leer = vollständiger Ersatz der Schicht (die Degradation einer überdeckten Schicht fällt nie in die globale Kette), unkonfigurierte Schichten ändern sich um kein Bit; der Deployment-Pin sperrt nur die Laufzeitseite (statische Schichtketten wirken wie gehabt). Der Abschnitt „Destillationsparameter" der Einstellungsseite wird zum **Segmentpanel** umgebaut (Globales / L1 / L2 / L3): Segmentstatuspunkte in der Übersicht (blau gefüllt = Laufzeit-kundenspezifisch / hohl = statisches YAML / grau = folgt dem Globalen)
  + eine Legendenzeile (die Prioritätsbeziehung hängt im Tooltip)
  + Anmerkung „in Benutzung: welche Schichten" im Globalpanel + schichtweise Budgets nach Schicht gruppiert (Semantik unverändert). Die ×4-Aufblähung der Ausgabebudgets bei high/xhigh/max
  folgt dem Ebenenwert (Kopf-Kandidat der Ebenenkette > globaler Kandidat); die Buchung bleibt unverändert (token_cost-Zeilen
  sind bereits nach Schicht + tatsächlich bedienender Route attribuiert).

  ![Segmentpanel der Destillationsparameter · global](assets/changelog/0.8.9/03-layer-segmented-panel.png)
  ![L1-Ebenenpanel · schreibgeschützte Vorschau des Folgens und Ebenenbudgets](assets/changelog/0.8.9/04-layer-l1-panel.png)

- **Kontextbelegungsanzeige (Gedächtnis-Lichtbogen um den offiziellen Ring + Aufschlüsselung im Detailpanel)**: der vom Plugin injizierte Erinnerungsinhalt versank bisher in den Großkategorien des offiziellen Kontextrings; jetzt — außen am offiziellen Ring der Eingabeleiste ein markenblauer **leuchtender Schmalbogen**
  (Länge = Anteil der Erinnerung am Fenster, im selben Bild wie der offizielle Ring); klickt man das offizielle Panel auf, erscheint unten eine Sektion „Erinnerungsbelegung" mit zwei Zeilen, **Abruffragmente / Erinnerungsstabilzone** (im offiziellen `~5.5K`-Format und hellen Farbwerten). Die Zahlen folgen derselben Heuristik fester Dichte wie der offizielle Token-Zähler (`ceil(chars/4)+Overhead`,
  UTF-16-Regime), der Nenner ist die offiziell deklarierte Fenstergröße des Hauptkonversationsmodells; alte Sitzungen bleiben bedient (Scannen der
  Live-Sitzungsoberfläche + Rückfüllung durch Lesen der gespeicherten Präfixe des Persistenzdienstes), beim Neustart nichts verloren (durchgehende Schreibung von occupancy.json);
  nach OFF bleibt das Erreichte sichtbar und verwittert mit der Kompression natürlich. Rein additive Implementierung: alle neu hinzugefügten Knoten entfernt und die Oberfläche kehrt bitweise zur nativen Form zurück.

  ![Aufschlüsselung der Erinnerungsbelegung im Detailpanel](assets/changelog/0.8.9/01-panel.png)
  ![Erinnerungs-Lichtbogen um den offiziellen Ring](assets/changelog/0.8.9/02-halo.png)

## [0.8.8] — 2026-08-26

### Hinzugefügt

- **Einzige Quelle der Wahrheit des RPC-Vertrags `src/contract.ts`**: die Anfrage-/Antworttypen der 23 `dsh-memory/*`-Endpunkte werden in einem types-only-Modul gebündelt (null Laufzeitcode), das Host-Seite (case-Tabelle in stats.ts) und Client-Seite teilen — Vertragsdrift zeigt sich zur Kompilationszeit, statt zu warten, bis die UI undefined rendert. Die reinen Datentypen der Host-Module (MemoryStats / RebuildStatus / CostSnapshot-Familie /
  EmbeddingStateView / MemoryLiveSettings / RecallSessionStats u. a.) wandern in den Vertrag und behalten dort ihr re-export; `EFFORT_CHOICES` verriegelt per `satisfies` rückwärts die Vokabular-Drift.
- **Migration der Client-Hälfte auf TS/TSX + esbuild-Bundle**: `client/client.js` (3433 Zeilen handgeschriebenes ES5-Einzeldatei) wird als mehrdateiges TSX in `client/src/` neu geschrieben (geschichtet nach Grundlage/Steuerelemente/pill/tabs),
  gebündelt über `scripts/build-client.mjs` (esbuild, cjs-Körper in einen Factory-Wrapper verpackt, isomorph zu den offiziellen dsh-client-ui-*-Paketen) zu einer Einzeldatei `dist/client.js`. react / react/jsx-runtime /
  @deepseek-ai/* allesamt extern (vom Host per require injiziert, gegen Doppel-react); **null Verhaltensänderung** (UI pixelgleich, RPC-Endpunkte und Lasten unverändert, Handoff-Protokoll unverändert). Neu
  `npm run typecheck` (Doppelprüfung tsconfig + tsconfig.client.json); die Sektion 21 des Smoke wird zu Assertionen über das **Artefakt** dist/client.js (Protokollform + External-Verdrahtung + äquivalente Migration der bestehenden Assertionen zu Token/
  Rundungen/Partikelfeld).
- **Destillationsroutenkette-Editor (Einstellungsseiten-UI, einheitliche Liste)**: eine geordnete Liste ersetzt den alten globalen Umschalter „Destillationsdenken" und den Einzelroutenwähler „Destillationsmodell" — Zeile 1 ist die Hauptroute (Abzeichen „Haupt", darf leer bleiben und dem Standardmodell folgen), die Folgezeilen degradieren der Reihe nach; **Ebenen werden routenweise gesetzt** (Standard „folge der Deployment-Konfiguration",
  weiterhin durch den Fähigkeitsklemm). Neue Laufzeit-Schlüssel `distillChain` (≤ 8 Einträge; Hauptroutenzeile doppelt leer oder doppelt voll, Reservenzeilen zwingend explizit, Dubletten abgewiesen; leeres Array = der Deployment-Konfiguration folgen). RPC: llm-providers erhält einen `chain`-Block
  (current mit Projektion der alten Schlüssel / static / effectiveChain / source), llm-models legt jedem Modell eine `efforts`-Ebenentabelle bei. Position ist Priorität: Zeile 2 kann mit der Hauptroute tauschen / sie verdrängen (eine verdrängte leere Hauptroute bleibt nicht erhalten); pinned ist schreibgeschützt; im Folgemodus kopiert ein Knopf „als Laufzeitkette editieren" die statische Kette auf einen Klick. Designspezifikation in `design/settings-spec.md` (Abschnitt RouteChainEditor).
- **Destillations-Fallback-Kette (Variante 1 des #31)**: `llm.fallbacks` als Objektliste (Eintrag = provider + model +
  optionales `reasoningEffort`) — bei Fehlschlag der Hauptroute (Fehler/Abschnitt/Netzfehler/leere Ausgabe) automatische Degradation in der Reihenfolge der Einträge, Rückkehr sobald eine Route Erfolg hat; Einträge identisch mit der Hauptroute werden übersprungen; jede Route erhält die volle `llm.timeoutMs`; ein nichtleerer Eintragsebene übersteuert die globale Ebene (die volle Übernahme der alten Laufzeitschlüssel
  `reasoningEffort` — inklusive Eintragsstempel — bleibt bei nicht konfiguriertem `distillChain` auf Bestandswerten wirksam); aktive Abbruchung des Aufrufers degradiert nicht und wird unverändert nach oben geworfen; bei Totalversagen wird der letzte Fehler an den bestehenden
  Sitzungs-Exponential-Backoff übergeben. Token-Kosten und Destillationsnutzung werden je Versuch gebucht, Erfolg vermerkt die tatsächlich dienende Route; Degradationswechsel ins info-Log + einmalige Warnung bei dauerhaftem Einzelroutenversagen. Standard leeres Array = Einzelroutenverhalten unverändert. Die chinesischen und englischen READMEs erhalten den Abschnitt „Destillations-Fallback-Kette und Modelle mit langsamem TTFT" (mit Konfigurationsbeispiel und dreistufiger Abmilderung).

### Geändert

- **Die Einstellungsseite entfernt den globalen Umschalter „Destillationsdenken" und den Einzelroutenwähler „Destillationsmodell"**: verschmolzen in den einheitlichen Routenkette-Editor (Ebenen routenweise). Die alten Laufzeitschlüssel `reasoningEffort`/`distillProvider`/
  `distillModel` behalten ihre Semantik bitweise (effectiveCfg erkennt nur ein explizites `distillChain`, Bestandswerte werden verträglich gelesen), die UI schreibt nicht mehr hinein.
- **Leere Ausgabe wird zum Aufruffehlschlag umgestuft**: `callLLM` wechselt bei „Stream endet normal, aber 0 Zeichen Ausgabe" vom Zurückgeben eines Leerstrings (Warn-Log) zum Werfen (vollständiges Diagnose-Log bleibt) — das alte Verhalten schob das Scheitern nur an den nachgelagerten JSON/Markdown-Parser und lieferte schlechtere Diagnostik; Deployments ohne Fallback-Kette sind ebenso betroffen, der bestehende Fehlerabfangpfad der Destillationsschichten (nur Log, nie die Pipeline blockierend) bleibt natürlich kompatibel.

## [0.8.7] — 2026-08-25

### Hinzugefügt

- **Token-Kosten-Dashboard (#30, Beiträger @Irvington258)**: die Token-Kosten jedes Destillations-LLM-Aufrufs
  (l1-extract / l1-dedup / l2 / l3) werden nach Verbundschlüssel `provider/model` in die SQLite-Detailtabelle `token_cost` geschrieben (inkl. Migration der provider-Spalte der alten Tabelle), die Einstellungsseite erhält den Tab „Kosten":
  nach Modell eingefärbte Trendlinien (`--dsh-mem-chart-1..8` Diagrammreihen-Token, Tages-/Wochen-/Monatsgranularität +
  Fenster der letzten N Tage erzwungen in Tagesgranularität + L1/L2/L3-Filter), Tabelle Ebenen × Zeitfenster (Anzahl Aufrufe /
  Output- und Thinking-Tokens / Mittelwert / Median, median in JS berechnet), kumulierte Liste je Modell,
  gezogen über das schreibgeschützte RPC `dsh-memory/token-cost`, alle 5 s gesondet. Datenkriterien: Eingaben nach Zeichen
  (dsh-Streaming-usage enthält keine Input-Tokens, gleiche Zählung wie llm-usage), Ausgabe/Denken nach Tokens;
  die Buchung hängt am callLLM-Ausgang und wird auf beiden Wegen Erfolg/Misserfolg vermerkt; Buchungsfehler warnt nur und blockiert die Destillation nie;
  prepare-Caches beim Aufbau der Anweisungen; Modulreferenzen werden bei Plugin-Deinstallation aufgeräumt.
- Konfigurationsschlüssel `tokenCost.retentionDays` (Standard `365`, `0` = unbegrenzt aufbewahren): Aufbewahrungstage der Kostendetails,
  mit rollierender Bereinigung beim Schreiben; die Obergrenze des Fensters „letzte N Tage" des Kosten-Dashboards entspricht diesem Wert (nach Freigabe der Aufbewahrung wird das
  Client-Eingabelimit auf 3650 gelockert, die echte Obergrenze prüft das Backend nach Konfiguration).

### Geändert

- Rückaufnahme der Designspezifikation: `global-spec.md` erhält eine Sektion „Diagrammreihenfarben" (Kategorien der Farbcodierung für Datenvisualisierung —
  funktionale Ausnahme vom Verriegelten Einakzent, Präzedenz: Modusfarben; 8 Stufen mit Doppelthemen-Token + nachgerechneten AA-Kontrastwerten,
  hell überall ≥ 3:1 / dunkel überall ≥ 4.29, Stufe 1 auf dem Markenblau verankert, Stufe 8 in neutralem Grau für „andere");
  `settings-spec.md` erhält die Sektion „Kosten-Tab (CostTab)"; README chinesisch und englisch synchronisiert in Funktionsbeschreibung und
  Konfigurationstabellenzeilen; der Smoke erhält Assertionen zu retentionDays-Standard/Grenzen und Diagramm-Token-Verdrahtung.

## [0.8.6] — 2026-08-24

### Hinzugefügt

- **Frischegewichtung des Abrufs (#29 Variante B)**: die Abrufsortierung gewichtet weich mit `Relevanz × max(0.5, 0.5^(Δtage/Halbwertszeit))`
  (Δ nach dem updated_at der Erinnerung) — zwischen Kandidaten ähnlicher Relevanz gehen frische Erinnerungen zuerst; in langen Sitzungen rotieren die Abrufplätze
  bei Gebrauch natürlich, Antiquitäteneinträge besetzen nicht mehr das Top-N. Entwurfsentscheidungen (im Vergleich der Abwägungen von Generative Agents und
  produktionsreifer RAG-Praxis): **multiplikativ statt additiv** — die Frische verschiebt nur Ränge zwischen Kandidaten ähnlicher Relevanz, sie überschreitet nie
  die Relevanz (additiv ließe irrelevante neue Erinnerungen über die Aktualität aufsteigen); **Decay-Boden bei 0.5** — alte Erinnerungen verlieren höchstens die halbe
  Sortierpunktzahl, Langzeitfakten („die vor drei Jahren geschriebene Kaffepräferenz") versinken nie am Boden, was die Halbwertszeit zu einem unsensiblen Regler macht;
  Einträge ohne updated_at gelten als die ältesten (der Boden übernimmt, null Sonderfälle). Aufgehängt an der einzigen Naht der Suche
  (nach den Dreiweg-Schwellen von `L1Store.search()`, vor der Kappung), so dass Abrufinjektion und das Werkzeug memory_search automatisch konsistent sind;
  **der Dedupe-Kandidatenabruf (searchCandidates) wendet sie ausdrücklich nicht an** — der Schreibweg, der alte gleichsemantische Einträge sucht, muss Neu und Alt
  gleichbehandeln; die Abklingung würde der Dedupe Funde kosten. `recall.decayHalfLifeDays` Standard 30 Tage, 0 = aus (für Benchmark-Baseline-Vergleichbarkeit auf 0 pinnbar);
  das score-Feld der Treffer wird nicht umgeschrieben (die Sortierung nutzt den gewichteten Wert, die Anzeige spiegelt weiter die Suchrelevanz);
  idf wird nicht einzeln geführt (in der BM25-Route eingebaut, auf der Vektorroute ohne Begriff); importance (priority) bleibt vorläufig unaktiviert (die aktuelle
  Extraktionsausgabe ist nahezu konstant, ihr Sortiergewinn tendiert gegen null; die Formel reserviert ihr einen Platz).
- **Abrufdedupe (Tokensparnis)**: innerhalb derselben Sitzung werden bereits injizierte Erinnerungen nicht erneut injiziert — fragt der Nutzer verwandt/ähnlich nach, trifft die
  Suche erneut dieselben Einträge, doch der Modellkontext enthält sie bereits; erneutes Injizieren wäre reine Verschwendung (maximal ~2000 Zeichen ≈ 1000 Tokens je Runde). Reine Filtersemantik: so viele frische Treffer bleiben, wie injiziert werden; die volle Unterdrückung (0 Einträge) ist ein korrekter Zustand, kein Fehltreffer. Granularität = L1-Eintrags-id: Dedupe-Zusammenführung/Aktualisierung wechselt die id, inhaltlich veränderte Erinnerungen lösen sich natürlich von der Unterdrückung und werden neu injiziert. Wird der Kontext per `/compact` komprimiert oder per `/clear` geleert
  (Ereignis `agent/session-start`), setzt das Register zurück — der injizierte Inhalt ist aus dem Modellkontext entlassen, Erinnerungen können neu injiziert werden;
  `resume` setzt nicht zurück (der Verlauf ist noch da). Das Register wird in `recall-dedupe.json` im Datenverzeichnis persistiert
  (durchgeschriebene serialisierte atomare Schreibung, gleiche Rezeptur wie session-modes; LRU von 200 Sitzungen / Obergrenze von 512 ids je Sitzung /
  Ablauf nach 90 Tagen; jeder I/O-Fehler degradiert in den Speicherzustand und blockiert den Abrufpfad nie — der Zusatzkosten des heißen Pfads bleibt ein O(hits)-Speicher-Set). Die Statistik erhält den kumulativen Zähler `suppressedRecalls` (abfragbar über den RPC session-stats),
  bei jeder Unterdrückung ein debug-Log; die Zählweise der schwebenden Karte bleibt durchgehend (Vollunterdrückungsrunden zählen in hitTurns — die relevante Erinnerung
  ist bereits im Kontext, im Wesentlichen ein Treffer).

### Behoben

- **Import der records.jsonl alter Version für immer festgefahren (#28)**: fehlte in den Einträgen des alten Schreibers eines der Felder `type`/`priority`/
  `scene_name`, wurde das `undefined` in der node:sqlite-Bindungsschicht abgewiesen — auch der zeilenweise Rückfall schlug systematisch komplett fehl (fehlende Felder desselben
  Schrifters kommen im Batch), die Datei blieb liegen, jeder Start versuchte es erneut, die Daten gelangten nie in die Basis. Fix:
  **Feldsicherheitsnetz in der Bindungsschicht** (`upsertL1InTx`/`upsertL0Batch` normalisieren lokale Variablen, Haupttabelle/Vektor/FTS teilen
  dieselben Quellwerte; Standardwerte aus den Schema-Spalten: `type='' / priority=50 / scene_name=''`, L0-Seite `sessionId='default' / role='' / recordedAt='' / timestamp=0`) —
  ein einziger Fix deckt Altimporte, reindex, backfill und alle regulären Schreibaufrufer ab; nebenbei entfällt das TypeError-Risiko von `familyForType(undefined)`
  (nach Normalisierung Rückfall auf die chat-Familie). Der L0-Altimport erhält zugleich eine minimale Gültigkeitsklausel (Zählung verworfener Schlechtzeilen ohne id/content, bisher null Filterung). Anmerkung: die berichtete „fehlende Zeilenisolation" trifft nicht zu — der zeilenweise Rückfall existierte bereits
  (das Berichtslog bezeugt es selbst), was fehlte, war das Feldsicherheitsnetz; die `.failed`-Sicherung wurde nach Konsens übersprungen (die bekannte Schleifenursache
  ist kurativ gelöst; unbekannte Formen warten, bis sie real auftreten).
- **Lokales Embedding fror die ganze Seite ein (vorfall der Leistungsstufe)**: das Modellladen von transformers.js und die ONNX-Inferenz liefen ursprünglich synchron im Hauptthread des Hosts — das `run`/`loadModel` von onnxruntime-node (v1.24.3) sind synchrone Aufrufe im setImmediate-Rückruf (die Promise-Hülle entlädt die Rechnung nicht); mit aktiviertem lokalem Embedding (embeddinggemma-300m, gemessen ~0,3–1,3 s Inferenz je Eintrag) fror jede Konversationsrunde — L0-Schreibung, Abruf-Query, Destillationsschreibung, reindex-Batches — die Event-Loop für Sekunden ein: keinerlei Interaktion auf den dsh-Seiten antwortete mehr. Fix:
  die Inferenz zieht insgesamt in einen Worker-Thread um (`resources/embedding-worker.cjs`, der Hauptthread behält nur den Protokoll-Proxy
  `LocalEmbeddingService`): Inferenz Eintrag für Eintrag + Nachgeben zwischen den Einträgen, eine Einzelanfrage (Abruf-Query) drängelt vor und wartet nicht am reindex-Batch-Schlangenende;
  gemessen: während eines Batches von 8 Embeddings (der alte Pfad fror ~10 s am Stück), meldet das Sampling des Hauptthreads 0,0 ms Überziehung. Zusätzlich semantisch verstärkt: der innere Klemm `embeddingTimeoutMs` des Abrufpfads wird für lokales Embedding von „ignoriert" zu tatsächlich wirksam (Renn-Aufgabe, verspätete Antworten verworfen). Der Worker-Crash heilt sich nicht selbst (Zustand failed mit FTS-Degradationskette; Quellenwechsel/Neustart zur Erholung);
  `close()` = terminate, die Semantik „terminated erwacht nicht wieder" bleibt.
- **Destillationswiederholungs-Sturm (Kettenverbrennung von Aufrufen während LLM-Ausfällen)**: nach einem L1-Extraktionsfehler (z. B. 120-s-Gateway-Timeout) stapelte der
  Inaktivitäts-Auffang alle 30 s weiter force-Destillationsaufgaben, die während der LLM-Wartezeit zu endlosen Kettenaufrufen anschwollen
  (Beleg in memory.log vom 2026-08-24: alle 2 Minuten eine Runde 120-s-Aufrufe, ohne Konvergenz). Fix: exponentieller Backoff je Sitzung
  (Start 60 s, Verdopplung, Deckel 30 Minuten, bei erfolgreichem Konsum auf null; Rebuild-Runden ausgenommen — die explizite Nutzeraktion
  hat ihre eigene Fehler-/Abbruch-UI), während des Backoffs überspringen sowohl Inaktivitäts-Auffang als auch Schwelltrigger diese Sitzung.
- **Nebenbei Sicherheitsverhärtung (Semantik unverändert)**: alle Dateilese-/Schreibgrenzen der Bench-Werkzeuge und des Smoke-Tests gehen auf inline-Containment-Schreibweise über
  (startsWith-Wurzelprüfung nach resolve / SAFE_NAME-Weißliste;
  Vertragsassertionen für verzeichnisartige Umgebungsvariablen: absoluter Pfad ohne `..`-Segmente).

## [0.8.5] — 2026-08-23

### Behoben

- **Korrektur des Bewertungsmaßstabs** (bench): ① bei Aufgaben mit stale (update/Kettenupdate/Vergessen) ändert sich die FAIL-Bedingung von „der Altwert erscheint" zu „der Altwert **als Lagebericht vorgetragen**" — der bloße Bericht über die Entwicklung mit korrektem Endwert fällt nicht mehr negativ aus
  (lifecycle-Rücklauf vom 2026-08-23 gemessen: eine Kettenupdate-Frage mit richtiger Antwort über Platin/Diamant, die aber die Füllstreu-Entwicklung erwähnte, wurde massenweise fälschlich durchgestrichen); ② der FAIL der Antwortverweigerungsaufgaben beschränkt sich auf „das konkret Gefragte als bekanntes Faktum aussprechen", das Zitieren des echten Hintergrunds zur Erklärung „warum der Gefragte nichts weiß" zählt als PASS („ich kenne nur A und B, keinen Eintrag zu C" wurde bisher zu Unrecht durchgestrichen). Die update-Frage von work-project-stack wechselt von contains-all zum LLM-Urteil (die Programmprüfung kann Lagebericht und Entwicklungserzählung nicht unterscheiden; keine contains-all+stale-Kombination mehr in der ganzen Bibliothek).
- **Falsche Familienmarkierung im auto-Modus: private „planerische" Fakten wurden in die work-Familie eingesaugt** (entdeckt beim ersten lifecycle-Lauf):
  der Typ-Präfix der Extraktionsausgabe entschied stillschweigend über die Familie, und regelhafte private Fakten wie „Schädlingsbekämpfungsplan / Impftermine / Katzenstreu-Wahl", ohne passende Wendung im chat-Vokabular, wurden von der Formsemantik von work_fact/work_method eingesaugt → Familie falsch markiert → derselbe Fakt doppeltfamilig (die Dedupe überschreitet nie Familien → Auferstehung des Altwerts, Scheitern der Kettenfragen) + Leck des Familiengatings (eine chat-Modus-Sitzung konnte work-Fakten nennen, in lifecycle 2/2×2 gemessen). Fix: das Extraktionsprompt des auto-Modus **gibt pro Erinnerung ein explizites family-Feld aus** (das Urteil blickt auf den Kontext, nicht die Form — Beruf/Team/Projekt → work, Familie/Tiere/Gesundheit/persönliche Termine → chat; family begrenzt das Typvokabular, kein Kreuzen); auf der Ingenieursseite eine dreistufige Rückfallkette `resolveRecordFamily` (pur erzwungen → extraktionsexplizit → Typ-Präfix). Die Abzweigung vom MemoryCore-Upstream ist in der Prompt-Kopfanmerkung vermerkt. **Ein falsch markierter Bestand muss nach dem Upgrade einmal rebuild werden, um zu heilen** (L1 geleert und neu importiert; Achtung: der rebuild erweckt „vergessene" Fakten aus L0 — bestehende Semantik).

### Hinzugefügt

- **Ergänzung des Effizienz-Dreiecks** (bench + Plugin): „die Kosten des Gedächtnisses" und die bereits gemessene „Einsparung durch Gedächtnis" der Workflow-Spur bilden einen vollständigen ROI —
  ① **Injektionskosten** (Antwortdifferenz zwischen injizierten und nicht injizierten Runden — Ereigniszeitstempel werden bei der Schrittverteilung einheitlich geschrieben, die Eigenlaufzeit des Injektionshakens ist nicht direkt beobachtbar, daher nach Feldprüfung der Wechsel auf das differentielle Kriterium;
  die Gruppe A bildet intern ihre eigene Baseline); ② **Injektionsanteil** (injizierte Zeichen der Sondenrunde / Eingabetokens der Runde, umgerechnet 1 chinesisches Zeichen ≈ 1 Token); ③ **Destillationsbuchhaltung** (neuer stets laufender Zähler `src/llm-usage.ts`, callLLM akkumuliert je Schicht l1-extract/l1-dedup/l2/l3 Eingabezeichen/Ausgabe-/Denk-Tokens, lesbar über den Bench-Kontrolldienst
  `getDistillUsage`, umgelegt je erfasste Nachricht; der lifecycle-rebuild hat zusätzlich eine eigene Vorher/Nachher-Differenzierung). patch-arm-on schaltet benchControl zugleich ein; alte Läufe ohne neue Felder überspringen die Sektion automatisch.
  Nebenbei wird eine Lücke in der Linkwache von run.mjs gestopft: Geschwister-worktrees unter dem Hauptbaum (.worktree/…) wurden bisher
  durchgelassen — am 2026-08-23 gemessen lief ein alter Runner, der auf .worktree/dev zeigte, stillschweigend komplett durch.
- **Lifecycle-Spur** (bench `--track lifecycle`, nur Gruppe A): sie prüft nur die Lebenszyklus-Invarianten, die allein diese Architektur testen kann —
  **Familiengating** (eine chat-Modus-Sitzung kann keine work-Familien-Fakten nennen, spiegelbildlich ebenso; ein von null verschiedenes Fremdfamilien-Leck hieße „Schreiben und Abruf im selben Modus" gebrochen), **Capture im aus-Modus** (doppelte Assertion: die einer aus-Sitzung beigebrachten nonce-Fakten — die auto-Sonde muss ablehnen + vollständige Abwesenheit in den records/conversations-JSONL, nach rebuild erneut geprüft), **rebuild-Treue** (nach Auslösen des Vollrebuilds Sonde ×2, Kontrolle ×1; ein signifikanter Rückschritt hieße, die rebuild-Kette verliert Information), **Vergessensanfragen** (in natürlicher Konversation um Löschen einer Erinnerung bitten → der Löschpfad der L1-Konflikterkennung → dieselbe Frage erneut gestellt muss abgelehnt und der Altwert nicht wiederholt werden; die Auferweckung alter Fakten durch rebuild aus L0 ist die dokumentierte Semantik). Null neue Szenendateien, Wiederverwendung der Dialogszenenbibliothek.
- **Skalendegradationskurve**: ① Offline-Flutung (`retrieval-metrics.mjs --flood N1,N2`) — die Referenzbasis mit N deterministischen synthetischen Einträgen duplizieren (thematisch versetzt, im Volltext null Ziffern gegen zufällige Treffer auf Zahlen-golds) und recall@k neu berechnen, eine Kurve „Suchqualität vs. Basisumfang" ohne Laufkosten (Archivbasis 0.8.3 gemessen: +400 Einträge → recall@5 von 70,2 % auf 65,8 %); ② Laufzeitrauschen (run.mjs `--noise k`) — zwischen die Dialogszenen Füllsitzungen einschieben (`fillers.json`, 25 Sitzungen, Ladeassertion gegen Marker-Kollisionen), um die End-to-End-Degradation zu messen; der Bericht erhält eine Sektion „Skalenpositionsanalyse" (drei Eimer Anfang/Mitte/Ende); die Füllung ändert die scenarioFiles-Liste nicht, compares über noise-Stufen auslösen keine Umgebungsalarms.
- **Bench-Kontrolldienst** (Plugin-Konfiguration `benchControl`, standardmäßig aus): ein cordis-Dienst im Prozess `dsh-memory-bench` (rebuild-Auslösung / Statussondierung / Sitzungsmodus-Setzung) für die lifecycle-Spur — hostseitig hat connection.rpc nur handle, kein call; dies ist der einzige saubere In-Prozess-Kanal; Produktionsdeployments öffnen diese Konfiguration nicht, null Oberfläche.
- **Offline-Indikatoren der Suchschicht der Referenz** (bench): automatisch von report/compare berechnet + eigenständige CLI
  (`bench/harness/retrieval-metrics.mjs`) — recall@5 / Gold-Abdeckung / MRR je Fragetyp-Tabelle (Sondenfragen originalgetreu auf der endgültigen Erinnerungsbasis des rep kontrolliert wiedergespielt mit der keyword-Suche, Kandidatenpool/Schwellen/Kleinkorpus-Ausnahmen und Laufzeit punktweise identisch, Tokenisierung und Index teilen die search-utils aus dist) + Injektionspräzision (Anteil der injizierten Zeilen mit Gold-Punkten) + Zählung injizierter, bereits verworfener Informationen (update-artige stale gelangen in die Injektion, Updatescheitern wird direkt auf Injektionsebene sichtbar). Der Runner schreibt zusätzlich `recall.lines` (Details der injizierten Erinnerungszeilen).
  Für das Problem der stumpfen Waffe „End-to-End-Genauigkeit" gibt es nun ein direktes Signal ohne Abhängigkeit von Jury und Stichprobe.
- **Vier neue Fragetypen + Workflow-Szenen mit prospektivem Gedächtnis** (bench, angelehnt an MemoryAgentBench /
  GoodAI LTM / BEAM): `accretive` (inkrementeller Aufbau: ein vollständiger Fakt auf mehrere Sitzungen verteilt zum Zusammensetzen),
  `update-chain` (Kettenupdate v1→v2→v3, mit Rückschwungketten), `ordering` (Ereignissortierung),
  `paraphrase` (synonyme Umformung als Stress für lexikalische Lücken) — Dialogszenenbibliothek 15→20 (neue Szenen alle im 10-Fragen-Format,
  90→140 Fragen je rep), Szenen können Verstärkungssitzungen tragen (0~2, zwischen teach und change eingeschoben); im Workflow neu `wf-preflight`
  (als feste Konvention gelehrt „vor dem Erzeugen zuerst die Vorflug-Datei schreiben", die Sonde gibt nur eine vage Aufgabe, die Gruppe A muss den Schritt aus dem Gedächtnis ergänzen).

### Geändert

- Regeln des Dialogszenen-Validierers aktualisiert: Sondenfragenzahl 6→6~10 (die sechs Kernarten je genau 1 + je höchstens 1 erweiterter Typ),
  Verstärkungssitzungen erlaubt (Reihenfolge erzwungen teach → reinforce → change),
  `update-chain` muss stale tragen; das Update-Sonderkriterium geht in den Kettenfragen auf.
  Die Szenenlisten-Änderung lässt alte Baseline-compares „Umgebung uneinheitlich" warnen — erwartbar; Baseline neu laufen lassen oder mit `--scenarios` dieselbe Teilmenge vergleichen.

## [0.8.4] — 2026-08-22

### Behoben

- **Das neue Denkstufen-Vokabular der Einstellungsseite wurde von der Schreibporte abgewiesen** (eingeführt in 0.8.3): bei der Erweiterung der Ebenentabelle auf acht Wörter fehlte die Synchronisierung der RPC-Weißliste von `settings-set` (sie erkannte nur `''/off/high/max`), die Einstellungsseite antwortete auf jede Wahl `none/minimal/low/medium/xhigh` mit „ungültige Denkstufe" und rollte zurück. Jetzt teilen sich Weißliste und schema/settings dieselbe Quelle — das Vokabular konvergiert zur einzigen Quelle der Wahrheit `EFFORT_CHOICES` in `config.ts` (bisher war dieselbe Liste an 4 Stellen wörtlich abgeschrieben).
- **Das explizite `xhigh`-Ausgabebudget wurde doppelt um ×16 aufgebläht** (eingeführt in 0.8.3): der seitenseitige `layerMaxTokens` und der Automatikmodus-Wachposten von `callLLM` hielten je eigene Literaltabellen hoher Stufen und liefen auseinander (die Wache vergaß `xhigh`); bei Konfiguration `xhigh` und einem Modell, das es deklariert, wurde erst ×4 und noch einmal ×4 gerechnet. Beide Seiten teilen nun die einzige Konstante `HIGH_EFFORT_TIERS`, und wenn die Konfiguration selbst eine hohe Stufe ist, bläht die Wache nicht mehr auf.
- **Der Denkstufen-Wähler erhält den Punkt „Auto" zurück**: nach der Streichung der Option „der Konfiguration folgen" in 0.8.3 zeigte der Wähler nur noch die deklarierten Modellstufen, und wer einmal eine explizite Stufe gewählt hatte, kam aus der UI nicht mehr zum Automatikmodus zurück. Der erste Eintrag ist jetzt fix „Auto" (key='', der Klick schreibt den Leerstring zurück), und die dreifache Wiederholung im Optionsaufbau konvergiert zu einer einzigen Berechnung.
- Dokumentdrift: die Werteliste `llm.reasoningEffort` in beiden README-Versionen erhält `minimal` (am schema ausgerichtet); die „high/max ×4"-Hinweise der Budget-Tooltips der Einstellungsseite und der Codekommentare werden zu high/xhigh/max ergänzt.

### Geändert

- **Host-Laufzeit-Upgrade 0.1.0-rc.8 → 0.1.1-rc.2** (devDeps exakt gepinnt, Peers auf die Linie `^0.1.1-rc.2` gewechselt): die 9 Pakete direkter Abhängigkeiten Tarball für Datei verglichen — 7 Pakete ohne Codeänderung,
  dsh-llm / dsh-client-connection rein inkrementell (multimodales Bild-Offloading / Files API /
  Adapter-`prepareCall` / optionaler RPC-Parameter `doFetch`), die von diesem Projekt genutzten GenerateOptions/StreamChunk/createUserMessage/installModelSelection/
  rpc.handle|call sind byteweise identisch, null Anpassung. Verifikation: build/smoke/dump-config beider Profile/
  Bench-Fixture-Smoke alles grün. Das npm-ERESOLVE des Familienübergangs zwischen Pre-Releases geht mit `--legacy-peer-deps` (in AGENTS.md vermerkt).

### Benchmark

- **Die DSH-MemBench-Workflow-Spur wächst auf 7 Szenen** (`bench/`), mit drei neuen Prüffamilien:
  Prozesswissensaktualisierung (`wf-heap-update` — Lehre v1 → Änderungssitzung kündigt v2 an → Sonde prüft
  „der aktuell gültige Prozess", artefakte des alten Prozesses dürfen nicht mehr erscheinen, operationalisierte Messung des Dedupe-Updates),
  Zwilling-Workflow-Disambiguierung (`wf-twin-runbook` — Zwilling-Runbooks, den falschen Dienst konfigurieren wird durch Negativprüfungen verurteilt),
  Stilvorgaben-Kontinuität (`wf-report-style` — Namens-/Struktur-/Tausendertrenn-/Fußzeilenkonventionen sessioübergreifend umgesetzt). Die Vollständigkeitsprüfung wächst von einer einzigen Positivprüfung auf vier Kriterientypen (`contains`/`notContains`/
  `absent`/`exists`), der Prüfer wird in das unitestbare `checks.js` ausgegliedert; der Runner unterstützt eine optionale `change`-Sitzung; die Szenenbibliotheksvalidierung wird zugleich enger (genau ein Kriterium je Wahl, der Marker muss im Lehretext stehen).
  Die offizielle Baseline (`bench/baseline/`) bleibt bei der 4-Szenen-Fassung; der erste Regressionslauf nach der Erweiterung muss die Baseline neu bauen.

### Benchmark-Verhärtung (Korrekturlose nach Schwachstellen-Audit)

- **A/B-Gruppen parallel**: `run.mjs --arm AB` fährt beide Gruppen in zwei parallelen Prozessen (die Kontrollen hängen nicht voneinander ab), der Elternprozess erzeugt am Ende den gemeinsamen Bericht; die Kinderprozesse sind von Aufräumung und Autobereicht befreit, um sich nicht zu stören.
- **Verstopfung des Archäologiekanals zwischen Läufen**: vor jedem Lauf werden die historischen Sandboxes in `%TEMP%/dsh-mem-bench/` und die Sitzungsverzeichnisse des Bench-Namespace in `~/.dsh/sessions` geräumt (nur `dsh-mem-bench` wird gematcht, Nutzer-Sitzungen/-Daten bleiben unberührt).
- **Außerdienststellung der Gruppe B der Dialogspur**: Harness-Sitzungen sind voneinander unabhängig, die Sonde der Gruppe B ohne Gedächtnis scheitert zwangsläufig (historisch 17,8 % ≈ Boden), der Vergleich sagt nichts — `--track dialog --arm B` verweigert den Lauf, nur Gruppe A bleibt.
- **Code-Fingerabdruck und Linkwache**: der environment-Kopf der Ergebnisse verzeichnet `gitSha`; run.mjs prüft beim Start, dass die beiden link:-Abhängigkeiten des Bench-Profils auf das getestete Repository zeigen (alter Worktree-Code verschmutzte still die Ergebnisse, Unfall am 2026-08-21 gemessen).
- **Zweistufige Auditierung von Grenzlektüren** (Workflow-Spur): strenge Stufe — ein Treffer (Gedächtnis-/Sitzungsbasis in `~/.dsh`, memory.db, Speicherpfade records/conversations/scenes) → alle Prüfungen der betroffenen Szenen als verurteilt; weiche Stufe nur Aufforderung zur Nachprüfung;
  Fix des Fehlalarms durch die `.MemoryMappedFiles`-Teilzeichenfolge; legitime Erinnerungswerkzeugaufrufe (memory_read_scene u. a., Parameter sind Pfade) gehen nicht ins Audit.
- **Deklauteure der Szenen**: `wf-heap-update` auf eine zweistufige Konvention `target.env + apply.sh`, `wf-twin-runbook` auf isomorphe `svc-a/svc-b`-Dateien (die Zuordnung lebt nur im Lehretext) — Fix der Lücke in der Unterscheidungskraft „Gruppe B kann Sandbox-Dateien durchwühlen und den Prozess rekonstruieren" (gemessen erreichte die B-Sonde 12/12 und 11/12, nahe der Höchstnote).
- **Workflow-Verschmutzung gemessen**: die Abrufinjektion der Workflow-Sonden geht in die Kontaminationsstatistik ein (das Feld fehlte, der Bericht zeigte 0); der Bericht erhält eine Spalte **Vollständigkeit des Sondensegments** (in Lehr-/Änderungssegmenten haben beide Arme den Kontext vor Ort; nur das Sondensegment ist das reine Gedächtnisfenster).
- **Verschärfung der Szenenbibliotheksvalidierung**: Marker bibliotheksweit eindeutig, Dublettensuche gleicher Sitzungsart, die golds von contains-all müssen im Lehretext stehen (ohne Gedächtnis unbeantwortbar = schlechte Frage), golds dürfen nicht in den Fragetext lecken; die Hilferuf-Erkennung erhält englische Muster; die fixtures teilen sich nach Spuren in `dialog/`, `workflow/` (eine Workflow-Szene unter einem Dialog-Patch ohne Werkzeuge scheitert zwangsläufig, der gemischte Smoke hätte falsch alarmiert).

### Benchmark-Ergonomie (Modellkonfiguration über bench.env)

- **Konzentrierte Konfiguration der Modelle in drei Rollen**: `bench/harness/bench.env` (Vorlage aus `bench.env.example` kopieren, API-Schlüssel ist gitignored) konfiguriert an einem Ort getesteten Agent / Jury / Destillation —
  `BENCH_PROVIDER/BENCH_MODEL`, `BENCH_JUDGE_*`, `BENCH_DISTILL_*`; Befehlszeilenargumente haben Vorrang vor der env-Datei. Neue Parameter `--distill-provider/--distill-model`, das Destillationsmodell wechselt vom hartcodierten Patch zu Umgebungsvariablen (Standard-Rückfall: official/flash).
- **Individuelles OpenAI-kompatibles Gateway**: nach Eintrag von `BENCH_TEST_BASE_URL + API_KEY` in bench.env (die Jury kann ein eigenes Paar bekommen) erzeugt run.mjs automatisch den llm-pi-ai-Patch, der `bench-gw` /
  `bench-judge-gw` registriert (Jury/Destillation, die das getestete Gateway wiederverwenden: automatische Aggregation und Dedupe der Modelltabelle), der per apiKeyEnv referenzierte API-Schlüssel wird nur in die Kindprozess-Umgebung injiziert. Mit konfiguriertem Gateway sind die individuellen Anbieter des Laufs vollständig durch bench.env bestimmt (das Gateway des user-seitigen settings.yaml nimmt nicht teil: Isolation und Reproduzierbarkeit).
- **Entfernung des Standard-Rückfalls des getesteten Modells**: ohne `--provider/--model` und ohne bench.env wird der Lauf verweigert (der alte Rückfall traf das Standardmodell des settings.yaml, und das Bench-Profil ohne Adapter explodierte beim Start).
- Analyse und Gateway-Patch-Bau in das reine Funktionsmodul `env-config.mjs` ausgegliedert (22 Unit-Tests + dump-config-Strukturvalidierung, alles grün).
- **Denkintensität in drei Rollen konfigurierbar**: `BENCH_REASONING_EFFORT` (getestet) / `BENCH_JUDGE_REASONING_EFFORT`
  (Jury) / `BENCH_DISTILL_REASONING_EFFORT` (Destillation, Standard off) + zugehörige Parameter `--effort/
  --judge-effort/--distill-effort`; übermittelt via `ModelSelection.reasoningEffort`
  (offizielle Tür installModelSelection) und die GenerateOptions der Jury; leer = nicht senden, dem Anbieter-Standard folgen; der environment-Kopf der Ergebnisse verzeichnet den Effort beider Seiten (Reproduzierbarkeit).

### Aktualisierung der gemessenen Benchmark-Daten (README chinesisch/englisch synchronisiert)

- **Neue Daten nach der Erweiterung der Workflow-Spur auf 7 Szenen** (v4-flash@high, Jury glm-5.3, Plugin 0.8.3):
  Vollständigkeit des Sondensegments Gruppe A (Gedächtnis an, 3 Runden) **85,5 %** (59/69) gegen Gruppe B (Gedächtnis aus, 1 Runde)
  **43,5 %** (10/23); die Eingabe-Tokens des Gruppe-B je Szene sind das **6,8-fache** der Gruppe A (1,81M gegen 266k,
  bei high-Stufe wird der Preis der Neuerkundung ohne Gedächtnis deutlich aufgebläht); Sonde der Stilvorgaben-Szene Gruppe B 0/4 (die Konventionen
  leben nur im Gedächtnis, die Decke der Unterscheidungskraft); in der Prozessaktualisierungs-Szene kann Gruppe B sich noch per Skriptlektüre rekonstruieren (Unterscheidungskraft durch
  Sandbox-Affordanzen begrenzt, im README ehrlich vermerkt). Die Grafik `bench-workflow.svg` wird mit den neuen Daten neu gefertigt; die alten Dialogspur-Daten
  werden als 0.8.0-Archivbaseline etikettiert (Gruppe B außer Dienst).
- **Kosten-Leitplanke der Gruppe B**: `--repeats` wirkt nur auf die Gruppe A, Gruppe B läuft fest nur 1 Mal (der Tokenverbrauch von Langläufern
  ohne Gedächtnis ist zu hoch, Nutzerentscheidung).
- **Echtzeit-Fortschrittspanel**: beim Benchmark-Lauf startet `run.mjs` automatisch `panel.mjs` (null Abhängigkeiten, nur an
  127.0.0.1 gebunden) und öffnet den Browser — Karten beider Arme A/B, Szenen-/Phasen-/Nachrichtenfeingranularer Fortschritt, kumulierte Kosten,
  Ereignisschweif; das Doppelindikatoren-Paar Herzschlag (5 s) + Aktivitätsfrische entscheidet direkt „hängend vs. Prozess tot". Die Datenquelle ist die atomar inkrementelle Schreibung des Runners in `rep-N/progress.json` (gedrosselt auf ≥ 1 s) + das `plan.json`
  beim Start von `run.mjs` (die rep-Schleife liegt beim Elternprozess, die Kinder kennen die Gesamtzahl nicht). `--no-panel` schaltet aus;
  das Panel wird beim Ende des Laufs automatisch eingesammelt (unref der Kinder, sonst hielten sie die Event-Loop des Elternprozesses).

## [0.8.3] — 2026-08-21

### Geändert

- **Destillationsdenkstufen werden modellbewusst (behebt das garantierte Explodieren der Destillation auf Nicht-deepseek-Modellen)**: bisher leitete das Plugin die Denkstufe der Destillation (Standard `off`) unverändert an jedes Modell weiter — `off` ist ein Konzept der Deepseek-Adapterebene, das die pi-ai/openai-responses-Gateways nicht kennen (qwen lokal lehnte ab, der Upstream antwortete 400 Invalid
  reasoning.effort). Jetzt wird vor dem Senden per `resolveModelInfo` die Modellfähigkeit erkundet (cache pro Route, ungültig bei Topologieänderung): deklariert → unverändert senden; `off` gegenüber OpenAI-Vokabular → Alias `none`; nicht unterstützt oder nicht deklariert → nicht senden + einmalige Warnung; **die Option „der Konfiguration folgen" wird gestrichen**, '' = auto (Modellstandardstufe →
  high); die wählbare Stufentabelle der Einstellungsseite folgt der Echtzeitanzeige des aktuellen Modells (ohne Deklaration nur high sichtbar); das Vokabular der Tabelle erweitert sich auf off/none/minimal/low/medium/high/xhigh/max; löst die Auto-Stufe sich zu einer hohen Stufe auf, greift der ×4-Wachposten des Ausgabebudgets synchron.
- **Destillationsmodellwechsel mit automatischer Modellauswahl**: nach dem Anbieterwechsel fällt das Modell automatisch auf das erste Modell des Anbieters (paarweise Schreibung mit Übernahme), das Modell-Dropdown hat kein „dem Standard folgen" mehr (dem Standard folgen = den ersten Eintrag des Anbieter-Dropdowns leeren und übernehmen);
  die Modellliste wird pro Anbieter gecacht + beim Laden des Panels im Hintergrund vorab geholt (sofortiger Wechsel ohne Leerephase; bei Nichttreffer erscheint „Modellliste wird geladen…" statt eines veralteten Modellnamens). **Sofortiger Textwechsel des Knopfes gefixt**: die Optimismus-Aktualisierung von `writeLlm` verschmolz bisher die Settings-Schlüssel `distillProvider/distillModel` direkt in `info.current`,
  während die Anzeigenschicht `current.provider/model` las — die Schlüssel passten nicht, die Optimismus-Aktualisierung war für den Knopftext ein No-op,
  und man wartete auf den 5-s-Sondierungsrefresh (Gefühl „ein paar Sekunden, bis es wechselt"); jetzt werden die Schlüssel auf Ansichtsschlüssel abgebildet und gleichzeitig in `current` und
  `effective` geschrieben, während der Schreibung unterwegs empfangene alte Sondierungsantworten werden verworfen (gegen Blinzeln), und nach Erfolg wird einmal die echte Serverwahrheit gezogen.
- **Dropdown-Auswahl komplett selbst gezeichnet, an der Optik des dsh MenuDropdown ausgerichtet**: die Ausklappliste des nativen `<select>` wird vom Betriebssystem gezeichnet (eckige Winkel, Systemhervorhebung), dem CSS entzogen — ersetzt durch Auslöseknopf + schwebendes Panel (12px
  Rundung / dsw-specific-menu-Grundfläche / lv3-Schatten, Optionen mit 10px-Rundung + Hover-Grundfläche + Auswahlhaken,
  Tastatur ↑↓/Enter/Esc vollständig, aria-listbox-Semantik). Die vier Stellen — die beiden Ebenen Anbieter/Modell des Destillationsmodells und die Typ-/Kontextfilter des Gedächtnis-Tabs — sind vollständig ersetzt, im Bundle kein nativer `<select>` mehr.
- **Szenenblöcke der Einstellungsseite einklappbar**: die Szenenkarten des Szenen-Tabs sind standardmäßig zusammengeklappt (nur Kopf + Zusammenfassungszeile),
  ein Klick auf den Kopf klappt den Text aus/ein, der Klapppfeil dreht im ausgeklappten Zustand um 90° (respektiert reduced-motion).
- **Log-Tab springt standardmäßig nach ganz unten**: den Log zu lesen heißt, die neueste Endstücke wollen (tail-Semantik); nach Laden/Aktualisierung wird automatisch an den Grund geklebt, kein Standardhalt oben mehr.
- **Entsperrhinweis bei Deployment-Pin**: wenn das Destillationsmodell durch den statischen Profil-Pin (`llm.provider`+
  `llm.model` beide Felder) verriegelt ist und der Wähler nicht erscheint, ergänzt ein statischer Text, „wie man den Pin entfernt, um die
  Seitenumstellung zurückzubekommen" (bisher wurde nur die feste Route gezeigt, der Nutzer wusste nicht, warum nicht umgeschaltet werden konnte).

Korrekturlose nach einer umfassenden Codeüberprüfung (Sicherheit + Robustheit + Dokumentkonsistenz).

### Behoben

- **Eine missgebildete Proxy-Konfiguration bricht das Plugin-Laden nicht mehr** (hoch kritisch): war `embedding.proxy` ohne Schema geschrieben
  (z. B. `127.0.0.1:7890`) oder hatte die Proxy-Umgebungsvariable selbst kein Schema, warf der `ProxyAgent`-Konstruktor synchron einen TypeError → apply schlug fehl. Jetzt dieselbe Toleranz wie beim missgebildeten Mirror: abfangen und auf Direktverbindung degradieren + Warn.
- **Proxy-URL-Log-Entschärfung**: das Download-Log gab die Proxy-URL unverändert aus (mit möglichen
  user:pass-Anmeldedaten) und persistierte sie in `memory.log`; jetzt werden userinfo abgetrennt, nur `scheme//host` bleibt.
- **`NO_PROXY=*` mit Joker greift** (bisher matchte der Eintrag `*` nie, der Proxy blieb in Benutzung, obwohl gesetzt).
- **Sichtbarkeitschlusskreis der Doppel-Schreibfehler**: der Fehler von L0/L1 „JSONL-Faktenquelle geschrieben, Batchschreibung in die Suchbasis gescheitert" war bisher stillschweigend
  (Einträge waren seither unauffindbar, Dedupe-Kandidaten fehlten); jetzt auf error-Log gehoben mit dem Hinweis, dass sich per „Gedächtnis neu aufbauen" aus der Faktenquelle vollständig neu importieren lässt.
- **Haltbarkeit atomarer Schreibungen**: die tmp+rename-Atomarschreibungen von state/pending/Szenen/persona erhalten den fsync des Datenblocks
  (bisher konnte ein Stromausfall eine leere/halbe Datei hinterlassen); der tmp-Name erhält ein Zufallssegment gegen Kollisionen in derselben Millisekunde, Fehlerpfad räumt Waisen-tmp auf.
- **Abbruchsemantik des Laufzeit-Installateurs** (Hauptplattform Windows): nach Abbruch in der ci-Phase fällt es nicht mehr in den Rückfallzweig „ci gescheitert" und startet keinen sinnlosen install; der Abbruch in der Lücke zwischen ci-Austritt und Rückfallstart wirkt ebenfalls; unter `shell:true` tötet der Kill mit `taskkill /T /F` den Prozessbaum (bisher wurde nur cmd.exe getötet, die npm-Enkel liefen weiter — Timeout und Abbruch hörten nur oberflächlich auf).
- **Kappungslese-Konfiguration für lokales Embedding**: `embedding.maxInputChars` galt bisher nur für das Remote-Embedding, der lokale Pfad hart-codierte 5000; beide Wege teilen nun dieselbe Quelle.
- **Verhärtung der Szenendateinamen**: Windows-vorbehaltene Gerätename (CON/NUL/COM1… in Erweiterungsform) bekommen ein `_`-Präfix zur Ausweichung; überg lange Namen werden auf 120 Zeichen gekappt (ENAMETOOLONG-Verteidigung).
- **Migrationskriterium des L1-Altformats**: mischte der alte `records.jsonl` Schlechtzeilen, kam die Migration nie zum Abschluss (derselbe Batch wurde bei jedem Start neu importiert); das Kriterium wechselt auf die Zahl der gefilterten gültigen Zeilen.
- **Eingabengrenzen der RPC-Parameter**: sessionId ≤ 512 / query ≤ 4096 / provider·model·activeModel ≤ 200,
  Pagination-Offset ≤ 1 Million — gegen missgebildete überlange Nutzlasten aus dem Loopback-Panel (Aufblähung von session-modes.json, CPU-Spitzen durch jieba-Volltokenisierung).
- **limit-Wachen der FTS-/Vektorsuche**: die drei Suchzugänge verweigern `limit ≤ 0` (negatives SQLite-LIMIT = unbegrenzt; die aktuelle Aufruffläche klemmt bereits, reine Verteidigung gegen künftige Aufrufer).
- **Warnung bei Werkzeugaufrufen ohne Agentkennung**: ohne übergebenes `exec.agent` degradierte die Modusfilterung zu einer Allfamilien-Suche; jetzt einmalige Warnung (das fail-open-Verhalten bleibt, der Aufruf wird nicht abgewiesen).

### Dokumentation

- Das chinesische README ergänzt die ganze, bisher nur englischsprachige Sektion „Logs und Fehlerbehebung" (eine Lücke, die das Chinesisch-Englisch-Synchronisierungsgesetz verletzte),
  beide Versionen ergänzen zugleich die Erklärung zur JSONL-Haltbarkeitsgrenze; die Beispielpin-Version 0.8.0 → 0.8.2.
- **Zwei Faktfehler des 0.8.2-Eintrags korrigiert**: ① der Peer-Bereich ist tatsächlich bei `^0.1.0-rc.6` geblieben (rc.6~rc.8 verträglich), „die Peer-Anforderung wechselte zu dsh ≥ 0.1.0-rc.8" stimmte nicht mit package.json überein; ② das zitierte
  `docs/dsh-dev-experience.md` wird nicht mit dem Repository ausgeliefert (gitignored), nach außen eine schwebende Referenz.

## [0.8.2] — 2026-08-20

Nachzug der Host-Abhängigkeiten auf dsh 0.1.0-rc.8.

- **Epinne Aktualisierung der Host-Abhängigkeiten 0.1.0-rc.6 → 0.1.0-rc.8** (devDependencies exakt gepinnt, für
  Entwicklung/Test; die peerDependencies bleiben auf der Spanne `^0.1.0-rc.6` — rc.6→rc.8 praktisch getestet als **null API-Drift**,
  Typkompilation/Smoke/echter Start alles grün). Ab rc.8 geht der dsh-Körper zu einem **global installierten** Layout über
  (`profiles/node_modules` wird vom heal-Mechanismus als Farm symbolischer Links gepflegt); die alte „Materialbaum"-Installation scheiterte am Start.
- bench `run.mjs`: der dsh-CLI-Eingang wird zu einer Auflösungskette (`DSH_BIN` → npm-Globalpräfix → Rückfall auf altes Layout),
  hartcodierte persönliche Pfade entfernt, direkt auf anderen Maschinen lauffähig.

## [0.8.1] — 2026-08-20

Destillationsmodell-Laufzeitwechsel + modell-Download-Anti-Verschmutzungs-Wiederholungen + DSH-MemBench v3.

### Hinzugefügt

- **Laufzeitanpassung des Destillationsausgabebudgets** (Einstellungsseite → Memory → Übersicht → Destillationsparameter → Ausgabebudget):
  die Token-Obergrenzen der vier Schichten Extraktion / Dedupe / L2-Szene / L3-Profil werden UI-regelbar (bisher Codekonstanten; jede Anpassung verlangte eine Konfigurationsänderung und Neuinstallation); leer oder 0 = den eingebauten Standardwerten folgen (16k/8k/32k/16k),
  die ×4-Aufblähung der Denkstufen high/max greift wie gewohnt oberhalb des effektiven Werts. Das Schalterpanel der Einstellungsseite wird zugleich in zwei Gruppen „Gedächtnismodus / Destillationsparameter" neu geordnet, klarere Gruppierung der Optionen.
- **Laufzeitanpassung des Destillationseingabebudgets** (gleiche Gruppe → Eingabebudget): die Eingabezeichen-Obergrenze eines Destillationsaufrufs
  (`llm.maxInputChars`, Standard 700 000) wird UI-regelbar, leer/0 = der statischen Konfiguration folgen; die L1-Extraktionsblockung, L2/L3-Kappung und die Aufrufzahl-Schätzung des Rebuilds folgen der gesamten Kette nach dem effektiven Wert.
- **Destillationsmodell-Laufzeitwechsel** (Einstellungsseite → Memory → Übersicht → Wähler „Destillationsmodell"): Auswahl von Destillations-provider/model aus den vom Host **konfigurierten Anbieterrouten**
  (inkl. der in dsh → Einstellungen → Modelle hinzugefügten eigenen OpenAI-kompatiblen Anbieter), sofort wirksam, ohne Neustart, persistiert über Neustarts. Priorität:
  statischer Deployment-Pin (`llm.provider`+`llm.model` beide gefüllt, gegen Nutzerauswahl, die Konversationen nach draußen schickt)
  > Laufzeitauswahl > Standardmodell. Neue RPC-Endpunkte `dsh-memory/llm-providers`
  (Anbieterkatalog + Standardauswahl + aktuelle Übersteuerung + tatsächlich wirksame Route + ist der gewählte Anbieter noch registriert)
  und `dsh-memory/llm-models` (Modelle je Anbieter; ohne Katalog vom Adapter degradiert die UI zur Handeingabe);
  nach der Löschung von Anbieter/Modell weist die UI ausdrücklich „nicht mehr in der Liste" aus und fordert zur Neuwahl auf.

### Behoben

- **EmbeddingGemma war nicht installierbar** (echte Grundursache): der sha256 von `generation_config.json` im Katalog war um ein Zeichen falsch abgeschrieben (`a736d1b3` statt `a736b1b3`) — der Mirror hat nie einen fehlerhaften Byte geliefert, der Integritätsvertrag selbst war falsch; der Download scheiterte garantiert mit „sha256-Prüfung fehlgeschlagen", ohne Ansatzpunkt. Nach Messung korrigiert, und alle 19 Dateien des Katalogs einer autoritativen Prüfung unterzogen (LFS-Dateien gegen die oids der HF-Baum-API, kleine Dateien echt gehasht) — alles Übrige stimmt überein. Neu `npm run verify-catalog`
  (`scripts/verify-catalog.mjs`) zur Ein-Klick-Nachprüfung bei jeder Katalogerhöhung, um Abschreibunfälle dieser Art auszuschließen.
- **Modell-Downloads, die nicht verbinden/langsam sind** (Begleitproblem, im selben Szenario gemessen): der direkte Mirrorzugriff ist im chinesischen Netz zeitweise unerreichbar (Wechsel von TCP-Verbindungstimeouts und erreichbaren Fenstern), und Node-fetch liest keine Proxy-Umgebungsvariablen —
  der Downloader unterstützt jetzt Proxies (neue dreistufige Konfiguration `embedding.proxy`: Standardautomatik erkennt
  `HTTPS_PROXY`/`ALL_PROXY` u. a. und respektiert `NO_PROXY`, `none` erzwingt Direktverbindung,
  oder explizite Proxy-URL; über undicis `ProxyAgent`, gleiche Semantik wie curl/npm).
- **Resilienz des Downloaders**: automatische Wiederholung bei Einzeldatei-Fehler (Standard 2 Mal, Abstände 1 s/3 s) und bei jedem Wiederholungsversuch Anhang von
  `?dshmem-retry=N` zum Wechsel des Cache-Schlüssels — innerhalb des Fensters eines defekten Cache-Objekts auf der Mirror-CDN-Ebene erhält dieselbe URL deterministisch dieselbe schlechte Antwort; nur der Schlüsselwechsel holt ein anderes Objekt und heilt sich selbst. Prüfabweichung → Neuladen von null (der verunreinigte Wiederaufnahmepunkt gelöscht),
  Zahlenzähl-Diskrepanz/Netzfehler → Wiederaufnahme nach Abbruch bewahrt; Abbruch unberührt; die semantik der prozessübergreifenden Wiederaufnahme bleibt unverändert.

### Benchmark und Dokumentation

- **DSH-MemBench v3** (`bench/`): Dialogspur (15 Szenen × 6 Fragetypen × 3 Durchgänge
  = 270 Fragen/Gruppe) + Workflow-Spur (4 Szenen in echter Werkzeug-Sandbox) als Doppelschienen-A/B-Vergleich — **Gruppe A (Gedächtnis
  an) vs. Gruppe B (Gedächtnis aus)**, gleiche Szenenbibliothek, wortgleiche Eingaben, kopfloser automatischer Antrieb (dsh-headless-Profil + lokaler Runner-Plugin), Doppelstufige Bewertung durch Programm/LLM; Vollständigsindikatoren komplett: Kreuzszenen-Kontaminationserkennung (Szenenmarker-Scan), Werkzeugüberschreitungs-Audit, stationäre Cache-Quote (ohne Sitzungserstaufrufe), Sonderprüfung Wissensaktualisierung (nach Änderungsurteil den alten Wert nennen = 0) und Sonderprüfung Antwortverweigerung (erfinden = 0). `run.mjs` fährt A/B mit einem Befehl,
  `report.mjs` erzeugt den strukturierten Bericht, `compare.mjs` dient dem Regressionsvergleich vor/nach Plugin-Änderungen;
  die offizielle Baseline (vollständige Ergebnisse beider Spuren × A/B × 3 Durchgänge) archiviert in `bench/baseline/`. Das vorherige manuelle agentic-Szenario (v2) wurde entfernt.
- **Der README-Abschnitt „Messvergleich" füllt sich mit gemessenen Zahlen** (chinesisch/englisch synchronisiert): Dialogspur, Gesamtgenauigkeit Gruppe A 92,6 %
  (250/270) vs. Gruppe B 17,8 % (48/270), beidseitig 0 Erfindungen; Aufschlüsselung des Doppelkanals Abruf (75,1 % Treffer durch passive Injektion + 84 Fragen aktiver Abfrage, 60 Fragen durch Gedächtniswerkzeuge gerettet); Workflow-Spur, Gruppe B zahlt +49 % Schritte / +61 % Werkzeugaufrufe / +43 % Eingabetokens, Anmeldeszene +88 % Eingabe (Anmeldedaten leben nur im Gedächtnis, Gruppe B fragt jede Runde den Nutzer). Die Messungen wechseln zu SVG-Grafiken (`bench-dialog` /
  `bench-workflow`), alle SVG-Illustrationen des README erhalten die neue Optik in Gold/Tiefblau (`flow` /
  `storage` synchronisiert).

## [0.8.0] — 2026-08-18

Gedächtnisoptimierungspaket (Entscheidungsaufzeichnungen ADR-0001/0002/0003):
Abrufinjektion auf Nachrichtenseite + Umbau der Destillationsauslöser (progressiver Schwellwert + Sitzungsisolation über die ganze Kette) + Schichtausgabebudgets + FTS-Schreibweg-Fix.

### Hinzugefügt

- **Abrufinjektion auf Nachrichtenseite** (ADR-0001): relevante Erinnerungen werden als plugin-signiertes synthetisches Nachricht (`form: 'recall'`,
  die Host-UI zeigt die Signaturzeile **„context injection · memory"**) vor jede neue Nutzernachricht in den Sitzungsfluss injiziert
  — der Nutzer sieht direkt, dass „das Gedächtnis gegriffen hat". Tag `<relevant-memories>` + Begleitsatz „nur zur Orientierung"; reine Werkzeugschritte / reject-Entscheidungen werden durchgereicht; Auslösung nur in Schritten mit neuer Nutzernachricht
  (Rundenbeginn + Steering-Zwischenrufe). Der Werkzeugleitfaden weist darauf hin, dass in eingeschränkten Umgebungen (etwa der code-runtime-Modus, der nur den Codeausführungs-Eingang erlaubt) die Gedächtniswerkzeuge über den Aufrufmechanismus dieser Umgebung indirekt zu nutzen sind. Der Systemprompt behält nur stabilen Inhalt
  (Profil/Navigation/Filterleitfaden), der dynamische Slot `memory:recall` wird entfernt;
- **Abrufbudget**: `recall.maxCharsPerMemory` (Standard 500) / `recall.maxTotalRecallChars`
  (Standard 2000) — bei Überschreitung Kappung mit dem Begleitsatz `… (gekürzt; Einzelheiten über memory_search oder conversation_search
  abrufbar)`, der das Modell zu den Werkzeugen für den Volltext leitet (die Kappung ist eine Zuführung: der Werkzeugweg liefert den vollständigen Eintrag); über dem Gesamtbudget fällt der niedrig bewertete Endabschnitt weg; sichere Kappung auf Codepunkt-Ebene;
- **Abruf-Timeout**: `recall.timeoutMs` (Standard 5000, 0 = unbefristet) als Gesamtbudget, bei Überschreitung wird die Injektionsrunde übersprungen;
  innerer Klemm des Remote-Embedding-Fetch auf 3000 ms (um der FTS-Degradation Zeit zu lassen), lokale Inferenz unklemmt;
- **Progressiver Destillationsschwellwert** (ADR-0003): der wirksame Schwellwert klettert 1→2→4→stationär (die Semantik von `extract.minMessages`
  wird zum stationären Schwellwert, Standard 1→6) — neue Nutzer erhalten im ersten Zug eine Erinnerung, stationär spart das Batchen Aufrufe; der Kletterstatus wird mit pending.json persistiert;
- **Inaktivitäts-Auffangnetz**: `extract.idleSeconds` (Standard 300, 0 = aus) — nach ausreichendem Schweigen der Sitzung fallen undisstillierte Scheiben automatisch ins Netz; aus-Modus-Sitzungen mit Aufschub werden übersprungen;
- **Scheiben-Synchronisation beim Moduswechsel**: Wechsel zwischen Nicht-aus-Moden → die Scheiben dieser Sitzung werden sofort nach dem Capture-Modus destilliert; Wechsel auf aus → Aufschub; Rückkehr von aus → die aufgeschobenen Scheiben fallen nach dem Capture-Modus (Scheiben mischen sich nie über Moden);
- **Schichtausgabebudgets**: Extraktion 16k / Dedupe 8k / L2 32k / L3 16k; ×4 automatisch bei Denkstufen high/max
  (Wache gegen den historischen Unfall, dass das Reasoning das Budget fraß); `llm.maxTokens` Standard 256k→65536, herabgestuft zur allgemeinen Notvane.

### Behoben

- **Kreuzsitzungs-Verschmutzung** (bestehender Mangel): die Kontextnachrichten der Extraktion waren ein globales Speicher-Array (der Inhalt von Sitzung A diente B als Hintergrund und ging beim Neustart verloren); jetzt werden sie je Sitzung frisch aus L0 erfragt (über den Sitzungsindex) und die Scheibe selbst ausgeschlossen; die Destillationsauslöser zählen Scheiben je Sitzung und extrahieren nur Scheiben erreichter Sitzungen — alle fünf Kanäle (Schwellwert/idle/Hintergrund/Moduswechsel/Wiederholungsrückstände) sind sitzungsisoliert (ADR-0003);
- **O(N²)-Aufblähung des FTS-Schreibwegs**: die defensive FTS-Löschung wechselt zu einer Existenz-Punktprüfung auf der Haupttabelle (record_id ist UNINDEXED in der FTS-Tabelle, ein DELETE je id = Volltabellenscan — die Neuanlegepfade wie Rebuild/Re-Embedding/Import zahlten je Eintrag einen Vollscan). Äußeres Verhalten punktweise unverändert (ADR-0002; das rowid-Mapping-Schema wurde wegen des stillschweigenden Fehllöschungsrisikos durch veraltete Mappings abgelehnt).

### Geändert

- Der Werkzeugleitfaden wechselt auf ein Dreibedingungs-Gating (`tools an && Profil ∥ Navigation ∥ Abruftreffer in dieser Runde`): Nutzer mit leerer Basis und Nutzer mit abgeschalteten Werkzeugen zahlen diese feste Token-Pauschale nicht mehr jeden Schritt;
- pending.json erhält ein `sessionId`-Feld in den persistierten Einträgen (Altformat fällt automatisch in die legacy-Sitzungsgruppe),
  und persistiert zugleich den progressiven Schwellzustand;
- der Startrücklauf reiht per Sitzungsscheiben gruppiert ein;
- **die Tokenisierung der chinesischen Suche wechselt von CJK-Bigrammen zur jieba-Worttokenisierung** (ausgerichtet auf die offizielle MemoryCore-Implementierung):
  `@node-rs/jieba` (vorkompiliertes Rust-napi-Binärformat) erzeugt die geordnete, deduplizierte Vereinigung von **jieba-Tokens ∪ lateinischen Wörtern ∪ CJK-Bigrammen** — die Tokens liefern BM25 exakte Ganzworttreffer mit hohem idf, die Bigramme sichern die Grundlinie des Unterwortabrufs; bei Ladefehler automatischer Rückfall auf reine Bigramme (im Prozess verankert, keine Drift); Versionsstempel des FTS-Tokenizers (`fts_tokenizer`: `jieba-v1` /
  `bigram-v1`): bei unpassendem Stempel automatisches Drop + Neubau + Rückfüllung; alte Basen ohne Stempel gelten beim ersten Start als `bigram-v1`, automatische Migration.

## [0.7.1] — 2026-08-17

Korrekturlose der Vollüberprüfung (2026-08-17): Dokumentnacherzählungen + Speicherleistung + Verhärtung der Lieferkette der Laufzeitinstallation.

### Leistung

- **`PRAGMA synchronous=NORMAL`** (offiziell empfohlene WAL-Stufe): die Batchschreibung fällt von einem fsync je Transaktion auf einen je
  checkpoint, Re-Embedding/Import beschleunigt; der einzige Preis: bei Stromausfall gehen die letzten wenigen committierten Transaktionen verloren (nur Verlust, keine Korruption);
- **Vektorschreibungen des reindex werden transaktionalisiert**: die zeilenweisen Rohschreibungen des L1/L0-Re-Embeddings werden zu Blockbatches (16/32 Zeilen) in einer einzigen Transaktion
  (Scheitern des ganzen Batches → zeilenweiser Rückfall, gute Zeilen bleiben erhalten), zusammen mit dem vorherigen Punkt stark verkürzte Re-Embedding-Zeiten großer Basen.

### Sicherheit

- **Das lokale Embedding-Runtime wechselt zu `npm ci` + mitgelieferter lockfile**: `resources/runtime-package-lock.json`
  (beim Build nach dist/ kopiert) friert den kompletten transitiven Abhängigkeitsbaum von `@huggingface/transformers` auf der Autorseite ein —
  das alte `npm install pkg@exakte Version` sperrte nur direkte Abhängigkeiten, transitive triften nach semver, und spätere Registry-Veröffentlichungen/Vergiftungen drifteten nach Installationszeitpunkt. ci-Fehlschlag (Lock-Drift usw.) → automatischer Rückfall auf install (Verfügbarkeit zuerst).

### Dokumentation

- Das CHANGELOG erhält die fehlenden Einträge [0.5.3] / [0.5.4] (npm hatte bereits veröffentlicht);
- die Konfigurationstabelle der READMEs chinesisch/englisch erhält 5 Zeilen: `recall.includePersona` / `recall.includeSceneNav` /
  `embedding.maxInputChars` / `embedding.timeoutMs` / `llm.timeoutMs`;
- Korrektur des chinesischen Tippfehlers „间族" (richtig „跨族"); die alten Speicherlayout-Pfade des Entwicklererfahrungsdokuments
  (`l0/ l1/` → `conversations/ records/`); der persona-Dateiname von CONTEXT.md wechselt zur Familienform.

## [0.7.0] — 2026-08-17

Lokale Embedding-Modelle und heißer Wechsel (die größte Funktion), Light/Dark-Doppelthema, Korrekturlose der Vollcodeüberprüfung (Issues #1-#24).

### Hinzugefügt

- **Lokale Embedding-Modelle** (#20-#24): **dreistufige Embedding-Quelle** (aus / remote / lokal) zur Laufzeit umschaltbar,
  Zustand persistiert in `embedding-source.json`, Wirkung = Deployment-Obergrenze AND Laufzeitwahl;
  - **Eingebauter Modellkatalog** (Weißliste, revision verriegelt + sha256 je Datei): BGE small Chinesisch
    (512 Dimensionen / ~25 MB), EmbeddingGemma 300M (768 Dimensionen / ~330 MB, gleiches Modell wie der MemoryCore-Upstream),
    BGE-M3 (1024 Dimensionen / ~590 MB, Kontext 8192); Standard-Mirror `hf-mirror.com` konfigurierbar
    (`embedding.mirror`), `.part`-Wiederaufnahme nach Abbruch + Streaming-sha256-Prüfung nach Download;
  - **Inferenz-Runtime auf Abruf** (transformers.js 4.2.0): erst beim ersten Wechsel zur lokalen Stufe wird per npm ins Datenverzeichnis `runtime/` installiert
    (durch eigenes package.json verankert, außerhalb des Plugin-Abhängigkeitsbaums); Modelle landen in `models/<id>/`,
    von der Einstellungsseite löschbar (das benutzte Modell ist geschützt);
  - **Heißwechselkette**: Aufwärmen und Laden → Dienstwechsel + swapProvider (Dimensionswechsel = DROP der Vektortabelle) →
    sofortige Meta-Synchronisation → Vollre-Embedding im Hintergrund (L1/L0-Zählfortschritt, abbrechbar) → der Zustand wird erst nach Erfolg persistiert;
    bei Fehlschlag bleibt die alte Quelle (Neustart auf der Ursprungsquelle), Abbruch/Teilfehler des Re-Embeddings wird vom 30-Minuten-Backfill nachgefüllt;
  - Neue Konfigurationen: `embedding.allowLocalModels` (das Deployment verbietet die lokale Stufe), `embedding.mirror`;
- **Light/Dark-Doppelthemen-Anpassung von Einstellungsseite und Eingabeleiste** (#15-#19): zwei Token-Etagen (verkettete dsw-Host-Aliase +
  ganzer Satz eigener semantischer Token als Übernahme), der Themenwechsel tauscht die CSS-Variablenwerte vor Ort aus, ohne React-Neurenderung;
- **UI-Neubau des Moduswählers**: Modi eingedeutscht (日常 / 工作 / 智能 / 关闭), Schwebepanel neu gebaut,
  Füllung des Reglers (links hell, rechts dunkel, beim Ziehen stets sichtbar), Ziehblase (umgekehrtes Doppelspitzen-Dreieck), **Partikelschicht**
  (Punktpartikelfeld, Feldstärke je Modusstufe: 日常 spärlich / 工作 Wasserwellen / 智能 volles Feld, im hellen Thema mit multiply vermischt);
  das Designsystème wird im Verzeichnis `design/` abgelegt (vier Specs: global / pill / slider / settings).

### Behoben (Vollcodeüberprüfung #1-#14 + unabhängige Zweitprüfung F1-F4 + Montagenähte)

- store: der FTS-Schreibfehler rollt die ganze Transaktion zurück (Schluss mit stillen Indexlöchern, #2); die Embedding-Ergänzung wird inkrementell +
  Nullvektoren als skipped vermerkt (behebt die Endlosschleife des Vollre-Embeddings alle 30 Minuten, #3); Batchfehler → zeilenweiser Rückfall +
  Anweisungscache-Ungültigmachung beim DROP + Obergrenze des skip-Sets (F2-F4);
- Lebenszyklus: Abschaltreihenfolge — erst Aufgaben stoppen/L0-Kette spülen, dann die Basis schließen (#5); Referenzfreigabe an drei Stellen Capture-Puffer/Rebuild-Snapshot/pending
  (#4);
- recall: die Query nimmt nur die letzten 8 Nachrichten + Obergrenze 2000 Zeichen, leere Query leert den Cache (#6);
- settings: die Wiederverwendung des Prozess-Scope beim Faserneustart, Schalter werden nicht mehr stillschweigend ignoriert (#8); Scope-Cache lebt nach Dienstinstanz,
  automatisches Anremounten beim Dienstneustart (F1);
- rpc: automatisches Anremounten der RPC-Registrierung nach Abgang/Austausch des connection-Dienstes (#9);
- client: Fehlerzustände der drei Panels + Degradationsbadge der Übersicht (#7); Sequenznummern der Listenanfragen verwerfen überholte Antworten (#10);
- tools: die drei Werkzeuge im aus-Modus antworten einheitlich mit dem Hinweis; die Suchpaginierung zeigt eine ausdrückliche Kappungsmarke (#11);
- log: rückwärts blockweises Lesen von log-tail + Kappungsrückfall bei wiederholt scheiternder Rotation (#12);
- config: numerische Grenzen + Kappung der pending-Persistenz + Rücksetzen des Erweiterungsschalters (#13);
- **Stats-Montagenähte**: der `/rpc`-Handler übergab in seinen deps `embedManager` nicht — die Embedding-Verwaltungs-UI zeigte dauerhaft
  „Speicher degradiert" (das Fehlen des optionalen Feldes war von TS/Smoke gleichermaßen nicht abfangbar; behoben).

### Leistung

- Wiederverwendung vorkompilierter Anweisungen im heißen Suchpfad + IN-Blockung + L1-Batchtransaktionen (#14).

### Dokumentation

- Großer README-Umbau: neue Sektion „semantische Suche (Embedding-Quelle)" (Dreistufen-Tabelle / Modellkatalogtabelle / Download und heißer Wechsel);
  Hero / Schichtgedächtnis / Sitzungsmodi wechseln auf image2-Generierbilder; neue Oberflächenvorschau (echte Screenshots beider Themen hell/dunkel);
  storage.svg erhält die drei Embedding-Quellzustände und neue Dateiformen; die Konfigurationstabelle erhält zwei Zeilen;
- der Entwicklungskontext erhält ein Glossar „Embeddings und Suche"; Archivierung des Vollcodeprüfberichts vom 2026-08-17.

## [0.6.1] — 2026-08-17

- `llm.maxTokens`-Standard 20000 → **256000**: bei v4-flash konnte der standardmäßige high-Denkmodus jedes beliebige Ausgabebudget auffressen und den Text auf 0 Zeichen drücken; großzügiges Budget gewährt, zusammen mit Denkstufe standardmäßig aus.

## [0.6.0] — 2026-08-17

Destillationsdenkstufen + UI-Neubau des Gedächtniswählers + Zuverlässigkeitsverstärkung.

### Hinzugefügt

- **Destillationsdenkstufen**: Konfiguration `llm.reasoningEffort` (`off`/`high`/`max`/leerer String, Standard `off`)
  + Laufzeitumschaltung im Übersichts-Tab der Einstellungsseite („der Konfiguration folgen" fällt auf den Deployment-Standard zurück, über den settings-Dienst persistiert);
  das Standarddenken von Reasoning-Modellen konnte das Ausgabebudget auffressen und den Text auf 0 Zeichen drücken, daher für die Destillation das Denken standardmäßig aus;
- **Persistenz des undisstillierten Puffers**: fehlgeschlagene, nachzusetzende Nachrichten und Nachrichten auf dem Weg zum Schwellwert werden modusweise in `pending.json` gestapelt
  (nach jedem Destillationsversuch atomar geschrieben), beim Neustart nichts verloren, automatischer Rücklauf 20 Sekunden nach dem Start;
- **Gedächtnis-Vollrebuild** (Einstellungsseite → Memory → Übersicht → Gedächtnis neu aufbauen): alle abgeleiteten Schichten werden mit L0 als Faktenquelle neu importiert,
  alte Erzeugnisse werden als Ganzes archiviert statt gelöscht, Blockung in niedriger Priorität (weicht der normalen Konversation), mit Bestätigungs-Popup/Fortschritt/Abbruch;
  einheitlich im Intelligent-Modus (auto) neu destilliert, blockiert je Sitzung (Sitzungen nach erster Zeit sortiert), während des Rebuilds laufen neue Konversationen über normale Runden.

### Geändert

- UI-Neubau des Gedächtniswählers: conic-Kaltblau-Fluss an den Rändern des auto-Modus, Apple-Glas-Schwebeebene (dreischichtiger Aufbau, Reparatur des
  Backdrop-Filter-Sampling-Ausfalls unter Chromium), 1:1-Reglerzug + Magnetandock durch Schwungprojektion beim Loslassen;
  Farben von Linien/Haltepunkten/Etiketten thematisiert.

## [0.5.4] — 2026-08-16

Release-Industriealisierung: npm Trusted Publishing (OIDC von GitHub Actions) geht an den Start — push eines `v*`-Tags veröffentlicht automatisch,
ohne Token / ohne 2FA; die Konsistenzprüfung von Tag und package.json-Version greift nur bei Tag-Auslösung (ein manueller Probelauf über `workflow_dispatch`
kann die Authentifizierungskette der Veröffentlichung durchlaufen, um die OIDC zu verifizieren). Keine nutzer­sichtbaren Änderungen.

## [0.5.3] — 2026-08-16

### Behoben

- Der Schwellzähler wird sofort nach der L1-Extraktion persistiert (ein Abbruch im Prozessverlauf rollt nicht zurück, beim Neustart keine Doppel-Extraktion);
- das Destillationsausgabebudget läuft einheitlich über `llm.maxTokens` (Standard 20000, um zu verhindern, dass das Reasoning von Denkmodellen das Budget frisst und der Text auf 0 Zeichen fällt).

### Hinzugefügt

- Die Profil-/Szenennavigationsinjektion des auto-Modus wird strukturiert: Gruppierung nach Kategorien + `<domain family>`-Domänen-Tags, statt der groben Aneinanderreihung beider Familien.

### Dokumentation

- Die README-Installationsart stellt npm an die erste Stelle (GitHub / lokaler Pfad als Alternativen), `files` schließt die hero-Ressource ein.

## [0.5.2] — 2026-08-16

Behebung des schwerwiegenden Fehlers auf Linux/macOS, dass „jeder Werkzeugaufruf
`Cannot read properties of undefined (reading 'prepare')`" meldete
 (echter WSL-Unfall: der bash-Werkzeugaufruf stürzte beim ersten Mal ab, Fehlschlag auf Zug-Ebene).

### Grundursache

Das Plugin hatte die Host-Laufzeitpakete (`@deepseek-ai/cordis`, `dsh-tools` u. a.) als gewöhnliche
`dependencies` deklariert — der Installateur installierte **private Kopien** für das Plugin und bildete mit dem Modulgraph des Hosts eine
**doppelte `dsh-tools`-Instanz**. Der `ToolRuntime`-Dienst wurde von der Plugin-Kopie instanziiert, während
`dsh-agent-loop` mit dem `Symbol(@deepseek-ai/dsh-tools.scheduler)` der Host-Kopie den Scheduler las — die Symbol-Identitäten waren ungleich (gleicher Name, verschiedene Instanzen), die Lese ging ins Leere → jeder Werkzeugaufruf
warf einen TypeError bei `scheduler.prepare`. Unter Windows liefen zufällig beide Graphen in derselben Auflösungsreihenfolge und es funktionierte; unter Linux (pnpm hoisted + Symlink-Layout) trat es garantiert auf.

### Behoben

- **Die Host-Laufzeitpakete wechseln zu `peerDependencies`** (ausgerichtet an der Konvention offizieller Plugins, etwa
  `dsh-bash-local`: cordis / dsh-agent / dsh-home-paths / dsh-llm /
  dsh-session / dsh-settings / dsh-system-prompt / dsh-tools, `^`-Bereich),
  die Installation erzeugt keine privaten Kopien mehr, Plugin und Host teilen denselben Modulgraph;
- die für lokale Entwicklung benötigten Versionen wandern in `devDependencies` (Build/Smoke unberührt);
- reine Bibliotheksabhängigkeiten bleiben in `dependencies` (schemastery, sqlite-vec).

## [0.5.1] — 2026-08-16

Behebung des clientseitigen Registrierungsfehlers der 0.5.0-Umbenennung (echter Unfall: nach Installation von GitHub meldete die Browserseite
`client-modules: bundle ... loaded without registering "dsh-prime-memory"`, und sämtliche Gedächtnissteuerelemente von Einstellungsseite und Eingabeleiste waren unbenutzbar).

### Behoben

- **Die Registrierungs-id des Client-Bundles folgt dem neuen Paketnamen**: der
  `window.__ModuleLoader__.load({ id: ... })` in `client/client.js` wechselt vom alten Namen `dsh-memory-plugin` zu
  `dsh-prime-memory` — bei der 0.5.0-Umbenennung waren nur die Host-Seite und die Bundle-Deklaration geändert worden, die Browser-Hälfte blieb vergessen,
  so dass Loader-Eintragsname und Registrierungsname auseinanderlagen und das Bundle-Laden sofort scheiterte. Der Pluginname auf der Host-Seite
  `dsh-memory-plugin`, der Konfigurationsschlüssel `dsh-memory` und die RPC-Endpunkte `dsh-memory/*` bleiben unverändert
  (sie zu ändern würde bestehende Konfigurationen und Datenkanäle brechen).

### Dokumentation

- README-Visuelle Aufhübschung (beautify-github-readme): natives Projekt-Hero (`assets/readme/hero.svg`,
  ein SVG der L0→L3-Schichtenpipeline, die abnehmende Breite zeigt die Datenverfeinerung); Umordnung in „Wert → Mechanismus → erster Schritt → Details",
  Zusammenführung doppelter Abschnitte, Einbetten als `<p align="center"><img width="100%">`.

## [0.5.0] — 2026-08-16

Umbau zur öffentlichen Veröffentlichung: das Paket wird zu **`dsh-prime-memory`** umbenannt (der alte Name `dsh-memory-plugin` war auf npm bereits durch
ein gleichartiges Plugin belegt), und die Verpackung nach der offiziellen Bundle-Spezifikation ist abgeschlossen.

### Geändert

- **Deklaration von `dsh.bundle`** (neues `cordis.patch.yml` im Wurzelverzeichnis): nach der Ein-Befehl-Installation per `dsh plugin --profile <name> add`
  **wird die Plugin-Zeile automatisch gemountet**, kein manuelles Bearbeiten des patch.yml des Profils mehr nötig;
  `files` nimmt die Datei auf;
- **Entmaschinierung der Abhängigkeiten**: die `@deepseek-ai/*` wechseln von `file:`-Absolutpfaden (zeigend auf das lokale Profil) zu exakten npm-Versionen
  (`0.1.0-rc.6` eine Stufe, cordis `4.0.1`, schemastery `3.18.1`) — auf jeder Maschine lösen `npm install` / `dsh plugin add`
  (rc.6 hängt am dist-tag `next`, keine `^`-Bereiche verwenden);
- Repo-Hygiene: MIT LICENSE, `.gitignore` (ignoriert `node_modules/`, `dist-smoke/`, `.zcode/`),
  Neuformulierung des README-Installationsabschnitts (Ein-Befehl-Installation + Deinstallation + Sicherheitshinweis + Quellentwicklung), doppelte Überschriften korrigiert.

## [0.4.2] — 2026-08-16

Diagnostikverstärkung für leere LLM-Ausgaben der Destillation (echter Unfall: zwei Runden in Folge Dedupe/Extraktion mit 0 Zeichen Ausgabe, im Log nur die
`Ausgabe vor 400 Zeichen:`-Leeranmerkung, ohne jeden Vor-Ort-Hinweis).

### Wert der Grundursachenprüfung

`callLLM` zeichnete ursprünglich nur Eingabe-/Ausgabezeichenzahlen auf; wenn „der Stream normal endete, ohne ein Wort zu spucken", ließ sich nicht unterscheiden,
„das Modell hat nur Reasoning erzeugt (text leer)" vs. „der Server antwortete leer". Die beiden fehlgeschlagenen Male
(35~38 s, 0 Zeichen, 13.000 Zeichen Eingabe) lagen weit unter den Budgets von Timeout (120 s) und maxTokens (4096).

### Geändert

- `callLLM` sammelt **blockweise Statistiken** im Stream: Endgrund (stop/max-tokens/tool-calls/error/aborted),
  usage-Token-Zählungen (outputTokens/reasoningTokens), Blockzahl und Zeichen der text-deltas,
  Zeichen der reasoning-deltas (mit 300-Zeichen-Auszug), Verteilung der block-end-Typen;
- **warn-Diagnose-Log bei leerer Ausgabe**, mit all diesen Statistiken — beim nächsten leeren Ausgang lässt sich unmittelbar entscheiden, ob das Reasoning das Budget fraß, der Endgrund, oder ob der Server leer antwortete;
- das normale `LLM-Aufruf`-Log ergänzt den Endgrund (bei nicht leerer Ausgabe null Zusatzkosten).

## [0.4.1] — 2026-08-16

Behebung des L0-Capture-Mangels, der bei Runden mit langen Antworten die user-Nachricht verlor (echter Unfall: in einem 4-Runden-Dialog verlor Runde 3 die user-Nachricht, Runde 4 user + die erste assistant-Nachricht).

### Grundursache

Die exportierte session.jsonl ist ein **nach Kompression** verdichtetes Log; im Echtzeit-`session/event`-Strom trägt jede Streaming-Antwort zudem zahlreiche
text-delta/reasoning chunk-Ereignisse. Runden mit langen Antworten (langer Text + Denken + Onlinesuche) überstiegen mit ihren Echtzeit-Ereigniszahlen das `MAX_BUFFER=500` des Capture-Puffers, und das Kopf-Trimmen (`splice(0, len-500)`) schnitt den **frühesten**
`turn/start` des Zugs und die user-Nachricht ab — `findTurnStart` fand den Zuganfang nicht mehr und die Capture degenerierte zu „der ganze Puffer als aktueller Zug", nur die Endabschnittsnachrichten des Zugs blieben übrig. Runden mit kurzen Antworten erreichten das Limit nicht, daher waren Runden 1 und 2 vollständig.

### Behoben

- **Der Puffer nimmt nur 4 Ereignistypen** (user/message, assistant/message, turn/start, turn/end),
  Streaming-Chunks werden am Eingang direkt verworfen (`isCaptureRelevant`) — das Puffervolumen fällt von Hunderten/Zug auf einstellige Zahlen/Zug;
- **eiserne Trimmregel**: Ereignisse eines laufenden Zugs (nach einem nicht geschlossenen turn/start) werden nie getrimmt, nur der abgeschlossene Vorbau davor
  (`trimBuffer`, defensiv, praktisch unerreichbar);
- **sofortige L0-Schreibung**: beim turn/end sofort über eine eigene serielle Kette geschrieben (`capture.ts`), nicht mehr in die Destillationswarteschlange —
  bisher konnte L0 durch langsame LLM-Aufrufe blockiert werden (26 s gemessen); beendete dsh die Destillation mitten drin, ging das eingereihte L0 verloren; der Runner ist nicht mehr für die L0-Schreibung zuständig.

### Verifikation

- Der Smoke erhält Sektion 12: Whitelist der 4 Ereignistypen, Chunk-Ausschluss, Trimmszenario bei 600 Ereignissen + laufendem Zug
  (turn/start + user nicht verloren), 500er-Obergrenze ohne laufenden Zug, kein Trimmen unter der Grenze.

## [0.4.0] — 2026-08-16

Sitzungsweise Gedächtnismodi: Vier-Zustands-Kontrolle (auto/chat/work/aus) + Schreib-Abruf-Isolation im selben Modus + L2/L3-Familienspeicher.

### Hinzugefügt (UI)

- **Modussteuerung in der Eingabeleiste** (`conversation.input.left`, rechts neben dem Moduswähler): das Pill zeigt den aktuellen Modus
  (`记忆·自动` usw., modusabhängig eingefärbt), ein Klick lässt darüber einen **macOS-Stil-Gleitwähler** aufschweben —
  horizontale Schiene + vier Haltepunkte (aus · chat · work · auto), die Linie durchläuft den Kugelmittelpunkt,
  Ziehkopf (mit Schatten), nach dem Loslassen **Andocken am nächsten Haltepunkt** und optimistisches Absenden per RPC (bei Scheitern Rollback + roter Hinweis);
  der aktuelle Modus wird durch Hervorhebung des unteren Etiketts angezeigt (oben kein Text); Klick auf ein Haltepunkt-Etikett springt direkt zum Modus, Klick nach außen/Esc schließt;
  beim Sitzungswechsel wird die Komponente automatisch neu montiert und holt den Modus dieser Sitzung;
- der Einstellungsseiten-Browser behält die **gemischte Ansicht** beider Familien (Verkettung der Szenen-/Profil-Endpunkte), die „Prompt-Wrapper-Familie" der Übersicht wird „Standardmodus".

### Hinzugefügt (Semantik: Schreiben und Abruf im selben Modus)

- **Vier Moduszustände** (`MemoryMode = auto | chat | work | off`), unabhängig je Sitzung, per sessionId in `session-modes.json` persistiert
  (> 90 Tage / > 500 Einträge automatische Aufräumung, serialisierte Schreibungen):
  - `chat` / `work`: der schmale Prompt destilliert die eigene Familie → Schreibung nur in die Familienbibliothek; der Abruf fragt nur Familienerinnerungen + Familien-Profil/Szenennavigation;
  - `auto` (**Standard neuer Sitzungen**): einstufige Extraktion mit Prompt aus fusioniertem Vokabular (drei private Klassen + vier Arbeitsklassen, alle 7 offen),
    jede Erinnerung erhält ihre Familienetikett per Typ-Präfix; der Abruf öffnet beide Familien (Profil/Navigation beider Familien verkettet);
  - `off`: diese Sitzung ist für das Gedächtnissystem vollständig unsichtbar — kein L0-Schreiben, keine Destillation, kein Abruf, die drei Modellwerkzeuge antworten mit dem Hinweis;
- Standardmodus neuer Sitzungen = Konfiguration `family` (die Union erweitert sich zu `auto|chat|work`, Standard `auto`, Semantik herabgestuft zu
  „Standardmodus"; die von alten Deployments ausdrücklich konfigurierten chat/work bleiben wirksam); Moduswechsel greift in der nächsten Runde, bereits extrahierte Erinnerungen bleiben in ihrer Ursprungsfamilie;
- überlagert mit dem globalen Schalter: der Globale ist der Hauptschalter, die Sitzungsmodi gliedern sich darunter.

### Geändert (Familiengerechte Speicherisolation)

- **memory.db bleibt eine einzige Basis**: `l1_records`/`l1_fts` erhalten eine `family`-Spalte (Bestand nach Typ-Präfix zurückgefüllt,
  die FTS-Tabelle wird automatisch neu gebaut); alle drei Suchstrategien (FTS/Vektor/hybrid) unterstützen Familienfilter (Vektorpfad: Überruf + nachgelagertes Nachfiltern);
- **L2/L3 in Familien aufgespaltete Dateien**: `scenes/chat|work/` (alte `scenes/*.md` wandern automatisch nach chat),
  `persona-chat.md` / `persona-work.md` (das alte `persona.md` wird automatisch umbenannt), `state.json` steigt auf v2
  mit Familien-Checkpoint (alter flacher Inhalt fällt in den chat-Bucket); L2/L3-Schwellzähler, Kontextketten, Prompt-Varianten jeweils unabhängig;
- Dedupe-Kandidaten werden nur innerhalb derselben Familie abgerufen (die Dedupe überschreitet nie Familien); der L1-Nachsetz-Puffer wird modusweise in Buckets gelegt;
- die Modellwerkzeuge filtern nach dem Modus der aufrufenden Sitzung (`exec.agent.id === sessionId`);
  `memory_read_scene` sucht namentlich in beiden Familienverzeichnissen, der persona-Parameter wird zu `persona-chat.md|persona-work.md`.

### Hinzugefügt (RPC)

- `dsh-memory/session-mode-get {sessionId} → {mode, defaultMode}` und
  `dsh-memory/session-mode-set {sessionId, mode}` (Vierwert-Weißlistenvalidierung).

### Migration (alles läuft automatisch innerhalb von init)

1. `l1_records`: ALTER ergänzt die family-Spalte + Rückfüllung nach Typ-Präfix; fehlt die Spalte in `l1_fts`, drop + Neubau + Rückfüllung;
2. `state.json`: v1 flach → v2 familienweise (alte Daten fallen an chat);
3. `scenes/*.md` → `scenes/chat/`; `persona.md` → `persona-chat.md`;
4. **Deployment-Synchronisierung**: aus dem `cordis.patch.yml` des Web-Profils die Zeile `family: chat` löschen (sonst bliebe der Standardmodus chat).

### Verifikation

- Der Smoke erhält Sektion 11: Familienetiketten-Inferenz / Persistenz der Modusspeicherung und Standardmodus / FTS-Familienfilter + Kandidatenfamiliennisolation +
  Listen-Familienfilter / Migration und Rückfüllung einer echten alten Basis (ohne family-Spalte) + FTS-Neubau / Migration alter Szenen- und Profil-Dateien /
  state v1→v2 / fusioniertes Vokabular-Prompt mit 7 Klassen / RPC-Modus-Endpunkte (inkl. Ablehnung illegaler Werte);
- `Config['~standard'].validate({})` besteht mit family=auto als Standard.

## [0.3.0] — 2026-08-16

Gedächtnisbrowser + Gedächtnismodus-Schalter: die Einstellungsseite „Memory" steigt von einer reinen Textzähltabelle zu einem multitabletigen Inhaltspanel auf.

### Hinzugefügt (UI)

- **Multi-Tab-Gedächtnisbrowser** (Einstellungen → Memory):
  - **Übersicht**: Laufzähler + Gedächtnismodus-Schalterpanel + automatische Aktualisierung alle 5 Sekunden;
  - **Memory**: Liste der L1-Erinnerungskarten — Schlüsselwortsuche (BM25, gleiche Quelle wie der Abruf) + Typ-/Kontextfilter +
    Relevanzanzeige + Klick zum Aufklappen der Details (Zeitstempelkette/Version/Quellnachrichten); standardmäßig absteigend nach Aktualisierung, paginiertes Laden;
  - **Szenen**: Volltext der L2-Szenenblöcke (mit Popularitäts-/Zusammenfassungs-META);
  - **Profil**: Volltext des L3-Personas;
  - **Logs**: rollierende letzte 200 Zeilen von memory.log.
- **Gedächtnismodus-Schalter** (Hauptschalter + drei Teilschalter Capture/Destillation/Abruf, bei ausgeschaltetem Haupt grau):
  über den offiziellen settings-Dienst (Namespace `dsh-memory`, live wirksam, offiziell persistiert),
  die Seitenschalter schreiben per Loopback-RPC; Semantik = statische Konfiguration (Deployment-Obergrenze) AND Laufzeitschalter.

### Hinzugefügt (Host)

- Neue RPC-Endpunkte (im `/rpc`-Loopback-Kanal): `dsh-memory/settings-get` / `settings-set` /
  `list-records` (Browsing-Paginierung + doppelter Schlüsselwortweg + Szenenfacette) / `scenes` / `persona` / `log-tail`;
- `L1Store.list()` (SQL absteigend nach Aktualisierung + Typ-/Kontextfilter + Paginierung) und `distinctScenes()`;
- Laufzeitfilterung an drei Stellen: der Capture-Ereigniseingang, der Destillationsschritt des Runners, die Abrufinjektionstextfunktion;
- ist der settings-Dienst erst nach dem Plugin bereit, automatisches Nachmounten (Abhören von `internal/service`), fehlt er, bleibt alles offen mit Hinweis.

### Verifikation

- Der Smoke erhält: Paginierung/Filter der Browsing-Schnittstellen, Schema-Standardwerte der Schalter, Endpunktverteilung des RPC von Ende zu Ende
  (Assertionen Endpunkt für Endpunkt auf einer fake connection, inkl. Schalterdurchschreibung und Ablehnung unbekannter Endpunkte);
- echter Boot: Log-Zeile `Gedächtnismodus-Schalter bereit (settings-Namespace dsh-memory)` bestätigt, HTTP 200.

## [0.2.4] — 2026-08-16

Diagnostizierbarkeit vollendet: die Schlüsselknoten der ganzen Pipeline laufen ins Log; bei jedem Fehler reicht die eine `memory.log`-Datei, um den Ausführungspfad zu rekonstruieren.

### Hinzugefügt

- **LLM-Aufrufstatistiken**: jeder Destillationsaufruf zeichnet `provider/model, Eingabe-/Ausgabezeichenzahl, Dauer` auf,
  jeder Fehlschlag vermerkt Grund + Dauer (bisher blieb bei Fehlschlag nur die nackte Nachricht, ohne Routenkontext);
- **Originalauszug bei JSON-Parsefehler**: bei Analysefehlern von L1-Extraktion / L1-Dedupe / L2-Szenenoperationen werden die ersten 400 Zeichen
  der rohen Modellausgabe aufgezeichnet (die Schlüsselinformation zur Untersuchung von Ausgabedriften des Modells);
- **Dedupe-Entscheidungsstatistik**: einzeiliges Log `Extraktion von N Einträgen → Kandidatenabruf von M → Entscheidungen store/update/merge/skip=x/y/z/w`,
  ohne Entscheidungseintrag wird als skip gezählt;
- **Phasendauern der Pipeline**: Start/Ende der Destillationspipeline (mit der Neuzahl der Runde und der Gesamtdauer), L0-Schreibung, Phasendauern von L1/L2;
- **L0-Capture-Details**: die turn-level-Capture steigt von debug auf info (inkl. Verteilung der user/assistant-Einträge);
- **Abruftreffer**: beim Treffer Anzahl der Einträge + Query-Auszug (debug → info);
- **Startinformationsverstärkung**: die Datenverzeichniszeile trägt die Plugin-Versionsnummer; neue Zeile zur Destillationsmodell-Routenauflösung
  (ein Routenfehler zeigt sich beim Start, kein Warten mehr auf den ersten Extraktionsfehler);
- L2-Sprunggründe (Schwellfortschritt), L3-Nichtauslösungsgründe (Schwellfortschritt) ins debug-Log;
- alle Pipeline-Fehlschläge warnen mit der ersten Frame des Fehlerstapels (`errDetail`).

## [0.2.3] — 2026-08-16

Diagnostikfix: nach zwei Runden echten Dialogs hatte L0 Daten, L1 aber keinen Ertrag, und der dsh-Host ohne persistierende Logs ließ die Ursache nicht lokalisieren.

### Hinzugefügt

- **Dateilog**: die Stufe info und höher wird als Spiegel in `memory.log` des Datenverzeichnisses geschrieben (Rotation zu `.1` über 2 MB),
  Schreibfehler stillschweigend ignoriert — der dsh-Host gibt Plugin-Logs nur an die Konsole aus; jetzt lassen sich Destillationspipeline-Probleme nachträglich untersuchen.
- **L0-Capture-Sprunggründe ins Log**: von der Kaltstartwache abgefangene user-Nachrichten und Nachrichten nicht-Nutzer-Ursprungs (`source.kind≠user`)
  erhalten je eine info-Zeile — zum Diagnostizieren von Capturalücken wie „ein Zug, der nur assistant-Nachrichten übrig lässt".

### Behoben

- **L1 „erfolgreich, aber nuller Ertrag" und „Fehlschlag" unterscheidbar**: gelingt die Extraktion ohne extrahierbare Erinnerung,
  rückt auch `state.lastExtractAt` vor (bisher blieb es 0, von einer Extraktionsausnahme ununterscheidbar).
- **Speicherleck des Hot-Reloads des Abrufkontexts**: der disposer von `systemPrompt.context()` hing bisher nicht am Plugin-Lebenszyklus,
  nach dem Hot Reload blieben alte Registrierungen übrig und neue Instanzen kollidierten (`"memory:recall" is already registered`);
  jetzt meldet das Plugin bei Deinstallation alle `memory:recall` / `memory:profile` auf allen Agents aktiv ab.

## [0.2.2] — 2026-08-15

Codeüberprüfungs-Korrekturlos.

### Behoben (hoch kritisch)

- **Selbst-Degradation des MemoryDb-Konstruktors (S1/P5)**: jeder Fehlschlag von Basisöffnung / Verzeichnisanlage / PRAGMA wirft nicht mehr, sondern geht in den
  degradierten Modus (alle Lese-/Schreibungen als sichere no-ops), und `init()` verzweigt bei bereits degradierter Instanz direkt — **kein Speicherfehler kann mehr den dsh-Host-Start zu Fall bringen** (die storage-degrade-Invariante gilt wieder).

### Behoben (Suchsemantik, am offiziellen Vorbild ausgerichtet)

- **Kein Schwellfilter mehr vor der Hybrid-Fusion (P6)**: der offizielle Hybrid vereinigt die vollständigen Listen beider Wege direkt per RRF,
  `scoreThreshold` gilt nur für die Einweg-Strategien keyword/embedding (dokumentiert);
- **Hybrid-Fusionsscores normalisiert auf 0~1 (P6)**: Doppel-Glory mit rang 1 = 1.0, Einzelspalte ≤ 0.5, repariert die gebrochene Semantik, dass memory_search dem Modell Scores von 0.02~0.03 meldete;
- **Überrufkoeffizient am offiziellen Vorbild ausgerichtet (P1)**: der Kandidatenpool ist fix = limit × 3 (gleiche Formel wie der offizielle tool-Pfad),
  die zusätzliche Aufblähung des Typfilters ist entfernt (das Dokument, das fälschlich ×5 sagte, wird mitkorrigiert — die 0.2.0-Beschreibung war unzutreffend, der echte Code multiplizierte ×9).

### Behoben (Robustheit)

- **Verzögerte embedding_meta-Schreibung (P7)**: das meta wird erst persistiert, wenn das Re-Embedding vollständig erfolgreich war (oder die Basis leer war, ohne historische Vektoren); bei Fehlschlag wird beim nächsten Start neu ausgelöst — behebt die Lücke „meta zu früh geschrieben, die Vektortabelle bleibt für immer leer und das Fähigkeitsbit meldet true";
- **periodische Vektornachfüllung (P3)**: bei aktivierter Vektorfähigkeit werden alle 30 Minuten (erster Lauf 1 Minute nach Start) Vektorzeilen- und Metadatenzeilenzahl verglichen, Fehlmengen automatisch neu eingebettet — fehlgeschlagene Embedding-Batches verlangen keine manuelle Hilfe mehr;
- **Altdatenmigration real geprüft (P8)**: nur wenn alle Einträge erfolgreich in die Basis gelangt sind, wird zu `.imported` umbenannt; rename-Fehler / Teilexporte loggen echt und versuchen es beim nächsten Start erneut (idempotenter upsert);
- **L1-Dedupe-Entscheidungen auf exakte Abfragen (S3)**: `pipeline/l1.ts` holt die Einträge per `getByIds()` über die Vereinigung von Kandidaten-/Ziel-ids,
  statt je Runde die ganze Tabelle mit `all()` zu scannen.

### Behoben (Statuspanel)

- Die Stats-Versionsnummer wird aus `package.json` gelesen (bisher hart 0.1.0); `message` spiegelt den degradierten Zustand;
  `pendingExtract` wird an den echten Nachsetz-Zähler des Runners angeschlossen (P4); die Datenverzeichnisanzeige läuft einheitlich über `resolveDataDir`.

### Aufräumung (Prüfurteile)

- `EmbedHelper` bündelt die zwischen L0/L1 doppelte Embedding-Degradations-/Alarmlogik; `EmbeddingProviderInfo` wird einheitlich von
  `embedding.ts` exportiert; der Szenennavigationstitel verweist einheitlich auf den `NAV_HEADER` aus `persona.ts`;
- toter Code entfernt: `Bm25Index.add`/Schmutzflag/`snippet`-Feld, `makeSnippet`, `readTodayCount`,
  die unverbrauchten recall-Exports, der unbenutzte onProgress-Parameter von `reindex` (die Rückgabe wird zu `{written, failed}` für die Meta-Zeitpunktbeurteilung);
- die `[DELETED]`-Semantik wird dokumentarisch ausgerichtet (delete auf LLM-Seite → Dateilöschung auf der Ingenieursseite; die Liste toleriert Altmarkierungen).

## [0.2.1] — 2026-08-15

### Hinzugefügt (Eingabe-Token-Budgetsteuerung)

Kontext des Destillationsmodells 1M Tokens, im Alltag mit einem Budget von ~700k genutzt (`llm.maxInputChars`, Standard 700_000 Zeichen,
konservativ umgerechnet 1 chinesisches Zeichen ≈ 1 Token):

- **L1-Extraktion blockweise**: überschreiten die zu extrahierenden Nachrichten das Budget, wird automatisch blockweise geschnitten und kettenartig mehrfach extrahiert (Kontextnamen greifen von Block zu Block ineinander, `chunkByCharBudget`),
  keine Nachricht geht verloren — deckt beide Pfade überlanger Agent-Runden und sich anhäufender Extraktionswiederholungen (schlimmstenfalls ~840k Zeichen);
- **callLLM-Rückfallkappung**: überschreitet der Nutzerprompt eines Destillationsaufrufs das Budget, wird gekappt und vermerkt (letztes Netz für L2/L3 und Ausnahmeszenarien);
- Einzelne Nachrichten werden weiterhin captureseitig auf `capture.maxMessageChars` (4000 Zeichen) gekappt, L2/L3-Eingaben sind durch die Szenendateigrößen natürlich begrenzt.

### Konfiguration

- Das Destillationsmodell ist ausdrücklich fest auf `deepseek-official / deepseek-v4-flash` (`cordis.patch.yml`),
  wechselt nicht mit dem dsh-Standardmodell mit.

## [0.2.0] — 2026-08-15

Neubau der Speicher- und Suchschichten nach der Architektur des offiziellen sqlite-Backends von [MemoryCore](https://github.com/TencentDB-Agent-Memory) (TencentDB Agent Memory):
**JSONL-Doppelschreibung als Faktenquelle + SQLite als Haupt-Suchmaschine + gemischte Suche mit drei Strategien**.
Motivation: in der alten Implementierung las jede L0-Suchanfrage nahezu 30 Tage Dateien neu und baute einen BM25-Index im Speicher, und L1 lud vollständig in den Speicher und schrieb bei jeder Dedupe die ganze Datei neu — mit wachsender Datenmenge brachen Leistung und Abrufquote beide zusammen.

### Geändert (Speicherarchitektur)

- **Neue Suchbasis `memory.db`** (`src/store/sqlite.ts`, eingebautes Modul `node:sqlite` + WAL + FTS5 +
  cosinuse Vektortabelle vec0 von `sqlite-vec`), die PRAGMA-Kombination ist vom Offiziellen übernommen (busy_timeout/WAL/cache_size/mmap/wal_autocheckpoint).
- **Doppelschreib-Semantik (wie offiziell)**: die JSONL-Anhangdateien werden zur Backup-/Wiederherstellungsfaktenquelle zurückgestuft, **nur anfügend, nie ändernd**;
  die gesamte Suche läuft über SQLite — L0 scannt keine Dateien mehr für den Index, L1 lädt nicht mehr vollständig ein und schreibt nicht mehr vollständig neu.
- **Datenlayout am offiziellen Vorbild**: L0 `l0/*.jsonl` → `conversations/YYYY-MM-DD.jsonl`;
  L1 `l1/records.jsonl` (Vollneuschreibung Einzeldatei) → `records/YYYY-MM-DD.jsonl` (anfügend je Tag). Das alte Layout wird beim Plugin-Start automatisch in die Suchbasis importiert und zu `.imported` umbenannt (`l0/` → `l0.imported/`,
  `l1/records.jsonl` → `l1/records.jsonl.imported`), keine manuelle Migration.
- **Dedupe/Fusions-Schreibweg neu geschrieben**: die Entscheidungsanwendung von `pipeline/l1.ts` wechselt von der Vollneuschreibung `all() + replace(next)` zur offiziellen Semantik — das Fusionsergebnis wird **als neuer Eintrag angefügt** (Versionsnummer +1), und die ersetzte Ziel wird nur per `deleteBatch` aus der Suchbasis entfernt.
- Die L1-Eintragsfelder richten sich am Offiziellen aus: neu `version`, `source_message_ids`, `metadata`
  (version/metadata gehen in die Suchbasis; source_message_ids lebt nur in der JSONL-Faktenquelle).

### Geändert (Suche)

- **Dreistrategische Suche** (`recall.strategy`, Standard `hybrid`):
  - `keyword`: FTS5-BM25-Volltextsuche (`bm25()` rank → Score 0~1, Formel vom Offiziellen übernommen);
  - `embedding`: sqlite-vec-vec0-Kosinus-KNN (score = 1 − Kosinusdistanz), optionale Fähigkeit;
  - `hybrid`: beide Wege parallel + **RRF-Fusion (k=60)**, gleiche Formel wie die offizielle Mischsuche.
- **Offizielle Suchparameter transplantiert**: Überruf-Faktor (Kandidatenpool = limit × 3), Nullvektor-Kompensationspuffer des vec-KNN
  (+10), Abrufscoreschwelle `recall.scoreThreshold` (Standard 0.3, mit der FTS-Kleinkorpus-Ausnahme —
  überschreitet die Ergebniszahl nicht maxResults, bleiben niedrig bewertete Treffer erhalten), nachgelagerter Typfilter (der Werkzeugpfad nimmt den Schwellwert nicht).
- **Der Dedupe-Kandidatenabruf steigt auf die offiziellen 3 Stufen**: leere Basis → überspringen; Vektor vorrangig → FTS als Netz (zuvor BM25 im Speicher, eine Stufe).
- FTS-Abfragekonstruktion: Tokens in Anführungszeichen mit OR verknüpft + chinesische Stoppwortfilter (offizielle Kleintabelle); Tokenisierung durch die eigenen
  CJK-Bigramme + englische Worttokenisierer (derselbe Tokenizer auf Lese- und Schreibseite garantiert den Ausgleich), **keine jieba-Nativabhängigkeit**.
- **Das Format der Abrufzeilen** wird zum offiziellen Stil erhoben: `- [type|scene] content`.

### Hinzugefügt (embedding, optionale Fähigkeit, standardmäßig aus)

- `embedding.*`-Konfigurationsgruppe: jeder OpenAI-kompatible `/embeddings`-Dienst (`baseUrl/apiKey/model/dimensions`
  usw.; das `ctx.llm` von DSH hat keinen embeddings-Endpunkt, selbst mitzubringen). L2-Normalisierung des Vektorklients (wie offiziell).
- `embedding_meta` persistiert provider/modell/Dimension; bei Konfigurationswechsel automatischer Drop der Vektortabelle und **Vollre-Embedding im Hintergrund**
  (`reindex()`, ohne den Start zu blockieren).
- Ausgeschaltetes Embedding entspricht dem offiziellen `provider="none"`-Rein-FTS-Modus — **standardmäßig null externe Abhängigkeit zum Laufen**.

### Degradationskette (degrade-don't-crash über die ganze Strecke)

- Laden von sqlite-vec fehlgeschlagen → Rein-FTS-Modus (Fähigkeitsbit degradiert, einmal warn);
- Anlage von FTS5 fehlgeschlagen → `ftsSearch=false`; Schema-Initialisierung fehlgeschlagen → Suchbasis degradiert → Gedächtnisfunktionen deaktiviert, aber
  **der dsh-Host startet normal weiter** (die storageOk-Degradationskette bleibt);
- einzelner Embedding-Aufruf fehlgeschlagen → diese Suche degradiert zu FTS + einmalige Warnung, die Schreibseite überspringt den Vektor (per reindex nachholbar);
- bei der Plugin-Deinstallation wird die DB-Verbindung geschlossen (WAL auf Datenträger), registriert in `ctx.effect`.

### Abhängigkeiten

- Neue Laufzeitabhängigkeit `sqlite-vec@0.1.7-alpha.2` (gleiche Version wie MemoryCore; vorkompilierte native Erweiterung,
  die einzige native Abhängigkeit).
- `node:sqlite` ist ein eingebautes Modul von Node ≥ 22.13 (die engines verlangen bereits ≥ 22.16, keine neue Laufzeitanforderung).

### Brechende Änderungen

- Datenlayout: `l0/` → `conversations/`, `l1/records.jsonl` → `records/` (alte Daten automatisch importiert,
  Originale als `.imported` behalten, manuell aufräumbar).
- `L1Store.search` / `searchCandidates` wechseln von synchron zu **async** (der Vektorpfad braucht den Fernaufruf),
  der dritte Parameter wechselt von `type?: string` zu einem Optionsobjekt `{ type?, scoreThreshold? }` (nur interne Plugin-API;
  das äußere Werkzeug-/Abrufverhalten bleibt unverändert).

### Verifikation

- Der Smoke gewinnt/überschreibt Speicher- und Suchassertionen: SQLite-Doppelschreibung, FTS-Suche chinesisch/englisch, Typfilter, Schwellwert und Kleinkorpus-Ausnahme,
  Append/Lösche-Semantik der Fusion, **vec0 + hybrid + reindex** (deterministische Schein-Embeddings), Altlayout-Migration,
  die reinen Funktionen RRF/bm25RankToScore/buildFtsQuery — alles bestanden.
- Die Standardwert-Befüllung des Config Standard Schema (`embedding`/`recall.strategy`/`scoreThreshold`) bestanden.
- Verifikation am echten Start: `dsh --profile web` fährt normal hoch, `~/.dsh/memory/` erzeugt `memory.db` (mit WAL) +
  `conversations/` + `records/`, vollständiges Tabellenschema (l0_conversations/l1_records/l0_fts/l1_fts/embedding_meta),
  sauberer Stopp.

## [0.1.0] — 2026-08-14

Erste nutzbare Version.

- L0~L3-Schichtdestillationspipeline (Capture → L1-Extraktion/Dedupe → L2-Szenenkonsolidierung → L3-Profildestillation), Prompts transplantiert von
  MemoryCore (Doppelfamilie chat/work).
- Automatischer Abruf agent/pre-step + Kontextinjektion im Agent-Scope (`<relevant-memories>` / `<user-persona>` /
  `<scene-navigation>` / Werkzeugleitfaden), die Capture-Seite schält Injektionstags aus gegen Rückkoppelschleifen.
- Modellwerkzeuge: memory_search / conversation_search / memory_read_scene.
- Statuspanel der Einstellungsseite (Client-Bundle, Datenkanal Connection RPC).
- Behebung tödlicher Bugs: der Schema-Exportname der Konfiguration wechselt von `schema` zu `Config` (cordis liest nur `plugin.Config`,
  ein falscher Exportname lässt das ganze Profil nicht starten); das Sammeln des LLM-Streaming-Texts wird zum block-end als Autorität (behebt die Doppelausgabe).
