# Changelog (Italiano)

- [更新日志（中文）](./CHANGELOG.md)
- [Changelog (English)](./CHANGELOG.en.md)
- [日本語 changelog](./CHANGELOG.ja.md)
- [한국어 changelog](./CHANGELOG.ko.md)
- [Changelog in italiano](./CHANGELOG.it.md)
- [Changelog en français](./CHANGELOG.fr.md)
- [Changelog auf Deutsch](./CHANGELOG.de.md)
- [Changelog на русском](./CHANGELOG.ru.md)
- [Changelog en español](./CHANGELOG.es.md)

Questo file registra le modifiche rilevanti di dsh-prime-memory (chiamato dsh-memory-plugin prima del 0.5.0). Il formato segue [Keep a Changelog](https://keepachangelog.com/it/1.1.0/)
e i numeri di versione rispettano il [versionamento semantico](https://semver.org/).

> **Convenzione degli screenshot dell'interfaccia**: le voci che apportano cambiamenti alla UI conservano una registrazione reale
> in `assets/changelog/<numero di versione>/<numero a due cifre>-<breve descrizione>.png` e la richiamano nel testo con un percorso relativo: nel changelog si vede direttamente come appare la UI della nuova versione.

## [0.24.1] — 2026-10-14

### Aggiunto
- **Invariante di suffisso della proiezione (`convergeDisabledSuffix`)**: `.memory.md` / `.memory.md.disable` dipende solo da «il record è ritirato in libreria», non da `name` né dal percorso che lo ha ritirato. Verifica per voce: esistenza del file, suffisso attuale, corrispondenza dell'impronta. Un `.disable` fatto a mano è una prova lato file: si segnala come `both`, non lo si tocca.
- **Gancio libreria→file raccolto in `L1Store` (`store/memory-md-sync.ts`)**: `setFileSyncHook` scatta nei quattro punti di confluenza (`appendNew` / `retire` / `restore` / `rename`) invece che sugli otto siti di chiamata — su macchina reale 920 ritirati avevano solo 8 `.disable`, tutti dal pannello recall. I ritiri automatici (fusione, conflitto perso) e il `memory_add` del modello ora seguono da soli.
- **Il file segue la rinomina**: dopo `rename()` la proiezione si sposta sul nome nuovo (la sorella `.disable` viaggia con essa) e la chiave del ledger viene riscritta; se il vecchio path non aveva file si scrive il nome nuovo, se la destinazione è occupata si segnala senza sovrascrivere.
- **Esecuzione a rotazione e barra di avanzamento (`store/memory-md-run.ts`, nuovo endpoint `dsh-memory/mem-run-status`)**: un click spinge il cursore di export in coda alla tabella e poi quello di convergenza, con limiti tra i giri `maxPasses` / `totalBudgetMs`; il resto è dichiarato in `notice`.
### Cambiato
- **Budget di aggiornamento file per click**: `memExport.maxRecords` 300 → **2000**, più la manopola a caldo `live.mdExportMaxRecords` (0 = segue il default di deployment, senza riavvio). L'etichetta fuorviante «barriera d'azione singola» diventa **«budget aggiornamento file per click»**, unità «file/click», valore riletto dall'effettivo `appliedMaxRecords`.
### Corretto
- Il budget contava la scansione invece delle azioni su disco (anche gli «immutati» consumavano quota): 1210 record richiedevano quattro click.
- Scrittura del ledger O(n²): un `flush()` per rinomina (il ledger è un JSON riscritto per intero) → ora sporco nel ciclo, un solo `flush()` alla fine.
- Due inneschi ravvicinati si calpestavano → la proiezione è **serializzata** in background; prima il secondo task vedeva «file assente» prima che il primo scrivesse, e il ritirato restava su `.memory.md`.
- Duplicati permanenti dopo il ripristino → il `.disable` obsoleto si rimuove solo se valgono «stesso id a ledger + byte immutati da quando lo scrivemmo + il `.memory.md` è esattamente il render corrente».

## [0.24.0] — Non rilasciato (linea locale `0.24.0-local.0…3`, 2026-10-13)

### Aggiunto

- **Fonte unica del vocabolario dei tipi (`src/memory-types.ts`)**: 29 categorie originali della memoria host + 7 categorie vecchie del plugin + `unclassified` come fallback, per un totale di 37 tipi. La whitelist delle directory di proiezione, la whitelist di scrittura `memory_add`, le etichette del pannello, le stringhe enum dei prompt di estrazione e deduplicazione, i codici tipo a doppia implementazione TS/Python di memport — **tutto deriva da qui**. Prima d'ora il «set completo dei tipi» era copiato a mano in quattro punti che evolvevano separatamente: `memory_add` sovrascriveva **silenziosamente** le classificazioni esterne con `episodic`, mentre la documentazione di memport prometteva «trasparenza integrale» — due misure per la stessa cosa.
- **Distillazione del nome (`cfg.naming`)**: l'estrazione produce `title` sul posto, **definito separatamente** da `content` (title è la frase nominale che risponde a «di cosa parla questa voce», content è il corpo narrativo completo); il merge di deduplicazione emette insieme `merged_title`. Al momento di salvare in archivio, `title` è solo un **candidato nome**, deve superare la soglia di forma `validateTitle`; se non qualificato viene comunque passato al generatore di nomi — la fonte unica dell'unicità del nome non sdoppia i criteri solo perché si aggiunge un'origine.
- **Set di esempi in formato standard few-shot (`src/prompts/examples.ts`)**: esempi positivi per tipo + controesempi, lunghezza totale con budget massimo (gli esempi sono un costo fisso che si paga a ogni round di distillazione); gli esempi positivi stessi devono superare la soglia e avere lo scheletro completo, il caso d'uso usa direttamente `auditFewShot()` invece di copiare i criteri a mano.
- **Eseguibilità dei criteri di scheletro (`SKELETON_ELEMENTS` + `scoreSkeleton`)**: trasforma «senza causa-effetto, incompleto non è utilizzabile» da desiderio nel prompt a criterio misurabile e usabile per definire valori default. Limite dichiarato: euristica a parole chiave, utilizzabile solo per confronto relativo a due bracci su input identico, non è un punteggio di qualità assoluto.
- **Scheletro di directory + `_index.md` per tipo (`memory-md-skeleton.ts`)**: ogni directory di tipo contiene un file indice (nome categoria + numero di voci in archivio). Le directory vuote vengono scartate da git e dagli archivi compressi, e «manca la directory» e «questa categoria ha 0 voci» appaiono identici agli occhi di un essere umano. Idempotente: contenuto invariato ⇒ zero scritture, nessun aggiornamento mtime; con la faccia di proiezione spenta ⇒ zero azioni.

### Modificato

- **Tre valori default ribaltati in base a test A/B** (`narrativeTemplates.enabled` / `naming.enabled` / `naming.fewShot`). L'evidenza sono due misurazioni **di direzione opposta**: nel percorso reale di distillazione di sessione, senza esempi lo scheletro completo è **0.000** (0/23), con esempi **0.703** (26/37); mentre per il task di rinomina dell'esistente l'aggiunta di esempi dà **−0.113** (risposte mancanti 18/160). Conclusione: **gli esempi non si usano tra task**, entrano solo nel prompt di estrazione, non nello script di denominazione.
- **Proiezione md attiva di default** (`memExport.enabled`): l'intero piano poggia su «il file è l'autorità del contenuto + l'archivio è l'indice», default spento equivale a default non-uso. `mdSync.enabled` **resta spento di default** — scrive nell'archivio, rischio asimmetrico.
- **Ridenominazione della faccia di configurazione appartenenza workspace `workspaceHints` → `workspaceSource`**: rinomina dura senza alias compatibili (la chiave non è mai stata esposta in nessun rilascio, aggiungere un alias significa allevare una seconda fonte di verità). Attiva di default; il `path` di rotinamento adesso memorizza la **root workspace** (il valore vecchio era `E:\test\rewrite-agently\.agents`, e `targetFor` concatenava ulteriormente `.agents/memory` → si otteneva un albero orfano `.agents\.agents\memory\`, il guard-rail «torna alla root singola solo se la root non esiste» non intercetta questa forma). Backfill su macchina reale: **724/1166** voci ricevono appartenenza, `hashRecords` byte-identico.

### Corretto

- **Il caricatore del ledger sovrascriveva chiavi assolute in `relPath`**: dalla N10 in poi le chiavi del ledger sono percorsi assoluti, e la clausola «se incoerente, sovrascrivi usando la chiave» scatta ad ogni caricamento — misurato: corruzione di **1167/1241** voci; sintomi a valle: archiviazione orfani che componeva directory illegali con due punti, 75 spostamenti tutti ENOENT. Riscritto per derivare da `root` + chiave (nuova `deriveRelPath`), il lato archiviazione non si fida più del `relPath` memorizzato.
- **`--revert` non copre gli hooks**: `findArchivedOld` accede direttamente a `deps.hooks.exists`, mentre `runCli` nel chiamare revert non passa hooks (il lato apply ha `deps.hooks ?? defaultHooks`, il lato revert lo ometteva). Al primo rollback in sandbox, 74 voci in errore. Il punto critico è l'asimmetria del danno: se apply fallisce si torna con `--revert`, **un rollback rotto equivale a dire che il backup è l'unica via d'uscita**.
- **File duplicati cross-root scavalcavano «se entrambi cambiati non toccare»**: `roots = radice di destinazione della registrazione ∪ radici registrate nel ledger`, una stessa registrazione può avere un file sotto due radici; la valutazione prendeva quello della radice vecchia, la scrittura andava su quello calcolato dalla radice nuova via `targetFor`, così le modifiche umane nella radice vecchia sovrascrivevano l'autorevole, e il report sembrava perfettamente conforme. Ora si riconosce solo la radice di destinazione attuale, il resto viene conteggiato nel nuovo campo `staleRootFiles` e mostrato nel pannello.
- **Collisione di nome espelleva l'intera memoria dall'archivio recuperabile**: la scrittura `{ ...旧记录, id: 新 id }` portava nell'archivio un «nome già appartenente a un'altra riga» → collideva con l'indice partial-unique → il batch in fallback a singolo riga falliva comunque → il prodotto del merge **spariva silenziosamente** (la vecchia registrazione era già uscita, questa sostituzione non lasciava nulla). Il criterio di denominazione cambia da «name vuoto» a «**questo nome non le appartiene**».
- **Vettori «da integrare N» mai a zero mentre «reindicizzazione: niente da fare»**: la faccia espositiva `missing = total − embedded` aveva un denominatore che includeva righe uscite, e per progettazione quelle righe legittimamente non hanno vettori; le due SQL che guidano il completamento escludono le righe uscite, quindi sullo stesso schermo comparivano «da integrare 114» e «niente da fare» simultaneamente. Denominatore uniformato sulle righe attive.
- **La soglia di proiezione contava «scansione» invece di «azioni»**: `maxRecords` includeva nella quota anche le voci giudicate «immutate», il secondo click scansionava sempre gli stessi primi N — la frase del pannello «clicca ancora per continuare» era una menzogna (sintomo su macchina reale: `已写 9 · 未变 291 · 剩余 866` invariato). Ora conta solo le voci toccate su disco, il totale di scansione è coperto da `timeBudgetMs`.
- **Scrivitura ledger O(n²)**: `set()` serializzava l'intero JSON atomicamente per ogni voce. Misurato con 1200 voci sullo stesso disco: **9442ms → 1954ms** (dirty-flag + batch window + `flush()` forzato).
- **`NAME_MAX`(40) e `NAME_CLIP_MAX`(28) separati in due numeri**: il conteggio caratteri trattava ASCII e ideogrammi alla pari, `dsh-agent-teams` / `Python-3.13` — una sola parola consumava 15 quote; nomi legittimi di una o due parole venivano giudicati `too-long`; e unificare a 40 faceva sì che `deriveName` copiasse intere frasi narrative come coda (verificato sperimentalmente). Corretto anche l'hardcoded 28 dentro `validateTitle` (stessa soglia, due fonti).
- **Tre falsi positivi nella soglia di nome**: tabella-strip e tabella-reject **separate** (il soggetto nudo «utente/team» non ammazza più la frase nominale «nome utente account npm», 10 casi su macchina reale); `has-id-fragment` ristretto a «4+ cifre dopo un carattere non-ASCII» (`ADR-0006`, `Han-1413141` passano, 4 casi su macchina reale).

### Limiti noti

- La proiezione incrementale a fine-rumazione si basa su diff di base `id→updatedAt`, mentre relabel / uscita passano da `patchMetadata` senza toccare `updated_time` ⇒ **riscritture metadata-only non vengono ri-proiettate nel round corrente**.
- La sincronizzazione inversa P2 deve ancora due elementi: gancio automatico all'avvio (ridotto a endpoint + pulsante), e il batch `pending` non ancora incluso nella faccia `conflicts` in attesa di arbitrato.
- **Le traduzioni in 8 lingue non sono aggiornate dalla 0.20.0** (questa volta si inseriscono solo le voci dalla 0.22.0 in poi, il vuoto 0.20/0.21 resta, annotato a parte).

## [0.23.0] — Non rilasciato (linea locale `0.23.0-local.1…8`, 2026-10-12…13)

### Aggiunto

- **Faccia di proiezione md autorevole (P0/P1/U/N10/N11)**: colonna `l1_records.name` (chiave di identità file + indice partial-unique); `renderRecord` + ledger a doppia impronta (`dbDigest`/`fileDigest`) + endpoint `mem-export` / `mem-reconcile`; sezione «Archiviazione esterna» nel pannello; radice di proiezione cambiata a **workspace-first** (`<ws>/.agents/memory/<tipo>/<nome>.memory.md`); la valutazione di obsolescenza si collega a `.memory.md.disable`.
- **Sincronizzazione inversa P2 (file → indice)**: quadrante **a tre stati** basato sulle due digest del ledger — se solo il file è cambiato, reimporta e riscrive nel rendering canonico (elimina il loop di scrittura); se solo l'archivio è cambiato, riusa `exportRecords` per riscrivere il file; **se entrambi sono cambiati, nessun lato viene toccato**, si monta solo `pending`; `.disable` gestisce l'uscita senza eliminare il file; nuovi file di provenienza sconosciuta vengono solo contati, non importati (l'importazione deve passare dal kernel di scrittura). Endpoint `dsh-memory/mem-sync`.
- **Archiviazione P3 + eliminazione fisica**: la soglia di `exportThenPurge` cambia da hash globale dell'archivio a **proiezione a livello batch** (la distillazione concorrente bastava modificare una qualsiasi registrazione non correlata alla batch e la vecchia implementazione rendeva la pulizia eternamente inefficace); dopo l'eliminazione scrive un `retired.md` leggibile per gli umani + sposta i file proiettati della batch (inclusi `.disable`) nella directory snapshot; `cleanup-retired` in dry-run restituisce **anteprima della lista di eliminazione**; la tabella indice della proiezione a grafo aggiunge `forgetRecords` (prima d'ora in tutto il repo si aggiungeva senza mai sottrarre — le registrazioni ripristinate dagli snapshot avevano ancora la riga di proiezione e venivano trattate come «già proiettate», **mai ri-proiettate**, il grafo recuperabile mancava silenziosamente una voce senza errore).
- **P4.1 default `unclassified` + P4.2 standardizzazione del layout del corpo** (`normalizeContentMd`). L'idempotenza è vincolo duro: senza idempotenza il ledger `fileDigest` cambia ad ogni round, il loop di scrittura viene introdotto dal renderer stesso. Solo layout, non semantica (no bullet di prosa, no inserimento H1, no metadati nel corpo).
- **Archiviazione file proiettati orfani `dsh-memory/mem-orphans`**: sposta solo i file che «il ledger registra come scritti da noi e attualmente nessuna registrazione reclama questo percorso»; file di provenienza sconosciuta non presenti nel ledger **non vengono assolutamente toccati** (potrebbero essere input messi dall'utente nella directory di proiezione in attesa di sincronizzazione inversa). Non elimina, solo sposta, preservando la forma relativa e il contenuto originale.

### Correzioni comportamentali (faccia di visualizzazione recall)

- Le voci di recall non scompaiono più istantaneamente: la view trasporta `body` / `retired`, si smette di rimuovere le righe `session_recalled`, il pill mostra l'annotazione «giudicato obsoleto» con testo barrato.
- Pulizia all'avvio dei residui di uscita dell'esistente (misurato su questa macchina: 725 righe ancora sporche in `l1_fts`); l'invariante di uscita copre due percorsi di scrittura laterali (corretto «risurrezione nella faccia di ricerca dopo marcatura di obsolescenza»).
- Punteggio recall end-to-end: `-1..5` (0..5 pertinenza; `-1` dichiara obsoleto e esce), il punteggio alimenta l'indicatore di maturità (`-1/1/2` abbassano e affondano, `4/5` alzano e fanno emergere).
- Rotinamento del contenuto workspace implementato per la prima volta (ecosistema dsh → `rewrite-agently`, non-dsh → `agent-no-dsh`; **scrive solo `workspace_id`, non tocca `scope`, non tocca `updated_time`**, e sincronizza le colonne di appartenenza incorporate nelle righe `l1_fts`).

### Disciplina

- Due funzioni giganti di memport suddivise in due round (Extract Function, comportamento preservato, regressione CLI byte-identica allo standard aureo).
- La disciplina di **modifica sincrona in cinque punti** del contratto endpoint resta in vigore (`MEMORY_ENDPOINTS ≡ switch ≡ contract doppio map ≡ conteggio contract-keys ≡ config`), catena di conteggio 55→56→57→58→59.

## [0.22.2] — 2026-10-12

### Aggiunto

- Tre stati di skin (auto/light/dark) + blocco di sovrascrittura dei token; pannello 11 Tab in una sola riga compattata.
- Idempotenza `ext_key` di `memory_import` (`l1_records.ext_key` + indice partial-unique + ricevuta `deduped`).
- **Memport Connect**: parsing / pre-filtro / scansione `.mem` + registro delle origini + Tab Connect (allineamento allo standard aureo sha256 cross-implementazione).
- **Cristallizzazione delle skill**: skill-store (JSON sidecar) + rilevamento candidati + iniezione recall skill + interruttore dashboard `skillsEnabled`.
- Archi causali nel grafo G4 (causa / perché / ha corretto / sostituisce, senza incrementare `projectorVersion`).
- Derivazione a lettura della maturità G3 (badge sulla carta registrazione + annotazione nella vista di arbitrato contraddizioni, non partecipa all'arbitrato automatico).
- Gate `usageScenario` G1 end-to-end (estrazione → `metadata.dsh_usage_scenario` → fine-ranking del recall; off = byte-identico).
- Template narrativi per tipo G2 (varianti di prompt gate; off è prefisso di on).
- Due assi wing / hall cognitivo non intersecati (accessori ortogonali + lock di regressione a domini disgiunti).
- **Set di recall vivo della sessione G-live**: sidecar persistente + endpoint read-only `session-recalled` + lista read-only nel pill.
- Proiezione session-aware di `memoryRecall` (sorgente dati per la sezione «recall di questa sessione» nella sidebar brief, `init(header).id`).
- `cfg.slots.migrateLegacy` (default spento): uscita morbida delle slot rule «pinnate come permanenti il cui contenuto è già portatore di L1 attivo».

### Corretto

- Reimmissione della rumazione che riportava o aumentava il contatore pending (ruminate ora passa un messaggio vuoto, stessa semantica di `enqueueSessionSlices`).
- Finalizzazione della rumazione e `doLightRefresh`: L3 forzato a esecuzione reale + azzeramento contatore + `state.save()` su disco (corretto «pending non si azzera dopo L2/L3, al riavvio rimbalza»).

### Disciplina

- Tutte le nuove funzionalità spente di default, artefatti e iniezioni in stato off byte-identici; il contratto di visualizzazione cross-plugin (proiezione `memorySlots`) resta collegato.

## [0.22.1] — 2026-10-09

### Corretto

- **Superficie di fondo dei popover resa opaca**: il popover memoria nella barra di input (`.dsh-mem-popover`) e i pannelli a tendina / filtri (`.dsh-mem-pop`) prima seguivano `--dsw-specific-menu` dell'host, che lo risolveva in un valore vetro semi-trasparente ⇒ il pannello lasciava trasparire lo sfondo. Ora si usa un livello opaco `bg-primary` come base con un layer di alias sovrapposto (tecnica underlay), il pannello è sempre pieno qualunque sia l'alpha dell'host.

## [0.22.0] — 2026-10-09

### Modificato

- **Adattamento della faccia dichiarativa a 15rc**: 9 dsh peers coprono tutti gli rc host pubblicati (`0.1.0-rc.2..0.2.0-rc.2`, verificato uno per uno con `npm view` e coerenza di insieme per ogni linea), tutti optional; `engines >= 0.1.0-rc.2` come cancello grossolano (il gate esatto sono i peers), `package.json` e `dsh.plugin.json` sincronizzati.
- **Riallineamento delle versioni a doppio elenco**: `dsh.plugin.json` era prima derivato su `0.20.0-beta.6-dsh0.2.0.1`, questo batch riallinea byte-per-byte a `package.json` (gate V1).
- **`dsh.client.inject` ristretto a `ui-primitives` only**: `dsh-client-connection` esiste come pacchetto solo dalla 0.1.2, dichiararlo bloccherebbe l'intero ingresso client su 0.1.0/0.1.1 (`rpc.ts` già fa `ctx.get` lazy su quella connessione).

### Disciplina

- In tutti i repo di tipo build viene iniettato `prepack: npm run build` — `npm pack` attiva solo prepack, non `prepublishOnly`; è una delle tre linee di difesa contro i falsi stale-build.

## [0.21.0] — 2026-10-04

### Aggiunto

- **Sigillo dei gruppi di strumenti (pannello archivio memoria → Memoria → Sigillo strumenti)**: 5 interruttori (gestione room / grafo / rumazione / conflitti / mutate scrittura-cancellazione, coprono 13 strumenti). Spento = gli strumenti di quel gruppo **non vengono registrati**, scompaiono direttamente dalla lista strumenti del modello (non è un rifiuto in fase di esecuzione); il ribaltamento vale immediatamente via aggiornamento volatile a caldo, senza riavvio. Le letture centrali (memory_search / memory_read_scene / memory_receipts / conversation_search) e i tre strumenti degli slot non sono controllati. Contesto: molti strumenti raggruppati (come la governance di Room o la rumazione) si usano pochissimo ogni giorno, tenerli residenti nella lista strumenti occupa attenzione senza motivo e induce il modello a invocarli a sproposito.
- **Verifica di esistenza dei riferimenti mem_ in memory_slot_write**: gli L1 record_id di forma `mem_*` dentro refs passano una verifica di esistenza via `getByIds` prima della scrittura; un id allucinato o scritto male viene rifiutato subito, con l'invito a passare da memory_search — così «le memorie attivate dalla search» che entrano nei riferimenti di uno slot sono per forza record reali (la risoluzione dei nomi abbreviati lato brief ha quindi un input affidabile). I refs di tipo percorso file / URL non vengono verificati.

## [0.20.4] — 2026-10-04 (build locale, non rilasciato)

### Corretto

- **Tolleranza ai guasti totale nella risoluzione dei refViews di proiezione**: la chiamata a L1 `getByIds` dentro `resolveRefViews` è avvolta in try/catch — il drive del registry non ha protezione dalle eccezioni, qualunque throw al livello di risoluzione (sqlite occupato / backend degradato / stato del record anomalo) si porta dietro l'intero pilota degli eventi di sessione e perfino il processo dell'host. In caso di fallimento degrada a: il frame corrente non porta refViews (il front-end ripiega sui refs grezzi).

## [0.20.3] — 2026-10-03

### Corretto

- **La resa testuale di `memory_search` aggiunge l'id**: la v0.20.2 aveva aggiunto record_id al JSON di output e allo schema, ma il modello vede il prodotto del render e non il JSON grezzo — una riga renderizzata senza id, per il modello, equivale a nessun ritorno (rilevato al ri-test su macchina reale). Ora ogni risultato finisce con `— id: mem_xxx` ed è scrivibile direttamente nei refs degli slot.

## [0.20.2] — 2026-10-03

### Corretto

- **Giudizio di sporcizia della proiezione `memorySlots` allargato a qualunque evento**: prima la sporcizia veniva valutata sul rev dello store solo su `tool/result` (settled, non error) — dopo una scrittura l'aggiornamento dipendeva dal «capitare che arrivasse un altro risultato di strumento», e la consultazione cross-sessione doveva aspettare le chiamate di strumento della sessione che sta consultando; la macchina reale ha esposto che dopo una scrittura la sidebar restava a lungo su un frame vuoto. Ora il confronto rev O(1) avviene su qualunque evento committato — se il rev cambia, si ricostruisce e si spinge; la guardia isError è rimossa (il rev incrementa solo dopo un cambiamento reale, l'evento è solo un trigger, non la fonte dei dati).
- **Iniezione stabile spostata su un frame con tag `<system-reminder>`** (allineata allo house style di iniezione AGENTS.md di dsh-agent-instructions): il vettore con ruolo user non cambia, ma si presenta come scatola di tag + dichiarazione di autorità (nessuna risposta richiesta / non ripetere / non sovrascrive i prompt di sistema e le istruzioni dirette dell'utente) — risolve i modelli deboli che ripetevano letteralmente il contenuto degli slot come se fosse l'utente a parlare, disturbando le risposte normali; i tag di chiusura nel corpo degli slot vengono escaped (`</system-reminder>`), perché il contenuto degli slot non falsifichi il confine del frame.

### Aggiunto

- **I risultati di `memory_search` espongono `id` (L1 record_id)**: rompe lo stallo «la ricerca non dà l'id → non posso scrivere i refs degli slot / alimentare memory_receipts»; la descrizione nello schema annota le due destinazioni dell'id.
- **La wire view espone `refs` + `refViews`**: i riferimenti di tipo `mem_*` vengono risolti alla costruzione del frame di proiezione tramite L1 `getByIds` in `[type] 名称简述` (prima riga di content, troncata a 80 caratteri), renderizzati direttamente da brief-sidebar (≥0.5.0-beta.2); i riferimenti di tipo percorso / URL restano letterali; i record mancanti o usciti non producono alcuna voce. La risoluzione avviene alla costruzione del frame — l'insieme dei riferimenti si congela quando si scrive lo slot, quindi le modifiche successive al record L1 non confluiscono di nuovo nei frame vecchi. Lo schema auto-implementato valida i campi aggiuntivi solo «se sono presenti», così le righe di checkpoint vecchie passano intere (stateVersion non si muove).

## [0.20.1] — 2026-10-03 (promossa a stabile; tutte le capacità del canale beta dalla beta.1 in poi sono consolidate)

L'intera catena di gestione della classificazione Hall·Room (registry a due livelli / merge / rename / retire / update / incorporamento / ritiro con record / ritiro di una voce non registrata che aggiunge la voce), le pagine di gestione Hall e Room indipendenti (filtro di ricerca, collassato per default, classificazione a trascinamento con pointer, filtro di uscita), la visualizzazione del peso di invecchiamento + le statistiche d'uso del recall (entra in topN = usato). L'ultima beta prima della promozione è 0.20.0-beta.26, identica a 0.20.1 nei contenuti; il canale `dsh-0.2.0-beta` continua a ricevere le beta successive.

## [0.20.0-beta.26] — 2026-10-03

### Aggiunto (usabilità dopo la crescita di Hall/Room)

- **Filtro di ricerca per nome Hall/Room**: nuova casella di ricerca sulla pagina Hall (slug, nome visualizzato, alias, senza distinzione maiuscole/minuscole) — se il hall stesso corrisponde si mostrano tutte le sue room figlie, altrimenti restano solo le room figlie che corrispondono, e un gruppo senza corrispondenze viene nascosto; durante la ricerca i gruppi che corrispondono si espandono da sé (lo stato collassato non nasconde più i risultati); anche l'area «non registrati a crescita spontanea» viene filtrata allo stesso modo. La pagina Room ha la stessa casella di ricerca, che si combina con i chips del filtro di uscita.
- **Gruppi Hall collassabili, tutti collassati per default**: la testata del hall mostra soltanto «totale N voci · M room»; toccando la testata o il pulsante ▸/▾ si espandono o si chiudono le room figlie; pulsanti batch «espandi tutto / chiudi tutto»; lo stato di espansione viene ricordato in localStorage (`dsh.memory.halls.open`). La priorità della classificazione a clic (toccare la testata del hall per completare la classificazione) non cambia.

## [0.20.0-beta.25] — 2026-10-02

> Correzione dello stato invisibile dopo l'uscita delle room a crescita spontanea + regola di visualizzazione delle room figlie di Hall (decisione dell'utente).

### Corretto / Modificato

- **Le room a crescita spontanea non registrate passano a «ritirato / ripristina» appena escono**: prima l'uscita soft-deletteva soltanto i record, il vocabolario non aveva alcuna voce da cambiare e il pulsante restava per sempre «incorpora / ritira». Ora retire withRecords, per uno slug non registrato, **aggiunge da sé una voce di registrazione grown e la posiziona su retired** — la riga del pannello passa immediatamente allo stato «ritirato», e «ripristina» (active:true) la riporta nel vocabolario. Persistente, non si perde al riavvio.
- **La pagina Hall mostra soltanto room figlie active**: le room ritirate / uscite non compaiono più sotto il gruppo dell'hall (si vedono nella pagina Room, che include il filtro «ritirato»); anche il conteggio aggregato del gruppo comprende solo le sotto-classi active.

## [0.20.0-beta.24] — 2026-10-02

### Corretto

- **Espansione/uscita della pagina Hall allineata alla pagina Room**: anche l'espansione di una riga room nella pagina Hall carica solo record attivi (`retired:false`); dopo la conferma di uscita, se quella room è espansa, l'area di espansione si aggiorna da sé. (beta.23 aveva sistemato solo la pagina Room, la pagina Hall era rimasta fuori dalla sincronizzazione — l'altro punto dietro il «premo uscita ma non vedo alcun effetto» riscontrato dall'utente.)

## [0.20.0-beta.23] — 2026-10-02

> **Filtro di uscita completato sulla pagina Room** (i chips del filtro di beta.22 non erano mai stati scritti su disco per il fallimento a metà dello script di patch — nel pacchetto era arrivato solo il badge; questa volta ogni voce è scritta su disco con Edit e verificata tutta verde).

### Corretto / Aggiunto

- **Chips del filtro di uscita** (pagina Room, sopra il modulo di registrazione): tutte / attive (vocabolario non ritirato) / ritirate.
- **Effetto dell'uscita immediato**: l'espansione di una voce carica solo record **attivi** (`retired:false`) — dopo l'uscita l'area espansa dà «nessuna voce di memoria»; se la room è espansa dopo la conferma di uscita, l'area **si aggiorna da sé**; badge [uscito] + ripiegamento sbiadito (già in beta.22).

## [0.20.0-beta.22] — 2026-10-02

> Visibilità dell'effetto di uscita + filtro di uscita sulla pagina Room (feedback dalla macchina reale: dopo la conferma di uscita l'interfaccia non cambiava e non c'era modo di filtrare).

### Corretto / Aggiunto

- **Effetto dell'uscita immediato**: l'espansione di una voce nella pagina Room carica solo record **attivi** (`retired:false`) — dopo l'uscita l'area espansa mostra «questa Room non ha voci di memoria»; se dopo la conferma di uscita quella room è espansa, le sue voci **si aggiornano da sé**; ripiegamento in lista mista: le voci uscite mostrano il badge [uscito] e appaiono grigiate.
- **Filtro di uscita**: la pagina Room aggiunge i chips «tutte / attive / ritirate» (filtro dello stato di ritiro del vocabolario).

## [0.20.0-beta.21] — 2026-10-02

> **Ritiro con record**: quando si ritira una room si può **far uscire anche tutte le sue memorie attive** (prima esisteva solo la tabella dei verbi, e le room a crescita spontanea non avevano proprio alcun trattamento possibile).

### Aggiunto

- **`retire withRecords`** (pulsante «ritira» delle pagine Room/Hall, rosso): ritiro del vocabolario + cancellazione soft a lotti di tutti i record **attivi** sotto quella room (ogni lotto ≤200, la stessa primitiva di records-delete; reason=manual) — i record sono ripristinabili uno per uno nella sezione «usciti» della pagina memoria. Anche la riga non registrata a crescita spontanea riceve «ritira» (solo uscita dei record, nessuna voce di vocabolario da toccare). La risposta porta il conteggio `retiredRecords`.
- Il pulsante «esporta orfani» torna **nel pannello di interrogazione della memoria** (in linea nel rigo del filtro orfani).

### Corretto

- Isolamento dei test recall-usage (il caso di roundtrip persistente andava in race sotto parallelismo); corretto il display letterale di `\n` nella finestra di conferma del ritiro di RoomTab.

## [0.20.0-beta.20] — 2026-10-02

> **Room in una scheda propria** (separata da Hall): esistenza, nome e voci di una room hanno ciascuno la propria faccia di gestione; la pagina memoria non accumula più tag Room.

### Aggiunto

- **Scheda «Room»** (dopo Hall): elenco piatto di tutte le room (voci registrate ∪ non registrate a crescita spontanea) — **esistenza** (registrazione dello slug a due livelli / incorporamento grown / ritiro·ripristino), **nome** (modifica del nome visualizzato + della nota di classificazione; il rename può usare uno slug a due livelli, i record seguono), **voci** (▸ espande e sfoglia le voci di memoria di quella room, collassato per default, primo caricamento delle 10); l'export orfani e gli interruttori ad alti privilegi viaggiano con la pagina.
- **Ri-modificabile dopo la registrazione**: nuovo `room-admin update` (riscrive label/description, i campi non forniti non si toccano) + store `RoomRegistryStore.update` + strumento `memory_room_admin action=update` + voce «modifica» nel pannello — prima, dopo la registrazione, label e nota si potevano solo completare negli spazi vuoti, non riscrivere.
- **Espansione del contenuto della riga room** (come le righe room della pagina Hall): collassato per default, ▸ per espandere e vedere le voci.
- **Separazione del blocco Room della pagina memoria**: rimossi i chips slug / la paginazione / il blocco espanso (duplicavano le pagine Hall/Room), restano solo il filtro orfani «nessun legame · N» e il testo di orientamento — la navigazione e la gestione dei tag room appartengono alle pagine Hall/Room.

### Modificato

- Moduli e anteprima di merge/classificazione/rename restano appiccicati allo scroll (con molti hall non serve più scorrere su e giù per cercare la finestra di conferma).
- Trascinamento autogestito con pointer (stesso schema pointer di ego-browser, ripiegamento per i webview dove l'HTML5 DnD non scatta).

## [0.20.0-beta.19] — 2026-10-02

> Classificazione rifatta (feedback dalla macchina reale: il trascinamento HTML5 non scatta in alcuni webview; dopo aver toccato l'hall l'anteprima restava sepolta nella riga di origine e sembrava «nessuna risposta»).

### Modificato

- **Trascinamento autogestito con pointer** (schema a puro pointer come ego-browser): tieni premuto su una room / slug a crescita spontanea → un chip fantasma fluttuante segue la mano → passando sopra la testata di un hall si evidenzia in tratteggio → rilasciando si classifica. Non dipende dall'HTML5 DnD, funziona in qualunque webview. Resta la classificazione a clic («classifica» / «assegna» → stato di scelta → tocco la testata dell'hall).
- **Barra delle azioni globale**: i moduli di merge/classificazione/rename e l'anteprima dryRun **risiedono in testa alla pagina** (la finestra di conferma rossa non scorre con la riga e non resta più sepolta nella riga della room di origine) — dopo aver toccato un hall la si vede sempre.
- **Layout della riga room**: i pulsanti stanno fissi su una riga sola e non vanno più a capo (Esporta non resta più isolato su una riga a sé); nome e alias vanno a capo naturalmente nell'area informativa di sinistra (gli alias si possono spezzare a metà parola).

## [0.20.0-beta.18] — 2026-10-02

### Manutenzione

- Conto chiuso con lint: le due importazioni morte lasciate in stats.ts / rooms-registry.ts dalla sostituzione isTag→isRoomSlug di beta.17 (il gate di rilascio non le ha rilevate — dopo la pipeline `$?` prendeva il codice di uscita di tail, ricaduta nella trappola D2). Nessun cambiamento funzionale.

## [0.20.0-beta.17] — 2026-10-02

> **Correzione della perdita delle relazioni hall/room dopo il riavvio**: il caricatore di `rooms-registry.json` filtrava ancora gli slug con `isTag` — rileggendo da disco all'avvio tutte le voci a due livelli `major/minor` venivano giudicate illegali e **scartate in silenzio** (i hall a un solo segmento passavano, quindi restavano). È il terzo punto dell'uso promiscuo tra isTag e isRoomSlug; nello stesso lotto è stata disinnescata la mina gemella in `normTags`.

### Corretto

- **Il caricatore scartava le voci a due livelli** (`store/rooms-registry.ts` init): il filtro passa a `isRoomSlug`. **I dati del vostro rooms-registry.json su disco sono integri** (le voci a due livelli sono sempre state nel file, venivano solo scaricate all'avvio) — dopo l'aggiornamento e il ricaricamento le relazioni tornano da sole, senza alcuna operazione di riparazione.
- **normTags lavava via i tag con slash** (`metadata-validators.ts`): la guardia «tutti i punti di riscrittura di tags devono passare di qui» usava isTag, quindi il tag `hall/minor` riscritto dalla classificazione veniva spogliato in silenzio al primo tocco di distillazione o di ri-etichettatura. Ora gli slug room a due livelli passano (i tre livelli restano rifiutati); la fonte di verità di `isRoomSlug` è stata avvicinata, dentro questo file (per evitare un ciclo di dipendenze), e il re-export di rooms-registry resta compatibile.
- **Il filtro dei tag a due livelli di list-records veniva rifiutato per errore** (stessa forma di stats.ts tagSel): passa a `isRoomSlug` — il filtro dei record di una room a due livelli cliccata nella pagina Hall rispondeva 400.
- Test rosso prima di tutto ×3 (roundtrip di persistenza a due livelli / normTags che lascia passare / filtro dei tag a due livelli in integrazione), verificato il rosso e poi riparato fino al verde.

## [0.20.0-beta.16] — 2026-10-02

> **Slug non registrati a crescita spontanea assegnati direttamente a un hall**: ogni chip dell'area in basso «non registrati a crescita spontanea» ora si può trascinare sulla testata di un hall — incorporamento + diventarne sottoclasse in un sol passaggio.

### Aggiunto

- **Chip grown, trascinamento / clic per classificare**: trascina uno slug non registrato (per esempio `git-commits`) sulla testata di un hall (oppure tocca il pulsante «assegna» sul chip per entrare nello stato di scelta, poi tocca l'hall bersaglio) → anteprima dryRun → conferma per l'esecuzione reale. Semantica = **incorporamento in loco (from, source=grown) → rename in `hall/子类`**: i tags dei record seguono, il vecchio nome entra negli alias del bersaglio, la voce è active e non porta ⭐ (identità da incorporata). Una ricaduta su uno slug a due livelli del proprio hall (per esempio `dsh-plugin/xxx`) = incorporamento in loco.
- L'ordine della composizione è fissato da un test di integrazione (markMered esce prima se il from non è registrato — bisogna prima incorporare il from e poi rinominare); execMerge incorpora automaticamente un from non registrato.

## [0.20.0-beta.15] — 2026-10-02

> Doppia correzione consecutiva dal feedback reale sulla classificazione: ① le voci appena rinominate portavano per errore «ritirato» (così uscivano dal vocabolario di annotazione); ② il trascinamento HTML5 non funziona in alcuni webview → aggiunto il percorso principale della **classificazione a clic**.

### Corretto

- **Voce marcata retired per errore dopo la classificazione (rename)**: renameRoom riusa l'orchestrazione di merge e si trascinava dietro il «trasforma la vecchia voce in ritirata» di `markMerged` — la room appena classificata mostrava «ritirato» e **usciva dal vocabolario dell'annotatore** (il filtro listActive). Ora la coda di rename ripristina lo stato precedente (una voce active resta active anche dopo il rename); un vero merge (semantica di unione) non è toccato. Test rosso prima di tutto (unit + integrazione sulla faccia HTTP).

### Modificato

- **Classificazione a clic come percorso principale**: tocca «classifica» nella riga room → entra lo stato di scelta (il pulsante diventa «scegli hall…», tutte le testate degli hall si evidenziano in tratteggio) → tocca la testata dell'hall bersaglio → anteprima dryRun → conferma per l'esecuzione. Il trascinamento resta (usabile dove è supportato), ma non se ne dipende più.

## [0.20.0-beta.14] — 2026-10-02

> Le carte di memoria aggiungono il **peso di invecchiamento** e l'**uso del recall**, e inizia l'accumulo di dati per le «statistiche sugli effetti del peso di invecchiamento». Criteri (decisione dell'utente): **solo entrare in topN (essere iniettati nel contesto) conta come usato**; aver partecipato al tentativo senza entrare = contato solo come tentativo.

### Aggiunto

- **Campi della carta**: chip «invecchiamento N%» (coefficiente di decadenza del percorso di lettura `max(0.5, 0.5^(Δ天/半衰期))`, stessa formula e stessa origine dell'ordinamento del recall; ≤60% diventa rosso = vecchio) + contatore «used/attempts» (il title porta gli orari di ultimo uso e di ultimo tentativo). La barra degli strumenti aggiunge il riepilogo «uso del recall used/attempted(rate%)».
- **Faccia delle statistiche**: `RecallUsageStore` (sidecar recall-usage.json, stessa famiglia di disciplina di rooms-registry — un file corrotto degrada a sola lettura e non blocca mai il percorso di lettura del recall); ogni round di recall registra nei tre stati terminali (iniezione / tutti soppressi / budget azzerato) (candidati attempts++, iniettati used++, il timestamp prende il più recente); immediato in memoria + scrittura atomica debounced a 5s, 50k voci con espulsione per tentativo più recente; non montato = bypass a costo zero.
- Contratto: UiRecord aggiunge `agingWeight`/`usage`, ListRecordsResponse aggiunge `usageSummary` (campi opzionali, zero rotture per i client vecchi); il numero di chiavi del contratto non cambia.

### Criteri delle statistiche di effetto (per le analisi successive)

- usageSummary: tracked (memorie con statistiche d'uso) / attempted (Σ tentativi) / used (Σ usati) / rate (percentuale d'uso)
- L'analisi fine (distribuzione dell'uso per tipo e per fascia di età, base per tarare l'emivita) accumula dati da questa versione; la vista di analisi è da decidere a parte.

## [0.20.0-beta.13] — 2026-10-02

> Completata la logica di classificazione: portare una room sotto un hall già esistente (prima si poteva solo aggiungere un nuovo hall, oppure fondere in un'altra room cancellandone l'identità). Il pannello supporta la **classificazione a trascinamento** — trascina una room e rilasciala sulla testata di un hall.

### Aggiunto

- **Trascinamento per classificare nella pagina Hall**: la riga room è trascinabile (cursore a mano quando hiPriv è attivo), le testate degli hall sono bersagli di rilascio (evidenziazione in tratteggio); il rilascio = un rename già pre-impostato (major/minor) che porta direttamente all'anteprima dryRun, conferma per l'esecuzione — i record seguono, il vecchio nome va negli alias, la vista a gruppi la aggancia sotto quell'hall. Su touch screen o dove il trascinamento non è supportato si ripiega sul pulsante «classifica» della riga room o sui chips di scelta rapida dell'hall nel modulo di rename.
- Correzione backend: la verifica del bersaglio di `renameSlug` passa `isTag` → `isRoomSlug` — prima i bersagli a due livelli (major/minor) venivano rifiutati per errore, quindi il percorso «classifica sotto un hall» in realtà non funzionava (e l'orchestrazione di rename riscriveva prima i record e poi buttava errore rinominando il registry, lasciando uno stato a metà). Secondo la disciplina C3 di rimozione/cambiamento: test rosso prima di tutto (unit + integrazione sulla faccia HTTP, uno per uno), verificato il rosso e poi riparato al verde.

### Corretto

- Come sopra: la verifica dei bersagli a due livelli di `renameSlug` (lacuna introdotta in beta.5).

## [0.20.0-beta.12] — 2026-10-02

> Conto chiuso con lint + disciplina di rimozione messa per iscritto (C3 aggiunta a ENGINEERING-NOTES). **Nessun cambiamento funzionale**.

### Manutenzione

- **Conto chiuso eslint (13 error → 0)**: residui della rimozione di longtask (importazioni morte in stats.ts ×2, stato morto in RecordsTab) + debito di lotti più vecchi (interfaccia e let morti in recluster.ts, importazioni e let morti in rooms-registry.ts / ruminate.ts / room-review.ts / due file di test). Restano 4 warning già presenti nel baseline (gli any di primitives/tools).
- **C3 «anche rimuovere è TDD» aggiunta a ENGINEERING-NOTES**: la rimozione prima cambia i test per esprimere la nuova aspettativa (rosso) → poi toglie l'implementazione (verde); lint è un gate obbligatorio per i cambiamenti che eliminano codice (un'importazione inutilizzata = il rilevatore automatico di «non ha rimosso tutto»).

## [0.20.0-beta.11] — 2026-10-02

> I test di integrazione Hall·Room entrano in repository (`tests/hall-room.integration.test.ts`: catena completa sulla faccia HTTP × viaggio utente su storage reale, 9 casi); la prima esecuzione d'integrazione ha beccato e riparato un punto cieco dei test unitari.

### Corretto

- **rooms-get, vista unita con source scritto fisso su `pre-registered`** (introdotto in beta.4): quando le voci del registry venivano unite nella lista dei conteggi, la provenienza era scritta a valore fisso, quindi una voce incorporata (source=grown) portava per sempre il badge ⭐ pre-registrata nei chips di conteggio del pannello — identità falsata. Ora si usa la provenienza reale della voce (⭐ solo alle pre-registrate; l'incorporamento mostra grown). Causa del punto cieco dei test unitari: i test unitari di rooms-registry coprivano solo il livello store, e nessuno asseriva il source della voce grown nella riga unita dell'endpoint.

### Test

- `hall-room.integration.test.ts`: conteggio a crescita spontanea su tabella vuota → registrazione a due livelli / rifiuto degli slug illegali → incorporamento → export dei tre kind → merge dryRun a zero scritture → esecuzione reale (backup su disco / riscrittura della riga di uscita / conservazione dei metadata / accodamento del ricalcolo delle scene con source='room-merge') → rename con alias → ritiro/ripristino → tetto di 200 per la classe maggiore senza che le minori consumino quota → linea rossa del degrado a sola lettura su file corrotto (rooms-get non blocca, il disco non viene riscritto).

## [0.20.0-beta.10] — 2026-10-02

> **Rimozione completa di longtask (modalità a lungo compito)**: questa famiglia di funzioni apparteneva di diritto al lato context-compression («suggerire l'avvio della compressione» è il suo dominio), pm l'aveva caricata per errore — beta.8 ha tolto la palla fluttuante, questa versione toglie tutto il backend rimasto. pm torna al dominio puro della memoria. Se in futuro serviranno capacità come «distilla subito la coda», vanno riprogettate dalla prospettiva di pm e ri-aperte come progetto.

### Rimosso

- **Endpoint `longtask-hint-get` / `longtask-compress-tail`** (chiavi di contratto 48 → 46) e la catena `compressTailTurns` / rumazione debounced: la misurazione del contesto (`ContextUsageStore`), il rilevamento della deriva dei todo (`TodoRefStore`) e la decisione del suggerimento vengono rimossi insieme; `hooks/long-task.ts`, `store/context-usage.ts`, `store/todo-ref.ts`, tre file eliminati (incluso l'ampliamento declare module degli eventi todo/write).
- **Il blocco di configurazione `cfg.longTask.*`** (valori di default + due punti Schema): le chiavi longTask nei file di configurazione vecchi vengono ignorate dallo schema, non serve alcuna migrazione.
- **La flag `longTask` di sessione e la watermark di compressione della coda `lastTailCompressedTurn`** (session-modes): le chiavi residue nei session-modes.json vecchi vengono ignorate naturalmente dal filtro di caricamento.
- **`session-mode-set` riporta `mode` a obbligatorio** (quella opzionalità esisteva solo per l'aut-aut con longTask); i campi `longTask` di richiesta e di risposta eliminati.
- Restano: la correzione del cablaggio RPC di roomRegistry di beta.9 (sta in piedi da sola), la pagina di gestione Hall e la faccia di gestione della classificazione Room invariati.

## [0.20.0-beta.9] — 2026-10-02

> Correzione della perdita di deps lungo tutta la catena RPC del pannello: `roomRegistry` e `longTaskDeps` si perdevano quando rpcHandler montava le sources, così la gestione Room lato pannello e gli endpoint del lungo compito leggevano sempre «non montato» (la faccia degli strumenti li passa direttamente e non era toccata, quindi da beta.4 gli strumenti funzionavano mentre la registrazione dal pannello continuava a dare errore).

### Corretto

- **rpcHandler di `registerMemoryRpc` perdeva `roomRegistry`/`longTask`** (introdotto in beta.4): la distribuzione HTTP passa in modo unificato da `buildEndpointDeps`, ma le sources portavano solo 7 voci — `rooms-get` non trasmetteva il registry, `room-register`/`room-admin` buttavano «Registry Room non montato (serve ricaricare il plugin per inizializzarlo)», `longtask-hint-get`/`longtask-compress-tail` restavano sempre disabilitati. Ora scendono insieme alle sources; un test di regressione fissa l'intera catena sulla faccia HTTP (register → merge rooms-get → room-admin, rpc.test.ts).

## [0.20.0-beta.8] — 2026-10-02

> Tolta l'UI della palla fluttuante: il pannello dei suggerimenti fluttuanti apparteneva di diritto al lato context-compression («suggerire l'avvio della compressione» è il suo dominio), pm l'aveva caricato per errore — la FAB che viaggiava nel pacchetto dalla beta.1 è rimossa in questa versione.

### Rimosso

- **Palla fluttuante + carta dei suggerimenti (`client/src/longtask-fab.ts`, nel pacchetto dalla beta.1)**: rimossa interamente, il client torna alle sue due facce — `settings.section` (pannello memoria) + `conversation.input.left` (pill delle modalità), niente più UI fluttuante a livello di tutta l'applicazione. La modalità a lungo compito in sé (misurazione del contesto / riferimento todo / compressione dei turn in coda) non è toccata; gli endpoint `longtask-hint-get` / `longtask-compress-tail` restano come faccia di backend, e l'interruttore del lungo compito e l'ingresso di compressione manuale finiranno nella sezione delle impostazioni di memoria al momento della messa a punto.

## [0.20.0-beta.7] — 2026-10-02

> Terza nave della gestione della classificazione Room (**volume del pannello di gestione**): una scheda «Hall» dedicata, hall (classe maggiore) + room (classe minore) gestiti insieme — da ora consultare e gestire le Room a mano non passa più dagli strumenti agent.

### Aggiunto

- **Scheda di gestione «Hall»** (dopo «Scene»): albero a gruppi di hall — `major/minor` finiscono sotto la classe maggiore del prefisso, uno slug standalone forma un hall da sé (è insieme hall e unica room sotto di esso); la riga di testata dell'hall aggrega i conteggi + un pulsante «+classe minore» (pre-impostato `hall/`); le righe room mostrano ⭐ pre-registrata / source / stato / alias / conteggi, i ritirati sono grigiati. I termini UI Hall/Room indicano la vista a gruppi, senza alcun legame con Wing (il dominio `metadata.hall`) e con l'hall cognitivo (disambiguazione ADR-0020 §7).
- **Ingresso UI a operazioni complete (barriera memoryMutate ad alti privilegi)**: registrazione dello slug a due livelli (modulo controllato, placeholder `dsh-plugin` / `dsh-plugin/merge`); **incorporamento** degli slug a crescita spontanea (`source=grown`); **rename/merge** tramite il nuovo RPC — anteprima dryRun (numero di righe colpite + esempi) → «conferma l'esecuzione», la stessa orchestrazione dello strumento memory_room_admin (backup automatico prima dell'esecuzione + accodamento del ricalcolo delle scene al completamento); ritiro/ripristino con un clic (il ripristino non chiede una seconda conferma, il ritiro sì); export CSV dell'elenco dei record di ogni room; export del vocabolario e degli orfani riuniti in questa pagina; merge e rename portano il suggerimento «esegui quando la rumazione è libera».
- **Nuovo endpoint `dsh-memory/room-admin`** (merge/rename/retire; barriera memoryMutate, semantica di throw lato endpoint): chiavi di contratto 47 → 48. `rooms-export` aggiunge `kind='records'` (esporta l'elenco dei record per Room, `tag` obbligatorio); `room-register` aggiunge un `source` opzionale (l'incorporamento passa `grown`).
- Il blocco Room della scheda memoria dimagrito: tolto il sottopannello di gestione (l'export orfani è salito nella riga di testata), il suggerimento punta alla pagina Hall.

### Corretto

- Restringimento del tipo di kind nel ramo records di `rooms-export` (TS2322) e testo di errore ereditato con caratteri spurii; sistemate le righe di titolo duplicate beta.1-beta.5 del CHANGELOG.

## [0.20.0-beta.6] — 2026-10-01

### Corretto

- **Vocabolario dell'annotatore agganciato al registry (completata la voce mancante in beta.5)**: merge/rename/retire di beta.5 erano già in linea, ma il vocabolario dell'annotatore di candidati (`annotateOrphanCandidates`) restava una pura aggregazione a crescita spontanea — le Room pre-registrate non entravano nei candidati per niente. Ora OrphanAnnotateIO porta il registry: il vocabolario unito = le voci del registry ordinate per prime (count=0, con label/description) + la directory a crescita spontanea, con tetto 120; entrambi i percorsi di annotate, ruminate e memory_room_admin, passano il parametro. **Le Room pre-registrate da ora influenzano davvero l'annotazione dei candidati.**

## [0.20.0-beta.5] — 2026-10-01

> Seconda nave della gestione della classificazione Room (**faccia distruttiva**). dryRun è true per default — merge/rename mostrano prima l'impatto, l'esecuzione reale solo dopo la conferma; backup automatico in `rooms-merge-backups/` prima di eseguire.

### Aggiunto

- **Registry Room a due livelli**: gli slug accettano la forma `major` o `major/minor` a due livelli (per esempio `dsh-plugin`, `dsh-plugin/merge`); **tetto di 200 per le classi maggiori**, le suddivisioni in classi minori non consumano la quota delle maggiori (assicurazione complessiva 2000). Il vocabolario isTag non viene allargato (lo slash è ammesso solo al livello registry).
- **merge/rename/retire (strumento `memory_room_admin`, alti privilegi)**: merge riscrive i tags di tutti i record corrispondenti tramite un cursore (rileggi-unisci-riscrivi prima di scrivere, chiavi conservate tra roomCandidates/roomReview/hall/anchors ecc.; include le righe già uscite, coerentemente col criterio di conteggio); rename = merge 1:1 + rename nel registry (gli aliases incamerano il vecchio nome); retire è solo il ritiro del vocabolario (l'esistente non si muove). merge/rename in concorrenza con la rumazione si sovrascrivono a vicenda — eseguiteli in fasce separate (lo dichiarano sia il suggerimento dello strumento sia ADR-0020).
- **Trittico di sicurezza della riscrittura**: dryRun di default restituisce solo affected + anteprima a zero scritture; backup automatico dei record corrispondenti in `rooms-merge-backups/<ts>-<slug>.json` prima di eseguire; al completamento `invalidateRooms` automatico + accodamento del ricalcolo delle scene per (family, scene) colpite (`source='room-merge'`).
- **Sottopannello di gestione Room nel pannello** (compare dopo che gli alti privilegi sono abilitati): modulo di registrazione (slug/nome/descrizione, tramite il nuovo RPC `room-register`), export dell'elenco orfani; i suggerimenti di merge/ritiro passano dallo strumento agent (l'anteprima dryRun è più dettagliata).
- Faccia degli endpoint 46 → 47 (`room-register`).

## [0.20.0-beta.4] — 2026-10-01

> Prima nave della gestione della classificazione Room (**faccia a zero deriva**): registry vuoto = comportamento identico byte per byte a beta.3. La faccia distruttiva merge/rename/retire arriverà con beta.5 (dryRun true di default trattenuto di una versione).

### Aggiunto

- **Registry Room (sidecar `rooms-registry.json`)**: pre-registra le Room scelte a mano (slug/label/description); corrotto o vuoto → degrada indietro alla pura directory a crescita spontanea e non blocca mai il pannello né l'annotatore; tetto 200 per impedire lo spam. L'unione avviene al livello dell'endpoint `rooms-get`: una voce registrata entra nel vocabolario anche con count=0 e porta `source`/`label`, la risposta aggiunge il campo completo `registry` (letto opzionalmente dal client).
- **Endpoint di export `dsh-memory/rooms-export`** (kind=rooms|orphans, CSV diretto): rooms = registry ∪ vocabolario a crescita spontanea con i conteggi; orphans = elenco dei record attivi senza alcun legame Room (incluse le colonne di stato candidato/verifica).
- **Strumento `memory_room_admin`** (action=list|register): list elenca la panoramica registry + crescita spontanea; register pre-registra una Room (barriera ad alti privilegi, completamento idempotente) — insieme alla verifica uno per uno di `memory_room_review`, l'agent ha l'ingresso completo di gestione della classificazione «registra → pre-marca → conferma uno per uno».
- Client: i chip Room portano l'indicazione della provenienza «pre-registrata / a crescita spontanea»; i chip degli orfani portano la semantica di verifica in attesa.

## [0.20.0-beta.3] — 2026-10-01

### Aggiunto

- **Miglioramenti della classificazione Room nel pannello dei record**: ① espandi/chiudi (chiuso = testata + anteprima delle 8 Room più frequenti, lo stato di apertura è persistito); ② paginazione completa nello stato espanso (40 per pagina, ◀▶ per voltare), in sostituzione del taglio duro precedente «mostra solo i primi 40»; ③ **filtro delle memorie orfane** — primo chip «nessun legame · N» che mostra solo le memorie senza alcun legame Room (`list-records` aggiunge il canale di filtro `untagged`, `rooms-get` aggiunge `orphanCount`, stesso criterio del conteggio Room); ④ condizioni di filtro visibili subito + cancellazione con un clic. Il percorso di ricerca ha lo stesso filtro orfani.

## [0.20.0-beta.2] — 2026-10-01

> Canale dsh-0.2.0-beta +1: ottimizzazione del contesto completo della rumazione (fence morbido di repo / migrazione delle scene per progetto / catena chiusa). Nello stesso pacchetto di longtask (vedi beta.1), feedback dalla macchina reale incorporato.

### Aggiunto

- **Fence morbido di repo (ADR-0015, `recall.scopeFence.*`, spento per default)**: repoKey=basename(cwd normalizzato), calcolato alla scrittura e messo nei metadata L1 (repo_key_name/repo_key_owner/applicability, DEFAULT a zero riempimento retroattivo, non entra nella FTS né nell'hash degli snapshot); le uscite di recall e memory_search declassano dolcemente per `this-repo`/`cross-project` (×0.2 regolabile, **solo declassamento, mai esclusione**, la famiglia chat e i record non attribuiti non vengono cintati, una sentinella sul percorso di deduplicazione impedisce l'ingresso sbagliato). Zero deriva: quando è spento per default, il confronto sha1 dell'ordine di recall torna identico.
- **Migrazione delle scene per progetto (L2 repo-aware + ri-clusterizzazione)**: il prompt di consolidamento L2 vede repoKeyName/applicability — i record this-repo non finiscono più nelle scene cross-project; una coda di lavori `scene_recluster_jobs` + un consumatore nella fascia di inattività della rumazione (snapshot → cancella la proiezione dei riassunti → rollback completo se fallisce, zero nuovi canali LLM); dopo una correzione dell'appartenenza a repo cerca da sé le scene colpite per repoKey e accoda il ricalcolo.
- **Catena chiusa della compressione**: dopo che l'accodamento della compressione in coda riesce, una rumazione parte con debounce di 10 minuti (scarico → L2 → L3 → relabel → consumo della ri-clusterizzazione), correggendo l'interruzione «i record compressi restano fermi nel secchio di distillazione».

## [0.20.0-beta.1] — 2026-10-01

> Prima pubblicazione del canale beta della linea dsh-0.2.0 (tag `dsh-0.2.0-beta`): anteprima su macchina reale della modalità a lungo compito. Oltre a quanto segue, questa versione porta anche tutte le modifiche main parcheggiate in `[Unreleased]` (slot di attivazione / ancore di provenienza / lettore di evidenze / catena chiusa di uscita delle memorie / conflitti a tre assi ecc.) — erano già uscite con la linea 0.1.7, ma la linea main non aveva un numero di versione corrispondente.

### Aggiunto

- **Modalità a lungo compito (`longTask.*`, spenta per default) — la terna per le «sessioni a lunga corsa»: misurazione del contesto, riferimento del compito, compressione della coda, più un pannello di suggerimento fluttuante non bloccante.**
  - **Uso del contesto (`store/context-usage.ts`)**: ascolta il lato input dell'`usage` ufficiale di `assistant/message` (input + lettura/scrittura cache), con semantica **ultimo valore** (l'input di ogni round contiene già tutta la storia, non si accumula); azzerato e ricontato dopo `compaction/summary`. Una pura Map in memoria per sessione — il primo messaggio assistant dopo il riavvio la ricostruisce; persistere farebbe solo resuscitare campioni scaduti.
  - **Riferimento todo (`store/todo-ref.ts` + `hooks/long-task.ts`)**: ascolta l'evento strutturato `todo/write` dell'host (fotografia completa; i tipi del pacchetto non la dichiaravano fino a 0.2.0-rc.1, il plugin si auto-amplia con declare module — stesso precedente del §E di dsh-compaction). **Solo sessioni a lungo compito**: la fotografia viene scaricata in uno slot `todo` pinned (`SlotStore.refreshByTitle`, aggiornamento gestito — le riscritture ripetute dello stesso soggetto devono aggiornare in loco, altrimenti nel tetto di ≤8 slot si accumula una scia di slot chiusi), iniettato stabilmente tramite slot-recall — dopo che la compressione ha espulso il contesto vecchio, la stella polare del compito resta lì. Alle fotografie adiacenti viene applicato il rilevamento di deriva Jaccard lessicale (le riscritture della stessa fotografia non diluiscono il segnale); body ≤512 byte, troncamento dichiarato.
  - **Compressione dei turn in coda (endpoint `longtask-compress-tail` + `compressTailTurns`)**: distilla immediatamente in memoria gli ultimi N turn dentro (watermark della compressione, ultimo turn catturato] con `enqueue(force:true)` — la conversazione in coda diventa subito memoria ricercabile invece di aspettare la soglia di distillazione. La watermark (`SessionModeStore.lastTailCompressedTurn`) avanza solo in avanti, e pressioni ripetute sono naturalmente idempotenti; la modalità off è totalmente invisibile; i dati vecchi senza ancora vengono inclusi solo alla prima compressione (watermark 0) — meglio raccogliere meno che ridistillare.
  - **Stato del suggerimento (`longtask-hint-get`) + palla fluttuante (`client/src/longtask-fab.ts`)**: overlay vanilla in stile ego-browser (FAB + pannello, trascinamento / persistenza della posizione / clamp della viewport), **il suggerimento non blocca** — l'aureola che respira si accende solo quando «l'occupazione di contesto raggiunge `contextThresholdPct`» o «la deriva dei todo raggiunge `driftThreshold`» e il lungo compito non è attivo; dentro il pannello: interruttore del lungo compito (temporaneo, per sessione, **senza mode** — commutare l'interruttore non resetta la modalità dell'utente), barre di avanzamento di occupazione e deriva, pulsante di compressione manuale della coda (usabile solo con il lungo compito attivo), conteggio dei task. Polling 2s se busy / 5s se libero, errori RPC silenziosi; il contratto dei posti non cambia (settings.section esattamente uno, il body singleton non occupa nessun posto).
  - **`mode` di `session-mode-set` diventa opzionale**: o lui o `longTask` è obbligatorio — commutare solo l'interruttore del lungo compito non è più costretto a inviare la modalità (i client vecchi mandavano sempre mode, comportamento invariato). Il `mode` della risposta torna al valore attualmente vigente.

## [0.19.0] — 2026-09-29

### Modifiche

- **Adattamento a DSH 0.2.0 (compat/0.2.0)**: peerDependencies e engines.dsh (package.json + dsh.plugin.json) passano in blocco a `>=0.2.0-rc.1 <0.2.1-0` (sostituzione di un solo intervallo; la linea 0.1.7 continua a essere servita dal ramo compat/0.1.7); le 9 devDependencies dsh-* sono fissate con precisione 0.1.1-rc.2 → 0.2.0-rc.1 e si aggiunge la dipendenza type-only `@deepseek-ai/dsh-compaction`. Adattamento a livello di codice alla deriva dell'API host di 0.2.0: l'evento `agent/session-start` confluisce in `agent/created` (ascoltatori resi async per onorare il contratto seriale); la lettura degli eventi di sessione passa da `session.events` a `session.snapshotEvents()` (l'host ha deprecato la lettura sincrona integrale, la catena di degrado resta); stub di test aggiornati (semantica dell'offset del cursore di proiezione).
- **Metadati di rilascio**: versione 0.18.4 → 0.19.0; publishConfig.tag `dsh-0.1.7` → `dsh-0.2.0`; dsh.plugin.json version → `0.19.0-dsh0.2.0.1`.

## [0.18.4] — 2026-09-28

### Aggiunti

- **Recupero dopo crash (§A)**: quando l'host crollava a metà turno, quel turno di conversazione andava prima perso per sempre insieme al buffer di cattura in memoria (il pavimento di avvio a freddo del resume buttava via tutta la storia). Ora al resume il plugin riconcilia con il registro eventi persistito dall'host: il turno maggiore già scritto in L0 fa da filigrana per recuperare i turni completi che lo seguono (limite di 2 turni; i turni orfani del crash vengono chiusi dall'host con `turn/end{reason:'interrupted'}` — 98 occorrenze trovate su questa macchina). Idempotenza = filigrana + verifica di esistenza turno per turno; quando i servizi di lettura dell'host non sono disponibili, degrado a gradini (`sessionQuery.readSession` → `sessionPersistence.readFrom` → mantenimento del comportamento attuale + avviso una tantum), sempre fail-open e senza mai bloccare l'avvio della sessione.
- **Oscuramento dei payload (§C, `capture.redactSecrets`, attivo di default)**: alla frontiera di scrittura della cattura, 8 classi di segreti (chiavi PEM / intestazioni Authorization / Bearer e JWT / Cookie / forme di chiavi API di fornitori / email / numeri ≥ 9 cifre escluso le date / ID ad alta entropia) vengono sostituiti da segnaposto tipizzati `[REDACTED:<KIND>]` — un unico strettoio che copre JSONL L0, SQLite L0, input di distillazione e scritture manuali `memory_add`/`memory_import` (le due frontiere di scrittura L1 condividono lo stesso vocabolario). I valori sicuri (`example` / `$VAR` / `${{…}}` ecc.) non vengono oscurati; i segnaposto conservano la semantica di categoria e restano intercettabili dalla ricerca. Attenzione: una volta attivato, il testo L0 originale resta per sempre mutato (la ricostruzione non restituisce l'originale); `false` riporta al testo in chiaro con un colpo.
- **Anti-iniezione dei prompt di distillazione (§B)**: tutti e sei i prompt di distillazione (estrazione L1 ×3 / deduplica L1 ×3 / scena L2 ×2 / profilo L3 ×2 / proiezione del grafo / verificatore) portano ora una dichiarazione generale «frontiera del contenuto (anti-iniezione)» più la delimitazione degli slot di dati — il testo di conversazione, il bacino di memorie esistenti, i testi integrali delle scene ecc. incorporati nei prompt sono dati, non istruzioni, così un testo dall'andatura imperativa portato dalla conversazione non può più dirottare distillazione, deduplica e arbitrato. Vocabolari di decisione e contratti di output invariati al bit.

### Migliorati

- **Ricevuta di iniezione (§D)**: l'iniezione del richiamo non si segna più come vista nell'istante del ritorno; si passa allo schema «pending → ricevuta dal registro» in due fasi — il `dedupe.mark` avviene solo quando l'host scrive davvero il messaggio di iniezione nel registro di sessione (`user/message` firmato `plugin:memory` con id stabile). Le iniezioni sopraffate o annullate non soffocano più a torto una memoria (si può re-iniettare al turno successivo); senza ricevuta entro 5 minuti si degrada alla marcatura immediata (perché un guasto della catena di ricevute non rompa la deduplica), e il non confermato viene scartato.
- **Re-iniezione mirata dopo la compressione (§E)**: dopo `compaction/end` (senza errore), il prossimo turno della sessione fa un richiamo potenziato e mirato — si salta la soppressione da deduplica (la compressione ha già espulso dal contesto le vecchie iniezioni), il profilo viene re-iniettato subito, il registro di occupazione torna a zero; consumare = cancellare. Il vecchio reset di sessione integrale al compact/clear resta come via di ripiego; le due vie sono idempotenti.
- **Tracciamento strutturato (§F, `trace.*`)**: gli eventi di richiamo e distillazione si scrivono in JSONL giornaliero (`<dataDir>/trace/`, conservazione 14 giorni di default, blocco della scrittura a 5 MB/giorno + marker). L'evento di richiamo contiene l'impronta della query (di default solo metadati: lunghezza + sha256, con `trace.captureContent` si salva l'originale fino a 200 caratteri), gli id degli incontri/iniezioni, i punteggi, le durate e quattro esiti (injected/suppressed/timeout/off); l'evento di distillazione contiene runId, l'aggregato delle decisioni a sei valori (stessa fonte di `l1_receipts`, audit incrociato possibile), le durate e l'esito. Nuovo endpoint `dsh-memory/trace-tail`; la scheda «Log» della pagina impostazioni riceve una commutazione tra tre fonti di dati: registro di sistema / traccia del richiamo / traccia della distillazione.

## [0.18.2] — 2026-09-27

### Corretti

- **Adattamento alla firma del formato sessione v4 (host ≥ 0.1.7-rc.1)**: le due iniezioni di richiamo della memoria (`hooks/recall.ts` per il richiamo tra sessioni, `hooks/slot-recall.ts` per l'iniezione permanente degli slot) non usano più la vecchia firma `source: { kind: 'plugin', plugin: 'memory', form: 'recall' }` che l'host v4 respinge (scatenava un `SessionFormatError` e il fallimento dell'intero turno — la fonte dei «errori alla chiamata della memoria»); si passa alla firma producer-owned `{ kind: 'plugin:memory', form: 'recall' }`. `form`, contenuto e tempi delle iniezioni restano invariati. Base probatoria: la `source()` di `@deepseek-ai/dsh-session-format-v3-to-v4@0.1.7-rc.2` controlla solo che kind sia non vuoto e ≠ `'plugin'`, senza validare i campi di accompagnamento.
- **Compatibilità a doppia forma in lettura**: il criterio di firma `isOwnRecallSource` usato per stimare la quota di richiamo accetta insieme la nuova firma e le vecchie righe v3 — correggere solo la scrittura avrebbe fatto cadere silenziosamente a zero la «quota di richiamo della memoria» del pannello di occupazione (senza eccezioni, senza errori). `MessageSourceMap` registra `plugin:memory` per module augmentation (la map di dsh-llm 0.1.7 è `user|model|tool|'system-prompt'`, senza sportello di salvataggio plugin, estendibile per merge per producer).
- **Adattamento nativo al tool-result v4 (N1)**: la lettura dei testi probatori di `store/evidence-source.ts` riceve un ramo nativo (messaggi `role:'tool'` di prima classe in v4: content direttamente a blocchi text/reasoning, `isError` alla radice del messaggio; l'`assertBlock` dell'host respinge secchi i vecchi blocchi wrapper `tool-result`), il vecchio percorso di discesa nei blocchi resta per compatibilità storica — altrimenti i testi probatori sarebbero restati silenziosamente vuoti sotto v4. La guardia `isError` di `projection/slots.ts` passa nel frattempo al nativo.

## [Inedito]

### Aggiunti

- **Slot attivi (Active Slot) — togliere «le convenzioni che devono valere a ogni giro» dal richiamo semantico, per farne un contesto permanente che persiste di sessione in sessione.** Origine è un vero fallimento: la regola generale d'accesso alla rete (upload via ufficiale, download via mirror) era scritta in memoria, ma al turno successivo **non è stata richiamata**, e la vecchia cattiva abitudine ha continuato a correre. Il richiamo semantico è probabilistico, mentre proprio questo tipo di regole esige determinismo — da qui un canale meccanico riservato ad esse.
  - **Archiviazione**: `<dataDir>/slots.json`, indipendente da `state.json` (gli slot sono piccole rettifiche ad alta frequenza; non si può trascinare la scrittura atomica del checkpoint nel loro ritmo), riutilizzando l'`atomicWriteJson` di `util/io.ts`; in memoria si modifica solo sul posto, `list()/open()/alwaysOn()` restituiscono sempre copie (lezione delle referenze vive di `StateStore.reset()`).
  - **Terna di strumenti**: `memory_slot_write` / `memory_slot_list` / `memory_slot_close`. Scrittura e chiusura sono soggette alla barriera ad alti privilegi `live.memoryMutate` (spenta di default) — cambiare stato è severa gestione del rischio; la lettura è soggetta al gating della modalità di sessione, stessa semantica di `memory_search`. Il nuovo registrar vive in un file proprio, zero intrusioni in `tools/index.ts` (1156 righe).
  - **Iniezione permanente**: `hooks/slot-recall.ts` registra il proprio `agent/pre-step` (prepend a cascata), componibile col `recall.ts` esistente (l'ordine delle due iniezioni è inchiodato da test). Gli slot `pinned && open` si ordinano per priority decrescente e si troncano sul budget di byte; oltre, si segnala esplicitamente con `… e altri N` e si indica la via per ritrovarli — **il troncamento non è mai muto**. `validUntil` viene convertito in `expired` da una liquidazione meccanica prima dell'iniezione (puro confronto di marche temporali, nessun LLM introdotto), altrimenti «validità» sarebbe stata solo decorazione.
  - **Proiezione lato server `memorySlots`**: registrata via `ctx.inject(['sessionProjections'])` — se l'host non ha questo servizio, **si rinuncia in silenzio alla registrazione** piuttosto che far fallire il caricamento dell'intera riga di profilo. Il closure di `apply` chiude su `SlotStore` e giudica lo sporco con `revision()`: **ricostituisce solo su `tool/result` (settled, senza errore) e con revisione cambiata** (`tool/call` committa prima che `execute()` modifichi lo store — ripiegare per call leggerebbe stantio); gli eventi non pertinenti restituiscono **la stessa referenza**; `view` tiene stabile la referenza con `WeakMap` e **non contiene il body** (giudicare e generare sono ortogonali, il testo si recupera a richiesta). Questo giro non porta alcun codice client: la presentazione è rimandata al brief del giro prossimo.
  - **Schema senza nuova dipendenza**: `stateSchema` / `viewSchema` implementano `parse` da sole (il runtime del registro invoca solo questo metodo); stato legale **restituito tale e quale, stessa referenza**, stato illegale solleva; niente zod (`package.json` e lockfile fuori dalla whitelist di modifiche di questo giro).
  - Limiti: ≤ 8 slot (configurabile) / permanente ≤ 2048 byte / body ≤ 512 / titolo ≤ 60.
- **Ancore di provenienza (R7) — la memoria ora ritrova la sua **posizione reale** nella sessione.** Prima la catena di ricostruzione era spezzata: L1 portava `source_message_ids`, ma erano **id di messaggi L0** (`msg_<epoch_ms>_<hex>`), e la tabella L0 non aveva colonne `turn`/`step`; inoltre quella lista di id **non veniva affatto scritta nella base di ricerca** (il lato scrittura prendeva solo `metadata`, il campo cadeva in silenzio). Risultato: **nessuna memoria poteva essere localizzata sul suo originale**.
  - `l0_conversations` riceve le colonne `turn`/`step` (`ALTER TABLE` idempotente; le righe vecchie restano NULL = nessuna ancora, **mai indovinare a posteriori**), più un indice `(session_id, turn)`.
  - Il lato cattura riceve un fold di `step/start`: `user/message` **non porta** `step` nel payload del nucleo, lo si ricava dal `step/start` dello stesso turno; `assistant/message` usa il `{turn, step}` portato dall'evento. **I messaggi antecedenti al primo `step/start` lasciano il step vuoto** — dove mancano le coordinate non se ne inventano, è la linea rossa.
  - L'ancora alloggia nella chiave riservata `dsh_source_anchors` di `metadata_json` (mostrata dalla UI come `t12 s3`). Nessuna colonna aggiunta, nessun contratto su disco toccato. **Entrambi i percorsi di scrittura — creazione e «fusione/aggiornamento» — portano l'ancora** — altrimenti una sola fusione basterebbe a perdere le coordinate, e la fusione è l'azione più frequente delle sessioni lunghe.
  - Nuova interfaccia di lettura dell'host `MemoryDb.l0ByAnchor(sessionId, turn, step?)`: prendere i messaggi L0 **per coordinate** (non per tempo); è l'ingresso unico del futuro «lettore di prove».
- **Il pannello dei record mostra l'ancora di provenienza** (prima quella riga non mostrava mai altro che «-»).
- **Lettore di prove (R1) — rendere alle ancore il testo originale della sessione.** Il testo originale passa per il **`ctx.sessionQuery` del nucleo** in linea diretta (`readSession` / `listEvents`), senza attendere un endpoint HTTP di un plugin di indicizzazione esterno: questo plugin è un plugin host, tiene già il `ctx` in mano e risparmia così una frontiera di processo e un punto di guasto. Questo giro consegna lo **strato di funzioni pure** (cablaggio e chiamate reali su macchina: voci successive).
  - **Entrambe le forme dell'id di sessione vengono provate**: nell'indice si trovano `session_id` col prefisso `session-` e altri in uuid puro; provarne una sola **lascia sfuggire in silenzio 124 sessioni** (senza errori — semplicemente non si trovano mai).
  - `foldEventAnchors` riutilizza in lettura **la stessa regola di fold della cattura**, garantendo che le coordinate scritte e rilette parlino la stessa semantica.
  - **Proiezione fedele**: niente `stripCodeBlocks`, niente troncamento per lunghezza, niente vaglio «vale la pena ricordarlo» — **la cattura può tralasciare qualcosa per risparmiare token, la raccolta di prove no**. L'unico filtro conservato: «il contesto iniettato dal plugin non conta come parola dell'utente».
  - **Fallimenti classificabili** (il cuore di questa voce): `no-service` / `no-anchor` / `session-unreadable` / `anchor-not-found` / `timeout` / `error`. La distinzione dei primi quattro è indispensabile — prendere «non leggibile» per «mai parlato» porterebbe a giudicare sistematicamente a torto le memorie delle sessioni archiviate.

- **Uscita di scena delle memorie (cancellazione logica) e ciclo chiuso della pulizia: cancellare non significa più perdere dati.** Prima «cancellare» era **cancellazione fisica** — un passo falso lasciava solo il recupero a mano dalle fonti di verità `records/*.jsonl`. Ora la cancellazione ha due gradi, **quello reversibile è il predefinito**, quello irreversibile va chiesto esplicitamente e porta con sé il proprio esportato.
  - **Uscita di scena (cancellazione logica)**: la riga della tabella principale resta + `valid_to` chiuso + marcatore di sostituzione scritto (chiave riservata `dsh_superseded` di `metadata`, con istante / motivo / verdetto / id della coppia in conflitto); si tolgono solo le righe `l1_fts` e `l1_vec`. **L'SQL del lato ricerca non è cambiato di una parola** — nessuna deriva di query. Le tre vie di uscita (condanna all'arbitrato / sostituzione per deduplica `update`·`merge` / cancellazione manuale) **condividono lo stesso primitivo**, altrimenti prima o poi comparirebbe l'incoerenza «una via cancella ancora in durissimo» — incoerenza che si svelerebbe solo al momento del passo falso.
  - **Endpoint 33 → 38**: `records-retired` (elenco degli usciti) / `records-restore` (recupero) / `cleanup-retired` (pulizia fisica) / `snapshots-list` (elenco degli istantanei) / `snapshot-restore` (reimmissione dall'istantaneo). I tre elenchi (tabella di corrispondenza di `contract.ts` / whitelist `MEMORY_ENDPOINTS` di `stats.ts` / `case` di distribuzione) e l'asserzione del totale degli endpoint si aggiornano insieme — tralasciando una sola delle quattro, l'endpoint risponderebbe 404 in perpetuo, mentre il `catch` del `rpc` lato cliente inghiottirebbe l'eccezione in silenzio e il pannello sparirebbe d'un blocco.
  - **`memory_delete` fa uscire di scena solo 1 voce per default** (prima 3) e riceve un percorso **esatto** via `ids` (saltando l'incrocio semantico). La vecchia implementazione cancellava per lotti col top-N semantico e in pratica **ha cancellato per sbaglio due vere memorie senza legame** — la precisione della cancellazione deve essere garantita dall'ID esatto, non dalla somiglianza.
  - **La pulizia fisica corre di default come prova a vuoto**: omettere `dryRun` vale `true`. Anche in esecuzione esplicita, prima si scatta uno **istantaneo integrale** della base e lo si **verifica per hash del contenuto**; se non torna, stop e nemmeno una riga cancellata. Per farlo, `deleteL1Batch` viene raccolto in **un unico chiamante** (`exportThenPurge`), inchiodato da un test di guardia sul sorgente — «non esiste un percorso di cancellazione fisica che aggira l'esportazione» diventa un fatto strutturale, non una promessa.
  - **Il biglietto di ritorno viene aggiunto**: `restoreL1Snapshot` finora era **chiamato solo dai test** — il principio «prima l'esportato, poi la pulizia» valeva a metà: l'esportato c'era, l'uscita di reimmissione no; al momento del guasto restava solo decifrare a mano `l1-records.json`. Ora arrivano `snapshots-list` / `snapshot-restore`: accettano solo **nomi di directory** degli istantanei (percorsi e `..` rifiutati), prova a vuoto per default, e riferiscono onestamente `stillRetired`. Questa voce è necessaria: la pulizia pulisce solo le voci **già uscite di scena** e l'istantaneo viene scattato **prima** della cancellazione, dunque tutto ciò che si recupera porta il marcatore di uscita — **ritornato nella tabella principale ≠ tornato nel richiamo**; senza dirlo, si crederebbe la ripristinazione finita. Per un vero rollback in un solo passo: `unretire: true` (riusa il `restore` esistente, nessun nuovo percorso di scrittura).
  - **Pannello**: la pagina dei record riceve la sezione «Usciti (recuperabili)» (ripiegata per default, caricata solo quando si apre, per non rallentare la navigazione ordinaria); il testo di conferma della cancellazione ora dice esplicitamente «recuperabile». **La pulizia fisica non ha di proposito nessuna voce nel pannello** — un'azione irreversibile resta solo su RPC / via modello.
- **§C Congelamento delle contraddizioni: anche le contraddizioni dello stesso lotto si congelano (sistemato «la frase propria del modello veniva rifiutata alla porta»).** L'indagine ha rilevato che il punto ③ di `validateConflictPair` esigeva in modo rigido che «l'altra parte fosse un record noto nel bacino di candidati», ma gli id delle nuove memorie dello stesso lotto non ci sono (nascono in quel turno e non sono ancora in base). Così, nel caso più tipico di «la macchina non può decidere» — due nuove memorie dello stesso turno si contraddicono — anche una `conflict` emessa correttamente dal modello ricadeva necessariamente su `store`. Prova: il modello emette in 7/7 dei casi, ma quel salto non arrivava mai alla base (`conflict_pending` 0 righe dalla sua creazione, `l1_receipts` 0 ricevute `conflict`, contro `store 381 / merge 204 / update 172 / skip 7`). Rimedio: `validateConflictPair` riceve l'opzionale `batchIds` (assente = comportamento vecchio), restando il requisito «esattamente una delle parti è la memoria presente» per garantire l'unicità dell'accoppiamento; e una balaustra per la coda piena — **quando il perdente appartiene alle nuove memorie del turno, non si fa il saldo automatico**; altrimenti i prodotti appena estratti uscirebbero subito di scena senza che nessuno ne sia avvisato: non si parcheggia e l'ingresso in base procede regolarmente.

- **§C Il congelamento delle contraddizioni ora capisce «le tre assi temporali» — una contraddizione di contenuto con anteriorità nel tempo non finisce più invariabilmente all'umano.** Un record di memoria porta di suo tre assi temporali non sostituibili (istante di registrazione `createdAt/updatedAt`, validità fattuale `validFrom/validTo`, persistenza `persistence`), ma la rilevazione dei conflitti usava solo l'istante di registrazione: giudicando `conflict`, il rilevatore non vedeva né validità né persistenza e prendeva spesso per un caso da arbitrare «un fatto vecchio rimpiazzato da uno nuovo»; anche il pannello di arbitrato mostrava solo i testi delle due parti, senza confronto di validità — un giudizio alla cieca. Questo giro collega le tre assi a entrambe le estremità del congelamento:
  - **Lato rilevazione**: il bacino unificato di candidati trasmette al rilevatore, **con il congelamento attivo**, `valid_from_ms` / `valid_to_ms` / `persistence` di ogni memoria; la clausola dell'azione `conflict` riceve un «aiuto di giudizio dalle tre assi» — in caso di contraddizione di contenuto, confrontare prima validità/persistenza; se una parte è già scaduta o nettamente più recente, orientare a `update`/`merge` invece che `conflict`. **Le tre chiavi e la clausola stanno tutte sotto il gating di `conflictFreeze`**: nello stato spento il prompt utente è **byte per byte identico** a quello antecedente l'aggiornamento (vedi «Corretti» qui sotto e [ADR-0012](./docs/adr/0012-conflict-3axis-advisory-time-axes.md)).
  - **Lato arbitrato**: `ConflictPairView` riceve i campi opzionali delle assi `winner_*` / `loser_*` (retrocompatibili); la lista da arbitrare e il rendering aggiungono a ogni coppia il confronto «validità da/a, persistenza», per vedere d'un colpo d'occhio chi è più recente, chi è già scaduto.
  - La macchina **non decide ancora da sé**: le tre assi sono solo fatti di appoggio; la conclusione finale continua a scriverla l'umano (o la valvola di sicurezza: timeout / coda piena) — i valori di `ConflictResolution` sono invariati.

- **§C Tre classi di conflitto + raggruppamento per claim + traccia degli scarti (Fase 3-4).** Il conflitto non è più solo la «contraddizione dura» — il LLM può ora giudicare `hard` (fatti reciprocamente esclusivi), `conditional` (contraddizione solo con premesse diverse), `supersession` (il nuovo rimpiazza il vecchio). Il pannello mostra per segmenti delle tre classi, ognuna con titolo e spiegazione propri; il pulsante `defer` permette «visto ma non ancora deciso» (azzera il timeout, conta le riletture). La colonna `claim_key` permette di marcare più coppie di conflitto sul medesimo tema, e il pannello raggruppa su di essa. Le decisioni di conflitto illegittime e scartate si interrogano con lo strumento `memory_conflicts_rejected` e l'endpoint `dsh-memory/conflicts-rejected`.
  - `conflict_pending` riceve due colonne `conflict_type` / `claim_key` (migrazione `ALTER TABLE` idempotente).
  - Il conteggio della quota conta solo `hard`: `pendingHardTotal` filtra per tipo; `conditional` / `supersession` non consumano quota.
  - Hash di proiezione congelato: la proiezione a 7 campi `projectConflictsForHash` esclude le nuove colonne, la verifica degli istantanei esistenti non cambia.
  - Pannello: `ConflictsTab` con segmentazione a tre classi + pulsante defer + testi delle tre assi + contatore delle riletture + mostra della chiave di claim.

### Corretti

- **Lo prompt nello stato spento portava di nascosto tre campi delle assi (toccati i deployment col default).** La prima versione iniettava `valid_from_ms` / `valid_to_ms` / `persistence` **incondizionatamente** nel bacino di candidati, mentre quella chiamata LLM leggeva l'interruttore solo per il system prompt ⇒ con `conflictFreeze=false` (il default dei deployment), il modello vedeva per ogni candidato 3 chiavi in più **senza alcuna clausola che le spiegasse**: token sprecati e un input cambiato. Le tre chiavi stanno ora sotto il gating di `conflictFreeze`, lo stato spento produce un prompt utente **byte per byte identico** a quello antecedente l'aggiornamento; il criterio sale nel frattempo da «non contiene tale sottostringa» a **ancora golden sha1 + verifica inversa** (se si rompe il gating, il test deve arrossire).
- **Il pannello diceva «congelamento delle contraddizioni non attivo», mentre l'interruttore era chiaramente acceso.** Gli endpoint `conflicts` / `conflict-resolve` leggevano la **configurazione statica del deployment** `cfg.conflictFreeze.enabled`, mentre il pannello scriveva nelle **impostazioni runtime** (live). Il default del deployment è sempre `false`: l'interruttore era acceso, `settings.yaml` portava `true`, e la pagina persisteva ad annunciare lo spento. Passaggio a `effectiveCfg(cfg, live)`, la stessa risoluzione della pipeline di deduplica — l'interruttore ha **una sola** fonte di verità, lettore e scrittore devono guardare lo stesso stato, altrimenti si ottiene «l'elenco dice acceso, l'arbitrato dice spento», un dialogo tra sordi.
- **`dsh-memory/embedding-reindex` dichiarato ma rispondente 404 in perpetuo.** L'endpoint stava nel contratto, ma mancava sia nella whitelist `MEMORY_ENDPOINTS` sia nel `case` di distribuzione; intanto `startReindex()` era **codice morto** — il blocco «indice vettoriale» della pagina impostazioni offriva dunque solo «Annulla», mai «Avvia». Whitelist + `case` + test aggiunti.
- **`UiRecord.sourceMessageIds` era un campo morto.** Leggeva da `l1_records` una **colonna mai esistita**, ricadeva dunque sempre su `[]`, e la riga di provenienza del pannello **non è mai stata renderizzata**. Sostituito con `sourceAnchors`, che legge dati veri.

## [0.17.0-dsh0.1.7.1] — 2026-09-25

> Prima pubblicazione della linea di compatibilità host **0.1.7** (dist-tag `dsh-0.1.7`, basata su main @ 85d9b05). **Solo per host ≥ 0.1.7-rc.1**;
> gli host 0.1.5 / 0.1.6 dovrebbero continuare a usare la linea di versioni del tag `dsh-0.1.5`. Contenuto = main integrale + il seguente adattamento.

### Modifiche

- **Gli interruttori runtime migrano in una sezione volatile del Config (superficie dichiarativa delle impostazioni di 0.1.7).** L'host 0.1.7 ha eliminato entrambe le generazioni di API di registrazione imperativa (`settings.register` / `installSection`); gli interruttori runtime (generale/cattura/distillazione/richiamo, catene di routing della distillazione, sovrascritture dell'embedding remoto, barriera di scrittura-cancellazione — 20 chiavi) sono ora portati da un `.volatile()` di intera sezione su `memorySchema.live`: l'host proietta automaticamente i campi volatili in un modulo di impostazioni, e i cambi runtime passano per `ctx.settings.update` → configEditor → patch del profilo → commit volatile-only del loader (senza remontare il plugin). Il contratto `LiveSettingsHandle` non cambia, RPC e tutti i consumatori non si toccano. **Il plugin porta la propria pagina impostazioni → il modulo autogenerato dell'host è spento** (`suppressAutoSettingsForm`).
- **⚠️ I vecchi valori di impostazioni non migrano automaticamente**: la sezione `dsh-memory` del vecchio `settings.yaml` portava chiavi piatte di primo livello, incompatibili con i nuovi percorsi `live.*` (e il suo booleano `conflictFreeze` collide con la sezione oggetto omonima del nuovo Config), quindi l'importatore dell'host respinge l'intera sezione. Dopo l'aggiornamento, riscrivi a mano i vecchi valori nella patch del profilo come `- id: dsh-memory / config: { live: {…} }` (nomi delle chiavi identici al vecchio namespace, solo un livello `live.` più in profondità).
- devDeps passate allo stack 0.1.7 (cordis 4.0.4 / schemastery 3.18.4 / cordis-plugin-loader 1.0.5), senza essere spedithe ai consumatori.

### Corretti

- **Regressione della perdita silenziosa della prima scrittura**: i file di lock venivano creati prima della scrittura; se la directory padre del bersaglio non esisteva ancora, `open('wx')` falliva con ENOENT e gli store lo inghiottivano come warn → prima scrittura persa in silenzio. `rmwJson` ora fa `ensureDir` prima di prendere il lock (incluso con le correzioni della linea main).
- Contiene inoltre tutto della linea main: indurimento dello strato file (scritture atomiche / classificazione in lettura / versione fail-closed / lock di file / sicurezza dei percorsi — vedi le voci [0.16.1] e Inedito).

## [0.16.1] — 2026-09-24

### Aggiunti

- **«Vaglio degli usciti» nel pannello dei record**: i record a cancellazione logica per disegno non si nascondono (sono recuperabili), ma mescolati ai record attivi erano difficili da distinguere — la riga di strumenti dell'elenco riceve ora un filtro a tre stati «**Tutti / solo attivi / solo usciti**». Il `listL1` del backend riceve lo stesso filtro a tre stati, stesso criterio (default: tutto; snapshot/ricostruzione non toccati; il criterio di `retired:true` e quello di `listRetiredL1` sono lo stesso, le due viste mostrano le stesse righe); contratto `ListRecordsRequest.retired?: boolean`. Il vaglio vale solo sul percorso di navigazione — la ricerca per parola chiave copre solo la faccia di ricerca, dove i record usciti di per sé non sono. «Carica altro» e il rinfresco automatico dopo cancellazione/ripristino conservano lo stato del vaglio corrente.

### Corretti

- **Dopo la conferma di «cancella memoria», il pannello sembrava ignorare la richiesta — lo stato di uscita non veniva trasmesso alla UI.** L'uscita logica (retire) ha sempre funzionato lato server (`valid_to` chiuso + uscita dalla faccia di ricerca + recuperabile), ma per disegno l'elenco attivo **conserva** i record usciti (il test `l1-retire` inchioda «il percorso di navigazione del pannello non nasconde i record usciti»), mentre il contratto `UiRecord` non aveva alcun campo «già uscito», le righe dell'elenco attivo non avevano nessuna differenza visiva e la zona «usciti» era ripiegata di default — dopo la conferma l'utente vedeva **un record identico in tutto e per tutto** e concludeva naturalmente che «la cancellazione non ha fatto effetto».
  - Il contratto riceve `UiRecord.retired` / `retiredReason`: derivati da `hitToUiRecord` da `valid_to` + marcatore di sostituzione, trasmessi uniformemente dall'elenco attivo e dai risultati di ricerca.
  - L'elenco attivo rende i record usciti con un **badge «uscito · motivo» + tutta la carta ingrigita**, e il pulsante in riga passa da «✕ Elimina» a «Ripristina» (via `records-restore`, con rinfresco automatico dopo il successo) — nell'istante della cancellazione l'interfaccia cambia subito e la confusione del secondo clic (no-op idempotente) sparisce.
  - Nuovo `tests/ui-retired-flag.test.ts` che inchioda la mappatura (attivo / uscito manualmente / uscito per sostituzione / forma senza `validTo`).

## [0.16.0] — 2026-09-24

### Corretti

- **Tutta la catena di etichettatura Wing del ricalibro / riempimento a un clic era inutilizzabile**: il prompt chiedeva al modello di restituire `{"id":…,"wing":…}`, ma il parsing leggeva `item.hall` → mai ottenuto nulla → l'intero lotto scartato in silenzio **(misurato: `wingLabeled=0 / tagged=0 / llmSkipped=60`, mentre il log mostrava l'LLM in pieno successo)**. È il **3° danno collaterale della stessa specie** dal cambio di nome hall→Wing (i primi due: `cfg.hall`, il `hall` di session-modes) — i nomi dei campi JSON in un prompt appartengono al **protocollo di filo** e non devono seguire i cambi di nome dei testi della UI. Il parsing ora legge `wing` con validazione per enumerazione; **ogni scarto deve lasciare traccia** (una voce warn per appaiamento degli id fallito, una per valore illegittimo), e il `catch` morto mai scatenato viene tolto.
- **`embedding-state-get` scende da 2,5–3,1 s al millisecondo.** Eseguiva a ogni chiamata 6 COUNT sul posto, due dei quali nella forma `l1_records LEFT JOIN l1_vec … IS NULL` — `l1_vec` è una **tabella virtuale vec0 (1024 dimensioni)** che con predicati ordinari degenera in sondaggio riga per riga. Sostituito con una sottrazione «totale − già incorporati − skip» (misurato: L1 55 ms → 0 ms, L0 371 ms → 3 ms), più una **cache TTL a livelli** (1 s se occupato / 30 s a riposo + invalidazione esplicita a fine di ricostruzione/commutazione/riempimento).
- **La parte meccanica del ricalibro non carica più tutto d'un fiato** con `l1.all()`. Passaggio a paginazione a cursore + solo le colonne `id/type/metadata` (`getAllL1Lite`), con cessione di mano dopo ogni lotto di 200; il riscritto passa per `patchL1Metadata` (**toca solo il metadata, mai il testo**, inchiodato da test).

### Aggiunti

- **Strato Room: classificazione auto-crescente per etichette**. Nelle cinque strati di MemPalace, Room sta sotto i Wing/hall cognitivi e si **deriva dinamicamente** da `metadata.tags` (aggregato `json_each`, zero schema, zero registro) — appena una nuova etichetta entra in base, diventa un nuovo Room. Nuovo endpoint `rooms-get` e blocco di classificazione Room nel pannello dei record (un clic filtra per quell'etichetta; `list-records` riceve un canale di filtro per `tag`). Rilevato sulla macchina: **78 Room** (aggregato in 2 ms).
- **Modulo di validazione condiviso `src/metadata-validators.ts`**: `isWingId` / `isCognitiveHall` / `isTag` / `normTags` accentrati in un solo luogo. Prima il lato Wing era **completamente privo di validazione** (qualsiasi stringa non vuota poteva scriversi in `metadata.hall`) mentre il lato hall cognitivi aveva un rigido `isCognitiveHall()` — questa asimmetria di enumerazioni era un buco nell'integrità dei dati.
- **Isolamento worker dell'elaborazione in background (porzione stretta di B)**: estrazione di un confine `MemoryBackend`, gli accessi SQLite dell'elaborazione a lotti in background (rumination/riempimento/ricalibro) si trasferiscono in `worker_threads` e non occupano più la event loop principale dell'host; se non parte, ritorno automatico in-processo con warn (**il fallimento dell'isolamento non deve mai rendere vana l'elaborazione in background**). I percorsi caldi (richiamo/cattura) non cambiano di una riga — interrogano la base a ogni turno, la messa in thread li farebbe pagare l'IPC.
- **Progresso dei lotti distinguibile per segmento**: ispezione meccanica / assegnazione dei Wing / estrazione delle etichette hanno ciascuno label e progresso di lotto propri (prima `sub` aveva valore solo nella fase LLM; durante le 1439 riscritture della fase meccanica il pannello restava totalmente vuoto).

### Modifiche

- La riscrittura del metadata del ricalibro passa da `l1.upsert` a `patchMetadata`. **Toccare solo il metadata non avrebbe mai dovuto ricalcolare l'embedding** — prima ogni riscrittura di record lanciava un embedding, un solo ricalibro poteva sprecare fino a 900 chiamate di embedding.


## [0.12.0] — 2026-09-17

### Aggiunti

- **Ricostruzione manuale dell'indice vettoriale (endpoint `dsh-memory/embedding-reindex` + blocco «indice vettoriale» nella pagina impostazioni)**. Prima la ricostruzione aveva solo due vie: la catena di rilevazione dei cambi di `db.init` all'avvio, e il rimpiazzo dei mancanti del backfill periodico — **l'utente non aveva alcun ingresso manuale**. Nella pagina impostazioni si vedeva solo «Annulla» (e solo durante una ricostruzione in corso), mai «Avvia», né quanti erano già incorporati o quanti mancavano. Ora colmato:
  - **Faccia degli endpoint 31 → 32**. Nuovo `EmbeddingReindexStartResponse` (`{accepted:true}`), **ritorno all'accettazione, il progresso non passa qui** — il client continua a sondare il campo `reindex` di `embedding-state-get`. Due semantiche di progresso in contraddizione tra loro erano un incidente in agguato: si ne lascia deliberatamente una sola. I tre elenchi (tabella di corrispondenza di `contract.ts` / whitelist `MEMORY_ENDPOINTS` di `stats.ts` / `case` di distribuzione) e l'asserzione del totale degli endpoint si aggiornano insieme; tralasciando una sola di queste quattro, l'endpoint risponde 404 in perpetuo, mentre il `catch` del `rpc` lato cliente inghiottisce l'eccezione in silenzio e il pannello sparisce d'un blocco.
  - **`EmbeddingStateView` riceve `vectors`**: per L1 / L0 separatamente `embedded` / `total` / `missing` / `skipped`. Da qui viene «X incorporati / Y in totale». Il **sentinella `-1` dello strato db passa tale e quale** — «la capacità vettoriale non è disponibile» e «non uno solo incorporato» devono essere due frasi diverse sulla superficie; piegate in un solo numero, l'utente andrebbe a cliccare un pulsante che non reagirà mai.

### Corretti

- **Rifiutare le richieste di ricostruzione «accettate ma che non gireranno mai»**. La prima riga di `L1Store.reindex` / `L0Store.reindex` **cortocircuitava in silenzio** su `0/0/0` quando la capacità vettoriale non era pronta. Senza soglia all'ingresso, la UI avrebbe mostrato «ricostruzione completata, zero da colmare» — mentre la verità è che **non era mai cominciata**. Questa trappola era commentata già in `src/index.ts:240`, ma copriva solo la catena d'avvio; l'ingresso manuale era una breccia nuova. `startReindex()` porta ora le cinque soglie tutte in anticipo, ciascuna con un testo **azionabile**: plugin disinstallato / ricostruzione già in corso / commutazione della sorgente d'embedding in corso / **sorgente d'embedding spenta** (`currentInfo` vuoto) / **servizio d'embedding non pronto** («prima attivala» e «aspetta ancora» sono due frasi diverse, non si fondono in una). A tal fine i due store ricevono un accessor `vectorsReady()` — l'`helper` è privato, dall'esterno nessuno poteva chiedere.
- **Lo stub `db` di `embedding-subsystem.test.ts` era incompleto.** Aveva solo `swapProvider` / `markEmbeddingSynced` e aggirava il controllo dei tipi con `as never`, perciò non era mai stato scoperto; appena `snapshot()` cominciò ad aggiungere i conteggi vettoriali, esplose (`getVecSkipSet is not a function`). **Completare lo stub invece di rendere `vectorCounts` difensivo**: la firma dei tipi dichiara un `MemoryDb` completo; inghiottire i metodi mancanti nasconde anche i veri errori di cablaggio.

### Test

- 5 nuovi casi: rifiuto a stato spento / rifiuto se non pronto / accettazione e pilotaggio di L1+L0 con rifiuto immediato di una seconda richiesta parallela / rifiuto dopo la disinstallazione / criteri di conteggio di `snapshot`. **Ogni percorso di rifiuto afferma insieme «eccezione sollevata» e «chiamate a valle zero»** — affermando solo l'eccezione, un'implementazione che «chiama prima a valle, poi solleva» passerebbe comunque.
- **Controprova**: tolta temporaneamente la guardia di prontezza, `capacità vettoriale non pronta → rifiuto, non mentire «accettato»` arrossisce davvero (`expected [Function] to throw an error`), e riverde al ripristino.
- Totale **39 file / 403 casi** verdi; `typecheck` (tre tsconfig), `build`, `smoke` pure verdi.

## [0.11.0] — 2026-09-13

### Compatibilità (adattata secondo la documentazione del framework di plugin DSH)

- **Compatibilità multiversione della registrazione delle impostazioni (0.1.1-rc.2 ~ 0.1.5-rc.2)**. `src/settings.ts` **importava come valore** `settingsNamespace()` da `@deepseek-ai/dsh-settings`, simbolo rimosso dalla v0.1.3+ — su un host 0.1.3+, già il caricamento del modulo sollevava `Failed to load plugins` e trascinava giù tutto l'albero dei plugin. Ora:
  - il namespace diventa il letterale stringa `'dsh-memory'` (la metà browser guarda solo la stringa grezza, equivalente tra host vecchi e nuovi); resta solo l'import di tipi (cancellato alla compilazione, nessun rischio al caricamento);
  - la registrazione passa per tre rami runtime: priorità a `settings.register()` (presente su tutte le versioni bersaglio, restituisce uno scope get/watch/update, interruttori live e scritture UI passano tutti di lì); ripiego sul ponte `settings.installSection()` (superficie di servizio v0.1.2+, solo se manca register; le scritture runtime sollevano esplicitamente un errore di business); non avendo nessuno dei due, degrado a sempre-attivo — la regola ferrea «impostazioni assenti non devono mai fare cadere l'host» resta intoccabile;
  - `SettingsScope` diventa un tipo strutturale locale, più nessuna dipendenza dagli export di tipi del pacchetto.
- **Nuovo `dsh.plugin.json`** (manifesto di scoperta DSH: id / engines.dsh `>=0.1.1-rc.2 <0.2.0-0` / components puntano a `dist/`), allineato alla struttura standard di `dsh-plugin-template`.
- **`@deepseek-ai/dsh-*` passati a peerDependencies opzionali e intervalli allentati** (`^0.1.1-rc.2 || ^0.1.2-rc.1 || ^0.1.3-rc.1 || ^0.1.5-rc.2`), `@deepseek-ai/cordis` resta obbligatorio — allineato all'esigenza B.3 della sottomissione awesome-dsh-plugin.
- **Nuovo `screenshots.json`** (8 registrazioni, richiamano `assets/img/`), la carta di sottomissione può mostrarli.

### Modifiche

- `package.json` `version` sale a 0.11.0; npm `files` riceve `dsh.plugin.json` (`screenshots.json`, per la convenzione di rilevazione di awesome-dsh-plugin, vive solo nel repository git, non nel pacchetto npm).

### Da verificare sul campo

- Su v0.1.5-rc.2, la semantica degli slot `conversation.input.left` / `settings.section` e di `session.surface.nodes` di Session V3 (stima di occupazione) non è ancora verificata sul campo; vedi la matrice di compatibilità del README.

## [Inedito]

> 📘 **Manuale delle insidie e delle cure**: le insidie davvero incontrate in questo e nei due giri precedenti, e le direzioni prese a torto, sono sistemate sistematicamente in
> [`ENGINEERING-NOTES.md`](./ENGINEERING-NOTES.md) (una pagina di consultazione rapida + per voce «sintomo / causa radice / pratica corretta / come verificare»
> + lista di verifica prima della consegna). Comprende: `nullable` che fa crollare l'intero albero dei plugin, deps non iniettate mascherate da un ramo di ripiego,
> parser duplicati condannati a marcire, bandierina di guardia in `finally` equivalente a non averla, lungo task senza `running` quindi interfaccia senza progresso,
> campo opzionale che impedisce a `tsc` di acchiappare l'identificatore non definito, test a dati vuoti che mascherano un difetto fatale, `vitest` che solo traspila e lascia il contratto derivare,
> `spawn EPERM` della sandbox (e perché `ESBUILD_BINARY_PATH` non serve), cattura PowerShell che porta gli errori `tsc` a zero,
> BOM/caratteri corrotti/sfalsamento dei numeri di riga, e trappole Git come `git amend -m` che svuota il corpo del commit.

### Aggiunti

- **§E Ambito di archiviazione `scope` (visibilità, ortogonale a `family`)**. Prima tutti i progetti condividevano una sola base di memoria: i ricordi della famiglia `work` depositati dal progetto A venivano richiamati anche nelle sessioni del progetto B. Nuova configurazione `scope` (`global` di default / `workspace`), **ortogonale** al `family` esistente (tipo di contenuto) — `family` chiede «che contenuto è», `scope` chiede «in quale ambito deve essere visibile»; i quattro quadranti esistono tutti. «In modalità `workspace`, isolare la famiglia `work` per spazio di lavoro, `chat` globale per default» è una **scelta di default, non una regola derivata** (le memorie personali devono attraversare i progetti; è proprio tra progetti che giace la superficie di inquinamento).
  - **Lo zero deriva è costruttivo, non comparativo**: finché `cfg.scope` non è `workspace`, il `scopeFilterOf` unificato restituisce sempre `undefined` (= non filtrare); nessun punto di chiamata può far passare per sbaglio un identificatore di spazio di lavoro. I deployment esistenti (che non definiscono la chiave) mantengono un comportamento **parola per parola identico** a quello antecedente la modifica.
  - **L'isolamento si colloca allo stesso piano dell'isolamento per famiglia**: non solo all'uscita della ricerca — **il richiamo dei candidati della deduplica** filtra pure. Il bacino di candidati decide le nuove deduzioni; senza filtraggio, record trasversali produrrebbero memorie «invisibili nel progetto B, che hanno già deciso la sorte delle memorie del progetto A» — peggio che nessuna isolamento ([`ADR-0008`](./docs/adr/0008-storage-scope-vs-family.md)). Il percorso del grafo filtra allo stesso piano secondo l'appartenenza del **record di origine**; i percorsi di scrittura (pipeline di estrazione / `memory_add` / `memory_import`) condividono lo stesso `resolveRecordScope`.
  - **L'identità dello spazio di lavoro prende il cwd canonico, non la `WorkspaceId` (uuid) del `dsh-workspace` dell'host**: stesso canale di intestazioni del `parentSession` del §A, disponibile in sincronia; dichiarare un `inject` farebbe fallire l'intero albero su un host privo del servizio; il criterio di appartenenza dell'host stesso è comunque «cwd canonico dell'intestazione di sessione == percorso dello spazio di lavoro»; l'uuid esigerebbe «uno spazio di lavoro registrato», e nelle directory non registrate l'isolamento cadrebbe in silenzio. Limite nota: **i link simbolici non vengono risolti**, la conseguenza è sovra-isolamento (nel senso sicuro), non perdita ([`ADR-0009`](./docs/adr/0009-workspace-identity-source.md)).
  - **La migrazione si limita a etichettare l'appartenenza, senza trasloco né cancellazione**: `l1_records` / `l1_fts` ricevono ciascuna le colonne `scope` + `workspace_id`, i dati esistenti vengono marcati `global` dal `DEFAULT` dell'`ALTER` — numero di voci, id, content, created_time identici alla lettera.
  - **Due veri problemi acchiappati in corso d'esecuzione**: ① **la reimmissione dopo la ricostruzione del FTS, senza scope, appiattisce l'isolamento in silenzio** (se i parametri di `backfillL1Fts` non si allineano all'insert, viene inghiottito dal proprio `catch` riga per riga; sintomo: indice vuoto con `count=0`); ② **mancata normalizzazione della forma lato scrittura → la memoria entra in base e non ne esce mai più** (la ricerca passa il percorso in minuscolo normalizzato, la scrittura conserva la maiuscola del chiamante così com'è — il test di uguaglianza di stringa non può che cadere). Entrambi acchiappati e riparati da test end-to-end e sonde di mutazione.
- **§F Colonna vettoriale dei nodi del grafo `graph_node_vec` (fondamento di archivio e degrado)**. Il grafo aveva finora solo punteggio lessicale ponderato, senza colonna vettoriale — entità **semanticamente equivalenti ma letteralmente diverse** come «nuvola profonda» e «DeepRobotics» non potevano risolversi tra loro. Nuova tabella virtuale vec0 **dello stesso schema** di `l1_vec` (stessa codifica, stessa dichiarazione `float[N] distance_metric=cosine`), la cui dimensione **riusa** il risultato di rilevazione delle capacità esistente — niente seconda tubatura.
  - **Degrado digerito all'interno**: senza vec0, la creazione della tabella solleva; se l'eccezione saliva fino al `catch` esterno di `GraphStore.init`, il grafo passerebbe da «via vettoriale non disponibile» a «**tutta la dominia del grafo non disponibile**» — ricerca lessicale, proiezione, arbitrato, tutto se ne andrebbe insieme. La colonna vettoriale porta quindi il proprio `try/catch` stretto. Negli stati disattivati l'interfaccia risponde no-op, il chiamante non deve testare il bit di capacità ([`ADR-0011`](./docs/adr/0011-graph-node-vector-storage-and-degradation.md)).
  - **Questa ondata consegna solo la porta, senza produttore né consumatore**: la pipeline di proiezione non è ancora cablata per calcolare gli embedding. Registrato onestamente come incompiuto — è l'inizio del §F, non il suo compimento.
- **§B Catena di ricevute delle decisioni L1 (infrastruttura di tracciabilità)**. Ogni record L1 in `memory.db` è **il risultato di una decisione di deduplica** (store / update / merge / skip), ma la decisione in sé non lasciava traccia — a posteriori si vedeva solo «il risultato ha questa faccia», mai «su che base era stato preso». Nuova tabella `l1_receipts`: ogni decisione di deduplica lascia una ricevuta (`run_id` / `record_id` / `kind` / **digest sha256 della sequenza ordinata del bacino di candidati** `input_digest` / `decided_at`), con il nuovo strumento **`memory_receipts`** e l'endpoint RPC **`dsh-memory/receipts`** per la retracing su due assi, per record o per lotto (dati insieme fanno E). La ricevuta deve esistere **prima** dell'evento — l'istantaneo d'ingresso **non si può ricostruire a posteriori**, dunque la capacità si colloca a monte, senza innesco sintomatico ([`ADR-0006`](./docs/adr/0006-l1-decision-receipts.md)).
  - **Tre partiti presi deliberati per `input_digest`**: **sensibile all'ordine** (il bacino è ordinato; «quali candidati erano visibili e in quale ordine» è proprio l'ingresso da ricostruire), **i duplicati non si piegano** (i duplicati nel bacino sono essi stessi un fatto), **codifica con prefisso di lunghezza** (altrimenti `['a|b']` e `['a','b']` colliderebbero — se la serializzazione non è iniettiva, il digest perde il valore d'impronta).
  - **Politica di ritenzione**: diradamento per **numero di run** (`RECEIPTS_MAX_RUNS = 1000`) — una finestra temporale **non dà nessun limite alle righe** (la soglia è indipendente dal ritmo di scrittura; un utente intenso può scrivere in 90 giorni quante righe vuole, la crescita illimitata è solo **rimandata**); la granularità del diradamento è il run, non la riga — diradare per riga taglierebbe «mezzi lotti» e risponderebbe a «cosa si è giudicato in quel giro» con una conclusione **apparentemente completa ma in realtà bucherellata**, danno **maggiore** del «non trovabile».
  - **Linea rossa**: il diradamento **toca solo `l1_receipts`, mai `l1_records`** — la prima è una dati d'osservazione gettabili, la seconda la fonte di verità dell'utente; risparmiare qualche MB toccando la memoria stessa è trasformare un'ottimizzazione di capacità in perdita di dati.
  - **Isolamento dei fallimenti**: la ricevuta è un'infrastruttura di contorno; il suo fallimento di scrittura si limita a un `warn` e **non interrompe mai la distillazione L1**.

- **§C Congelamento delle contraddizioni (opzionale, spento per default)**. Fino ad ora il **vocabolario di decisione** della deduplica contava solo `store` / `update` / `merge` / `skip` — il «rilevatore di conflitti» (`CONFLICT_DETECTION_SYSTEM_PROMPT`) individuava la contraddizione e poi **il LLM decideva e scriveva direttamente** (`update` per sovrascrivere o `merge` per fondere), **senza l'opzione «fermarsi e aspettare l'arbitrato umano»**. Con `conflictFreeze.enabled`, il vocabolario riceve l'azione `conflict`: quando il LLM giudica che «entrambe sembrano vere e la macchina non può decidere», la coppia conflittuale viene **parcheggiata** nella coda `conflict_pending` — **la nuova memoria entra regolarmente in base, il contenuto di entrambe le parti resta intatto**, e il nuovo strumento **`memory_resolve_conflict`** (RPC: `dsh-memory/conflict-resolve`) consegna l'arbitrato alla persona, con le conclusioni `winner` / `loser` / `both`.
  - **Il congelamento non è «bloccare la scrittura», è «non decidere automaticamente»** — implementarlo come la prima farebbe perdere informazione, peggio del problema che vorrebbe risolvere.
  - **Valvola di sicurezza**: `maxPending` (limite di coda) / `timeoutDays` (degrado per scadenza). La semantica è «**non accettarne altri**», non «cancellare furtivamente i vecchi»: le coppie saldate automaticamente **restano registrate in coda**, con `resolution` segnato `auto` per distinguerle dalle conclusioni umane. Senza valvola, due conseguenze certe: crescita senza confini della coda; «due memorie contraddittorie richiamate fianco a fianco» per sempre in base.
  - **Lato grafo**: i nodi del grafo toccati dalle fonti di un record congelato vengono marcati `disputed` (stato esistente, riusato; resta nei candidati di ricerca: uno stato intermedio «richiamato come al solito, ma visibile»). Questa marcatura è **sincronizzazione derivata**, non un timbro a senso unico — l'arbitrato **revoca** la controversia; un timbro a senso unico lascerebbe nodi già arbitrati bloccati su `disputed`, e sarebbe **il grafo derivato a mentire**.
  - **Zero deriva**: nello stato spento, il prompt di deduplica è **byte per byte identico** a quello di prima — garanzia **costruttiva** (lo stato spento fa direttamente `return base`), non un confronto manuale ([`ADR-0010`](./docs/adr/0010-conflict-freeze-default-off-and-timeout.md)).

### Modifiche

- **Nuove configurazioni** `conflictFreeze.enabled` (spento per default) / `conflictFreeze.maxPending` (100) / `conflictFreeze.timeoutDays` (30, `0` = nessun degrado per scadenza); **nuovi endpoint** `dsh-memory/receipts` e `dsh-memory/conflict-resolve` (faccia degli endpoint 26 → 28).
- **`L1ReceiptKind` riceve `conflict`**. Nell'ampliare un vocabolario bisogna controllare **tutti i luoghi che lo consumano** (normalizzazione delle ricevute, log di statistica, testi di rendering, descrizioni di schema) — rilevato in pratica: una registrazione omessa farebbe registrare «il modello **ha detto espressamente** di non poter decidere» come `skip_missing` (= «il modello **non ha risposto»), mentre tutta l'auditabilità dell'arbitrato del §C poggia sulla catena di ricevute — la conclusione dell'audit sarebbe **esattamente l'opposto del fatto** (peggio che mancare una ricevuta: mancare vuol dire «non trovato», sbagliato vuol dire «trovato ma sbagliato»).
- **`GraphStore.markSourcesDisputed` (timbro a senso unico) → `syncDisputed` (sincronizzazione derivata)**: `active` e fonti toccate → `disputed`; `disputed` e fonti che non toccano più → ritorno a `active`; le lapidi `archived` non si toccano. La pipeline trasmette **l'insieme dei record di tutte le coppie non arbitrate del momento**, non solo la coppia nuova del giro.
- **L'ordine dell'arbitrato è deliberato**: prima si pone `resolved_at`, poi si fa uscire di scena il perdente — al contrario, «il record è sparito ma la coda lo mostra ancora in attesa» esigerebbe un secondo clic per accorgersene; la marcatura usa `WHERE resolved_at = ''`, **un secondo arbitrato non sovrascrive la prima conclusione**.

### Test

- **§B: 5 nuovi file di test** (creazione della tabella delle ricevute e digest, punti di scrittura e isolamento dei fallimenti, politica di ritenzione, interrogazioni a due assi, retracing end-to-end), inclusa una **sonda di mutazione**: sostituendo la tabella di diradamento con `l1_records`, il caso della linea rossa fallisce davvero.
- **§C: 7 nuovi file di test** (vocabolario / creazione della tabella / interruttore / semantica del congelamento / valvola / arbitrato / ciclo chiuso), tutti passati per TDD con osservazione prima del RED. Tre criteri **discriminanti** meritano nota: `version===0` (separa la semantica store da quella di merge/update), acchiappare end-to-end il prompt realmente inviato dalla pipeline (funzioni statiche tutte verdi **non provano** che la pipeline passa l'interruttore), e la mutazione del ramo `both` che fa davvero arrossire il caso.
- Totale **34 file / 341 casi**; la catena CI a sette passi (`typecheck` / `test` / `lint` / `build` / `build:smoke` / `smoke` / `verify-catalog`) tutta verde.
- Ciclo chiuso archiviato su documenti: due veri `runExtraction` (stub solo sullo strato di trasporto LLM) → vero endpoint di arbitrato, JSON grezzo archiviato in `evidence/` del dominio di pianificazione.

### Corretti

- **Le azioni non riconosciute venivano assorbite in silenzio dal ramo di ripiego.** Il ciclo di applicazione di `pipeline/l1.ts` ramificava esplicitamente solo su `store` / `skip`, **tutto il resto cadeva nel ramo update/merge**. Le decisioni conflict non portano per disegno alcun `target_ids`, dunque `targets=[]` → il record veniva appeso come prodotto di una fusione «che ha sostituito 0 voci», e `version` calcolato a `1`. **Né errore, né perdita: unica traccia, un numero di versione** — cioè «conflict degradato silenziosamente in merge/update», proprio il comportamento che il §C voleva eliminare. **Rimedio**: ramo `conflict` esplicito; in caso di validazione fallita o interruttore spento, **ritorno a `store`**, mai al ramo di ripiego.
- **Il portinaio degli endpoint era una copia ricopiata a mano.** Il `ENDPOINTS` di `tests/contract-keys.test.ts` è una **copia manoscritta** del registro vero (`MEMORY_ENDPOINTS` di `src/stats.ts`); le sue due asserzioni erano coerenti solo con quella copia (`ENDPOINTS.length === 26`). Quando il §B, con `dsh-memory/receipts`, fece salire il registro vero a 27, la copia **non lo seguì**, e l'asserzione di conteggio restò a 26 — e «l'asserzione concorda con la copia, la copia non concorda con i fatti» passò **tutto verde dall'inizio alla fine**; dopo l'aggiunta di `conflict-resolve` di questo giro, **ancora tutto verde**. Il portinaio metteva alla prova la propria ombra: con qualunque sistema testato, non arrossirebbe mai. **Rimedio**: nuova asserzione `expect([...ENDPOINTS].sort()).toEqual([...MEMORY_ENDPOINTS].sort())` — l'elenco locale deve coincidere **voce per voce** con l'unica fonte di verità; l'asserzione di conteggio resta come pietra miliare esplicita al momento dei cambi.

- **Caricamento dell'albero dei plugin fallito: lo schema d'output degli strumenti usava la parola chiave `nullable`, non supportata dal DSL** (correzione di una regressione, DSH diveniva totalmente incapace di avviarsi). Gli schemi di output di `memory_ruminate` e `memory_ruminate_status` dichiaravano `nullable: true` su `startedAt`/`finishedAt`/`error`, mentre il DSL dei value schema di DSH accetta solo un insieme in whitelist di chiavi d'autore (`description`/`title`/`default`/`examples`/`required`/`enum`/`const` e, per tipo, `type`/`properties`/`additionalProperties`/`items`/`oneOf`). Alla compilazione dello schema per parte di `defineTool()` veniva sollevato `JsonSchemaError: schema.properties.startedAt.nullable is not supported by the value schema DSL`, il loader ha giudicato fallito il caricamento della voce `dsh-memory (dsh-prime-memory)`, l'applicazione dell'intero albero si è fermata e il processo è uscito con un'eccezione non catturata.
  **Rimedio**: rimozione dei 4 `nullable: true`. Semantica invariata — in questo DSL una proprietà è opzionale per default; solo un `required: true` esplicito la rende obbligatoria; e la validazione runtime salta `undefined`, quindi il `startedAt: undefined` restituito da `execute` resta legale. Verifica: `tsc` compila + nessuna occorrenza negli artefatti dist + nuovo caso di regressione della registrazione degli strumenti.
- **Endpoint RPC di rumination tutti irraggiungibili: al controllore non sono mai state iniettate le deps degli endpoint.** `dsh-memory/ruminate-status` restituiva sempre `{supported:false,running:false,phase:'idle'}`, `ruminate-start`/`ruminate-cancel` sollevavano sempre «controllore di rumination non inizializzato». Causa radice: `EndpointDeps.ruminate` era dichiarato e le tre implementazioni di endpoint scritte, ma `registerMemoryRpc`, assemblando gli argomenti delle deps, non iniettava il controllore — `deps.ruminate` restava `undefined` e gli endpoint restavano inchiodati al ramo di degrado.
  **Impatto visibile all'utente**: il pannello di rumination (`RuminatePanel.tsx`) fa un `return null` integrale se `supported === false`, quindi si presentava come «funzione inesistente» piuttosto che come errore — per questo il guasto è rimasto tanto a lungo inavvisato; dopo la correzione il pannello si rende per la prima volta.
  **Rimedio**: l'assemblaggio delle deps viene estratto in una cucitura testabile `buildEndpointDeps()` (unico proprietario), che scrive esplicitamente il controllore nel campo `ruminate`; `rebuild`/`embedManager`/`sessionInfo` percorrono ormai esattamente lo stesso canale di iniezione di `ruminate`, senza più parametri posizionali di ripiego.
  **Verifica**: dopo l'iniezione di uno stub, `dsh-memory/ruminate-status` restituisce `supported !== false`.

- **La rumination crollava a ogni colpo: `pending.json` veniva analizzato due volte senza sballare `buckets`, `TypeError: messages is not iterable`**. Il `RuminateController.start()` passava per il proprio `readPendingBuckets()` e asseriva `JSON.parse(readFileSync(file))` direttamente come `PendingBuckets` (`{auto,chat,work}`), ma la forma vera su disco è `PendingFile` (`{version,buckets:{auto,chat,work},warmup}`) — **mancava lo sballaggio di un livello `buckets`**, quindi `buckets[mode]` restava `undefined` e il `for (const m of messages)` di `groupPendingBySession` sollevava.
  **Impatto visibile**: **questa funzione non è mai riuscita nemmeno una volta**. L'errore veniva accolto dal `catch` (ripiego in secchi vuoti) solo nel caso «il file non esiste»; ma `persistPending` scrive quel file a ogni giro, quindi in qualsiasi deployment reale con buffer, cliccare la rumination falliva di sicuro, pannello in rosso. **Attenzione, contro l'intuizione**: il sollevarsi non ha **nulla a che fare** col contenuto dei secchi — secchi vuoti sollevavano ugualmente; il vecchio giudizio «tre secchi vuoti, per questo non si è mai visto» era sbagliato: la vera ragione è che la rumination non è mai stata innescata (`memory.log` non porta alcun `反刍开始`).
  **Rimedio**: rimossi `readPendingBuckets()` e `readFileSync`, sostituiti dal `loadPending()` di `store/pending.ts` — l'**unica autorità** sulla forma dei secchi, che porta gratis la validazione di forma, la verifica `Array.isArray` per secchi, il conteggio delle righe corrotte `isMessage` scartate, il raggruppamento del vecchio formato `LEGACY_SESSION` e la validazione di `warmup`. **Nessuna seconda porta in `pending.ts`** (è proprio questa la causa del difetto: due percorsi d'implementazione della stessa semantica, uno dei quali marcisce senza che nessuno se ne accorga).
  **Verifica**: nuovo caso a livello di controllore, prima rosso poi verde (rosso: `TypeError: messages is not iterable` @ `pending.ts:104` ← `ruminate.ts:75` ← `:139`; verde: `total` == numero di gruppi di sessioni, `mode` dedotto dalle chiavi dei secchi); `dist/pipeline/ruminate.js` non contiene più `readPendingBuckets`.
- **Dopo un fallimento della rumination, stato e interfaccia si contraddicevano.** Il percorso di fallimento non scriveva mai `this.status` (l'originale `:149-155` assegnava solo sul percorso di successo), quindi `ruminate-status` continuava a restituire `phase:'idle'`/`error:null` e il ramo `failed` della UI non si accendeva mai — l'utente vedeva l'errore in rosso, l'endpoint di stato assicurava che tutto andava bene. **Rimedio**: nel `catch` si scrivono `phase:'failed'` e `error`, con `logger.warn` prima del rilancio.
- **Progresso e produzione della rumination sempre a zero, così l'effetto delle correzioni non era giudicabile.** `totalL1` veniva solo dichiarato/azzerato/letto, **mai incrementato**; `status.done` non aveva alcun punto d'incremento, quindi `recordsBuilt` restava `0` e il log di chiusura diceva sempre `0/N sessioni, 0 record prodotti`. **Rimedio**: `PipelineTask` riceve un callback di completamento `onDone` (invocato dentro `drain`, un'eccezione del callback non tocca la pipeline), `enqueue` espone `onTurnDone`, la rumination vi accumula il vero numero di record; `doEnqueue` pone `status.done = index` alla fine.
- **Tre punti di fallimento silenzioso**: il `catch` di `loadPending` e il `.catch(() => {})` di `doLightRefresh` comprimevano «file inesistente (normale)», «illeggibile/corrotto (da avvisare)», «forma non conforme (da avvisare)» nello stesso degrado silenzioso, indistinguibile nel log e nello stato dal «rinfresco leggero di un pending vuoto legittimo» — l'utente vedeva `phase:'done'` e lo prendeva per successo. **Rimedio**: `loadPending` distingue `ENOENT` (silenzio) dal resto (`warn` con percorso del file e motivo), forma non conforme in `warn` pure; `doLightRefresh` passa a `await` e **azzera la bandierina solo dopo il successo** (prima l'azzerava anche in fallimento — si inghiottiva così la chance di riprovarci).
- **Durante il «rinfresco leggero» della rumination: falsa inattività, né progresso, né annullamento** (riscontro dal campo). `start()` faceva `return await this.doLightRefresh()` quando non c'era alcuna fetta in attesa, e quel ramo **non poneva mai `running`** — nel frattempo `ruminate-status` continuava a rispondere `phase:'idle'`/`running:false`. Eppure il L2/L3 qui è una **vera chiamata LLM** (misurata sopra i 70 secondi a chiamata); `start()` restava appeso all'await, occupando la guardia.
  **Impatto visibile**: dopo il clic, l'interfaccia mostrava solo una frase statica, **senza barra di progresso, senza pulsante di annullamento, senza fase, senza durata**; un secondo clic dava «la rumination è già in corso» — esatto ma privo d'informazione, impossibile dire se giri o se sia congelato.
  **Rimedio**: il rinfresco leggero **riporta onestamente** — registra `total` in base al numero di famiglie in attesa L2/L3, incrementa `done` passo per passo, e riceve `RuminatePhase='refreshing'` con un `detail` che descrive l'azione in corso (es. «consolidamento di scena L2 (chat)»); il log di chiusura passa dal silenzio a `rinfresco leggero terminato: 2/3 passi, 84 s`. Il pannello mostra il nome della fase, `completati/totale passi (percentuale)`, il **tempo realmente trascorso** e l'azione corrente, e tratta `refreshing` come stato attivo.
- **Tempo trascorso non mostrato durante la rumination**: una singola chiamata L2/L3 può durare minuti; mostrare solo «in corso» non distingue «gira» da «è congelato». **Rimedio**: durante l'esecuzione, ricalcolo e mostra ogni secondo di `trascorso X min Y s`.

### Modifiche

- **`RuminateStatus` riceve `detail`; `RuminatePhase` riceve `refreshing`**: osservabilità per passi alla scala del minuto (retrocompatibile: campo opzionale + nuovo membro del tipo unione). `detail` dà «sessione <id> (i/N)» in fase di distillazione, e l'azione L2/L3 corrente in fase di chiusura/rinfresco.
- **`DshMemoryRequestMap` completa le tre chiavi di rumination** (correzione del contratto, riporta in vita la porta dei tipi in CI): la tabella delle risposte dichiarava da tempo `dsh-memory/ruminate-status|start|cancel`, e `DshMemoryEndpoint = keyof DshMemoryResponseMap` li includeva dunque nell'unione degli endpoint; ma la **tabella delle richieste mancava delle tre chiavi corrispondenti** — il `DshMemoryRequestMap[K]` di `client/src/rpc.ts` sollevava `TS2536`, `tsc -p tsconfig.client.json` falliva di continuo e **il `npm run typecheck` di CI arrossiva a colpo sicuro**. Corretto con tre righe `Record<string, never>` della stessa forma di `rebuild-*` (nessuno dei tre endpoint prende parametri d'ingresso). Verifica: i tre tsconfig escono 0, l'intera catena di `npm run typecheck` esce 0.
- **L'assemblaggio delle deps di `registerMemoryRpc` estratto in `buildEndpointDeps()`**: cucitura testabile per «quale controllore cade in quale campo», col tipo `EndpointDepsInput` a delimitare la faccia d'iniezione, così le iniezioni mancanti affiorano già in compilazione (questo difetto restava finora un degrado silenzioso a runtime). `handleEndpoint` e `EndpointDeps` esportati anche per chiamata diretta nei test.
- **Lucchetto d'avvio `starting` per la rumination**: `loadPending` introduce un punto di cessione della event loop tra la guardia e la messa a `status.running`; un doppio clic / raffica di RPC può attraversare la guardia da entrambi i lati e i due `sessions` si sovrascrivono a vicenda. Una nuova bandierina chiude la finestra. **Attenzione**: la bandierina si riarmi esplicitamente alla fine del ramo distilling, non in un `finally` — perché `doEnqueue` accoda in modo asincrono e un `finally` alzerebbe la bandierina subito, disattivando la guardia; la guardia persistente attraverso gli `await` è `status.running`.

### Test

- Nuove «barriere d'iniezione dei controllori negli endpoint» dello strato RPC, 5 casi: per entrambe le famiglie `rebuild` e `ruminate`, «assemblato → status/start/cancel raggiungibili» e «non assemblato → status degrada, start/cancel riportano non inizializzato», più il ramo della guardia di degrado dell'archivio di `rebuild-start`. Le due famiglie condividono lo stesso schema (controllore opzionale + risposta di degrado + iniezione delle deps); `rebuild`, la cui iniezione era già corretta, fa da gruppo di controllo per inchiodare la forma dello schema. Casi di test 194 → 199.
- Nuovo `tests/ruminate.test.ts`, 5 casi, che inchioda **il vero percorso di lettura del controllore**, un contratto finora a copertura zero: tre secchi con messaggi veri → nessuna eccezione e `total`/`mode` corretti; JSON scritto a mano in forma su disco (**senza andare e tornare per `savePending`**, per evitare che entrambi i lati sbaglino insieme e passino); tre secchi vuoti → rinfresco leggero; file mancante → rinfresco leggero (ENOENT, percorso normale); `start()` paralleli, uno solo passa. Casi di test 199 → 204.
- **Al passaggio, pulizia dei 10 errori di lint preesistenti in `tests/`** (import/variabili inutilizzati, `require()` in import ESM di testa, condizioni sempre vere), perché `lint` possa comprendere `tests`. **Fino ad ora la directory dei test viveva interamente fuori dal lint.**
- **`npm test` e `npm run lint` allacciati a CI per la prima volta**: `.github/workflows/ci.yml` girava solo `typecheck → build → build:smoke → smoke → verify-catalog` e **non lanciava mai i test** — tanto valeva non scriverli. La barriera è ora in servizio.

### Limiti noti

- **La porta dei tipi di `tests/` è aperta solo in parte (ratchet)**: nuovo `tsconfig.test.json` incluso in `npm run typecheck`, ma siccome 8 file di test esistenti portano circa 60 errori di tipi (`MemoryConfig` spostato di modulo, `DistillBudgets` senza `graph`, `UserMessage.turn`, assegnazione di array in sola lettura, `as` nudi in massa in `rpc.test.ts` ecc.), per ora solo `tests/ruminate.test.ts` e `tests/stores.test.ts` sono inclusi. Vedi `pending-issues.md` P8 — **constata che i test hanno derivato dai contratti di tipi e che vitest solo traspila senza controllare; per questo girava tutto verde senza che nessuno se ne accorgesse**.
- **La rumination soffre di una doppia fonte di verità disco/memoria**: l'elenco delle sessioni viene dal `pending.json` su disco, ma l'estrazione vera, in `runner.ts:667`, prende i messaggi dai **secchi in memoria** per `sessionId` — quindi il `session.messages` passato non influenza il risultato. Nella finestra sono possibili distillazioni mancate o giri a vuoto (`total` gonfiato). Rimedio suggerito: esporre dal runner una vista in memoria in sola lettura, vedi `pending-issues.md` P9.
- **Corsa alla chiusura della rumination**: la catena di `setImmediate` non aspetta che la coda si svuoti, anche una sola sessione innesca subito `finalize`, facendo correre L2/L3 invano su L1 stantio (i record vengono consolidati dopo da `l1.ts:264`, **non perduti**). Vedi `pending-issues.md` P10.
- **Una chiamata LLM in corso durante la rumination non è interrompibile**: «annulla l'ordine» si ferma solo **dopo il completamento del passo in corso**. Un L2/L3 può durare minuti — ecco l'origine del ritardo dell'annullamento.

## [0.10.0] — 2026-09-06

### Aggiunti

- **Proiezione in grafo della conoscenza** (proiezione ricostruibile di L1; risponde a «che stato hanno ora persone/progetti/organizzazioni/strumenti/luoghi»): i record prodotti dalla distillazione L1 vengono dati per lotti al modello che propone entità e relazioni orientate; `applyGraphProjection` valida in modo rigido prima di scrivere — **zero fatti senza fonte**: i `sourceRecordIds` di ogni nodo/fatto/arco devono appartenere tutti ai record reclamati dal lotto, le proposte fuori lotto vengono scartate in silenzio, e ogni conclusione del grafo si retrotraccia per `nodo → sourceRecordIds → record L1 → fonte di verità JSONL`. Disambiguazione delle entità (normalizzazione NFKC + fusione per coerenza di tipo, accumulo di alias), storia degli stati (supersede + chiusura per validTo, `currentState` ricostruito solo dai fatti attivi), catena di ancoraggio temporale a quattro gradini (`activity_start_time → activity_end_time → timestamps → createdAt`, senza prova nessuna data indovinata). La famiglia di tabelle del grafo può essere droppata e rifatta in ogni momento, non serve come fonte di verità.
- **Coda dei compiti di proiezione** (GraphStore, degrado indipendente: se l'inizializzazione fallisce, solo il grafo diventa no-op, senza infettare l'archivio principale): stato di job persistito come macchina a stati pending → running → completed/dead, deduplica spinta giù nell'SQL (mapping in volo + registro di proiezione, due tabelle di indice, senza scansione integrale dei job); niente inversione di priorità (nuova distillazione 10000 > recupero del retrobotola 100); tetto di attempts poi passaggio a dead, `nextAttemptAt` a back-off esponenziale, recupero all'avvio running→pending; dopo `deleteL1Batch` propagazione delle cancellazioni (nodi/archi con fonti tutte invalidate marcati pigramente archived). Le chiamate LLM non entrano mai in una transazione (claim e complete sono due cuciture di transazione; complete committa atomicamente in una sola).
- **Ricerca nel grafo e strumenti**: ricerca ponderata per campi (name×6/aliases×5/tags×5/currentState×4/facts×4/relations×3/type×2), filtro del rumore d'adiacenza quando colpiscono solo le parole delle relazioni, output spiegabile con `matchedFields` + `matchReason` in cinese; nuovi strumenti `memory_search_graph` (carte di nodi compatte) e `memory_expand_graph_node` (fatti al completo con storia + archi di relazione), soggetti alla stessa negazione di lettura per modalità/iniezione di `memory_search`, e filtrati per famiglia di sessione (la modalità pura vede solo i nodi derivati dalla propria famiglia).
- **Endpoint RPC 24 → 26**: `dsh-memory/graph-search` (ricerca) e `dsh-memory/graph-node-get` (svolgimento del dettaglio; un id appeso restituisce `node=null` senza sollevare); contratto a fonte di verità unica sincronizzato, la faccia di chiamate generiche del client riceve i tipi dei nuovi endpoint senza alcuna modifica.
- **Allargamento delle chiavi di budget**: `DistillBudgets` riceve la chiave `graph` (default 8000, riga grafo della pagina impostazioni editabile); `layerKeyFor('graph')` torna esplicitamente alla risoluzione globale, non cade mai nella catena di strato l1; i costi della proiezione del grafo entrano nel totale e nel raggruppamento per modello, ma non nella tabella stratificata l1→l2→l3 né nelle tendenze (esonero da via di contorno).

### Modifiche

- **Nuova configurazione**: `config.graph.enabled` (livello deployment, **false** di default — anche attivata, l'interruttore runtime della distillazione deve essere vero; balaustra della pompa: al più un compito grafo per drain, sempre precedenza ai turni di distillazione in tempo reale).
- Versione del plugin 0.9.0 → 0.10.0 (cambio della faccia degli endpoint).

## [0.9.0] — 2026-09-01

### Aggiunti

- **Canale di classificazione grossolana Hall**: faccia di attributi grossolani ortogonale a `family`/`type`. `types.ts` definisce `HALL_CATALOG` (unica fonte di verità: la linea principale `work`/`relationships`/`general` attive di default, i sperimentali `finance`/`journey` con marchio `experimental`); `config.hall.enabled` decide quali Hall partecipano all'etichettatura. Nella fase di estrazione L1, `metadata.hall` viene etichettato automaticamente secondo l'elenco attivo (se la classificazione non è certa, il campo si omette, senza forzare General); il contratto `ListRecordsRequest.hall` e `UiRecord.hall` si allarga, il browser di memorie riceve un menu a tendina di filtro per Hall e le carte un badge Hall.
- **Sovrascrittura runtime dell'embedding remoto**: `baseUrl`/`apiKey`/`model`/`dimensions` dell'embedding diventano **editabili nella pagina impostazioni**, sovrascrivendo a runtime il YAML di deployment (`effectiveCfg` inietta il sottoalbero `cfg.embedding`, indipendente dal canale llm); `EmbeddingManager` riceve `getEff()` che legge la configurazione effettiva dopo la sovrascrittura runtime, così la modifica dalla pagina prende effetto immediatamente.
- **Strumenti di scrittura-cancellazione ad alti privilegi**: registrazione di `memory_add` («ricorda X» esplicito → scrive direttamente una voce L1 in base, `hall` opzionale) e di `memory_delete` (cancellazione dopo incontro della ricerca semantica, al più 10 voci), entrambi sotto la barriera `live.memoryMutate` (modalità alti privilegi della pagina impostazioni); il browser di memorie riceve un interruttore ad alti privilegi (con doppia conferma) e un pulsante di cancellazione unitaria.
- **Documentazione multilingue** (allineata a `multilingual-docs-skill`): `README`/`INSTALL`/`CHANGELOG` coperti in `zh`/`en`/`ja`/`ko`, con interlink di commutazione lingua in testa a ogni pagina (scritti in madrelingua), pagine `ja`/`ko` con nota di compatibilità DSH.
- **Catena di strumenti**: allaccio di ESLint 9 in configurazione piatta e di Vitest, nuovi `npm run lint`/`npm run test`, più la prima fornitura di unit test per `HALL_CATALOG` e il prompt di estrazione Hall.

### Modifiche

- **`apiKey` dell'embedding remoto diventa opzionale**: accettazione di servizi `/embeddings` self-hosted senza chiave (`remoteCeiling` non impone più `apiKey`); senza chiave non viene iniettata l'intestazione `authorization`, perché un `Bearer` vuoto non venga respinto.

### Corretti

- L'embedding remoto non invia più un'intestazione `Bearer` vuota quando `apiKey` è vuota.

### Limiti noti

- Il punto di costruzione di `EmbeddingManager` (`src/index.ts`) non riceve ancora `getEff`; la sovrascrittura runtime non ancora confluisce nel servizio d'embedding interno del gestore, collegamento da completare più avanti.

## [0.8.11] — 2026-08-29

### Corretti

- **Adattamento mobile del controllo di modalità di sessione**: pill e selettore scorrevole erano finora pensati solo per il layout web da scrivania — il pannello flottante saliva con asse sul centro della pill, ma la pill sta a sinistra della barra di input: su viewport stretti da telefono, la metà sinistra del pannello veniva tagliata dallo schermo. Il pannello ora fa un serramento orizzontale del viewport: misurato all'apertura, se tagliato (incluse le scorrimenti di layout come l'apertura della barra laterale che spinge la zona di input verso il bordo), si addossa al bordo automaticamente; su scrivania sta naturalmente dentro lo schermo, zero cambio di comportamento;
  la chiusura per clic esterno passa da `mousedown` a `pointerdown` (su iOS la zona di solo testo non sintetizza eventi mouse, la vecchia implementazione lasciava il pannello aperto sul telefono); le zone di clic di pill e rotaia si allargano in alto e in basso di una zona calda invisibile secondo lo standard tattile di 44px (visivamente nessun pixel cambiato, geometria del pannello intatta, uniforme su tutti i terminali — su scrivania la bersaglio cliccata ingrandisce pure). La logica d'interazione del selettore scorrevole (fissare la modalità al clic, proiezione della spinta al trascinamento con calamita) resta invariata.

## [0.8.10] — 2026-08-28

### Aggiunti

- **«Solo scrittura» a livello di sessione (Issue #38)**: certe sessioni vogliono dal sistema di memoria «entrare ma non uscire» — continuare a catturare la conversazione e a partecipare alla distillazione, ma non iniettare alcuna memoria nella sessione corrente. Finora la modalità spenta era l'invisibilità totale (spenta persino la cattura, fette in attesa sospese) e l'interruttore del richiamo aveva solo la granularità globale: questa combinazione era inesprimibile. Il pannello flottante riceve ora un **interruttore «Iniezione» a tre stati (segui il globale / on / off)**: su «off» la sessione passa in sola scrittura — cattura L0 e distillazione L1→L2→L3 procedono come al solito, mentre l'iniezione del richiamo, le zone stabili profilo/navigazione e la guida degli strumenti si fermano insieme;
  gli strumenti di lettura come `memory_search` rispondono con l'avviso di sola scrittura (la scrittura passa per l'hook di cattura, non per gli strumenti: nessuna breccia semantica).
  La faccia della pill cambia con lo stato in `记忆·只写` (lo stato di iniezione ha la precedenza in faccia, il nome di famiglia si ritira nella rotaia); la sovrascrittura è persistita per sessione
  e ortogonale alla modalità (cambiare modalità non la perde); «segui il globale» la cancella; la combinazione inversa
  «globale spento + sessione particolare accesa» vale pure. Catena di priorità: tetto di deployment > interruttore globale > sovrascrittura di sessione > modalità spenta (l'invisibilità totale
  non cambia). Le ragioni di disattivazione di «incontri del richiamo» sulla carta flottante si affinano al tempo stesso (nuova causa «sessione in sola scrittura»).
  Adatto alle sessioni di debug/valutazione, sensibili/a uso singolo, di lunga durata in sottofondo — tutto ciò che vuole «assorbire senza disturbare».

  ![Sessione in sola scrittura: testo della pill cambiato e interruttore d'iniezione a tre stati](assets/changelog/0.8.10/01-write-only-pill.png)

## [0.8.9] — 2026-08-27

### Aggiunti

- **Routing indipendente della distillazione per strato (Issue #34 / ADR-0005)**: gli strati di distillazione chiedono cose diverse al modello (L1
  molto frequente vuole essere economico, rapido e stabile; L3, rara con input grandi, vuole capacità forti); ora si può **dotare ogni strato della propria catena di riserva completa**.
  Doppio ingresso: il YAML di deployment `llm.layerRoutes` (chiavi di strato l1/l2/l3, la riga di testa deve dichiarare esplicitamente fornitore+modello)
  e `distillLayerChains` a runtime dalla pagina impostazioni; priorità nello strato **catena di strato runtime > catena di strato statica > catena
  globale di default**, a gradini come rete di sicurezza; non vuota = sostituzione integrale di quello strato (il degrado di uno strato coperto non ricade mai nella catena globale), gli strati non configurati non cambiano di un bit; il pin di deployment blocca solo il lato runtime (le catene statiche di strato valgono come sempre). La sezione «Parametri di distillazione» della pagina impostazioni viene rimaneggiata in **pannello a segmenti** (globale / L1 / L2 / L3): punti di stato dei segmenti in vista d'insieme (blu pieno = personalizzato runtime / vuoto = YAML statico / grigio = segue il globale)
  + una riga di legenda (la relazione di priorità sta nel tooltip)
  + nota «in uso: quali strati» sul pannello globale + budget per strato raggruppati per strato (semantica invariata). L'ingrandimento ×4 dei budget di uscita per strato in high/xhigh/max
  segue il livello dello strato (candidato di testa della catena di strato > candidato globale); la contabilità non cambia (le righe token_cost
  sono già attribuite per strato + rotta realmente servita).

  ![Pannello a segmenti dei parametri di distillazione · globale](assets/changelog/0.8.9/03-layer-segmented-panel.png)
  ![Pannello dello strato L1 · anteprima in sola lettura del seguire il globale e budget per strato](assets/changelog/0.8.9/04-layer-l1-panel.png)

- **Indicatore di occupazione del contesto (arco luminoso di memoria attorno all'anello ufficiale + ripartizione nel pannello di dettaglio)**: il contenuto di memoria iniettato dal plugin affondava finora nelle grandi categorie dell'anello ufficiale di contesto; ora — all'esterno dell'anello ufficiale della barra di input, un **sottile arco luminoso** blu di marca
  (lunghezza = quota della memoria nella finestra, stessa immagine dell'anello ufficiale); aprendo il pannello ufficiale, in fondo compare una sezione «occupazione memoria» che elenca due righe, **frammenti di richiamo / zona stabile della memoria** (nel formato ufficiale `~5.5K` e valori a colori vivi). I numeri seguono la stessa euristica di densità fissa del contatore ufficiale di token (`ceil(chars/4)+oneri`,
  regime UTF-16), il denominatore è la finestra dichiarata ufficialmente del modello principale di conversazione; le vecchie sessioni restano servite (scansione della
  surface della sessione live + riempimento leggendo i prefissi archiviati del servizio di persistenza), nulla si perde al riavvio (scrittura attraversante di occupancy.json);
  dopo OFF, l'acquisito resta visibile e s'invecchia naturalmente con la compressione. Implementazione puramente additiva: rimossi tutti i nodi aggiunti, l'interfaccia torna bit a bit alla forma nativa.

  ![Ripartizione dell'occupazione memoria nel pannello di dettaglio](assets/changelog/0.8.9/01-panel.png)
  ![Arco luminoso di memoria attorno all'anello ufficiale](assets/changelog/0.8.9/02-halo.png)

## [0.8.8] — 2026-08-26

### Aggiunti

- **Unica fonte di verità del contratto RPC `src/contract.ts`**: i tipi di richiesta/risposta dei 23 endpoint `dsh-memory/*` sono accentrati in un modulo types-only (zero codice runtime), condiviso tra lato host (tabella dei case in stats.ts) e lato client — la deriva del contratto si vede in compilazione, piuttosto che aspettare che la UI renda undefined. I tipi di dati puri dei moduli host (MemoryStats / RebuildStatus / famiglia CostSnapshot /
  EmbeddingStateView / MemoryLiveSettings / RecallSessionStats ecc.) migrano nel contratto e conservano sul posto il loro re-export; `EFFORT_CHOICES` ri-blocka all'indietro con `satisfies` la deriva del vocabolario.
- **Migrazione della metà client a TS/TSX + bundle esbuild**: `client/client.js` (3433 righe di ES5 monofiles scritto a mano) viene riscritto come TSX multifiles in `client/src/` (stratificato per base/controlli/pill/tabs),
  impacchettato via `scripts/build-client.mjs` (esbuild, corpo cjs avvolto in un factory wrapper, isomorfo ai pacchetti ufficiali dsh-client-ui-*) che produce un `dist/client.js` monofiles. react / react/jsx-runtime /
  @deepseek-ai/* tutti external (iniettati per require dall'host, contro il doppio react); **zero cambio di comportamento** (UI equivalente al pixel, endpoint RPC e carichi invariati, protocollo di handoff invariato). Nuovo
  `npm run typecheck` (doppio controllo tsconfig principale + tsconfig.client.json); la sezione 21 dello smoke diventa asserzioni sull'**artefatto** dist/client.js (forma del protocollo + cablaggio degli external + migrazione equivalente delle asserzioni esistenti su token/
  arrotondamenti/campo di particelle).
- **Editor della catena di routing di distillazione (UI della pagina impostazioni, elenco unificato)**: un elenco ordinato sostituisce il vecchio commutatore globale di «riflessione della distillazione» e il selettore monorotta di «modello di distillazione» — la 1ª riga è la rotta principale (badge «principale», può restare vuota e seguire il modello di default), le righe seguenti degradano nell'ordine; **il livello si regola rotta per rotta** (default «segui la configurazione del deployment»,
  sempre passato al morsetto delle capacità). Nuove chiavi runtime `distillChain` (≤ 8 voci; riga della rotta principale vuota in doppio o piena in doppio, righe di riserva obbligatoriamente esplicite, doppioni rifiutati; array vuoto = segui la configurazione del deployment). RPC: llm-providers riceve un blocco `chain`
  (current con proiezione delle vecchie chiavi / static / effectiveChain / source), llm-models allega a ogni modello una tabella `efforts` dei livelli. La posizione è la priorità: la 2ª riga può scambiarsi con la principale / sostituirla (una principale vuota sostituita non resta conservata); pinned in sola lettura; in modalità «segui», un pulsante «edita come catena runtime» copia la catena statica a un clic. Specifica di design in `design/settings-spec.md` (sezione RouteChainEditor).
- **Catena di riserva della distillazione (variante 1 del #31)**: `llm.fallbacks` come lista di oggetti (voce = provider + model +
  `reasoningEffort` opzionale) — al fallimento della rotta principale (errore/troncamento/errore di rete/uscita vuota), degrado automatico nell'ordine delle voci, ritorno appena una rotta riesce; le voci identiche alla principale vengono saltate; ogni rotta gode dell'integrità di `llm.timeoutMs`; il livello di una voce non vuota sovrascrive il livello globale (la presa in carico integrale della vecchia chiave runtime
  `reasoningEffort` — timbro delle voci compreso — resta effettiva sui valori esistenti quando `distillChain` non è configurata); l'annullamento volontario del chiamante non degrada e risale tale quale; al fallimento totale l'ultimo errore viene lanciato al back-off esponenziale
  per sessione esistente. Costi in token e uso di distillazione contabilizzati a ogni tentativo, il successo registra la rotta realmente servita; cambio di degrado nel log info + unico avviso se una singola rotta fallisce di continuo. Default array vuoto = comportamento a rotta singola invariato. I README cinese e inglese ricevono la sezione «catena di riserva della distillazione e modelli lenti al TTFT» (con esempio di configurazione e tre livelli di attenuazione).

### Modifiche

- **La pagina impostazioni toglie il commutatore globale «riflessione della distillazione» e il selettore monorotta «modello di distillazione»**: fusi nell'editor unificato della catena di routing (livelli routati per rotta). Le vecchie chiavi runtime `reasoningEffort`/`distillProvider`/
  `distillModel` conservano la semantica bit a bit (effectiveCfg riconosce solo un `distillChain` esplicito, i valori esistenti si leggono per compatibilità), la UI non vi scrive più.
- **L'uscita vuota viene riclassificata come fallimento di chiamata**: `callLLM` passa da «restituire una stringa vuota» (log warn) a «sollevare» (diagnosi completa conservata) quando «lo stream termina regolarmente con 0 caratteri d'uscita» — il vecchio comportamento rimandava solo il fallimento al parser JSON/Markdown a valle, con diagnosi più povere; anche i deployment senza catena di riserva sono toccati, il percorso di ripiego per fallimenti delle strati di distillazione (solo log, mai la pipeline in blocco) resta naturalmente compatibile.

## [0.8.7] — 2026-08-25

### Aggiunti

- **Cruscotto dei costi in token (#30, contributore @Irvington258)**: il costo in token di ogni chiamata LLM di distillazione
  (l1-extract / l1-dedup / l2 / l3) viene scritto per chiave composta `provider/model` nella tabella di dettaglio SQLite `token_cost` (con migrazione della colonna provider della vecchia tabella), la pagina impostazioni riceve la scheda «Costi»:
  linee di tendenza colorate per modello (gettoni delle serie di grafici `--dsh-mem-chart-1..8`, granularità giorno/settimana/mese +
  finestra degli ultimi N giorni forzata in granularità giorno + filtro per livelli L1/L2/L3), tabella strati × finestre temporali (numero di chiamate /
  token d'uscita e di ragionamento / media / mediana, il median calcolato lato JS), elenco dei cumuli per modello,
  recuperato dal RPC in sola lettura `dsh-memory/token-cost`, sondato ogni 5 s. Criteri dei dati: ingressi contati in caratteri
  (l'usage in streaming di dsh non include i token d'ingresso, stesso criterio di llm-usage), uscita/ragionamento in token;
  la contabilità è agganciata all'uscita di callLLM e registrata su entrambe le vie successo/fallimento; un fallimento di contabilità si limita a warn e non blocca mai la distillazione;
  cache di prepare alla costruzione delle istruzioni; rilascio dei riferimenti di modulo alla disinstallazione del plugin.
- Chiave di configurazione `tokenCost.retentionDays` (default `365`, `0` = conservazione illimitata): giorni di conservazione del dettaglio dei costi,
  con pulizia scorrevole alla scrittura; il tetto della finestra «ultimi N giorni» del cruscotto costi coincide con questo valore (dopo la liberazione della ritenzione, il
  limite d'ingresso del client si allarga a 3650, il tetto vero verificato dal backend secondo la configurazione).

### Modifiche

- Riscrittura della specifica di design: `global-spec.md` riceve una sezione «colori delle serie di grafici» (categorie della codifica a colori per la visualizzazione dati —
  esenzione funzionale dal blocco mono-accento, precedente: i colori delle modalità; 8 gradi di gettoni a doppio tema + valori di contrasto AA ricalcolati,
  chiaro tutto ≥ 3:1 / scuro tutto ≥ 4.29, il grado 1 ancorato al blu di marca, il grado 8 in grigio neutro per «altro»);
  `settings-spec.md` riceve la sezione «scheda Costi (CostTab)»; README cinese e inglese sincronizzati in spiegazioni di funzione e
  righe della tabella di configurazione; lo smoke riceve asserzioni su default/confini di retentionDays e cablaggio dei gettoni dei grafici.

## [0.8.6] — 2026-08-24

### Aggiunti

- **Ponderazione di freschezza del richiamo (#29 variante B)**: l'ordinamento del richiamo pondera morbido con `rilevanza × max(0.5, 0.5^(Δgiorni/emivita))`
  (Δ sul updated_at della memoria) — tra candidati di rilevanza simile passano prima le memorie fresche; nelle sessioni lunghe i posti del richiamo
  ruotano naturalmente all'uso, le voci d'antichità non monopolizzano più il top-N. Scelte di progettazione (a fronte degli arbitrati di Generative Agents e delle
  pratiche RAG di produzione): **moltiplicativo e non additivo** — la freschezza aggiusta solo i ranghi tra candidati di rilevanza vicina, non si sostituisce mai
  alla rilevanza (l'addizione farebbe salire per recency memorie nuove ma fuori tema); **pavimento di decadimento a 0.5** — una memoria vecchia perde al più la metà
  del punteggio d'ordinamento, i fatti di lungo periodo («la preferenza di caffè scritta tre anni fa») non affondano mai, il che rende l'emivita un regolamento poco sensibile;
  i record senza updated_at contano come i più vecchi (il pavimento prende il timone, zero casi speciali). Appeso all'unica cucitura della ricerca
  (dopo le soglie delle tre vie di `L1Store.search()`, prima del taglio), così l'iniezione di richiamo e lo strumento memory_search sono automaticamente coerenti;
  **il richiamo dei candidati della deduplica (searchCandidates) non la applica esplicitamente** — il percorso di scrittura che cerca i vecchi record di stessa
  semantica deve trattare uguale nuovo e vecchio; il decadimento farebbe mancare alla deduplica i doppioni. `recall.decayHalfLifeDays` default 30 giorni, 0 = disattivato
  (fissabile a 0 per la comparabilità delle basi di bench); il campo score degli incontri non viene riscritto (l'ordinamento usa il punteggio ponderato, la mostra continua a riflettere la rilevanza di ricerca);
  l'idf non viene isolato (integrato nella via BM25, senza equivalente sulla via vettoriale); l'importance (priority) resta per ora inattiva (l'uscita dell'estrazione
  attuale è quasi costante, il suo guadagno all'ordinamento tenderebbe a zero; la formula le riserva un posto).
- **Deduplica del richiamo (risparmio di token)**: nella stessa sessione, le memorie già iniettate non lo vengono una seconda volta — quando l'utente insiste
  su una domanda affine/simile, la ricerca riincontra gli stessi record, ma il contesto del modello li contiene già: re-iniettare è puro spreco
  (~2000 caratteri ≈ 1000 token per turno al massimo). Semantica di filtro puro: restano tante nuove occasioni quante se ne iniettano, la soppressione integrale (0 voci)
  è uno stato corretto, non un mancare. Granularità = id del record L1: una fusione/aggiornamento della deduplica cambia l'id, le memorie dal contenuto cambiato si
  liberano naturalmente dal blocco e si re-iniettano. Quando il contesto viene compresso con `/compact` o svuotato con `/clear`
  (evento `agent/session-start`), il registro si azzera — il contenuto iniettato è già uscito dal contesto del modello, la memoria può essere re-iniettata;
  `resume` non azzera (la storia è ancora lì). Il registro si persiste in `recall-dedupe.json` della directory dati
  (scrittura attraversante serializzata e atomica, stessa ricetta di session-modes; LRU di 200 sessioni / tetto di 512 id per sessione /
  scadenza a 90 giorni; qualunque fallimento di I/O degrada in memoria senza mai bloccare la via del richiamo — il sovraccosto del percorso caldo resta un Set in memoria in O(hits)). Le statistiche ricevono il contatore cumulativo `suppressedRecalls` (consultabile via RPC session-stats),
  log di debug a ogni soppressione; il criterio della carta flottante resta continuo (i turni a soppressione integrale contano in hitTurns — la memoria
  rilevante è già nel contesto, essenza di un incontro).

### Corretti

- **Import dei records.jsonl della vecchia versione bloccato per sempre (#28)**: se nei record prodotti dal vecchio generatore mancava uno dei campi `type`/`priority`/
  `scene_name`, il `undefined` veniva rifiutato dallo strato di binding di node:sqlite — anche il ripiego unitario falliva sistematicamente in blocco (i campi mancanti della stessa
  generazione di generatore arrivano in lotto), il file restava sul posto, ogni avvio riprovava e i dati non entravano mai in base. Rimedio:
  **rete di sicurezza dei campi allo strato di binding** (`upsertL1InTx`/`upsertL0Batch` normalizzano le variabili locali, tabella principale/vettore/FTS condividono
  gli stessi valori di origine; valori di default presi dalle colonne dello schema: `type='' / priority=50 / scene_name=''`, lato L0 `sessionId='default' / role='' / recordedAt='' / timestamp=0`) —
  una sola riparazione copre gli import di vecchie versioni, reindex, backfill e tutte le scritture ordinarie; nel frattempo svanisce il rischio di TypeError di `familyForType(undefined)`
  (dopo la normalizzazione, ricaduta sulla famiglia chat). L'import L0 delle vecchie versioni riceve al tempo stesso una soglia minima di validità (conteggio delle righe cattive
  senza id/content scartate, finora zero filtraggio). Nota: l'«assenza di isolamento riga per riga» del rapporto non regge — il ripiego unitario esisteva già
  (il log del rapporto se ne fa testimone), ciò che mancava era la rete dei campi; il fusibile `.failed` è stato tralasciato per consenso (la causa nota del ciclo
  è curata; le forme sconosciute aspetteranno di comparire davvero).
- **L'embedding locale congelava l'intera pagina (incidente di livello prestazionale)**: il caricamento del modello di transformers.js e l'inferenza ONNX giravano all'origine in modo sincrono sul thread principale dell'host — il `run`/`loadModel` di onnxruntime-node (v1.24.3) sono chiamate sincrone dentro un callback setImmediate (l'incarto Promise non scarica il calcolo); con l'embedding locale attivo (embeddinggemma-300m, misurato ~0,3–1,3 s d'inferenza per voce), ogni turno di conversazione — scrittura L0, query di richiamo, scrittura di distillazione, lotti di reindex — congelava la event loop per secondi: nessuna interazione rispondeva più sulle pagine dsh. Rimedio:
  l'inferenza migra d'un blocco in un thread worker (`resources/embedding-worker.cjs`, il thread principale conserva solo il proxy di protocollo
  `LocalEmbeddingService`): inferenza voce per voce + cessione tra le voci, una richiesta unitaria (query di richiamo) infila in avanti e non aspetta in fondo alla
  coda del lotto di reindex; misurato: durante un lotto di 8 embeddings (il vecchio percorso congelava ~10 s di fila), il campionamento del thread principale rileva 0,0 ms di eccesso. In più, un rafforzamento semantico: il morsetto interno `embeddingTimeoutMs` della via di richiamo passa per l'embedding locale da «ignorato» a realmente efficace (abbandono per corsa, risposte in ritardo scartate). Il crash del worker non si auto-ripara (stato failed con discesa della catena FTS; cambio di sorgente/riavvio per la ripresa);
  `close()` = terminate, la semantica «terminated non risorge» si conserva.
- **Tempesta di ritenti della distillazione (chiamate bruciate a raffica durante i guasti LLM)**: dopo un fallimento d'estrazione L1 (es. timeout di gateway di 120 s), la rete
  d'inattività continuava a impilare ogni 30 s compiti di distillazione force, che durante l'attesa del LLM si gonfiavano in chiamate a raffica senza fine
  (prova in memory.log del 2026-08-24: un giro di chiamate da 120 s ogni 2 minuti, senza convergenza). Rimedio: back-off esponenziale per sessione
  (partenza a 60 s, raddoppio, tetto 30 minuti, azzeramento al consumo riuscito; i giri di ricostruzione esenti — l'azione esplicita dell'utente
  ha la propria UI di fallimento/annullamento), durante il back-off sia la rete d'inattività sia il grilletto della soglia saltano quella sessione.
- **Indurimento di sicurezza nel passaggio (semantica invariata)**: tutte le frontiere di lettura/scrittura di file degli strumenti bench e dello smoke-test passano a scrittura
  di containment in linea (verifica startsWith della radice dopo resolve / whitelist SAFE_NAME;
  asserzioni di contratto per le variabili d'ambiente di tipo directory: percorso assoluto e senza segmenti `..`).

## [0.8.5] — 2026-08-23

### Corretti

- **Rettifica del criterio di valutazione** (bench): ① per le domande con stale (aggiornamento/catena/oblio), la condizione di FAIL passa da «il vecchio valore compare» a «il vecchio valore **enunciato come situazione vigente**» — il solo racconto dell'evoluzione con valore finale giusto non penalizza più
  (misurato al ritorno lifecycle del 2026-08-23: una domanda di catena con risposta giusta su platino/diamante che però accennava alla traiettoria della sabbia per gatti veniva massacrata per intero); ② il FAIL delle domande a rifiuto di risposta si limita a «pronunciare come fatto noto proprio ciò che si chiedeva», citare il contesto reale per spiegare «perché non si sa ciò che si chiede» vale PASS («conosco solo A e B, nessun record di C» veniva prima scartato a torto). La domanda update di work-project-stack passa da contains-all al giudizio LLM (il giudizio programmatico non sa distinguere l'enunciato attuale dal racconto d'evoluzione; non ci sono più combinazioni contains-all+stale in tutta la biblioteca).
- **Etichettatura sbagliata di famiglia nella modalità auto: fatti personali «di piano» aspirati nella famiglia work** (scoperto alla prima corsa della pista lifecycle):
  il prefisso di tipo dell'uscita dell'estrazione decideva implicitamente la famiglia, e fatti personali a forma di «regola» come «piano di disinfestazione / calendario di vaccini / scelta della lettiera», senza formulazione aderente nel vocabolario chat, venivano aspirati dalla semantica di forma di work_fact/work_method → famiglia mal etichettata → lo stesso fatto in doppia famiglia (la deduplica non attraversa mai le famiglie → resurrezione del vecchio valore, fallimento delle domande a catena) + perdita del filtro per famiglia (una sessione in modalità chat poteva nominare fatti work, 2/2×2 misurati in lifecycle). Rimedio: il prompt di estrazione della modalità auto **emette esplicitamente un campo family per memoria** (il giudizio guarda il contesto, non la forma — professione/team/progetto → work, famiglia/animali/salute/agenda personale → chat; family circoscrive il vocabolario di tipo, senza incroci); lato ingegneria, catena di ripiego a tre gradi `resolveRecordFamily` (puro forzato → esplicito dell'estrazione → prefisso di tipo). La divergenza dall'upstream MemoryCore è annotata nell'intestazione del prompt. **Una base mal etichettata va ricostruita una volta dopo l'aggiornamento per guarire** (L1 svuotato e reimportato; attenzione: il rebuild risuscita da L0 i fatti «dimenticati» — semantica esistente).

### Aggiunti

- **Completamento del triangolo d'efficienza** (bench + plugin): «il costo della memoria» e il «risparmio da memoria» già misurato della pista workflow compongono un ROI completo —
  ① **costo d'iniezione** (differenziale dei tempi di risposta tra turni iniettati e turni non iniettati — le marche temporali degli eventi vengono scritte alla distribuzione dei passi, il tempo proprio dell'hook d'iniezione non è osservabile direttamente, da qui il passaggio al criterio differenziale dopo la verifica sul campo;
  il gruppo A si fa la propria base all'interno); ② **quota iniettata** (caratteri iniettati del turno sonda / token d'ingresso del turno, convertendo 1 carattere cinese ≈ 1 token); ③ **contabilità di distillazione** (nuovo contatore sempre attivo `src/llm-usage.ts`, callLLM accumula per strato l1-extract/l1-dedup/l2/l3 i caratteri d'ingresso/token d'uscita/di ragionamento, leggibile via servizio di controllo bench
  `getDistillUsage`, ripartito per messaggio catturato; il rebuild del lifecycle ha in più una sua differenziale prima/dopo). patch-arm-on attiva nel frattempo benchControl; i vecchi run senza i nuovi campi saltano automaticamente la sezione.
  Al passaggio si tappa una breccia della guardia dei collegamenti di run.mjs: i worktree fratelli sotto l'albero principale (.worktree/…) venivano finora
  lasciati passare — misurato il 2026-08-23, un vecchio runner puntante .worktree/dev ha girato tutta la procedura in silenzio.
- **Pista di ciclo di vita** (bench `--track lifecycle`, solo gruppo A): mette alla prova solo gli invarianti del ciclo di vita che solo questa architettura può provare —
  **filtraggio per famiglia** (una sessione in modalità chat non può nominare fatti della famiglia work, e specularmente; una perdita tra famiglie non nulla direbbe «scrittura e richiamo nella stessa modalità» rotto), **cattura in modalità spenta** (doppia asserzione: i fatti nonce insegnati a una sessione spenta — la sonda auto deve rifiutare di rispondere + assenza integrale nei JSONL records/conversations, riverificata dopo il rebuild), **fedeltà del rebuild** (dopo la ricostruzione integrale, sonda ×2 controllo ×1; un arretramento significativo direbbe che la catena del rebuild perde informazione), **richieste d'oblio** (chiedere nella conversazione naturale di cancellare un ricordo → via di cancellazione della rilevazione dei conflitti L1 → riporre la stessa domanda deve dare un rifiuto senza ripetere il vecchio valore; la resurrezione del vecchio da L0 tramite rebuild è la semantica documentata). Zero nuovi file di scena, riutilizzo della biblioteca di dialoghi.
- **Curva di degrado su scala**: ① allagamento offline (`retrieval-metrics.mjs --flood N1,N2`) — duplicare la base di riferimento con N record sintetici deterministici (domini tematici sfalsati, zero cifre nel testo integrale per evitare collisioni fortuite con i gold numerici) e ricalcolare recall@k, una curva «qualità di ricerca vs volume della base» a costo di esecuzione nullo (base archiviata 0.8.3 misurata: +400 voci → recall@5 da 70,2% a 65,8%); ② rumore a runtime (run.mjs `--noise k`) — inserire tra le scene di dialogo sessioni di riempimento (`fillers.json`, 25 sessioni, asserzione di caricamento contro le collisioni di marcatori) per misurare il degrado end-to-end; il report riceve una sezione «analisi di posizione su scala» (tre secchi inizio/mezzo/fine); il riempimento non tocca la lista scenarioFiles, i compare tra livelli di noise non innescano allarmi d'ambiente.
- **Servizio di controllo bench** (configurazione `benchControl` del plugin, spenta per default): un servizio cordis in-processo `dsh-memory-bench` (attivazione di rebuild / sondaggio di stato / fissazione delle modalità di sessione) al servizio della pista lifecycle — lato host, connection.rpc ha solo handle e non call; questo è l'unico canale in-processo pulito; i deployment di produzione non aprono questa configurazione, superficie nulla.
- **Indicatori offline dello strato di ricerca della referencia** (bench): calcolati automaticamente da report/compare + CLI autonoma
  (`bench/harness/retrieval-metrics.mjs`) — tabelle per tipo di domanda per recall@5 / copertura dei gold / MRR (le domande sonda rieseguite in modo controllato sulla base di memoria finale del rep con la ricerca keyword, criteri di bacino/soglie/eccezioni da piccolo corpus e di runtime identici punto per punto, tokenizzazione e indice condividono i search-utils di dist) + precisione d'iniezione (quota delle righe iniettate con i punti gold) + conteggio delle iniezioni con informazione già caduta (gli stale di tipo update entrano nell'iniezione, il fallimento dell'aggiornamento diventa visibile proprio allo strato d'iniezione). Il runner scrive in più `recall.lines` (dettaglio delle righe di memoria iniettate).
  Al problema dell'arma smussata «accuratezza end-to-end» ecco ormai un segnale diretto che non dipende né dal giudice né dal campionamento.
- **Quattro nuovi tipi di domande + scene di workflow con memoria prospettica** (bench, ispirate a MemoryAgentBench /
  GoodAI LTM / BEAM): `accretive` (accumulo incrementale: un fatto completo spaccato su più sessioni da assemblare),
  `update-chain` (aggiornamento a catena v1→v2→v3, con catene a ritorno d'onda), `ordering` (ordinamento di eventi),
  `paraphrase` (riformulazione sinonimica a prova dei buchi lessicali) — biblioteca di dialoghi 15→20 (scene nuove tutte nel formato a 10 domande,
  90→140 domande per rep), le scene possono portare sessioni di rinforzo (0~2, incastonate tra teach e change); nel workflow nuovo `wf-preflight`
  (convenzione fissa insegnata «prima di generare, scrivi il file di pre-volo», la sonda dà solo un compito vago, il gruppo A deve integrare il passaggio affidandosi alla memoria).

### Modifiche

- Aggiornamento delle regole del validatore delle scene di dialogo: numero di domande sonde 6→6~10 (le sei centrali esattamente 1 ciascuna + al più 1 per tipo esteso),
  sessioni di rinforzo consentite (ordine forzato teach → reinforce → change),
  `update-chain` deve portare stale; il criterio speciale di aggiornamento confluisce nelle domande a catena.
  Il cambiamento della lista di scene fa avvisare i compare con le vecchie basi «ambiente non conforme» — atteso; riesegui la base o punta `--scenarios` sulla stessa sotto-insieme per confrontare.

## [0.8.4] — 2026-08-22

### Corretti

- **Il nuovo vocabolario dei livelli di ragionamento della pagina impostazioni veniva respinto dalla porta di scrittura** (introdotto in 0.8.3): all'ampliamento della tabella dei livelli a otto parole, la whitelist RPC di `settings-set` non lo seguì (riconosceva solo `''/off/high/max`), e la pagina impostazioni rispondeva «livello di ragionamento illegittimo» con annullamento a ogni scelta di `none/minimal/low/medium/xhigh`. Ora la whitelist e lo schema/settings tirano dalla stessa fonte — il vocabolario converge alla fonte di verità unica `EFFORT_CHOICES` di `config.ts` (la stessa lista era copiata alla lettera in 4 luoghi).
- **Il budget d'uscita esplicito `xhigh` veniva ingrandito due volte, ×16** (introdotto in 0.8.3): il `layerMaxTokens` lato fasi e la guardia della modalità automatica di `callLLM` portavano ciascuna la propria tabella letterale dei livelli alti, divergenti (la guardia dimenticava `xhigh`); con la configurazione `xhigh` e un modello che lo dichiara, si moltiplicava ×4 e ancora ×4. I due lati condividono ora l'unica costante `HIGH_EFFORT_TIERS`, e quando la configurazione è essa stessa un livello alto, la guardia non ingrandisce più.
- **Il selettore del livello di ragionamento riacquista la voce «Auto»**: dopo la rimozione dell'opzione «segui la configurazione» in 0.8.3, il selettore mostrava solo i livelli dichiarati dal modello, e chi aveva scelto una volta un livello esplicito non poteva più tornare all'automatico dalla UI. La prima voce è ora fissa «Auto» (key='', il clic riscrive la stringa vuota), e la tripla ripetizione nella costruzione delle opzioni converge in un solo calcolo.
- Deriva documentale: la lista dei valori di `llm.reasoningEffort` nei README cinese e inglese riceve `minimal` (allineata allo schema); le menzioni «high/max ×4» nei suggerimenti di budget della pagina impostazioni e nei commenti del codice vengono completate in high/xhigh/max.

### Modifiche

- **Aggiornamento del runtime host 0.1.0-rc.8 → 0.1.1-rc.2** (devDeps fissate esattamente, peers passati alla linea `^0.1.1-rc.2`): i 9 pacchetti di dipendenze dirette confrontati file per file nel tarball — 7 pacchetti senza cambi di codice,
  dsh-llm / dsh-client-connection a puro incremento (scaricamento di immagini multimodali / Files API /
  `prepareCall` dell'adapter / parametro opzionale RPC `doFetch`), i GenerateOptions/StreamChunk/createUserMessage/installModelSelection/
  rpc.handle|call usati da questo progetto sono identici byte per byte, zero adattamenti. Verifica: build/smoke/dump-config dei due profili/
  smoke del fixture di bench tutto verde. L'ERESOLVE di npm per l'attraversamento delle famiglie pre-release passa per `--legacy-peer-deps` (annotato in AGENTS.md).

### Riferimento

- **La pista workflow di DSH-MemBench sale a 7 scene** (`bench/`), con tre nuove famiglie di prove:
  aggiornamento del sapere di processo (`wf-heap-update` — insegnamento v1 → sessione di cambio che annuncia la v2 → sonda su
  «il processo attualmente in vigore», gli artefatti propri del vecchio processo non devono più comparire, misura operativizzata dell'aggiornamento per deduplica L1),
  disambiguazione di workflow gemelli (`wf-twin-runbook` — runbook gemelli, configurare il servizio sbagliato viene condannato dalle verifiche negative),
  continuità delle convenzioni di stile (`wf-report-style` — convenzioni di denominazione/struttura/separatore delle migliaia/piede di pagina applicate di sessione in sessione). La verifica di completezza si allarga da un solo controllo positivo a quattro tipi di criteri (`contains`/`notContains`/
  `absent`/`exists`), il verificatore viene estratto in `checks.js` unitestabile isolatamente; il runner accetta una sessione `change` opzionale; la validazione della biblioteca di scene si stringe al tempo stesso (esattamente un criterio a scelta, il marcatore deve comparire nel testo d'insegnamento).
  La base ufficiale (`bench/baseline/`) resta alla versione a 4 scene; la prima corsa di regressione dopo l'allargamento dovrà ricostruire la base.

### Indurimento del riferimento (lotti di correzioni dopo l'audit delle breccie)

- **Gruppi A e B in parallelo**: `run.mjs --arm AB` gira i due gruppi in due processi paralleli (i controlli non pendono l'uno dall'altro), il padre produce alla fine il rapporto congiunto; i figli sono dispensati da pulizia e rapporto automatico per non disturbarsi.
- **Chiusura del canale di archeologia tra run**: prima di ogni run, pulizia delle sandbox storiche di `%TEMP%/dsh-mem-bench/` e delle directory di sessioni del namespace bench in `~/.dsh/sessions` (viene incrociato solo `dsh-mem-bench`, le sessioni/dati dell'utente non sono toccati).
- **Ritiro del gruppo B della pista dialogo**: le sessioni di Harness sono indipendenti tra loro, la sonda del gruppo B senza memoria fallisce necessariamente (17,8% misurato storicamente ≈ il pavimento), il controllo non dice nulla — `--track dialog --arm B` rifiuta di girare, resta solo il gruppo A.
- **Impronta del codice e guardia dei collegamenti**: l'intestazione environment dei risultati registra `gitSha`; run.mjs verifica all'avvio che le due dipendenze link: del profilo bench puntino al repository testato (il codice di un vecchio worktree inquinava silenziosamente i risultati, incidente misurato il 2026-08-21).
- **Audit a due livelli delle letture fuori confine** (pista workflow): livello rigido — un incontro (base di memoria/sessioni di `~/.dsh`, memory.db, percorsi di archivio records/conversations/scenes) → tutte le verifiche delle scene coinvolte condannate; livello lasso solo invito a riverificare;
  correzione del falso allarme per la sottostringa `.MemoryMappedFiles`; le chiamate legittime degli strumenti di memoria (memory_read_scene ecc., i parametri sono percorsi) non entrano nell'audit.
- **De-auto-rivelazione delle scene**: `wf-heap-update` passa a una convenzione in due passi `target.env + apply.sh`, `wf-twin-runbook` a file `svc-a/svc-b` isomorfi (la corrispondenza vive solo nel testo d'insegnamento) — riparazione della breccia di discriminabilità «il gruppo B può frugare i file della sandbox e ricostruire il processo» (misurato, la sonda B era salita a 12/12 e 11/12, vicino al punteggio massimo).
- **Inquinamento del workflow misurato**: l'iniezione di richiamo delle sonde workflow entra nelle statistiche di contaminazione (il campo mancava, il rapporto mostrava 0); il report riceve una colonna **completezza del segmento sonda** (nei segmenti di insegnamento/cambio entrambi i bracci hanno il contesto sul posto; solo il segmento sonda è la finestra di memoria pura).
- **Riserrata della validazione della biblioteca di scene**: marcatori unici in tutta la biblioteca, ricerca di doppioni tra sessioni dello stesso tipo, i gold di contains-all devono comparire nel testo d'insegnamento (domanda senza risposta senza memoria = cattiva domanda), i gold non devono filtrare nel testo delle domande; la rilevazione delle chiamate d'aiuto riceve motivi inglesi; i fixtures si separano per pista in `dialog/`, `workflow/` (una scena workflow sotto un patch di dialogo senza strumenti fallirebbe a colpo sicuro, lo smoke mescolato avrebbe allarmato a torto).

### Ergonomia del riferimento (configurazione dei modelli via bench.env)

- **Configurazione accentrata dei modelli in tre ruoli**: `bench/harness/bench.env` (modello da copiare da `bench.env.example`, con chiave API gitignored) configura da un solo luogo l'agente testato / il giudice / la distillazione —
  `BENCH_PROVIDER/BENCH_MODEL`, `BENCH_JUDGE_*`, `BENCH_DISTILL_*`; gli argomenti da riga di comando hanno la precedenza sul file env. Nuovi parametri `--distill-provider/--distill-model`, il modello di distillazione passa dal codice fisso nel patch alle variabili d'ambiente (default in ripiego: official/flash).
- **Gateway personalizzato compatibile OpenAI**: dopo aver compilato in bench.env `BENCH_TEST_BASE_URL + API_KEY` (il giudice può avere un'altra coppia), run.mjs genera automaticamente il patch llm-pi-ai che registra `bench-gw` /
  `bench-judge-gw` (giudice/distillazione che riutilizzano il gateway testato: fusione automatica e deduplica della tabella dei modelli), la chiave API referenziata da apiKeyEnv viene iniettata solo nell'ambiente del sotto-processo. Con il gateway configurato, i fornitori personalizzati del run sono interamente dettati da bench.env (il gateway del settings.yaml dell'utente non vi partecipa: isolamento e riproducibilità).
- **Rimozione del ripiego di default del modello testato**: senza `--provider/--model` e senza bench.env si rifiuta di girare (il vecchio ripiego cadeva sul modello di default del settings.yaml, e il profilo bench senza adapter esplodeva all'avvio).
- Analisi e costruzione del patch di gateway estratte nel modulo di funzioni pure `env-config.mjs` (22 test unitari + validazione della struttura di dump-config, tutto verde).
- **Intensità di ragionamento configurabile in tre ruoli**: `BENCH_REASONING_EFFORT` (testato) / `BENCH_JUDGE_REASONING_EFFORT`
  (giudice) / `BENCH_DISTILL_REASONING_EFFORT` (distillazione, default off) + parametri corrispondenti `--effort/
  --judge-effort/--distill-effort`; trasmessi via `ModelSelection.reasoningEffort`
  (porta ufficiale installModelSelection) e le GenerateOptions del giudice; vuoto = non trasmettere, seguire il default del fornitore; l'intestazione environment dei risultati registra l'effort di entrambi i lati (riproducibilità).

### Aggiornamento dei dati misurati della referencia (README cinese/inglese sincronizzati)

- **Nuovi dati dopo l'allargamento della pista workflow a 7 scene** (v4-flash@high, giudice glm-5.3, plugin 0.8.3):
  completezza del segmento sonda gruppo A (memoria accesa, 3 turni) **85,5%** (59/69) contro gruppo B (memoria spenta, 1 turno)
  **43,5%** (10/23); i token d'ingresso per scena del gruppo B valgono **6,8 volte** quelli del gruppo A (1,81M contro 266k,
  a livello high il costo della riesplorazione senza memoria si amplifica sensibilmente); sonda della scena di convenzioni di stile gruppo B 0/4 (le convenzioni
  vivono solo nella memoria, il soffitto della discriminabilità); nella scena di aggiornamento del processo il gruppo B può ancora ricostruire leggendo gli script (discriminabilità limitata dalle
  affordance della sandbox, annotato onestamente nel README). Il grafico `bench-workflow.svg` viene rifatto con i nuovi dati; i vecchi dati della
  pista dialogo vengono etichettati base d'archivio 0.8.0 (gruppo B ritirato).
- **Balaustra di costo del gruppo B**: `--repeats` vale solo per il gruppo A, il gruppo B gira fisso solo 1 volta (il consumo di token dei lunghi compiti
  senza memoria è troppo alto, decisione dell'utente).
- **Pannello di progresso in tempo reale**: durante il benchmark, `run.mjs` avvia automaticamente `panel.mjs` (zero dipendenze, legato solo a
  127.0.0.1) e apre il browser — carte dei due bracci A/B, progresso a grana fine per scene/fasi/messaggi, costi cumulati,
  coda degli eventi; la coppia di indicatori battito (5 s) + freschezza dell'attività decide al volo «bloccato vs processo morto». La fonte dei dati è la scrittura atomica incrementale del runner in `rep-N/progress.json` (strozzata a ≥ 1 s) + il `plan.json`
  all'avvio di `run.mjs` (il ciclo dei rep resta al padre, i figli ignorano il totale dei giri). `--no-panel` disattiva;
  il pannello viene mietuto automaticamente all'uscita del run (unref dei figli, altrimenti reggerebbero la event loop del padre).

## [0.8.3] — 2026-08-21

### Modifiche

- **I livelli di ragionamento della distillazione diventano consci del modello (sistema l'esplosione garantita della distillazione sui modelli non deepseek)**: prima il plugin trasmetteva il livello di ragionamento della distillazione (default `off`) tale e quale a qualsiasi modello — `off` è un concetto dello strato adattatore deepseek, che i gateway pi-ai/openai-responses non conoscono (qwen in locale rifiutava, l'upstream rispondeva 400 Invalid
  reasoning.effort). Ora, prima dell'invio, si interroga `resolveModelInfo` sulle capacità del modello (cache per rotta, invalidata al cambiamento di topologia): se dichiarato → inviato tale e quale; `off` davanti al vocabolario OpenAI → alias `none`; non supportato o non dichiarato → non si invia + un solo avviso; **l'opzione «segui la configurazione» viene rimossa**, '' = auto (livello di default del modello →
  high); la tabella dei livelli selezionabili della pagina impostazioni segue la mostra in diretta del modello corrente (senza dichiarazioni, solo high visibile); il vocabolario della tabella si allarga a off/none/minimal/low/medium/high/xhigh/max; se il livello auto si risolve in un livello alto, la guardia ×4 del budget d'uscita entra in gioco al tempo stesso.
- **Cambio del modello di distillazione con selezione automatica del modello**: dopo il cambio di fornitore, il modello ricade automaticamente sul primo modello del fornitore (scrittura in coppia con sovrascrittura), il menu del modello non ha più il «segui il default» (seguire il default = svuotare la prima voce del menu del fornitore sovrascrivendola);
  l'elenco dei modelli viene messo in cache per fornitore + precaricato in background al caricamento del pannello (cambio immediato senza vuoti; in caso di mancanza, mostra «caricamento dell'elenco dei modelli…» invece del nome di un modello stantio). **Il testo del pulsante che non cambiava da solo, ora sistemato**: l'ottimismo di `writeLlm` fondeva finora le chiavi settings `distillProvider/distillModel` direttamente in `info.current`,
  mentre lo strato di visualizzazione leggeva `current.provider/model` — le chiavi non corrispondevano, l'ottimismo era un no-op per il testo del pulsante,
  e bisognava attendere il rinfresco del sondaggio a 5 s (sensazione «qualche secondo prima che cambi»); ora le chiavi vengono mappate in chiavi di vista e scritte insieme in `current` e
  `effective`, le risposte stantie del sondaggio giunte durante la scrittura in volo vengono scartate (anti-scorpaccio), e dopo il successo si tira subito una volta il vero valore del server.
- **Menu a tendina interamente disegnato al proprio interno, allineato all'aspetto del MenuDropdown di dsh**: la lista esplosa del `<select>` nativo viene disegnata dal sistema operativo (angoli squadrati, evidenziazione di sistema), fuori dalla portata del CSS — sostituito da pulsante grilletto + pannello flottante (arrotondamento 12px
  / fondo dsw-specific-menu / proiezione lv3, opzioni a arrotondamento 10px + fondo al passaggio + spunta di selezione,
  tastiera ↑↓/Enter/Esc interamente supportata, semantica aria listbox). I quattro luoghi — i due livelli fornitore/modello del modello di distillazione e i filtri tipo/contesto della scheda memoria — sono tutti sostituiti, nel bundle più nessun `<select>` nativo.
- **I blocchi di scena della pagina impostazioni diventano ripiegabili**: le carte di scena della scheda scene sono ripiegate per default (solo la testa + una riga di riassunto),
  un clic sulla testa sfoglia/ripiega il corpo, la freccia di ripiego ruota di 90° nello stato svolto (rispetta reduced-motion).
- **La scheda dei log scorre di default in fondo**: leggere i log significa volere la coda più recente (semantica tail); dopo caricamento/rinfresco si incolla automaticamente al fondo, più nessun fermo di default in cima.
- **Guida allo sblocco quando il deployment è fissato**: quando il modello di distillazione è bloccato dal pin statico del profilo (`llm.provider`+
  `llm.model` entrambi compilati) e il selettore non compare, un testo statico spiega «come togliere il pin per recuperare
  la commutazione di pagina» (prima si mostrava solo la rotta fissa, l'utente non sapeva perché non potesse commutare).

Lotto di correzioni dopo una revisione completa del codice (sicurezza + robustezza + coerenza documentale).

### Corretti

- **Una configurazione proxy malformato non fa più crollare il caricamento del plugin** (alta gravità): se `embedding.proxy` è scritto senza schema
  (es. `127.0.0.1:7890`) o la variabile d'ambiente del proxy stessa è senza schema, il costruttore di `ProxyAgent` sollevava un TypeError in modo sincrono → fallimento di apply. Stessa tolleranza del mirror malformato: cattura e ripiego in connessione diretta + warn.
- **Oscuramento dei log delle URL proxy**: il log dei download via proxy stampava l'URL del proxy così com'è (con eventuali
  credenziali user:pass) e lo persisteva in `memory.log`; ora le userinfo vengono spogliate, resta solo `scheme//host`.
- **`NO_PROXY=*` con asterisco prende effetto** (prima la voce `*` non incrociava mai, il proxy restava in uso anche se impostato).
- **Ciclo chiuso della visibilità dei fallimenti di doppia scrittura**: il fallimento di L0/L1 «fonte di verità JSONL scritta, scrittura in lotti nella base di ricerca fallita» era finora silenzioso
  (record da allora introvabili, candidati della deduplica mancanti); ora innalzato a log error con la nota che «Ricostruisci la memoria» permette di reimportare integralmente dalla fonte di verità.
- **Durabilità delle scritture atomiche**: le scritture atomiche tmp+rename di state/pending/scene/persona ricevono il fsync del blocco dati
  (prima un blackout poteva lasciare un file vuoto o mezzo scritto); il nome del tmp riceve un segmento casuale contro le collisioni nello stesso millisecondo, il percorso di fallimento ripulisce i tmp orfani.
- **Semantica di annullamento dell'installatore runtime** (piattaforma principale Windows): dopo l'annullamento in fase ci, non si cade più nel ramo di ripiego «ci fallito» che rilancerebbe un install inutile; l'annullamento nella finestra tra l'uscita del ci e la partenza del ripiego vale pure; sotto `shell:true` il kill passa a `taskkill /T /F` per tagliare l'albero dei processi (prima si uccideva solo cmd.exe e i nipoti npm continuavano a girare — timeout e annullamento si fermavano solo in superficie).
- **Configurazione di troncatura letta per l'embedding locale**: `embedding.maxInputChars` valeva finora solo per l'embedding remoto, la via locale codificava 5000 a mano; le due vie tirano ormai dalla stessa fonte.
- **Indurimento dei nomi di file di scena**: i nomi di dispositivi riservati di Windows (CON/NUL/COM1… in forma con estensione) ricevono un prefisso `_` di schivata; i nomi troppo lunghi vengono tagliati a 120 caratteri (difesa da ENAMETOOLONG).
- **Criterio di migrazione del L1 vecchio formato**: se il vecchio `records.jsonl` conteneva righe corrotte, la migrazione non si completava mai (lo stesso lotto veniva reimportato a ogni avvio); il criterio passa al numero di righe valide dopo il filtro.
- **Limiti dei parametri d'ingresso RPC**: sessionId ≤ 512 / query ≤ 4096 / provider·model·activeModel ≤ 200,
  offset di paginazione ≤ 1 milione — contro i carichi sovradimensionati malformati dal pannello in loopback (gonfiamento di session-modes.json, picchi CPU della tokenizzazione jieba integrale).
- **Guardie di limite delle ricerche FTS/vettore**: i tre ingressi di ricerca rifiutano `limit ≤ 0` (LIMIT negativo in SQLite = non limitato; la faccia di chiamata attuale è già morsettata, pura difesa contro futuri chiamanti).
- **Avviso per chiamate di strumento senza identificatore d'agente**: senza `exec.agent` trasmesso, il filtro per modalità degradava in ricerca di tutte le famiglie; ora un solo avviso (il comportamento fail-open resta, la chiamata non viene rifiutata).

### Documentazione

- Il README cinese recupera l'intera sezione «Log e risoluzione dei problemi» esistente solo nella versione inglese (una mancanza che violava la legge del sincronismo cinese-inglese),
  e le due versioni aggiungono insieme la spiegazione del confine di durabilità del JSONL; la versione fissata degli esempi passa da 0.8.0 a 0.8.2.
- **Due errori fattuali della voce 0.8.2 corretti**: ① l'intervallo peer è in realtà rimasto `^0.1.0-rc.6` (rc.6~rc.8 compatibili), «l'esigenza peer è passata a dsh ≥ 0.1.0-rc.8» non corrispondeva al package.json; ② il documento citato
  `docs/dsh-dev-experience.md` non viene distribuito col repository (gitignored), verso l'esterno una referenza appesa.

## [0.8.2] — 2026-08-20

Rincorsa delle dipendenze host a dsh 0.1.0-rc.8.

- **Aggiornamento fissato delle dipendenze host 0.1.0-rc.6 → 0.1.0-rc.8** (devDependencies fissate esattamente, per
  sviluppo/test; le peerDependencies restano sull'intervallo `^0.1.0-rc.6` — rc.6→rc.8 provato sul campo come **zero deriva
  d'API**, compilazione dei tipi/smoke/avvio reale tutto verde). Dalla rc.8 il corpo di dsh passa a un layout di **installazione globale**
  (`profiles/node_modules` mantenuto dal meccanismo di heal come una fattoria di link simbolici); la vecchia installazione «albero materiale» falliva all'avvio.
- bench `run.mjs`: l'ingresso della CLI dsh diventa una catena di risoluzione (`DSH_BIN` → prefisso globale di npm → ripiego sul vecchio layout),
  rimossi i percorsi personali codificati a mano, eseguibile direttamente su altre macchine.

## [0.8.1] — 2026-08-20

Commutazione runtime del modello di distillazione + ritenti anti-inquinamento dei download dei modelli + DSH-MemBench v3.

### Aggiunti

- **Regolazione runtime del budget d'uscita della distillazione** (pagina impostazioni → Memoria → Panoramica → Parametri di distillazione → budget d'uscita):
  i tetti di token di ognuna delle quattro strati estrazione / deduplica / scena L2 / profilo L3 diventano regolabili dalla UI (erano costanti del codice; ogni aggiustamento esigeva di toccare il file di configurazione e reinstallare); vuoto o 0 = seguire i default integrati (16k/8k/32k/16k),
  l'ingrandimento ×4 dei livelli di ragionamento high/max si applica come sempre sopra il valore effettivo. Il pannello di interruttori della pagina impostazioni viene nel frattempo riorganizzato in due gruppi «modalità memoria / parametri di distillazione», raggruppamento più leggibile.
- **Regolazione runtime del budget d'ingresso della distillazione** (stesso gruppo → budget d'ingresso): il tetto di caratteri d'ingresso di una chiamata di distillazione
  (`llm.maxInputChars`, default 700.000) diventa regolabile dalla UI, vuoto/0 = seguire la configurazione statica; la suddivisione a blocchi dell'estrazione L1, la troncatura L2/L3 e la stima del numero di chiamate della ricostruzione seguono l'intera catena sul valore effettivo.
- **Commutazione runtime del modello di distillazione** (pagina impostazioni → Memoria → Panoramica → selettore «modello di distillazione»): scelta del provider/model di distillazione tra le **rotte di fornitori configurate** dell'host
  (incluse le aggiunte in dsh → impostazioni → modelli come fornitori compatibili OpenAI personalizzati), effetto immediato, senza riavvio, persistente oltre il riavvio. Priorità:
  pin statico del deployment (`llm.provider`+`llm.model` entrambi pieni, contro una scelta utente che spedirebbe la conversazione fuori)
  > scelta runtime > modello di default. Nuovi endpoint RPC `dsh-memory/llm-providers`
  (catalogo dei fornitori + selezione di default + sovrascrittura corrente + rotta realmente effettiva + il fornitore scelto è ancora registrato?)
  e `dsh-memory/llm-models` (modelli per fornitore; se l'adapter non fornisce il catalogo, la UI degrada alla digitazione manuale);
  dopo la cancellazione di fornitore/modello, la UI segnala esplicitamente «fuori elenco» e invita a risciegliere.

### Corretti

- **EmbeddingGemma non installabile** (causa radice vera): lo sha256 di `generation_config.json` nel catalogo era trascritto con un carattere sbagliato (`a736d1b3` invece di `a736b1b3`) — il mirror non ha mai restituito neanche un byte errato, è il contratto d'integrità stesso che era sbagliato; il download falliva di colpo sicuro con «verifica sha256 fallita» senza nessuna presa. Corretto secondo le misurazioni, e le 19 file del catalogo hanno subito una verifica autoritativa (file LFS confrontati con gli oid dell'albero HF, file piccoli davvero hashati) — tutto il resto coincide. Nuovo `npm run verify-catalog`
  (`scripts/verify-catalog.mjs`) per riverificare a un clic a ogni alzata di catalogo, per escludere incidenti di trascrizione della stessa specie.
- **Download dei modelli che non connettono/lenti** (problema concomitante, misurato nello stesso scenario): il collegamento diretto al mirror è intermittente nelle reti cinesi (alternanza di timeout TCP e finestre raggiungibili), e il fetch di Node non legge le variabili d'ambiente del proxy —
  il downloader ora supporta i proxy (nuova configurazione a tre stati `embedding.proxy`: per default rilevamento automatico delle
  `HTTPS_PROXY`/`ALL_PROXY` ecc. rispettando `NO_PROXY`, `none` forza la connessione diretta,
  oppure URL del proxy esplicito; passa per il `ProxyAgent` di undici, stessa semantica di curl/npm).
- **Resilienza del downloader**: riprova automatica al fallimento di un file (2 volte per default, a 1 s/3 s d'intervallo) e a ogni riprova aggiunta di
  `?dshmem-retry=N` per cambiare la chiave di cache — nella finestra di un oggetto di cache corrotto lato CDN del mirror, la stessa URL riceve in modo deterministico la stessa risposta cattiva; solo il cambio di chiave riesce a prendere un altro oggetto e a auto-guarire. Verifica non corrispondente → riscaricamento da zero (il punto di ripresa inquinato cancellato),
  conteggio di file non corrispondente/errore di rete → conservazione della ripresa dopo interruzione; l'annullamento non è toccato; la semantica della ripresa tra processi resta invariata.

### Riferimento e documentazione

- **DSH-MemBench v3** (`bench/`): pista dialogo (15 scene × 6 tipi × 3 passaggi
  = 270 domande/gruppo) + pista workflow (4 scene in sandbox di strumenti reale) come doppia ferroia di confronto A/B — **gruppo A (memoria
  accesa) vs gruppo B (memoria spenta)**, stessa biblioteca di scene, ingressi identici alla parola, pilotaggio automatico senza testa (profilo dsh headless + plugin runner locale), valutazione a due livelli programma/LLM; indicatori di integrità al completo: rilevazione di contaminazione tra scene (scansione dei marcatori di scena), audit degli sconfinamenti degli strumenti, quota di cache a regime (escluse le prime richieste di sessione), prova speciale sull'aggiornamento della conoscenza (dopo il cambio di parola, nominare il vecchio = 0) e prova speciale sul rifiuto di risposta (inventare = 0). `run.mjs` fa girare A/B con un comando,
  `report.mjs` produce il rapporto strutturato, `compare.mjs` serve ai confronti di regressione prima/dopo la modifica del plugin;
  la base ufficiale (risultati integrali delle due ferrovie × A/B × 3 passaggi) archiviata in `bench/baseline/`. Il vecchio scenario manuale agentic (v2) è stato rimosso.
- **La sezione «confronto misurato» del README si riempie dei numeri veri** (cinese/inglese sincronizzati): pista dialogo, accuratezza totale gruppo A 92,6%
  (250/270) vs gruppo B 17,8% (48/270), zero invenzioni da entrambe le parti; scomposizione del doppio canale di richiamo (75,1% di incontri da iniezione passiva + 84 domande in query attiva, 60 domande salvate dagli strumenti di memoria); pista workflow, il gruppo B paga +49% di passi / +61% di chiamate di strumento / +43% di token d'ingresso, scena di login +88% d'ingresso (le credenziali vivono solo nella memoria, il gruppo B ridomanda l'utente a ogni turno). Le tabelle di misurazione passano ai grafici SVG (`bench-dialog` /
  `bench-workflow`), tutte le illustrazioni SVG del README prendono la nuova veste oro/blu profondo (`flow` /
  `storage` sincronizzati).

## [0.8.0] — 2026-08-18

Pacchetto di ottimizzazione della memoria (decisioni registrate ADR-0001/0002/0003):
iniezione del richiamo lato messaggi + rifacimento dei grilletti di distillazione (soglia progressiva + isolamento di sessione su tutta la catena) + budget d'uscita per strato + correzione della via di scrittura FTS.

### Aggiunti

- **Iniezione del richiamo lato messaggi** (ADR-0001): le memorie rilevanti vengono iniettate nel flusso come un messaggio sintetico firmato dal plugin (`form: 'recall'`,
  la UI dell'host mostra la riga di firma **«context injection · memory»**) piazzato prima di ogni nuovo messaggio utente
  — l'utente vede con i propri occhi che «la memoria ha agito». Tag `<relevant-memories>` + frase di accompagnamento «a mero titolo indicativo»; i passi di strumenti puri / decisioni reject vengono trasmessi tali e quali; innesco solo nei passi con un nuovo messaggio utente
  (inizio di turno + interruzioni di guida). La guida degli strumenti precisa che negli ambienti ristretti (come la modalità code-runtime che ammette solo l'ingresso di esecuzione del codice) gli strumenti di memoria vanno usati indirettamente tramite il meccanismo di chiamata di quell'ambiente. Il prompt di sistema conserva solo il contenuto stabile
  (profilo/navigazione/guida di filtraggio), lo slot dinamico `memory:recall` viene rimosso;
- **Budget del richiamo**: `recall.maxCharsPerMemory` (default 500) / `recall.maxTotalRecallChars`
  (default 2000) — oltre, troncatura con l'accompagnamento `… (troncato; usa memory_search o conversation_search
  per i dettagli)` che incanala il modello verso gli strumenti per il testo integrale (la troncatura è un imbuto: la via degli strumenti restituisce il record completo); oltre il totale cade la coda a basso punteggio; troncatura sicura a livello di code point;
- **Timeout del richiamo**: `recall.timeoutMs` (default 5000, 0 = illimitato) come budget totale, oltre si salta l'iniezione del turno;
  morsetto interno del fetch dell'embedding remoto a 3000 ms (per lasciare tempo alla discesa FTS), l'inferenza locale non si morsetta;
- **Soglia progressiva della distillazione** (ADR-0003): la soglia effettiva sale 1→2→4→a regime (la semantica di `extract.minMessages`
  diventa soglia a regime, default 1→6) — i nuovi utenti ottengono una memoria già al primo turno, a regime l'accumulo in lotti risparmia chiamate; lo stato della salita si persiste con pending.json;
- **Rete d'inattività**: `extract.idleSeconds` (default 300, 0 = disattivato) — dopo il silenzio sufficiente della sessione, le fette non distillate
  cadono nel sacco automaticamente; le sessioni in modalità spenta sospese vengono saltate;
- **Sincronizzazione delle fette al cambio di modalità**: cambio tra modalità non spente → le fette di quella sessione vengono distillate subito secondo la modalità di cattura; cambio su spenta → sospensione; ritorno dalla spenta → le fette sospese cadono secondo la modalità di cattura (le fette non si mescano mai tra modalità);
- **Budget d'uscita per strato**: estrazione 16k / deduplica 8k / L2 32k / L3 16k; ×4 automatico ai livelli di ragionamento high/max
  (guardia contro l'incidente storico del reasoning che divorava il budget); `llm.maxTokens` default 256k→65536, retrocesso a valvola generale di soccorso.

### Corretti

- **Contaminazione tra sessioni** (difetto esistente): i messaggi di contesto dell'estrazione erano un array in memoria globale (il contenuto della sessione A serviva da sfondo alla sessione B e si perdeva al riavvio); ora vengono interrogati al volo in L0 per sessione (via l'indice di sessione) escludendo la fetta stessa; i grilletti della distillazione contano le fette per sessione ed estraggono solo le fette delle sessioni a soglia raggiunta — tutti e cinque i canali (soglia/idle/contesto/cambio di modalità/residui di ritento) sono isolati per sessione (ADR-0003);
- **Ingrossamento O(N²) della via di scrittura FTS**: la cancellazione difensiva del FTS passa a una preverifica d'esistenza con interrogazione puntuale sulla tabella principale (record_id è UNINDEXED nella tabella FTS, un DELETE per id = scansione integrale — i percorsi di nuova scrittura come ricostruzione/re-embedding/import pagavano per ogni record una scansione integrale). Comportamento esterno identico punto per punto (ADR-0002; lo schema di mapping per rowid è stato respinto per il rischio di cancellazioni errate silenziose da mappature stantie).

### Modifiche

- La guida degli strumenti passa al filtraggio a tre condizioni (`tools acceso && profilo ∥ navigazione ∥ incontro di richiamo nel turno`): gli utenti a base vuota e quelli con gli strumenti spenti non pagano più questi token fissi a ogni passo;
- pending.json riceve un campo `sessionId` nelle sue voci persistenti (il vecchio formato cade automaticamente nel gruppo di sessione legacy),
  e persiste al tempo stesso lo stato della soglia progressiva;
- il recupero d'avvio mette in coda raggruppato per fette di sessione;
- **la tokenizzazione della ricerca cinese passa dai bigrammi CJK alla tokenizzazione a parole jieba** (allineata all'implementazione ufficiale di MemoryCore):
  `@node-rs/jieba` (binario napi Rust precompilato) produce l'unione ordinata e deduplicata di **token jieba ∪ parole latine ∪ bigrammi CJK** — i token danno a BM25 gli incontri di parola intera esatti ad alto idf, i bigrammi garantiscono la linea di fondo del richiamo dei sotto-parole; fallimento di caricamento → ripiego automatico sui soli bigrammi (in modalità intra-processo, deriva impossibile); timbro di versione del tokenizzatore FTS (`fts_tokenizer`: `jieba-v1` /
  `bigram-v1`): se il timbro non corrisponde, drop + ricostruzione + reimmissione automatiche; le basi vecchie senza timbro contano come `bigram-v1` al primo avvio, migrazione automatica.

## [0.7.1] — 2026-08-17

Lotto di correzioni della revisione integrale (2026-08-17): aggiustamenti documentali + prestazioni dell'archivio + indurimento della catena di fornitura dell'installazione runtime.

### Prestazioni

- **`PRAGMA synchronous=NORMAL`** (grado raccomandato ufficiale del WAL): la scrittura in lotti scende da un fsync per transazione a uno per
  checkpoint, re-embedding e import accelerano; l'unico prezzo: al blackout si perdono le ultime transazioni commesse (si perde, non si corrompe);
- **Scritture vettoriali del reindex transazionalizzate**: le scritture grezze riga per riga del re-embedding L1/L0 diventano lotti a blocchi (16/32 righe) in un'unica transazione
  (fallimento del lotto intero → ripiego unitario, le righe buone non si perdono), insieme al punto precedente accorcia molto i tempi di re-embedding delle basi grandi.

### Sicurezza

- **Il runtime dell'embedding locale passa a `npm ci` + lockfile in dotazione**: `resources/runtime-package-lock.json`
  (copiato in dist/ alla costruzione) congela lato autore l'intero albero delle dipendenze transitive di `@huggingface/transformers` —
  il vecchio `npm install pkg@versione esatta` bloccava solo le dipendenze dirette, le transitive galleggiavano al ritmo del semver, e le pubblicazioni/avvelenamenti successivi del registry derivavano secondo l'ora d'installazione. Fallimento del ci (deriva del lock ecc.) → ripiego automatico sull'install (prima la disponibilità).

### Documentazione

- Il CHANGELOG riceve le voci [0.5.3] / [0.5.4] mancanti (npm aveva già pubblicato);
- la tabella di configurazione dei README cinese/inglese riceve 5 righe: `recall.includePersona` / `recall.includeSceneNav` /
  `embedding.maxInputChars` / `embedding.timeoutMs` / `llm.timeoutMs`;
- correzione del refuso cinese «间族» (corretto «跨族»); i vecchi percorsi di disposizione dell'archivio nel documento d'esperienza sviluppatore
  (`l0/ l1/` → `conversations/ records/`); il nome del file persona di CONTEXT.md passa alla forma per famiglia.

## [0.7.0] — 2026-08-17

Modelli d'embedding locali e commutazione a caldo (la funzione più grande), doppio tema Light/Dark, lotto di correzioni della revisione integrale del codice (issue #1-#24).

### Aggiunti

- **Modelli d'embedding locali** (#20-#24): **sorgente d'embedding a tre stati** (spenta / remota / locale) commutabile a runtime,
  stato persistito in `embedding-source.json`, l'effetto = tetto di deployment E scelta runtime;
  - **Catalogo di modelli integrato** (whitelist, revisione bloccata + sha256 per file): BGE small cinese
    (512 dimensioni / ~25 MB), EmbeddingGemma 300M (768 dimensioni / ~330 MB, stesso modello dell'upstream MemoryCore),
    BGE-M3 (1024 dimensioni / ~590 MB, contesto 8192); mirror di default `hf-mirror.com` configurabile
    (`embedding.mirror`), ripresa `.part` dopo interruzione + verifica sha256 in flusso dopo il download;
  - **Runtime d'inferenza a richiesta** (transformers.js 4.2.0): installato via npm nella directory dati `runtime/` solo al primo passaggio in locale
    (ancorato dal proprio package.json, fuori dall'albero di dipendenze del plugin); i modelli si depositano in `models/<id>/`,
    cancellabili dalla pagina impostazioni (il modello in uso è protetto);
  - **Catena di commutazione a caldo**: preriscaldamento e caricamento → cambio di servizio + swapProvider (cambio di dimensione = DROP della tabella vettoriale) →
    sincronizzazione immediata del meta → re-embedding integrale in background (progresso a conteggi L1/L0, annullabile) → lo stato si persiste solo dopo il successo;
    al fallimento resta la vecchia sorgente (al riavvio riparte la sorgente d'origine); annullamento/fallimenti parziali del re-embedding rimborsati dal backfill periodico di 30 minuti;
  - Nuove configurazioni: `embedding.allowLocalModels` (il deployment vieta la modalità locale), `embedding.mirror`;
- **Adattamento a doppio tema Light/Dark della pagina impostazioni e della barra di input** (#15-#19): due piani di gettoni (alias dsh dell'host in catena +
  sovrascrittura dell'intero insieme di gettoni semantici propri), il cambio di tema scambia i valori delle variabili CSS sul posto senza re-render React;
- **Rifacimento dell'UI del selettore di modalità**: modalità tradotte (日常 / 工作 / 智能 / 关闭), pannello flottante rifatto,
  riempimento del cursore (chiaro a sinistra, scuro a destra, sempre visibile durante il trascinamento), bolla di trascinamento (doppia punta a triangolo rovesciato), **strato di particelle**
  (campo di particelle a puntini, intensità del campo per modalità: 日常 sparso / 工作 onde d'acqua / 智能 a pieno campo, nel tema chiaro mescolato con multiply);
  il sistema di design si archivia nella directory `design/` (quattro specifiche: global / pill / slider / settings).

### Corretti (revisione integrale #1-#14 + seconda revisione indipendente F1-F4 + cuciture di assemblaggio)

- store: il fallimento di scrittura FTS fa rollback dell'intera transazione (fine ai buchi d'indice silenziosi, #2); il rimpiazzo dell'embedding passa a incrementale +
  vettori nulli segnati skipped (sistema il ciclo infinito di re-embedding integrale ogni 30 minuti, #3); fallimento del lotto → ripiego unitario +
  invalidazione della cache di istruzioni al DROP + tetto del set di skip (F2-F4);
- ciclo di vita: ordine di spegnimento — prima fermare i compiti/sciacare la catena L0, poi chiudere la base (#5); rilascio delle referenze in tre punti: buffer di cattura/snapshot di ricostruzione/pending
  (#4);
- recall: la query prende solo gli ultimi 8 messaggi + tetto di 2000 caratteri, query vuota → cache svuotata (#6);
- settings: riuso dello scope in-processo al riavvio della fibra, gli interruttori non vengono più ignorati in silenzio (#8); cache dello scope vitalizia per istanza di servizio,
  rimontaggio automatico al riavvio del servizio (F1);
- rpc: rimontaggio automatico delle registrazioni RPC dopo il via o la sostituzione del servizio connection (#9);
- client: stati d'errore dei tre pannelli + badge di degrado della panoramica (#7); numeri di serie delle richieste d'elenco che scartano le risposte sorpassate (#10);
- tools: i tre strumenti in modalità spenta rispondono uniformemente con l'avviso; paginazione delle ricerche con marcatore di taglio esplicito (#11);
- log: lettura a blocchi a ritroso di log-tail + ripiego di taglio al fallimento ripetuto della rotazione (#12);
- config: confini numerici + taglio della persistenza del pending + azzeramento dell'interruttore d'estensione (#13);
- **cucitura di assemblaggio delle stats**: il handler `/rpc` non trasmetteva `embedManager` nelle sue deps — la UI di gestione degli embedding mostrava perennemente
  «archivio degradato» (la mancanza del campo opzionale non era intercettabile né da TS né dal smoke; sistemato).

### Prestazioni

- Riuso delle istruzioni precompilate del percorso caldo di ricerca + taglio degli IN + transazioni in lotti L1 (#14).

### Documentazione

- Grande revisione del README: nuova sezione «ricerca semantica (sorgente d'embedding)» (tabella a tre stati / tabella del catalogo di modelli / download e commutazione a caldo);
  Hero / memoria stratificata / modalità di sessione passano alle immagini generate image2; nuova anteprima d'interfaccia (vere registrazioni dei due temi chiaro e scuro);
  storage.svg riceve i tre stati della sorgente d'embedding e le nuove forme di file; la tabella di configurazione riceve due righe;
- il contesto sviluppatore riceve un glossario «embedding e ricerca»; archiviazione del rapporto di revisione integrale del codice del 2026-08-17.

## [0.6.1] — 2026-08-17

- Default di `llm.maxTokens` 20000 → **256000**: con v4-flash, la modalità di ragionamento high di default poteva divorare qualunque budget d'uscita lasciando il corpo a 0 caratteri; budget concesso in grande, e insieme ragionamento spento per default.

## [0.6.0] — 2026-08-17

Livelli di ragionamento della distillazione + rifacimento dell'UI del selettore di memoria + rinforzi d'affidabilità.

### Aggiunti

- **Livelli di ragionamento della distillazione**: configurazione `llm.reasoningEffort` (`off`/`high`/`max`/stringa vuota, default `off`)
  + commutazione runtime nella scheda Panoramica della pagina impostazioni (scegliere «segui la configurazione» ricade sul default del deployment, persistito via servizio settings);
  il ragionamento di default dei modelli di reasoning poteva divorare il budget d'uscita lasciando il corpo a 0 caratteri, dunque per la distillazione il ragionamento è spento per default;
- **Persistenza del buffer non distillato**: i messaggi falliti da ritentare e quelli in accumulo prima della soglia vengono stoccati per modalità in secchi di `pending.json`
  (scritti atomicamente dopo ogni tentativo di distillazione), nulla si perde al riavvio, recupero automatico 20 secondi dopo l'avvio;
- **Ricostruzione integrale della memoria** (pagina impostazioni → Memoria → Panoramica → Ricostruisci memoria): reimport di tutti gli strati derivati prendendo L0 come fonte di verità,
  i vecchi prodotti archiviati d'un blocco invece che cancellati, suddivisione in blocchi a bassa priorità (cede il passo alla conversazione normale), con pop-up di conferma/progresso/annullamento;
  ri-distillazione unificata in modalità intelligente (auto), suddivisione per sessioni (sessioni ordinate per l'ora del primo messaggio), durante la ricostruzione le nuove conversazioni passano per i turni normali.

### Modifiche

- Rifacimento dell'UI del selettore di memoria: flusso conic blu freddo sui bordi della modalità auto, livello flottante di vetro alla Apple (struttura a tre piani, riparazione del
  fallimento di campionamento del backdrop-filter su Chromium), cursore che segue il trascinamento 1:1 + calamita per proiezione della spinta al rilascio;
  colori di linee/fermate/etichette tematizzati.

## [0.5.4] — 2026-08-16

Industrializzazione del rilascio: parte npm Trusted Publishing (OIDC di GitHub Actions) — il push di un tag `v*` pubblica automaticamente,
senza token / senza 2FA; il controllo di coerenza tra tag e versione del package.json agisce solo all'attivazione via tag (una prova manuale via `workflow_dispatch`
può percorrere la catena di autenticazione della pubblicazione, per verificare l'OIDC). Nessun cambiamento visibile all'utente.

## [0.5.3] — 2026-08-16

### Corretti

- Il contatore della soglia viene persistito subito dopo l'estrazione L1 (un'uscita a metà processo non arretra, al riavvio nessuna doppia estrazione);
- il budget d'uscita della distillazione passa uniformemente per `llm.maxTokens` (default 20000, perché il reasoning dei modelli di ragionamento non divori il budget lasciando il corpo a 0 caratteri).

### Aggiunti

- L'iniezione di profilo/navigazione di scene della modalità auto si struttura: raggruppamento per categorie + tag di dominio `<domain family>`, al posto della concatenazione brutale delle due famiglie.

### Documentazione

- Il README mette l'installazione via npm al primo posto (GitHub / percorso locale come alternative), `files` include la risorsa hero.

## [0.5.2] — 2026-08-16

Correzione del grave bug su Linux/macOS per cui «ogni chiamata di strumento restituiva
`Cannot read properties of undefined (reading 'prepare')`»
 (incidente reale su WSL: la chiamata allo strumento bash crollava subito, fallimento a livello di turno).

### Causa radice

Il plugin aveva dichiarato i pacchetti di runtime dell'host (`@deepseek-ai/cordis`, `dsh-tools` ecc.) come semplici
`dependencies` — l'installatore ne installava **copie private** per il plugin, formando col grafo di moduli dell'host un **doppio
`dsh-tools` in due istanze**. Il servizio `ToolRuntime` veniva istanziato dalla copia del plugin, mentre
`dsh-agent-loop` leggeva lo scheduler con il `Symbol(@deepseek-ai/dsh-tools.scheduler)` della copia dell'host — le identità dei Symbol non coincidevano (stesso nome, istanze diverse), la lettura andava nel vuoto → ogni chiamata di strumento
sollevava un TypeError in `scheduler.prepare`. Su Windows i due grafi per fortuna si risolvevano nello stesso ordine e funzionava; su Linux (hoisting di pnpm + layout a symlink) accadeva sistematicamente.

### Corretti

- **I pacchetti di runtime dell'host passano a `peerDependencies`** (allineati alla convenzione dei plugin ufficiali, come
  `dsh-bash-local`: cordis / dsh-agent / dsh-home-paths / dsh-llm /
  dsh-session / dsh-settings / dsh-system-prompt / dsh-tools, intervallo `^`),
  l'installazione non produce più copie private, plugin e host condividono lo stesso grafo di moduli;
- le versioni necessarie allo sviluppo locale migrano in `devDependencies` (costruzione/smoke non toccate);
- le dipendenze di pura libreria restano in `dependencies` (schemastery, sqlite-vec).

## [0.5.1] — 2026-08-16

Correzione del bug di registrazione lato client introdotto dal cambio di nome del 0.5.0 (incidente reale: dopo l'installazione da GitHub, il lato browser segnalava
`client-modules: bundle ... loaded without registering "dsh-prime-memory"`, e tutti i controlli di memoria della pagina impostazioni e della barra di input erano inutilizzabili).

### Corretti

- **L'id di registrazione del bundle client segue il nuovo nome del pacchetto**: il
  `window.__ModuleLoader__.load({ id: ... })` di `client/client.js` passa dal vecchio nome `dsh-memory-plugin` a
  `dsh-prime-memory` — al cambio di nome del 0.5.0 erano stati cambiati solo il lato host e la dichiarazione del bundle, dimenticando la metà browser,
  così il nome della voce del loader e il nome di registrazione divergevano e il caricamento del bundle falliva all'istante. Il nome del plugin lato host
  `dsh-memory-plugin`, la chiave di configurazione `dsh-memory` e gli endpoint RPC `dsh-memory/*` restano invariati
  (cambiarli spezzerebbe le configurazioni esistenti e i canali di dati).

### Documentazione

- Abbellimento visivo del README (beautify-github-readme): hero nativo del progetto (`assets/readme/hero.svg`,
  un SVG della pipeline stratificata L0→L3, la larghezza decrescente mostra la raffinazione dei dati); riordino in «valore → meccanismo → primo passo → dettagli»,
  fusione delle sezioni in doppione, incorporazione come `<p align="center"><img width="100%">`.

## [0.5.0] — 2026-08-16

Rifacimento per la pubblicazione pubblica: il pacchetto viene rinominato **`dsh-prime-memory`** (il vecchio nome `dsh-memory-plugin` era già occupato su npm da
un plugin della stessa specie), e l'impacchettamento conforme alla specifica ufficiale dei pacchetti composti (bundle) è completato.

### Modifiche

- **Dichiarazione di `dsh.bundle`** (nuovo `cordis.patch.yml` alla radice): dopo l'installazione in un comando `dsh plugin --profile <name> add`,
  **la riga del plugin si monta automaticamente**, più bisogno di ritoccare a mano il patch.yml del profilo;
  `files` include il file;
- **dismacchinizzazione delle dipendenze**: le `@deepseek-ai/*` passano dai percorsi assoluti `file:` (puntanti al profilo locale) alle versioni esatte di npm
  (`0.1.0-rc.6` di un lato, cordis `4.0.1`, schemastery `3.18.1`) — su qualunque macchina risolvono `npm install` / `dsh plugin add`
  (rc.6 è appeso al dist-tag `next`, non usare intervalli `^`);
- igiene del repository: LICENSE MIT, `.gitignore` (ignora `node_modules/`, `dist-smoke/`, `.zcode/`),
  riscrittura della sezione installazione del README (installazione in un comando + disinstallazione + consiglio di sicurezza + sviluppo dai sorgenti), correzione dei titoli doppi.

## [0.4.2] — 2026-08-16

Diagnosi rafforzata delle uscite vuote del LLM di distillazione (incidente reale: due turni di fila di deduplica/estrazione L1 con 0 caratteri d'uscita, e nei log solo una
`extract dei primi 400 caratteri dell'uscita grezza:` vuota, nessun indizio sul posto).

### Valore della ricerca della causa radice

`callLLM` registrava all'origine solo i conteggi di caratteri d'ingresso/uscita; quando «il flusso finiva regolarmente senza emettere nemmeno una parola», non si poteva distinguere
«il modello ha prodotto solo ragionamento (text vuoto)» da «il server ha risposto vuoto». I due fallimenti osservati
(35~38 s, 0 caratteri, 13.000 caratteri d'ingresso) erano lontani dai budget di timeout (120 s) e maxTokens (4096).

### Modifiche

- `callLLM` raccoglie **statistiche a blocchi** nel flusso: motivo di fine (stop/max-tokens/tool-calls/error/aborted),
  conteggi di token dell'usage (outputTokens/reasoningTokens), numero e caratteri dei blocchi text-delta,
  caratteri dei reasoning-delta (con estratto di 300 caratteri), distribuzione dei tipi di block-end;
- **log di diagnosi warn quando l'uscita è vuota**, portando tutte queste statistiche — alla prossima uscita vuota si potrà decidere subito se il reasoning ha divorato il budget, il motivo di fine, o se il server ha risposto vuoto;
- il log ordinario di `chiamata LLM` aggiunge il motivo di fine (zero sovraccosto quando l'uscita non è vuota).

## [0.4.1] — 2026-08-16

Correzione del difetto di cattura L0 che perdeva il messaggio user dei turni a risposte lunghe (incidente reale: in una conversazione di 4 turni, il turno 3 perdeva il messaggio user e il turno 4 perdeva user + il primo messaggio assistant).

### Causa radice

La session.jsonl esportata è un registro **dopo compressione**; nel flusso in tempo reale di `session/event`, ogni risposta in streaming porta in più numerosi eventi
text-delta/reasoning chunk. I turni a risposte lunghe (testo lungo + ragionamento + ricerca in rete) superavano col conteggio dei loro eventi in tempo reale il `MAX_BUFFER=500` del buffer di cattura, e il taglio dalla testa (`splice(0, len-500)`) portava via il `turn/start` **più antico** del turno e il messaggio user — `findTurnStart` non trovava più l'inizio del turno e la cattura degenerava in «tutto il buffer come turno corrente», restando solo i messaggi di coda del turno. I turni a risposte corte non raggiungevano il limite, perciò i turni 1 e 2 erano completi.

### Corretti

- **Il buffer accetta solo 4 tipi di eventi** (user/message, assistant/message, turn/start, turn/end),
  i chunk in streaming vengono scartati all'ingresso (`isCaptureRelevant`) — il volume del buffer scende da centinaia/turno a unità/turno;
- **legge ferrea del taglio**: gli eventi di un turno in corso (dopo un turn/start non chiuso) non si tagliano mai, si taglia solo il prefisso completato che lo precede
  (`trimBuffer`, difensivo, quasi irraggiungibile);
- **scrittura L0 immediata**: al turn/end, scrittura subito via una catena seriale indipendente (`capture.ts`), senza passare per la coda di distillazione —
  prima il L0 poteva venire bloccato da una chiamata LLM lenta (26 s misurati); se dsh usciva nel mezzo della distillazione, il L0 in coda si perdeva; il runner non è più responsabile della scrittura del L0.

### Verifica

- Lo smoke riceve la sezione 12: whitelist dei 4 tipi di eventi, esclusione dei chunk, scenario di taglio a 600 eventi + turno in corso
  (turn/start + user non persi), limite di 500 senza turni in corso, nessun taglio sotto il limite.

## [0.4.0] — 2026-08-16

Modalità di memoria per sessione: controllo a quattro stati (auto/chat/work/spento) + isolamento scrittura-richiamo nella stessa modalità + archivio L2/L3 per famiglie.

### Aggiunti (UI)

- **Controllo di modalità nella barra di input** (`conversation.input.left`, a destra del selettore di modalità): il pill mostra la modalità corrente
  (`记忆·自动` ecc., colorata secondo la modalità), un clic fa salire sopra un **selettore scorrevole in stile macOS** —
  rotaia orizzontale + quattro punti di sosta (spento · chat · work · auto), la linea attraversa il centro della sfera,
  maniglia di trascinamento (con ombra), **calamita sul punto di sosta più vicino al rilascio** poi invio ottimista via RPC (rollback al fallimento + segnalazione rossa);
  la modalità corrente è indicata dall'evidenziazione dell'etichetta sottostante (nessun testo sopra); clic sull'etichetta di una sosta salta direttamente alla modalità, clic esterno/Esc chiude;
  al cambio di sessione il componente si rimonta automaticamente e recupera la modalità di quella sessione;
- il browser della pagina impostazioni conserva la **vista mista** delle due famiglie (concatenazione degli endpoint scene/profilo), e la «famiglia di prompt» della panoramica diventa «modalità predefinita».

### Aggiunti (semantica: scrittura e richiamo nella stessa modalità)

- **Quattro stati di modalità** (`MemoryMode = auto | chat | work | off`), indipendente per sessione, persistito per sessionId in `session-modes.json`
  (> 90 giorni / > 500 voci pulizia automatica, scritture serializzate):
  - `chat` / `work`: il prompt stretto distilla la propria famiglia → scrittura solo nella biblioteca della propria famiglia; il richiamo interroga solo le memorie della famiglia + profilo/navigazione di scene della famiglia;
  - `auto` (**default delle nuove sessioni**): estrazione in un solo passaggio con prompt a vocabolario fuso (tre classi personali + quattro classi di lavoro, tutte e 7 aperte),
    ogni memoria riceve la sua etichetta di famiglia per prefisso di tipo; il richiamo apre entrambe le famiglie (profilo/navigazione delle due famiglie concatenati);
  - `off`: questa sessione è totalmente invisibile al sistema di memoria — nessuna scrittura L0, nessuna distillazione, nessun richiamo, i tre strumenti del modello rispondono con l'avviso;
- la modalità di default delle nuove sessioni = configurazione `family` (l'unione si allarga a `auto|chat|work`, default `auto`, semantica retrocessa a
  «modalità predefinita»; le chat/work configurate esplicitamente dai vecchi deployment restano valide); il cambio a metà sessione vale dal turno successivo, le memorie già estratte restano nella famiglia d'origine;
- si somma all'interruttore globale: il globale è la valvola principale, le modalità di sessione si articolano al di sotto.

### Modifiche (isolamento dell'archivio per famiglie)

- **memory.db resta una base unica**: `l1_records`/`l1_fts` ricevono una colonna `family` (esistente riempito per prefisso di tipo,
  la tabella FTS si ricostruisce automaticamente); le tre strategie di ricerca (FTS/vettore/hybrid) supportano tutte il filtro per famiglia (via vettoriale: sovrarichiamo + filtro a valle);
- **L2/L3 spezzati in file per famiglia**: `scenes/chat|work/` (i vecchi `scenes/*.md` migrano automaticamente in chat),
  `persona-chat.md` / `persona-work.md` (il vecchio `persona.md` viene rinominato automaticamente), `state.json` sale alla v2
  con checkpoint per famiglia (il vecchio contenuto piatto cade nel secchio chat); contatori di soglia L2/L3, catene di contesto, varianti di prompt, tutti indipendenti;
- i candidati della deduplica vengono richiamati solo nella stessa famiglia (la deduplica non attraversa mai le famiglie); il buffer L1 da ritentare viene messo in secchi per modalità;
- gli strumenti del modello si filtrano secondo la modalità della sessione chiamante (`exec.agent.id === sessionId`);
  `memory_read_scene` cerca per nome nelle directory delle due famiglie, il parametro persona diventa `persona-chat.md|persona-work.md`.

### Aggiunti (RPC)

- `dsh-memory/session-mode-get {sessionId} → {mode, defaultMode}` e
  `dsh-memory/session-mode-set {sessionId, mode}` (validazione a whitelist dei quattro valori).

### Migrazione (tutto si esegue automaticamente in init)

1. `l1_records`: ALTER per aggiungere la colonna family + riempimento per prefisso di tipo; se manca la colonna in `l1_fts`, drop + ricostruzione + reimmissione;
2. `state.json`: v1 piatto → v2 per famiglie (vecchi dati in chat);
3. `scenes/*.md` → `scenes/chat/`; `persona.md` → `persona-chat.md`;
4. **sincronizzazione del deployment**: dal `cordis.patch.yml` del profilo web, cancellare la riga `family: chat` (altrimenti la modalità predefinita resterebbe chat).

### Verifica

- Lo smoke riceve la sezione 11: inferenza delle etichette di famiglia / persistenza dell'archivio delle modalità e modalità di default / filtro FTS per famiglia + isolamento dei candidati per famiglia +
  filtro degli elenchi per famiglia / migrazione e riempimento di una vera base vecchia (senza colonna family) + ricostruzione FTS / migrazione dei vecchi file di scene e profilo /
  state v1→v2 / prompt a vocabolario fuso con le 7 classi / endpoint RPC delle modalità (incluso il rifiuto dei valori illegittimi);
- `Config['~standard'].validate({})` passa con family=auto di default.

## [0.3.0] — 2026-08-16

Browser di memorie + interruttori della modalità memoria: la pagina «Memoria» delle impostazioni sale da una semplice tabella di conti testuali a un pannello di contenuti a più schede.

### Aggiunti (UI)

- **Browser di memorie multi-scheda** (Impostazioni → Memoria):
  - **Panoramica**: contatori di esecuzione + pannello degli interruttori della modalità memoria + rinfresco automatico ogni 5 secondi;
  - **Memoria**: elenco delle carte di memorie L1 — ricerca per parole chiave (BM25, stessa fonte del richiamo) + filtri per tipo/contesto +
    mostra della rilevanza + clic per svolgere il dettaglio (catena di marche temporali/versione/messaggi di origine); ordinamento decrescente per aggiornamento di default, caricamento paginato;
  - **Scene**: testo integrale dei blocchi di scena L2 (con META popolarità/riassunto);
  - **Profilo**: testo integrale del persona L3;
  - **Log**: scorrimento delle ultime 200 righe di memory.log.
- **Interruttori della modalità memoria** (interruttore generale + tre sotto-interruttori cattura/distillazione/richiamo, grigi quando il generale è spento):
  passano per il servizio settings ufficiale (namespace `dsh-memory`, effetto live, persistenza ufficiale),
  gli interruttori di pagina scrivono via RPC in loopback; semantica = configurazione statica (tetto di deployment) E interruttore runtime.

### Aggiunti (Host)

- Nuovi endpoint RPC (mantenendo il canale loopback `/rpc`): `dsh-memory/settings-get` / `settings-set` /
  `list-records` (paginazione di navigazione + doppia via per parole chiave + faccette di scene) / `scenes` / `persona` / `log-tail`;
- `L1Store.list()` (SQL in ordine decrescente di aggiornamento + filtri per tipo/contesto + paginazione) e `distinctScenes()`;
- filtraggio runtime in tre luoghi: l'ingresso degli eventi di cattura, il passo di distillazione del runner, la funzione di testo d'iniezione del richiamo;
- se il servizio settings è pronto dopo il plugin, rimontaggio automatico in aggiunta (ascolto di `internal/service`), in assenza tutto resta aperto con una nota.

### Verifica

- Lo smoke riceve: paginazione/filtri delle interfacce di navigazione, valori di default dello schema degli interruttori, distribuzione degli endpoint RPC end-to-end
  (asserzioni endpoint per endpoint su una fake connection, compresa la trasmissione degli interruttori e il rifiuto degli endpoint sconosciuti);
- avvio reale: riga di log `interruttori della modalità memoria pronti (namespace settings dsh-memory)` confermata, HTTP 200.

## [0.2.4] — 2026-08-16

Diagnosticabilità completata: i nodi chiave di tutta la pipeline entrano nei log; alla minima anomalia, il solo file `memory.log` basta a ricostruire il percorso d'esecuzione.

### Aggiunti

- **Statistiche delle chiamate LLM**: ogni chiamata di distillazione registra `provider/model, caratteri d'ingresso/uscita, durata`,
  e ogni fallimento registra la causa + la durata (prima un fallimento lasciava solo il messaggio nudo, senza contesto di rotta);
- **estratto dell'originale al fallimento del parse JSON**: fallimento d'analisi delle operazioni di estrazione L1 / deduplica L1 / scena L2, si registrano i primi 400 caratteri
  dell'uscita grezza del modello (l'informazione chiave per indagare sulle derive delle uscite del modello);
- **statistiche delle decisioni di deduplica**: log di una riga `estrazione di N voci → richiamo di M candidati → decisioni store/update/merge/skip=x/y/z/w`,
  senza voci di decisione si conta come skip;
- **durata delle fasi della pipeline**: inizio/fine della pipeline di distillazione (con il numero di novità del turno e la durata totale), scrittura L0, durata delle fasi L1/L2;
- **dettaglio della cattura L0**: la cattura a livello di turno passa da debug a info (con la distribuzione delle voci user/assistant);
- **incontri del richiamo**: al richiamo, numero di voci + estratto della query (debug → info);
- **informazioni d'avvio rafforzate**: la riga della directory dati porta il numero di versione del plugin; nuova riga di risoluzione della rotta del modello di distillazione
  (un errore di rotta affiora all'avvio, più nessuna attesa del primo fallimento d'estrazione);
- ragioni di salto di L2 (progresso della soglia), di non-innesco di L3 (progresso della soglia) nel log debug;
- tutti i fallimenti della pipeline warn con il primo quadro dello stack d'errore (`errDetail`).

## [0.2.3] — 2026-08-16

Correzioni di diagnosticabilità: dopo due turni di vera conversazione, L0 aveva dati ma L1 non produceva nulla, e l'host dsh senza log persistenti non permetteva di localizzare la causa.

### Aggiunti

- **Log su file**: il livello info e sopra viene specchiato in `memory.log` della directory dati (rotazione in `.1` oltre 2 MB),
  fallimento di scrittura ignorato in silenzio — l'host dsh manda i log del plugin solo alla console; ora i problemi della pipeline di distillazione si indagano a posteriori.
- **Ragioni di salto della cattura L0 nei log**: i messaggi user fermati dalla protezione d'avvio a freddo e i messaggi di origine non utente (`source.kind≠user`)
  ottengono ciascuna una voce info — per diagnosticare i buchi di cattura del tipo «un turno che lascia solo messaggi assistant».

### Corretti

- **L1 «successo ma produzione zero» e «fallimento» distinguibili**: quando l'estrazione riesce senza memorie estraibili,
  anche `state.lastExtractAt` avanza (prima restava a 0, indistinguibile da un'eccezione d'estrazione).
- **Perdita dal hot-reload del contesto di richiamo**: il disposer di `systemPrompt.context()` non era appeso al ciclo di vita del plugin,
  dopo l'hot reload restavano le vecchie registrazioni e le nuove istanze scontravano (`"memory:recall" is already registered`);
  ora, alla disinstallazione del plugin, tutti i `memory:recall` / `memory:profile` sugli agent si disregistrano attivamente.

## [0.2.2] — 2026-08-15

Lotto di correzioni della revisione del codice.

### Corretti (alta gravità)

- **Autodegrado del costruttore di MemoryDb (S1/P5)**: qualunque fallimento di apertura della base / creazione di directory / PRAGMA non solleva più, ma entra in
  modalità degradata (tutte le letture/scritture come no-op sicuri), e `init()` cortocircuita subito su un'istanza già degradata — **nessun difetto di archivio può più far crollare l'avvio dell'host dsh** (l'invariante storage-degrade vale di nuovo).

### Corretti (semantica di ricerca, allineata all'ufficiale)

- **Niente più filtro per soglia prima della fusione hybrid (P6)**: l'ibrido ufficiale fonde direttamente per RRF le liste complete di ciascuna via,
  `scoreThreshold` vale solo per le strategie a via singola keyword/embedding (documentato);
- **punteggi della fusione hybrid normalizzati a 0~1 (P6)**: doppio glory con rang 1 = 1.0, singola colonna ≤ 0.5, sistema la semantica spezzata per cui memory_search riportava al modello punteggi di 0.02~0.03;
- **coefficiente di sovrarichiamo allineato all'ufficiale (P1)**: il bacino di candidati è fisso = limit × 3 (stessa formula della via tool ufficiale),
  l'ulteriore ingrossamento del filtro per tipo è rimosso (il documento che diceva a torto ×5 viene corretto al passaggio — la descrizione del 0.2.0 era inesatta, il codice vero moltiplicava ×9).

### Corretti (robustezza)

- **Scrittura ritardata di embedding_meta (P7)**: il meta si persiste solo dopo un re-embedding interamente riuscito (o base vuota senza vettori storici); al fallimento si riinnesca al prossimo avvio — sistema la breccia «meta scritto troppo presto, la tabella vettoriale resta per sempre vuota e il bit di capacità segnala true»;
- **riempimento vettoriale periodico (P3)**: con la capacità vettoriale attiva, ogni 30 minuti (prima corsa 1 minuto dopo l'avvio) si confronta il numero di righe vettoriali e di righe di metadati, e le mancanze si re-embeddano automaticamente — i lotti d'embedding falliti non chiedono più aiuto manuale;
- **migrazione dei vecchi dati verificata sul serio (P8)**: il cambio di nome in `.imported` avviene solo se tutte le voci sono entrate con successo in base; fallimento di rename / import parziale registra davvero e ritenta al prossimo avvio (upsert idempotente);
- **decisioni di deduplica L1 su interrogazioni esatte (S3)**: `pipeline/l1.ts` recupera le voci con `getByIds()` sull'unione degli id candidati/bersaglio,
  invece di scansionare a ogni giro l'intera tabella con `all()`.

### Corretti (pannello di stato)

- Il numero di versione delle stats si legge da `package.json` (prima era fissato a 0.1.0); `message` riflette lo stato degradato;
  `pendingExtract` si allacchia al vero contatore da ritentare del runner (P4); la mostra della directory dati passa uniformemente per `resolveDataDir`.

### Pulizia (giudizi della revisione)

- `EmbedHelper` raccoglie la logica di degrado/avviso dell'embedding duplicata tra L0/L1; `EmbeddingProviderInfo` si esporta uniformemente da
  `embedding.ts`; il titolo della navigazione delle scene richiama uniformemente il `NAV_HEADER` di `persona.ts`;
- codice morto rimosso: `Bm25Index.add`/bandierina sporca/campo `snippet`, `makeSnippet`, `readTodayCount`,
  gli export non consumati del recall, il parametro onProgress inutilizzato di `reindex` (il valore di ritorno diventa `{written, failed}` per giudicare il momento del meta);
- la semantica di `[DELETED]` si allinea documentalmente (delete lato LLM → cancellazione del file lato ingegneria; l'elenco tollera i marcatori ereditati).

## [0.2.1] — 2026-08-15

### Aggiunti (controllo del budget di token d'ingresso)

Contesto del modello di distillazione di 1M di token, usato al quotidiano con un budget di ~700k (`llm.maxInputChars`, default 700_000 caratteri,
convertito con prudenza a 1 carattere cinese ≈ 1 token):

- **Estrazione L1 a blocchi**: se i messaggi da estrarre superano il budget, taglio automatico a blocchi ed estrazione a catena in più passaggi (i nomi di contesto si agganciano da blocco a blocco, `chunkByCharBudget`),
  nessun messaggio si perde — copre entrambi i percorsi dei turni d'agente super-lunghi e dell'ammasso dei ritenti d'estrazione (nel caso peggio ~840k caratteri);
- **troncatura di soccorso di callLLM**: se il prompt utente di una chiamata di distillazione supera il budget, taglio con annotazione (ultima rete per L2/L3 e scenari anomali);
- i messaggi singoli restano tagliati lato cattura a `capture.maxMessageChars` (4000 caratteri), e gli input L2/L3 sono naturalmente limitati dalla dimensione dei file di scena.

### Configurazione

- Il modello di distillazione è fissato esplicitamente a `deepseek-official / deepseek-v4-flash` (`cordis.patch.yml`),
  non segue i cambi del modello di default di dsh.

## [0.2.0] — 2026-08-15

Rifacimento degli strati di archivio e ricerca secondo l'architettura del backend sqlite ufficiale di [MemoryCore](https://github.com/TencentDB-Agent-Memory) (TencentDB Agent Memory):
**doppia scrittura JSONL come fonte di verità + SQLite come motore principale di ricerca + ricerca mista a tre strategie**.
Motivazione: nella vecchia implementazione, ogni interrogazione di ricerca L0 rileggeva quasi 30 giorni di file e costruiva un indice BM25 in memoria al volo, e L1 si caricava integralmente in memoria riscrivendo tutto il file a ogni deduplica — superata una certa massa di dati, prestazioni e tasso di richiamo crollavano entrambi.

### Modifiche (architettura d'archivio)

- **Nuova base di ricerca `memory.db`** (`src/store/sqlite.ts`, modulo integrato `node:sqlite` + WAL + FTS5 +
  tabella vettoriale coseno vec0 di `sqlite-vec`), la combinazione PRAGMA è ripresa dall'ufficiale (busy_timeout/WAL/cache_size/mmap/wal_autocheckpoint).
- **Semantica di doppia scrittura (come l'ufficiale)**: i file JSONL in append vengono retrocessi a fonte di verità di backup/ripristino, **in sola aggiunta, mai modificati**;
  tutta la ricerca passa per SQLite — L0 non scansiona più i file per costruire l'indice, L1 non si carica più in blocco né si riscrive più integralmente.
- **Disposizione dei dati allineata all'ufficiale**: L0 `l0/*.jsonl` → `conversations/YYYY-MM-DD.jsonl`;
  L1 `l1/records.jsonl` (riscrittura integrale monofiles) → `records/YYYY-MM-DD.jsonl` (append per giorno). La vecchia disposizione viene importata automaticamente nella base di ricerca all'avvio del plugin e rinominata `.imported` (`l0/` → `l0.imported/`,
  `l1/records.jsonl` → `l1/records.jsonl.imported`), senza migrazione manuale.
- **Percorso di scrittura deduplica/fusione riscritto**: l'applicazione delle decisioni di `pipeline/l1.ts` passa dalla riscrittura integrale `all() + replace(next)` alla semantica ufficiale — il risultato della fusione viene **appeso come nuovo record** (versione +1), e il bersaglio sostituito si toglie solo dalla base di ricerca con `deleteBatch`.
- I campi del record L1 si allineano all'ufficiale: nuovi `version`, `source_message_ids`, `metadata`
  (version/metadata scritti nella base di ricerca; source_message_ids vive solo nella fonte di verità JSONL).

### Modifiche (ricerca)

- **Ricerca a tre strategie** (`recall.strategy`, default `hybrid`):
  - `keyword`: ricerca a testo integrale FTS5 BM25 (`bm25()` rank → punteggio 0~1, formula ripresa dall'ufficiale);
  - `embedding`: KNN coseno vec0 di sqlite-vec (score = 1 − distanza coseno), capacità opzionale;
  - `hybrid`: le due vie in parallelo + **fusione RRF (k=60)**, stessa ricetta della ricerca mista ufficiale.
- **Parametri di ricerca ufficiali trapiantati**: fattore di sovrarichiamo (bacino di candidati = limit × 3), tampone di compensazione dei vettori nulli del KNN vec
  (+10), soglia di punteggio del richiamo `recall.scoreThreshold` (default 0.3, con l'eccezione da piccolo corpus del FTS —
  se il numero di risultati non supera maxResults, si conservano gli incontri a basso punteggio), filtro a valle per tipo (la via degli strumenti non prende la soglia).
- **Il richiamo dei candidati della deduplica sale ai 3 livelli ufficiali**: base vuota → saltare; vettore prima → FTS come rete (prima: BM25 in memoria, un solo livello).
- Costruzione della query FTS: token tra virgolette legati con OR + filtro delle parole vuote cinesi (piccola tabella ufficiale); tokenizzazione tramite i
  bigrammi CJK + tokenizzatore di parole inglesi del progetto (lo stesso tokenizzatore in lettura e scrittura garantisce l'allineamento), **senza dipendenza nativa jieba**.
- **Il formato delle righe di richiamo** si eleva allo stile ufficiale: `- [type|scene] content`.

### Aggiunti (embedding, capacità opzionale, spenta per default)

- Gruppo di configurazione `embedding.*`: qualunque servizio `/embeddings` compatibile OpenAI (`baseUrl/apiKey/model/dimensions`
  ecc.; il `ctx.llm` di DSH non ha endpoint embeddings, da portare da sé). Normalizzazione L2 del client vettoriale (come l'ufficiale).
- `embedding_meta` persiste provider/modello/dimensione; al cambiamento di configurazione, drop automatico della tabella vettoriale e **re-embedding integrale in background**
  (`reindex()`, senza bloccare l'avvio).
- Embedding spento equivale alla modalità `provider="none"` ufficiale in FTS puro — **per default, zero dipendenze esterne per girare**.

### Catena di degrado (degrade-don't-crash da capo a coda)

- Caricamento di sqlite-vec fallito → modalità FTS puro (bit di capacità degradato, un solo warn);
- creazione di FTS5 fallita → `ftsSearch=false`; inizializzazione dello schema fallita → base di ricerca degradata → funzioni di memoria disattivate, ma
  **l'host dsh si avvia comunque** (la catena di degrado storageOk si conserva);
- chiamata d'embedding singola fallita → quella ricerca degrada a FTS + un solo avviso, il lato scrittura salta il vettore (recuperabile via reindex);
- alla disinstallazione del plugin la connessione DB si chiude (WAL su disco), registrata in `ctx.effect`.

### Dipendenze

- Nuova dipendenza runtime `sqlite-vec@0.1.7-alpha.2` (stessa versione di MemoryCore; estensione nativa precompilata,
  l'unica dipendenza nativa).
- `node:sqlite` è un modulo integrato di Node ≥ 22.13 (le engines esigono già ≥ 22.16, nessuna nuova esigenza runtime).

### Cambiamenti con rottura

- Disposizione dei dati: `l0/` → `conversations/`, `l1/records.jsonl` → `records/` (vecchi dati importati automaticamente,
  file originali conservati come `.imported`, pulibili a mano).
- `L1Store.search` / `searchCandidates` passano da sincroni a **async** (la via vettoriale esige la chiamata remota),
  il terzo parametro passa da `type?: string` a un oggetto di opzioni `{ type?, scoreThreshold? }` (solo API interna del plugin;
  il comportamento esterno di strumenti/richiami resta invariato).

### Verifica

- Lo smoke riceve/riscrive asserzioni su archivio e ricerca: doppia scrittura SQLite, ricerca FTS cinese/inglese, filtro per tipo, soglia ed eccezione da piccolo corpus,
  semantica di append/cancellazione della fusione, **vec0 + hybrid + reindex** (falsi embedding deterministici), migrazione della vecchia disposizione,
  le funzioni pure RRF/bm25RankToScore/buildFtsQuery — tutto superato.
- Validazione del riempimento dei valori di default del Standard Schema di Config (`embedding`/`recall.strategy`/`scoreThreshold`) superata.
- Verifica all'avvio reale: `dsh --profile web` si alza regolarmente, `~/.dsh/memory/` genera `memory.db` (con WAL) +
  `conversations/` + `records/`, schema delle tabelle completo (l0_conversations/l1_records/l0_fts/l1_fts/embedding_meta),
  arresto pulito.

## [0.1.0] — 2026-08-14

Prima versione utilizzabile.

- Pipeline di distillazione stratificata L0~L3 (cattura → estrazione/deduplica L1 → consolidamento di scene L2 → distillazione di profilo L3), prompt trapiantati da
  MemoryCore (doppia famiglia chat/work).
- Richiamo automatico agent/pre-step + iniezione di contesto in scope agente (`<relevant-memories>` / `<user-persona>` /
  `<scene-navigation>` / guida degli strumenti), il lato cattura spella i tag di iniezione per evitare i cicli di retroazione.
- Strumenti del modello: memory_search / conversation_search / memory_read_scene.
- Pannello di stato della pagina impostazioni (bundle client, canale dati Connection RPC).
- Correzione di bug fatali: il nome di export dello schema di configurazione passa da `schema` a `Config` (cordis legge solo `plugin.Config`,
  un nome d'export sbagliato fa fallire l'avvio di tutto il profilo); la raccolta del testo in streaming del LLM passa al block-end come autorità (sistema l'uscita doppia).
