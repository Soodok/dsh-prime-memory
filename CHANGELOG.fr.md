# Journal des modifications (Changelog en français)

- [更新日志（中文）](./CHANGELOG.md)
- [Changelog (English)](./CHANGELOG.en.md)
- [日本語 changelog](./CHANGELOG.ja.md)
- [한국어 changelog](./CHANGELOG.ko.md)
- [Changelog en français](./CHANGELOG.fr.md)
- [Changelog auf Deutsch](./CHANGELOG.de.md)
- [Changelog in italiano](./CHANGELOG.it.md)
- [Changelog на русском](./CHANGELOG.ru.md)
- [Changelog en español](./CHANGELOG.es.md)

Ce fichier consigne les changements notables de dsh-prime-memory (nommé dsh-memory-plugin avant le 0.5.0). Le format suit [Keep a Changelog](https://keepachangelog.com/fr-FR/1.1.0/)
et les numéros de version respectent la [gestion sémantique de version](https://semver.org/).

> **Convention des captures d'écran d'interface** : les entrées apportant des changements d'interface conservent une capture réelle
> dans `assets/changelog/<numéro de version>/<numéro à deux chiffres>-<résumé>.png` et y font référence par un chemin relatif : on voit directement dans le journal à quoi ressemble l'interface de la nouvelle version.

<!-- Lacune : les entrées 0.21.0 et 0.20.x ne sont pas encore traduites. -->

## [0.24.0] — Non publié (ligne locale `0.24.0-local.0…3`, 2026-10-13)

### Ajouté

- **Vocabulaire des types avec source unique de vérité (`src/memory-types.ts`)** : les 29 types d'origine de la taxonomie mémoire de l'hôte + les 7 anciens du plugin + le parapluie `unclassified`, soit 37 types au total. Tout en **dérive** : l'allowlist du répertoire de projection, l'allowlist d'écriture de `memory_add`, les étiquettes du panneau, les chaînes d'énumération des prompts d'extraction et de déduplication, et les codes de type de la double implémentation TS/Python de memport. Jusqu'ici, le « jeu complet des types » était recopié à la main sur quatre sites qui évoluaient séparément : `memory_add` **réécrivait silencieusement** les classifications externes en `episodic`, tandis que le texte de memport promettait de « les passer telles quelles » — deux critères pour une même chose.
- **Distillation de noms (`cfg.naming`)** : l'extraction produit sur place un `title` **défini séparément du** `content` (le title est le syntagme nominal qui répond « de quoi traite cette entrée », le content est la narration complète) ; le merge de déduplication produit en plus `merged_title`. À la persistance, le `title` n'est qu'un **candidat de nom** : il doit franchir la porte de forme `validateTitle` ; sinon il est quand même remis au générateur de noms — la source de vérité de l'unicité du nom ne dédouble pas ses critères parce qu'on accueille une source de plus.
- **Jeu d'exemples few-shot au format standard (`src/prompts/examples.ts`)** : positifs typés + contre-exemples, avec budget maximum de longueur totale (les exemples sont un coût fixe payé à chaque ronde de distillation) ; les positifs eux-mêmes doivent franchir la porte et avoir le squelette complet, et les cas de test se nourrissent directement de `auditFewShot()` au lieu de recopier les critères à la main.
- **Critère de squelette exécutable (`SKELETON_ELEMENTS` + `scoreSkeleton`)** : transforme le vœu écrit dans le prompt — « sans antécédents ni conséquences, incomplet ne compte pas comme utilisable » — en critère mesurable et utilisable pour fixer les valeurs par défaut. Limite déclarée : heuristique de mots-clés, valable uniquement pour une comparaison relative entre deux bras sur la même entrée ; ce n'est pas un score absolu de qualité.
- **Squelette de répertoires + `_index.md` par type (`memory-md-skeleton.ts`)** : chaque répertoire de type porte un fichier index (nom de la classe + nombre d'entrées dans la base). Les répertoires vides sont recrachés par git et par l'archive comprimée, et aux yeux humains « ce répertoire n'existe pas » et « cette classe a 0 entrée » se ressemblent. Idempotent : contenu inchangé, zéro écriture et zéro rafraîchissement de mtime ; surface de projection fermée, zéro action.

### Modifié

- **Trois valeurs par défaut retournées selon la mesure A/B** (`narrativeTemplates.enabled` / `naming.enabled` / `naming.fewShot`). Le fondement vient de deux mesures **de sens opposé** : dans le chemin réel de distillation de conversations, sans exemples le squelette complet tombe à **0.000**（0/23）, avec exemples il monte à **0.703**（26/37） ; en revanche, ajouter des exemples aux tâches de renommage des entrées existantes leur retire **−0.113** (18/160 réponses manquantes). Conclusion : **les exemples ne traversent pas les tâches**, ils n'entrent que dans le prompt d'extraction, pas dans le script de renommage.
- **Projection md activée par défaut** (`memExport.enabled`) : la prémisse entière du plan est « le fichier fait autorité de contenu + la base est index », la laisser éteinte par défaut revient à ne jamais l'utiliser. `mdSync.enabled` **reste éteint par défaut** — il écrit dans la base, le risque est asymétrique.
- **Clé du rattachement workspace renommée `workspaceHints` → `workspaceSource`** : renommage sec, sans alias de compatibilité (cette clé n'est jamais sortie dans une version publiée, ajouter un alias revient à élever une seconde source de vérité). Activée par défaut ; le `path` routé stocke désormais **la racine du workspace** (l'ancienne valeur s'écrivait `E:\test\rewrite-agently\.agents`, et `targetFor` re-concaténait `.agents/memory` → produisait un arbre orphelin `.agents\.agents\memory\` ; la barrière « ne retomber sur une racine unique que si la racine n'existe pas » n'intercepte pas cette forme). Remplissage des entrées existantes sur machine réelle : **724/1166** ont obtenu leur rattachement, `hashRecords` littéralement inchangé.

### Corrigé

- **Le chargeur du registre écrasait la clé absolue dans `relPath`** : après N10 les clés du registre sont des chemins absolus, et cette ligne « réécrire selon la clé si incohérents » se déclenchait à chaque chargement ; en mesure réelle elle a contaminé **1167/1241** entrées. Symptômes en aval : l'archivage des orphelins construisait un répertoire illégal avec deux-points et les 75 déménagements tombaient tous en ENOENT. On dérive désormais depuis `root` + clé (nouvelle fonction `deriveRelPath`) ; le côté archivage ne fait plus confiance au `relPath` stocké.
- **`--revert` ne couvrait pas les hooks** : `findArchivedOld` touchait directement `deps.hooks.exists`, mais `runCli`, en appelant revert, ne passait pas hooks (côté apply il y avait bien `deps.hooks ?? defaultHooks`, côté revert manquait). La première fois que le sandbox lançait un rollback, les 74 entrées échouaient en erreur. L'essentiel est l'asymétrie du dommage : si apply casse, `--revert` vous remet ; **si le rollback lui-même est cassé, la sauvegarde devient la seule sortie**.
- **Les doublons entre racines court-circuitaient « si les deux côtés changent, ne rien toucher »** : `roots = racine de chute de l'enregistrement ∪ racines déjà enregistrées dans le registre` ; une même entrée peut avoir un fichier sous chacune des deux racines. La décision lisait la copie de l'ancienne racine, l'écriture passait par la copie de la nouvelle racine calculée par `targetFor` — ainsi les éditions humaines dans l'ancienne racine écrasaient la copie autoritaire, et le rapport avait l'air parfaitement conforme. Dorénavant on ne reconnaît que la racine de chute actuelle ; le reste est comptabilisé dans le nouveau champ `staleRootFiles` et affiché dans le panneau.
- **Une collision de nom éjectait la mémoire entière de la base récupérable** : la forme `{ ...ancienEnregistrement, id: nouvelId }` portait « un nom déjà affecté à une autre ligne » à l'écriture → collision avec l'index partiel unique → le repli du lot en écritures individuelles continuait d'échouer → le fruit de merge de cette entrée **disparaissait en silence** (l'ancien enregistrement était déjà sorti, ce remplacement ne laissait rien). Le critère de renommage est passé de « name est vide » à **« ce nom ne lui appartient pas »**.
- **Le compteur vectoriel « N entrées en attente d'embedding » ne retombait jamais à zéro alors que « reconstruire l'index : rien à faire »** : dans la vue `missing = total − embedded`, le dénominateur inclut les lignes retirées, et celles-ci légitimement n'ont pas de vecteur par construction ; les deux requêtes SQL qui pilotent le rattrapage excluent les lignes retirées, d'où sur le même écran « 114 en attente » et « rien à faire » côte à côte. Le dénominateur est unifié sur les lignes actives.
- **La barrière de projection comptait le « parcouru » et non l'« agi »** : `maxRecords` faisait entrer dans le quota aussi les entrées jugées « inchangées », et un second clic rescannait les mêmes N premiers — le texte du panneau « recliquez pour continuer » était un mensonge (symptôme machine réelle : `已写 9 · 未变 291 · 剩余 866` constant). On ne compte plus que ce qui a touché le disque ; le total scanné est borné par `timeBudgetMs`.
- **Persistance du registre en O(n²)** : chaque `set()` triait tout le registre et réécrivait atomiquement le JSON complet. Sur 1200 entrées sur le même disque, mesure **9442ms → 1954ms** (marqueur de sale + fenêtre d'agrégation + `flush()` forcé).
- **`NAME_MAX`(40) et `NAME_CLIP_MAX`(28) séparés en deux nombres** : le compteur de caractères traitait ASCII et hanzi à égalité, `dsh-agent-teams` / `Python-3.13` mangeaient 15 unités avec un seul mot, des noms légitimes d'un ou deux mots étaient jugés `too-long` ; mais tout remonter à 40 faisait que `deriveName` recopiait la phrase narrative jusqu'au bout de l'énoncé (mesuré). Au passage, on a corrigé le 28 écrit en dur dans `validateTitle` (deux sources de vérité pour le même seuil).
- **Trois faux positifs à la porte des noms** : la table des préfixes dépouillés est **dissociée** de la table des noms rejetés (les sujets nus « utilisateur/équipe » cessent d'abattre des syntagmes comme « le nom d'utilisateur du compte npm de l'utilisateur », 10 cas sur machine) ; `has-id-fragment` est resserré à « 4+ chiffres après un caractère non ASCII » (`ADR-0006`, `Han-1413141` passent, 4 cas sur machine).

### Limites connues

- Le renfort incrémental à la fin de la rumination s'appuie sur le diff de la base `id→updatedAt`, alors que relabel / retrait utilisent `patchMetadata` sans toucher `updated_time` ⇒ **une réécriture solo-metadata n'est pas reprojetée dans ce tour**.
- La synchro inverse P2 doit encore deux pièces : le hook automatique au démarrage (changé en exposition endpoint + bouton seulement) et le lot `pending` qui n'entre pas dans la vue `conflicts` d'arbitrage.
- **Les traductions en 8 langues ne sont pas à jour depuis 0.20.0** (cette passe n'ajoute que les entrées à partir de 0.22.0 ; le trou 0.20/0.21 reste ouvert, noté ailleurs).

## [0.23.0] — Non publié (ligne locale `0.23.0-local.1…8`, 2026-10-12…13)

### Ajouté

- **Surface de projection md autoritaire (P0/P1/U/N10/N11)** : colonne `l1_records.name` (clé d'identité du fichier + index partiel unique) ; `renderRecord` + registre à double empreinte (`dbDigest`/`fileDigest`) + endpoints `mem-export` / `mem-reconcile` ; section « archives externes » du panneau ; racine de projection passée en **workspace d'abord** (`<ws>/.agents/memory/<type>/<nom>.memory.md`) ; la détection de péremption s'articule avec `.memory.md.disable`.
- **P2 synchro inverse (fichier → index)** : **quadrant à trois voies** sur les deux digests du registre — si seul le fichier change, on le réintroduit dans la base et on le réécrit au rendu canonique (coupe la boucle d'écriture) ; si seule la base change, on réutilise `exportRecords` pour réécrire le fichier ; **si les deux changent, on ne touche ni l'un ni l'autre** et on accroche seulement `pending` ; `.disable` déclenche le retrait sans supprimer le fichier ; les fichiers nouveaux à provenance inconnue sont seulement comptés, pas importés (l'import doit passer par le noyau d'écriture). Endpoint `dsh-memory/mem-sync`.
- **P3 archivage + suppression physique** : la porte de `exportThenPurge` passe du hash de la base entière à une **projection par lot** (en distillation concurrente, si le lot touchait n'importe quel enregistrement étranger, l'ancienne implémentation empêchait éternellement le nettoyage de supprimer) ; après suppression, on écrit un `retired.md` lisible par l'humain et on déplace les fichiers projetés du lot (`.disable` inclus) dans le dossier du snapshot ; `cleanup-retired` en dry-run rend **un aperçu de la liste à supprimer** ; la table d'index de la projection de graphe ajoute `forgetRecords` (jusqu'ici dans tout le dépôt on n'ajoutait sans jamais retirer — un enregistrement restauré depuis un snapshot restait marqué « déjà projeté » et **n'était jamais reprojeté**, le graphe de récupération perdait silencieusement cette entrée).
- **P4.1 classe par défaut `unclassified` + P4.2 normalisation de la mise en forme du corps (`normalizeContentMd`)**. L'idempotence est une exigence dure : sans elle, la `fileDigest` du registre change à chaque ronde et la boucle d'écriture est introduite par le rendu lui-même. On ne touche que la mise en forme, pas la sémantique (pas de puces sur la prose, pas d'H1 inséré, pas de métadonnées dans le corps).
- **Archivage des fichiers projetés orphelins `dsh-memory/mem-orphans`** : ne déplace que les fichiers que le registre a enregistrés comme « écrits par nous » et qu'aucun enregistrement ne réclame ; les nouveaux fichiers absents du registre **ne sont pas touchés** (ce sont peut-être des entrées humaines posées dans le répertoire de projection en attendant d'être resynchronisées). On ne supprime pas, on déplace, en préservant la forme relative et le texte d'origine.

### Corrections de comportement (surface d'affichage des rappels)

- Les entrées rappelées cessent de disparaître instantanément : la vue porte `body` / `retired`, on cesse d'arracher les lignes `session_recalled`, la pastille affiche l'annotation marginale barrée « déclarée obsolète ».
- Au démarrage, on nettoie les résidus retirés déjà présents (sur machine, 725 lignes restaient sales dans `l1_fts`) ; l'invariant de retrait se complète de deux chemins d'écriture latéraux (corrige « après marquage obsolète, la surface de recherche ressuscite »).
- Scoring des rappels de bout en bout : `-1..5` (0..5 pertinence ; `-1` déclare obsolète et retire) ; le score entre dans les indicateurs de maturité (`-1/1/2` plombent et font couler, `4/5` rehaussent et font remonter).
- Première implémentation du routage de contenu par workspace (écosystème dsh → `rewrite-agently`, non-dsh → `agent-no-dsh` ; **écrit seulement `workspace_id`, ne touche ni `scope` ni `updated_time`**, et synchronise les colonnes de rattachement portées par chaque ligne `l1_fts`).

### Discipline

- Deux méga-fonctions memport scindées en deux rondes (Extract Function, comportement préservé, régression octet-à-octet sur l'étalon du CLI).
- La discipline du contrat d'endpoint à **cinq modifications synchronisées** reste en vigueur (`MEMORY_ENDPOINTS ≡ switch ≡ double map de contract ≡ décompte de contract-keys ≡ config`) ; chaîne de comptage 55→56→57→58→59.

## [0.22.2] — 2026-10-12

### Ajouté

- Thème tri-état (auto/clair/sombre) + bloc de redéfinition de tokens ; panneau à 11 onglets resserré sur une seule ligne.
- Idempotence de `ext_key` pour `memory_import` (`l1_records.ext_key` + index partiel unique + récépissé `deduped`).
- **Memport Connect** : analyse / pré-filtre / scan de `.mem` + registre de provenances + onglet Connect (alignement sur l'étalon sha256 entre implémentations).
- **Cristallisation de compétences** : skill-store (sidecar JSON) + détection de candidats + injection du rappel de compétences + interrupteur du tableau `skillsEnabled`.
- G4 arêtes causales du graphe (provoque / parce que / a corrigé / remplace, sans pousser `projectorVersion`).
- G3 maturité dérivée à la lecture (badge sur la fiche d'enregistrement + annotation marginale dans la vue d'arbitrage de contradictions, n'intervient pas dans l'arbitrage automatique).
- G1 de bout en bout sous porte pour `usageScenario` (extraction → dépôt dans `metadata.dsh_usage_scenario` → réordonnancement fin dans le rappel ; off laisse tout littéralement inchangé).
- G2 gabarits narratifs par type (variantes de prompt sous porte ; off est préfixe de on).
- Les deux axes wing / couloir cognitif ne se croisent pas (accesseurs orthogonaux + garde de régression avec domaines disjoints).
- **G-live ensemble vivant de rappels de cette conversation** : sidecar persistant + endpoint en lecture seule `session-recalled` + liste en lecture seule dans la pastille.
- Projection consciente de la session dans `memoryRecall` (source de données de la section « rappels de cette session » de la barre latérale du brief, `init(header).id`).
- `cfg.slots.migrateLegacy` (éteint par défaut) : retire en douceur les slots rule « cloués en résidents alors que le contenu est déjà porté par un L1 actif ».

### Corrigé

- La réinjection de rumination faisait remonter ou grossir le compteur de pendantes (ruminate passe des messages vides, même sémantique que `enqueueSessionSlices`).
- Dans le finalize de rumination et dans `doLightRefresh` : L3 forcé à courir vraiment + compteur remis à zéro + persistance par `state.save()` (corrige « les L2/L3 après rumination ne se vident pas et reviennent au redémarrage »).

### Discipline

- Toutes les capacités nouvelles sont éteintes par défaut ; en état off, produits et injections restent littéralement identiques ; le contrat d'affichage inter-plugins (projection `memorySlots`) reste câblé.

## [0.22.1] — 2026-10-09

### Corrigé

- **Fond du calque passé en opaque** : le popover mémoire de la barre de saisie (`.dsh-mem-popover`) et les panneaux déroulant / filtre (`.dsh-mem-pop`) suivaient auparavant le `--dsw-specific-menu` de l'hôte, que l'hôte résout en une valeur de verre semi-transparent ⇒ le panneau laissait passer l'arrière-plan. Désormais la couche d'alias est superposée **sur un fond opaque `bg-primary`** (technique underlay), le panneau paraît solide quel que soit l'alpha de l'hôte.

## [0.22.0] — 2026-10-09

### Modifié

- **Surface déclarative adaptée à 15rc** : 9 pairs dsh couvrent tous les rc publiés de l'hôte (`0.1.0-rc.2..0.2.0-rc.2`, vérifiés un à un par `npm view` et cohérents entre lignes), tous optionnels ; `engines >= 0.1.0-rc.2` sert de barrière grossière (la porte fine, ce sont les pairs), `package.json` et `dsh.plugin.json` synchronisés.
- **Versions recollées entre les deux manifestes** : `dsh.plugin.json` avait dérivé sur `0.20.0-beta.6-dsh0.2.0.1`, ce lot l'aligne littéralement sur `package.json` (porte V1).
- **`dsh.client.inject` réduit à `ui-primitives` uniquement** : `dsh-client-connection` n'existe en tant que paquet qu'à partir de 0.1.2 ; le déclarer faisait pendre toute l'entrée client sur 0.1.0/0.1.1 (`rpc.ts` résolvait déjà la connexion en paresse via `ctx.get`).

### Discipline

- Tout dépôt de type build reçoit l'injection `prepack: npm run build` — `npm pack` ne déclenche que prepack, pas `prepublishOnly` ; c'est l'une des trois couches de défense contre la fausse affaire stale-build.

## [0.19.0] — 2026-09-29

### Changements

- **Adaptation à DSH 0.2.0 (compat/0.2.0)** : peerDependencies et engines.dsh (package.json + dsh.plugin.json) passent en bloc à `>=0.2.0-rc.1 <0.2.1-0` (remplacement d'une seule plage ; la ligne 0.1.7 reste servie par la branche compat/0.1.7) ; les 9 devDependencies dsh-* sont épinglées avec précision 0.1.1-rc.2 → 0.2.0-rc.1 et la dépendance type-only `@deepseek-ai/dsh-compaction` est ajoutée. Adaptation au niveau du code de la dérive de l'API hôte 0.2.0 : l'événement `agent/session-start` fusionne dans `agent/created` (auditeurs passés en async pour honorer le contrat sériel) ; la lecture des événements de session passe de `session.events` à `session.snapshotEvents()` (l'hôte a déprécié la lecture synchrone intégrale, la chaîne de dégradation est conservée) ; les bouchons de test sont synchronisés (sémantique de l'offset du curseur de projection).
- **Métadonnées de publication** : version 0.18.4 → 0.19.0 ; publishConfig.tag `dsh-0.1.7` → `dsh-0.2.0` ; dsh.plugin.json version → `0.19.0-dsh0.2.0.1`.

## [0.18.4] — 2026-09-28

### Ajouts

- **Récupération après crash (§A)** : quand l'hôte s'effondrait en plein tour, ce tour de conversation était auparavant perdu à jamais avec le tampon de capture en mémoire (le plancher de démarrage à froid du resume jetait tout l'historique). Désormais, au resume, le plugin rapproche ses données du journal d'événements persisté par l'hôte : le plus grand tour déjà écrit en L0 sert de filigrane pour recouvrer les tours complets qui le suivent (limite de 2 tours ; les tours orphelins d'un crash sont refermés par l'hôte avec `turn/end{reason:'interrupted'}` — 98 instances constatées sur cette machine). Idempotence = filigrane + contrôle d'existence tour par tour ; quand les services de lecture de l'hôte sont indisponibles, dégradation par paliers (`sessionQuery.readSession` → `sessionPersistence.readFrom` → maintien du comportement actuel + avis ponctuel), toujours fail-open et sans jamais bloquer le démarrage de la session.
- **Expurgation des charges utiles (§C, `capture.redactSecrets`, activée par défaut)** : à la frontière d'écriture de la capture, 8 classes de secrets (clés PEM / en-têtes Authorization / Bearer et JWT / Cookies / formes de clés API de fournisseurs / e-mails / numéros ≥ 9 chiffres hors dates / ID à haute entropie) sont remplacées par des espaces réservés typés `[REDACTED:<KIND>]` — un point de passage unique couvrant le JSONL L0, le SQLite L0, l'entrée de distillation et les écritures manuelles `memory_add`/`memory_import` (les deux frontières d'écriture L1 partagent le même vocabulaire). Les valeurs sûres (`example` / `$VAR` / `${{…}}` etc.) ne sont pas expurgées ; les espaces réservés conservent la sémantique de catégorie et restent interrogeables par la recherche. Attention : une fois activé, le texte L0 original est modifié à jamais (la reconstruction ne rend pas l'original) ; `false` restaure le texte en clair d'un coup.
- **Anti-injection des prompts de distillation (§B)** : les six prompts de distillation (extraction L1 ×3 / déduplication L1 ×3 / scène L2 ×2 / profil L3 ×2 / projection du graphe / vérificateur) embarquent tous une déclaration générale « frontière de contenu (anti-injection) » et la délimitation des emplacements de données — le texte de conversation, le réservoir de mémoires existant, le texte intégral des scènes etc. incorporés aux prompts sont des données, pas des instructions, afin qu'un texte d'allure impérative glissé dans la conversation ne puisse plus détourner distillation, déduplication ni arbitrage. Vocabulaires de décision et contrats de sortie inchangés au bit près.

### Améliorations

- **Accusé d'injection (§D)** : l'injection de rappel n'est plus marquée comme vue au moment du retour ; place à un schéma « pending → récépissé du journal » en deux temps — le `dedupe.mark` n'intervient que lorsque l'hôte écrit réellement le message d'injection dans le journal de session (`user/message` signé `plugin:memory` avec un id stable). Les injections écrasées ou annulées ne pénalisent plus à tort une mémoire (réinjection possible au tour suivant) ; faute de récépissé sous 5 minutes, on retombe sur le marquage immédiat (pour qu'une panne de la chaîne d'accusé ne casse pas la déduplication) ; non accusé = abandonné.
- **Réinjection ciblée après compression (§E)** : après `compaction/end` (sans erreur), le prochain tour de la session déclenche un rappel renforcé et ciblé — la déduplication est contournée (la compression a déjà éjecté les anciennes injections du contexte), le profil est réinjecté immédiatement, le registre d'occupation est remis à zéro ; consommation = effacement. Le mécanisme antérieur de remise à zéro globale au compact/clear est conservé comme chemin de repli ; les deux chemins sont idempotents.
- **Traçage structuré (§F, `trace.*`)** : les événements de rappel et de distillation s'écrivent en JSONL quotidien (`<dataDir>/trace/`, conservation 14 jours par défaut, arrêt d'écriture à 5 Mo/jour + marqueur). L'événement de rappel contient l'empreinte de la query (par défaut metadata-only : longueur + sha256, `trace.captureContent` pour stocker l'original ≤ 200 caractères), les id des contenus touchés/injectés, les scores, les durées et quatre issues (injected/suppressed/timeout/off) ; l'événement de distillation contient le runId, l'agrégat des décisions à six valeurs (même source que `l1_receipts`, audit croisé possible), les durées et l'issue. Nouvel endpoint `dsh-memory/trace-tail` ; l'onglet « Journaux » de la page de paramètres gagne une bascule entre trois sources : journal système / trace de rappel / trace de distillation.

## [0.18.2] — 2026-09-27

### Corrections

- **Adaptation à la signature du format de session v4 (hôte ≥ 0.1.7-rc.1)** : les deux inéjections de rappel de mémoire (`hooks/recall.ts` pour le rappel intersessions, `hooks/slot-recall.ts` pour l'injection permanente des slots) n'utilisent plus l'ancienne signature `source: { kind: 'plugin', plugin: 'memory', form: 'recall' }` que l'hôte v4 rejette (elle déclenchait un `SessionFormatError` et le raté du tour entier — la source des « erreurs à l'appel de la mémoire ») ; place à la signature producer-owned `{ kind: 'plugin:memory', form: 'recall' }`. Le `form`, le contenu et le calendrier des injections restent inchangés. Preuve judiciaire : la `source()` de `@deepseek-ai/dsh-session-format-v3-to-v4@0.1.7-rc.2` vérifie seulement que kind est non vide et ≠ `'plugin'`, sans valider les champs d'accompagnement.
- **Compatibilité double forme en lecture** : le critère de signature `isOwnRecallSource`, utilisé pour estimer la part de rappel, accepte à la fois la nouvelle signature et les anciennes lignes v3 — corriger seulement l'écriture aurait fait retomber silencieusement à zéro la « part mémoire du rappel » du panneau d'occupation (sans exception ni erreur). `MessageSourceMap` enregistre `plugin:memory` par module augmentation (la map de dsh-llm 0.1.7 est `user|model|tool|'system-prompt'`, sans fourre-tout plugin, extensible par fusion par producteur).
- **Adaptation native au tool-result v4 (N1)** : la lecture des textes de preuve de `store/evidence-source.ts` gagne une branche native (messages `role:'tool'` de première classe en v4 : content directement composé de blocs text/reasoning, `isError` au niveau racine du message ; l'`assertBlock` de l'hôte rejette sèchement les anciens blocs wrapper `tool-result`), l'ancien chemin de descente dans les blocs est conservé pour compatibilité historique — sinon les textes de preuve seraient restés silencieusement vides sous v4. La garde `isError` de `projection/slots.ts` passe en même temps au natif.

## [Non publié]

### Ajouts

- **Slots actifs (Active Slot) — sortir « les conventions qui doivent s'appliquer à chaque coup » du rappel sémantique, pour en faire un contexte permanent persistant d'une session à l'autre.** L'origine est un échec réel : la règle générale d'accès réseau (téléversement par l'officiel, téléchargement par le miroir) était bien consignée en mémoire, mais au tour suivant elle **n'a pas été rappelée** et la vieille mauvaise habitude a continué de courir. Le rappel sémantique est probabiliste, alors que ce genre de règles exige justement du déterminisme — d'où un couloir mécanique qui leur est réservé.
  - **Stockage** : `<dataDir>/slots.json`, indépendant de `state.json` (les slots sont de fréquentes petites retouches ; il ne fallait pas traîner l'écriture atomique du checkpoint dans leur cadence), réutilisant l'`atomicWriteJson` de `util/io.ts` ; en mémoire, on ne modifie que sur place, `list()/open()/alwaysOn()` renvoient toujours des copies (leçon des références vivantes de `StateStore.reset()`).
  - **Une triade d'outils** : `memory_slot_write` / `memory_slot_list` / `memory_slot_close`. Écriture et fermeture sont soumises à la barrière à hauts privilèges `live.memoryMutate` (désactivée par défaut) — changement d'état = gestion du risque ; la lecture est soumise au gating par mode de session, même sémantique que `memory_search`. Le nouveau registrar vit dans son propre fichier, zéro intrusion dans `tools/index.ts` (1156 lignes).
  - **Injection permanente** : `hooks/slot-recall.ts` enregistre son propre `agent/pre-step` (prépend en cascade), composable avec le `recall.ts` existant (l'ordre des deux injections est épinglé par des tests). Les slots `pinned && open` sont triés par priority décroissante et tronqués au budget d'octets ; au-delà, la mention `… et N autres` l'indique explicitement et donne le chemin pour les retrouver — **la troncature n'est jamais silencieuse**. `validUntil` est converti en `expired` par une liquidation mécanique avant injection (simple comparaison d'horodatage, aucun LLM introduit), sinon « la durée de validité » n'aurait été qu'un ornement.
  - **Projection serveur `memorySlots`** : enregistrée via `ctx.inject(['sessionProjections'])` — si l'hôte n'a pas ce service, **on s'abstient silencieusement** plutôt que de faire échouer le chargement de toute la ligne de profil. Le `apply` ferme sur `SlotStore` et juge la souillure via `revision()` : **ne reconstruire que sur `tool/result` (réglé, sans erreur) et si la révision a changé** (`tool/call` commite avant que `execute()` ne modifie le store — replier par call lirait du périmé) ; les événements sans rapport renvoient **la même référence** ; `view` garde la stabilité des références via `WeakMap` et **ne contient pas le body** (juger et générer sont orthogonaux, le corps se récupère à la demande). Ce tour ne contient aucun code client : l'affichage attend le brief du prochain tour.
  - **Schéma sans nouvelle dépendance** : `stateSchema` / `viewSchema` implémentent leur propre `parse` (le runtime du registre n'appelle que cette méthode) ; état légal **renvoyé tel quel, même référence**, état illégal = exception ; zod n'entre pas (`package.json` et lockfile hors liste blanche de modifications pour ce tour).
  - Limites : ≤ 8 slots (configurable) / permanent ≤ 2048 octets / body ≤ 512 / titre ≤ 60.
- **Ancres de provenance (R7) — la mémoire retrouve désormais sa **position réelle** dans la session.** Jusqu'ici la chaîne de traçabilité était coupée : L1 portait des `source_message_ids`, mais ce sont des **id de messages L0** (`msg_<epoch_ms>_<hex>`), et la table L0 n'avait ni colonne `turn` ni `step` ; de plus, cette liste d'ids **n'était pas écrite dans la base de recherche** (le côté écriture ne prenait que `metadata`, le champ tombait en silence). Résultat : **aucune mémoire ne pouvait être localisée dans son original**.
  - `l0_conversations` gagne les colonnes `turn`/`step` (`ALTER TABLE` idempotent ; les anciennes lignes restent NULL = pas d'ancre, **jamais de rebond deviné**), plus un index `(session_id, turn)`.
  - Le côté capture gagne un fold de `step/start` : `user/message` **ne porte pas** de `step` dans la charge du noyau, on le déduit du `step/start` du même tour ; `assistant/message` utilise le `{turn, step}` porté par l'événement. **Les messages antérieurs au premier `step/start` gardent un step vide** — pas de coordonnées inventées là où elles manquent, c'est la ligne rouge.
  - L'ancre loge dans la clé réservée `dsh_source_anchors` de `metadata_json` (affichée par l'UI sous la forme `t12 s3`). Pas de colonne ajoutée, pas de contrat disque touché. **Les deux chemins d'écriture — création et « fusion/mise à jour » — portent l'ancre** — sinon une seule fusion suffirait à perdre les coordonnées, or la fusion est l'action la plus fréquente des longues sessions.
  - Nouvelle interface de lecture de l'hôte `MemoryDb.l0ByAnchor(sessionId, turn, step?)` : récupérer les messages L0 **par coordonnées** (et non par le temps) ; c'est l'entrée unique du futur « lecteur de preuves ».
- **Le panneau des enregistrements affiche l'ancre de provenance** (auparavant cette ligne n'affichait jamais qu'un « - »).
- **Lecteur de preuves (R1) — rendre aux ancres leur texte original de session.** Le texte original passe par le **`ctx.sessionQuery` du noyau** en ligne directe (`readSession` / `listEvents`), sans attendre un endpoint HTTP d'un plugin d'indexation externe : ce plugin est un plugin hôte, il tient déjà le `ctx`, ce qui économise une frontière de processus et un point de défaillance. Ce tour pose la **couche de fonctions pures** (câblage d'assemblage et appels réels sur machine : entrées suivantes).
  - **Deux formes d'id de session essayées toutes deux** : en pratique, l'index contient des `session_id` avec le préfixe `session-` et d'autres en uuid pur ; n'en essayer qu'une **laisse échapper silencieusement 124 sessions** (sans erreur : simplement, on ne les trouve jamais).
  - `foldEventAnchors` réutilise côté lecture **la même règle de fold que côté capture**, garantissant que les coordonnées écrites et relues partagent la même sémantique.
  - **Projection fidèle** : pas de `stripCodeBlocks`, pas de troncature par longueur, pas de filtre « ça vaut le coup d'être retenu » — **la capture peut laisser tomber des choses pour économiser des tokens, la prise de preuve non**. Le seul filtre conservé : « le contexte injecté par le plugin ne compte pas comme parole de l'utilisateur ».
  - **Échecs classifiables** (le cœur de cette entrée) : `no-service` / `no-anchor` / `session-unreadable` / `anchor-not-found` / `timeout` / `error`. La distinction des quatre premiers est indispensable — prendre « illisible » pour « jamais parlé » ferait juger systématiquement à tort les mémoires des sessions archivées.

- **Retrait des mémoires (suppression logique) et boucle de nettoyage : supprimer ne veut plus dire perdre des données.** Auparavant, « supprimer » était une **suppression physique** — une erreur ne laissait d'autre recours que de fouiller à la main les sources de vérité `records/*.jsonl`. Désormais la suppression a deux degrés, **le réversible est le défaut**, l'irréversible exige une demande explicite et apporte son propre export.
  - **Retrait (suppression logique)** : la ligne de la table principale est conservée + `valid_to` refermé + marqueur de remplacement écrit (clé réservée `dsh_superseded` de `metadata`, avec instant / motif / verdict / id de la paire en conflit) ; seules les lignes `l1_fts` et `l1_vec` sont retirées. **Le SQL côté recherche n'a pas bougé d'un mot** — aucune dérive de requête. Les trois voies de retrait (condamnation à l'arbitrage / remplacement par déduplication `update`·`merge` / suppression manuelle) **partagent le même primitif**, sinon finiraient par apparaître des incohérences du genre « telle voie supprime encore en dur » — incohérences qui ne se révéleraient qu'au moment de la fausse manœuvre.
  - **Endpoints 33 → 38** : `records-retired` (liste des retirés) / `records-restore` (restauration) / `cleanup-retired` (nettoyage physique) / `snapshots-list` (liste des instantanés) / `snapshot-restore` (réinjection depuis un instantané). Les trois listes (table de correspondance de `contract.ts` / whitelist `MEMORY_ENDPOINTS` de `stats.ts` / `case` de distribution) et l'assertion du total d'endpoints sont synchronisées — oublier l'une des quatre et l'endpoint renverrait 404 en permanence, tandis que le `catch` du `rpc` côté client avalerait le problème en silence et le panneau disparaîtrait d'un bloc.
  - **`memory_delete` ne retire par défaut qu'1 entrée** (contre 3 avant) et gagne un chemin **exact** par `ids` (en sautant le matching sémantique). L'ancienne implémentation supprimait en lot par top-N sémantique et a en pratique **supprimé à tort deux véritables mémoires sans rapport** — la précision de la suppression doit être garantie par l'ID exact, pas par la ressemblance.
  - **Nettoyage physique à blanc par défaut** : omettre `dryRun` vaut `true`. Même en exécution explicite, un **instantané intégral** de la base est d'abord pris et **vérifié par hachage de contenu** ; en cas d'écart, arrêt sans suppression d'une seule ligne. Pour cela, `deleteL1Batch` a été ramené à **un unique appelant** (`exportThenPurge`), épinglé par un test de garde du code source — « il n'existe pas de chemin de suppression physique qui contourne l'export » devient un fait structurel, pas une promesse.
  - **Le billet retour a été ajouté** : `restoreL1Snapshot` n'était jusqu'ici **appelé que par les tests** — l'« export avant nettoyage » n'était donc vrai qu'à moitié : l'export existait, la sortie de réinjection non ; en cas de pépin, il ne restait qu'à décoder `l1-records.json` à la main. Voici maintenant `snapshots-list` / `snapshot-restore` : ne reçoivent que des **noms de répertoires** d'instantanés (chemins et `..` refusés), à blanc par défaut, et déclarent honnêtement `stillRetired`. Cette entrée est nécessaire : le nettoyage ne nettoie que les entrées **déjà retirées** et l'instantané est pris **avant** la suppression, donc tout ce qui est retrouvé porte le marqueur de retrait — **être réécrit dans la table principale ≠ être revenu dans le rappel** ; sans le dire, on croirait la restauration terminée. Pour un vrai rollback en une étape : `unretire: true` (réutilise le `restore` existant, pas de nouveau chemin d'écriture).
  - **Panneau** : la page des enregistrements gagne une zone « Retirés (récupérables) » (repliée par défaut, chargée seulement à l'ouverture, pour ne pas ralentir la navigation ordinaire) ; le texte de confirmation de suppression dit désormais explicitement « récupérable ». **Le nettoyage physique n'a volontairement pas d'entrée dans le panneau** — une action irréversible n'expose que RPC / voie modèle.
- **§C Gel des contradictions : les contradictions d'un même lot se gèlent aussi (correction du « verdict du modèle qui se faisait refuser à la porte »).** L'expertise a révélé que le point ③ de `validateConflictPair` exigeait en dur que « l'autre partie soit un enregistrement connu du pool de candidats », or les id des nouvelles mémoires du même lot n'y figurent pas (elles viennent d'être produites à ce tour, pas encore entrées en base). Ainsi, le cas le plus typique de « la machine ne peut pas trancher » — deux nouvelles mémoires du même tour se contredisant — retombait obligatoirement sur `store` même quand le modèle émettait correctement `conflict`. Preuve : le modèle émet dans 7/7 des cas, mais ce saut n'atteignait jamais la base (`conflict_pending` : 0 ligne depuis sa création, `l1_receipts` : 0 reçu `conflict`, contre `store 381 / merge 204 / update 172 / skip 7`). Remède : `validateConflictPair` gagne un `batchIds` optionnel (absent = comportement ancien), avec toujours l'exigence « exactement une des parties est la présente mémoire » pour garantir l'unicité du pairage ; et garde-fou pour la file pleine — **pas d'acquittement automatique quand le perdant appartient aux nouvelles mémoires du tour**, sinon la production fraîchement extraite sortirait aussitôt de scène sans que personne ne soit prévenu ; on ne parque pas et l'entrée en base suit son cours.

- **§C Le gel des contradictions comprend désormais « les trois axes temporels » — une contradiction de contenu avec antériorité dans le temps n'est plus systématiquement refilée à l'humain.** Un enregistrement mémoire porte de son origine trois axes temporels non substituables (instant d'enregistrement `createdAt/updatedAt`, validité factuelle `validFrom/validTo`, persistance `persistence`), mais la détection de conflits n'utilisait que l'instant d'enregistrement : en jugeant `conflict`, le détecteur ne voyait ni validité ni persistance et prenait souvent pour un arbitrage humain ce qui n'était qu'« un vieux fait remplacé par un neuf » ; le panneau d'arbitrage, lui, ne montrait que les textes des deux parties, sans comparaison de validité — un jugement à l'aveugle. Ce tour branche les trois axes aux deux bouts du gel :
  - **Côté détection** : le pool unifié de candidats transmet au détecteur, **quand le gel est actif**, `valid_from_ms` / `valid_to_ms` / `persistence` de chaque mémoire ; la clause de l'action `conflict` gagne une « aide à la décision par les trois axes » — en cas de contradiction de contenu, comparer d'abord validité/persistance ; si une partie est déjà périmée ou nettement plus tardive, orienter vers `update`/`merge` plutôt que `conflict`. **Les trois clés et la clause sont toutes sous gating `conflictFreeze`** : l'état éteint produit un user prompt **octet pour octet identique** à celui d'avant la mise à niveau (voir « Corrections » ci-dessous et [ADR-0012](./docs/adr/0012-conflict-3axis-advisory-time-axes.md)).
  - **Côté arbitrage** : `ConflictPairView` gagne des champs optionnels d'axes `winner_*` / `loser_*` (rétrocompatible) ; la liste à arbitrer et le rendu joignent à chaque paire une comparaison « validité début/fin, persistance », pour voir d'un regard qui est plus récent, qui est déjà périmé.
  - La machine **ne tranche toujours pas toute seule** : les trois axes ne sont que des faits d'appui ; la conclusion finale reste écrite par l'humain (ou par la soupape de sûreté : timeout / file pleine) — les valeurs de `ConflictResolution` sont inchangées.

- **§C Trois classes de conflits + groupement par claim + trace des abandons (Phase 3-4).** Le conflit ne se réduit plus à une seule « contradiction dure » — le LLM peut désormais juger `hard` (faits mutuellement exclusifs), `conditional` (contradiction seulement sous des prémisses différentes), `supersession` (le neuf remplace l'ancien). Le panneau affiche par segments des trois classes, chacune avec son titre et son explication propres ; le bouton `defer` permet « vu mais pas encore tranché » (réinitialise le timeout, cumule les relectures). La colonne `claim_key` permet de marquer plusieurs paires de conflit portant sur le même sujet, et le panneau groupe dessus. Les décisions de conflit illégales et abandonnées s'interrogent via l'outil `memory_conflicts_rejected` et l'endpoint `dsh-memory/conflicts-rejected`.
  - `conflict_pending` gagne deux colonnes `conflict_type` / `claim_key` (migration `ALTER TABLE` idempotente).
  - Le comptage du quota ne compte que `hard` : `pendingHardTotal` filtre par type ; `conditional` / `supersession` ne consomment pas de quota.
  - Gel du hash de projection : la projection à 7 champs `projectConflictsForHash` exclut les nouvelles colonnes, la vérification des instantanés existants ne bouge pas.
  - Panneau : `ConflictsTab` — segments des trois classes + bouton defer + textes des trois axes + compteur de relectures + affichage de la clé de claim.

### Corrections

- **Le prompt en état éteint comportait furtivement trois champs d'axes (déploiements par défaut touchés).** La première version injectait `valid_from_ms` / `valid_to_ms` / `persistence` **sans condition** dans le pool de candidats, alors que cet appel LLM ne lisait l'interrupteur que pour le system prompt ⇒ quand `conflictFreeze=false` (défaut des déploiements), le modèle voyait 3 clés de plus par candidat, **sans aucune clause qui les explique** : des tokens gaspillés et une entrée modifiée. Les trois clés sont maintenant sous gating `conflictFreeze`, l'état éteint produit un user prompt **octet pour octet identique** à celui d'avant la mise à niveau ; le critère passe en même temps de « ne contient pas telle sous-chaîne » à **ancre golden sha1 + vérification inverse** (si on casse le gating, le cas doit rougir).
- **Le panneau disait « gel des contradictions non activé » alors que l'interrupteur était manifestement sur on.** Les endpoints `conflicts` / `conflict-resolve` lisaient la **configuration statique du déploiement** `cfg.conflictFreeze.enabled`, tandis que le panneau écrivait dans les **réglages runtime** (live). Le défaut de déploiement étant toujours `false`, l'interrupteur était sur on, `settings.yaml` portait bien `true`, et la page persistait à annoncer l'extinction. Passage à `effectiveCfg(cfg, live)`, la même résolution que le pipeline de déduplication — l'interrupteur n'a qu'**une** source de vérité, le lecteur et l'écrivain doivent regarder le même état, sinon on obtient « la liste dit allumé, l'arbitrage dit éteint », un dialogue de sourds.
- **`dsh-memory/embedding-reindex` déclaré mais renvoyant 404 en permanence.** L'endpoint était dans le contrat, mais absent à la fois de la whitelist `MEMORY_ENDPOINTS` et du `case` de distribution ; pendant ce temps `startReindex()` était du **code mort** — le bloc « index vectoriel » de la page de paramètres n'offrait donc qu'un « Annuler », jamais de « Démarrer ». Whitelist + `case` + cas de test ajoutés.
- **`UiRecord.sourceMessageIds` était un champ mort.** Il lisait de `l1_records` une **colonne qui n'a jamais existé**, retombait donc toujours sur `[]`, et la ligne de provenance du panneau **n'a jamais rien rendu**. Remplacé par `sourceAnchors`, qui lit les vraies données.

## [0.17.0-dsh0.1.7.1] — 2026-09-25

> Première publication de la ligne de compatibilité hôte **0.1.7** (dist-tag `dsh-0.1.7`, basée sur main @ 85d9b05). **Réservée aux hôtes ≥ 0.1.7-rc.1** ;
> les hôtes 0.1.5 / 0.1.6 doivent continuer d'utiliser la ligne de versions du tag `dsh-0.1.5`. Contenu = tout main + l'adaptation suivante.

### Changements

- **Les interrupteurs runtime migrent dans une section volatile du Config (face déclarative de réglages 0.1.7).** L'hôte 0.1.7 a supprimé les deux générations d'API d'enregistrement impératif (`settings.register` / `installSection`) ; les interrupteurs runtime (général/capture/distillation/rappel, chaînes de routage de distillation, surcharges d'embedding distant, barrière d'écriture-suppression, 20 clés au total) sont désormais portés par un `.volatile()` de section entière sur `memorySchema.live` : l'hôte projette automatiquement les champs volatils en formulaire de réglages, et les changements runtime passent par `ctx.settings.update` → configEditor → patch de profil → commit volatile-only du loader (sans remontage du plugin). Le contrat `LiveSettingsHandle` ne change pas, RPC et consommateurs ne bougent pas d'un bit. **Le plugin embarque sa propre page de réglages → le formulaire auto-généré de l'hôte est désactivé** (`suppressAutoSettingsForm`).
- **⚠️ Les anciennes valeurs de réglages ne migrent pas automatiquement** : la section `dsh-memory` de l'ancien `settings.yaml` portait des clés plates de premier niveau, incompatibles avec les nouveaux chemins `live.*` (et son booléen `conflictFreeze` entre en collision avec la section objet de même nom du nouveau Config), l'importateur de l'hôte refuse donc la section entière. Après la mise à niveau, recopiez à la main les anciennes valeurs dans le patch de profil sous la forme `- id: dsh-memory / config: { live: {…} }` (noms de clés identiques à l'ancien namespace, juste un niveau `live.` plus profond).
- devDeps passées à la pile 0.1.7 (cordis 4.0.4 / schemastery 3.18.4 / cordis-plugin-loader 1.0.5), sans être embarquées pour les consommateurs.

### Corrections

- **Régression de perte silencieuse de la première écriture** : le fichier de verrou était créé avant l'écriture ; quand le répertoire parent de la cible n'existait pas encore, `open('wx')` échouait en ENOENT et les stores l'avalaient en simple warn → première écriture perdue en silence. `rmwJson` fait désormais `ensureDir` avant de prendre le verrou (inclus avec les correctifs de la ligne main).
- Contient aussi l'intégralité de la ligne main : durcissement de la couche fichiers (écritures atomiques / classification en lecture / version fail-closed / verrouillage de fichiers / sûreté des chemins — voir les entrées [0.16.1] et Non publié).

## [0.16.1] — 2026-09-24

### Ajouts

- **« Filtrage des retirés » du panneau des enregistrements** : par conception, les enregistrements à suppression logique ne sont pas cachés (ils sont récupérables), mais mêlés aux enregistrements actifs ils se laissaient mal distinguer — la rangée d'outils de la liste gagne désormais un filtre à trois états « **Tous / actifs seuls / retirés seuls** ». Le `listL1` du backend reçoit le même filtre à trois états, même critère (défaut : tout ; instantanés/reconstruction non affectés ; le critère de `retired:true` et celui de `listRetiredL1` sont le même, les deux vues montrent les mêmes lignes) ; contrat `ListRecordsRequest.retired?: boolean`. Le filtre n'affecte que le chemin de navigation — la recherche par mot-clé ne couvre que la face recherche, où les enregistrements retirés ne figurent de toute façon pas. « Charger plus » et le rafraîchissement automatique après suppression/restauration conservent l'état du filtre courant.

### Corrections

- **Après confirmation de « supprimer la mémoire », le panneau semblait ignorer la demande — l'état de retrait n'était pas transmis à l'UI.** Le retrait logique (retire) fonctionnait depuis toujours côté serveur (`valid_to` refermé + sortie de la face recherche + récupérable), mais, par conception, la liste active **conserve** les enregistrements retirés (le test `l1-retire` épinglant « le chemin de navigation du panneau ne cache pas les enregistrements retirés » en témoigne) ; or le contrat `UiRecord` n'avait aucun champ « déjà retiré », les lignes de la liste active n'avaient aucune différence visuelle, et la zone « retirés » était repliée par défaut — après confirmation, l'utilisateur voyait **un enregistrement strictement identique** et concluait naturellement que « la suppression n'a pas pris ».
  - Le contrat gagne `UiRecord.retired` / `retiredReason` : dérivés par `hitToUiRecord` à partir de `valid_to` + marqueur de remplacement, transmis uniformément par la liste active et les résultats de recherche.
  - La liste active rend les enregistrements retirés avec un **badge « retiré · motif » + toute la carte grisée**, et le bouton en ligne passe de « ✕ Supprimer » à « Restaurer » (via `records-restore`, rafraîchissement automatique après succès) — au moment de la suppression, l'interface change immédiatement et la confusion du second clic (no-op idempotent) disparaît.
  - Nouveau `tests/ui-retired-flag.test.ts` épinglant le comportement de la cartographie (actif / retiré manuellement / retiré par remplacement / forme sans `validTo`).

## [0.16.0] — 2026-09-24

### Corrections

- **Toute la chaîne de marquage Wing du recalibrage / remplissage en un clic était morte** : le prompt demandait au modèle de renvoyer `{"id":…,"wing":…}`, mais l'analyse lisait `item.hall` → rien n'était jamais récupéré → tout le lot jeté en silence **(constaté en pratique : `wingLabeled=0 / tagged=0 / llmSkipped=60`, alors que le journal montrait un LLM en plein succès)**. C'est le **3e dégât collatéral du même type** depuis le renommage hall→Wing (les deux premiers : `cfg.hall`, le `hall` de session-modes) — les noms de champs JSON d'un prompt relèvent du **protocole filaire** et n'ont pas à suivre les renommages de libellés d'UI. L'analyse lit désormais `wing` avec validation par énumération ; **tout abandon doit laisser une trace** (une entrée warn pour appariement d'ids raté, une pour valeur illégale), et le `catch` mort qui ne se déclenchait jamais a été supprimé.
- **`embedding-state-get` passe de 2,5–3,1 s à la milliseconde.** Il exécutait à chaque appel 6 COUNT sur place, dont deux de la forme `l1_records LEFT JOIN l1_vec … IS NULL` — `l1_vec` est une **table virtuelle vec0 (1024 dimensions)** et sous prédicat ordinaire, elle dégénère en sonde ligne à ligne. Remplacé par une soustraction « total − déjà embarqués − skip » (mesuré : L1 55 ms → 0 ms, L0 371 ms → 3 ms), plus un **cache TTL hiérarchisé** (1 s en activité / 30 s au repos + invalidation explicite à la fin de reconstruction/bascule/complétion).
- **La partie mécanique du recalibrage ne charge plus tout d'un bloc** `l1.all()`. Passage à la pagination par curseur + seules les colonnes `id/type/metadata` (`getAllL1Lite`), avec cession de main après chaque lot de 200 ; le réécrit passe par `patchL1Metadata` (**seul le metadata est touché, le corps jamais**, épinglé par test).

### Ajouts

- **Couche Room : classification auto-croissante par étiquettes.** Dans les cinq couches de MemPalace, Room se situe sous les Wing/halls cognitifs et se **dérive dynamiquement** de `metadata.tags` (agrégat `json_each`, zéro schéma, zéro registre) — dès qu'une nouvelle étiquette entre en base, elle devient un nouveau Room. Nouvel endpoint `rooms-get` et bloc de classification Room du panneau des enregistrements (un clic filtre par cette étiquette ; `list-records` gagne un canal de filtrage par `tag`). Constaté sur la machine : **78 Rooms** (agrégat en 2 ms).
- **Module de validation partagé `src/metadata-validators.ts`** : `isWingId` / `isCognitiveHall` / `isTag` / `normTags` centralisés en un seul endroit. Jusqu'ici le côté Wing était **totalement dépourvu de validation** (n'importe quelle chaîne non vide pouvait s'écrire dans `metadata.hall`) alors que le côté halls cognitifs disposait d'un `isCognitiveHall()` strict — cette asymétrie d'énumérations était un trou d'intégrité de données.
- **Isolement du worker de traitement d'arrière-plan (tranche étroite de B)** : extraction d'une frontière `MemoryBackend`, les accès SQLite du traitement par lots d'arrière-plan (rumination/remplissage/recalibrage) migrent dans `worker_threads` et n'occupent plus la boucle d'événements principale de l'hôte ; si le worker ne démarre pas, retour automatique intra-processus avec warn (**l'échec de l'isolement ne doit jamais invalider le traitement d'arrière-plan**). Les chemins chauds (rappel/capture) ne bougent pas d'une ligne — ils interrogent la base à chaque tour, la mise en thread leur ferait payer l'IPC.
- **Progression des lots distinguée par segment** : inspection mécanique / attribution des Wing / extraction des étiquettes ont chacun leur label et leur progression de lot propre (avant, `sub` n'était alimenté que pendant la phase LLM ; pendant les 1439 réécritures de la phase mécanique, le panneau restait entièrement vide).

### Changements

- La réécriture du metadata du recalibrage passe de `l1.upsert` à `patchMetadata`. **Ne toucher que le metadata n'aurait jamais dû recalculer l'embedding** — jusqu'ici chaque réécriture d'enregistrement déclenchait un embedding, un seul recalibrage pouvait gaspiller jusqu'à 900 appels d'embedding.


## [0.12.0] — 2026-09-17

### Ajouts

- **Reconstruction manuelle de l'index vectoriel (endpoint `dsh-memory/embedding-reindex` + bloc « index vectoriel » de la page de paramètres)**. Jusqu'ici la reconstruction n'avait que deux chemins : la chaîne de détection de changements du `db.init` au démarrage, et le complément des manquants du backfill périodique — **l'utilisateur n'avait aucune entrée manuelle**. Dans la page de paramètres, on ne voyait que « Annuler » (et encore, seulement pendant une reconstruction en cours), jamais de « Démarrer », ni combien étaient déjà embarqués ou manquaient. Voici le rattrapage :
  - **Face des endpoints 31 → 32**. Nouveau `EmbeddingReindexStartResponse` (`{accepted:true}`), **retour dès acceptation, la progression ne passe pas ici** — le client continue de sonder le champ `reindex` de `embedding-state-get`. Deux sémantiques de progression qui se contredisaient, c'était l'accident assuré : on n'en garde volontairement qu'une. Les trois listes (table de correspondance de `contract.ts` / whitelist `MEMORY_ENDPOINTS` de `stats.ts` / `case` de distribution) et l'assertion du total d'endpoints sont synchronisées ; omettre l'une de ces quatre mises à jour et l'endpoint renvoie 404 à perpétuité, pendant que le `catch` du `rpc` client avale l'exception en silence et fait disparaître le panneau d'un bloc.
  - **`EmbeddingStateView` gagne `vectors`** : pour L1 / L0 séparément, `embedded` / `total` / `missing` / `skipped`. D'où vient « X embarqués / Y au total ». Le **sentinelle `-1` de la couche db est transmis tel quel** — « la capacité vectorielle est indisponible » et « pas un seul embarqué » doivent être deux phrases différentes à l'écran ; plier ces deux messages en un seul chiffre, et l'utilisateur se mettrait à cliquer sur un bouton qui ne réagira jamais.

### Corrections

- **Refuser les demandes de reconstruction « acceptées mais qui ne tourneront jamais »**. La première ligne de `L1Store.reindex` / `L0Store.reindex` **court-circuitait en silence** en `0/0/0` quand la capacité vectorielle n'était pas prête. Sans seuil à l'entrée, l'UI aurait affiché « reconstruction terminée, zéro à compléter » — alors qu'en vérité **rien n'avait commencé**. Ce piège était commenté dès `src/index.ts:240`, mais cela ne couvrait que la chaîne de démarrage ; l'entrée manuelle était une brèche neuve. `startReindex()` place désormais les cinq seuils en amont, chacun avec un message **actionnable** : plugin désinstallé / reconstruction déjà en cours / bascule de source d'embedding en cours / **source d'embedding éteinte** (`currentInfo` vide) / **service d'embedding pas prêt** (« d'abord activer » et « encore patienter » sont deux phrases différentes, on ne les fusionne pas). Pour ce faire, les deux stores reçoivent un accesseur `vectorsReady()` — le `helper` est privé, l'extérieur ne pouvait pas demander.
- **Le bouchon `db` de `embedding-subsystem.test.ts` était incomplet.** Il n'avait que `swapProvider` / `markEmbeddingSynced` et contournait la vérification de types par `as never`, donc rien ne l'avait jamais détecté ; dès que `snapshot()` a commencé à joindre les compteurs vectoriels, il a explosé (`getVecSkipSet is not a function`). **Compléter le bouchon plutôt que rendre `vectorCounts` défensif** : la signature de type déclare un `MemoryDb` complet ; avaler les méthodes manquantes, c'est aussi cacher les vraies erreurs de câblage.

### Tests

- 5 nouveaux cas : refus en état éteint / refus si pas prêt / acceptation puis pilotage L1+L0 avec rejet immédiat d'une seconde demande concurrente / refus après désinstallation / critères de comptage de `snapshot`. **Chaque chemin de refus affirme à la fois « l'exception levée » et « aucun appel aval »** — en n'affirmant que l'exception, une implémentation qui « appellerait d'abord l'aval puis lèverait » passerait quand même.
- **Contre-preuve** : en retirant temporairement la garde de préparation, `capacité vectorielle non prête → refus, sans mentir « accepté »` rougit bien (`expected [Function] to throw an error`) ; reverdi au rétablissement.
- Ensemble **39 fichiers / 403 cas** au vert ; `typecheck` (trois tsconfig), `build`, `smoke` au vert également.

## [0.11.0] — 2026-09-13

### Compatibilité (adaptée selon la documentation du framework de plugins DSH)

- **Compatibilité multi-versions de l'enregistrement settings (0.1.1-rc.2 ~ 0.1.5-rc.2)**. `src/settings.ts` **importait en valeur** `settingsNamespace()` depuis `@deepseek-ai/dsh-settings`, symbole supprimé dès v0.1.3+ — sur un hôte 0.1.3+, le chargement du module levait `Failed to load plugins` et entraînait tout l'arbre de plugins dans sa chute. Maintenant :
  - le namespace devient le littéral chaîne `'dsh-memory'` (la moitié navigateur ne regarde que la chaîne brute, équivalent entre hôtes anciens et nouveaux) ; seul l'import de types est conservé (effacé à la compilation, aucun risque au chargement) ;
  - l'enregistrement passe par trois branches runtime : priorité à `settings.register()` (présent sur toutes les versions cibles, renvoie un scope get/watch/update, interrupteurs live et écritures UI passent tous par là) ; repli sur le pont `settings.installSection()` (surface de service v0.1.2+, seulement si register manque ; les écritures runtime lèvent une erreur métier explicite) ; si rien des deux, dégradation en mode toujours actif — la règle d'or « un settings absent ne doit jamais faire tomber l'hôte » reste intangible ;
  - `SettingsScope` devient un type structurel local, plus aucune dépendance aux exports de types du paquet.
- **Nouveau `dsh.plugin.json`** (manifeste de découverte DSH : id / engines.dsh `>=0.1.1-rc.2 <0.2.0-0` / components pointant vers `dist/`), aligné sur la structure standard de `dsh-plugin-template`.
- **`@deepseek-ai/dsh-*` passés en peerDependencies optionnelles et plages assouplies** (`^0.1.1-rc.2 || ^0.1.2-rc.1 || ^0.1.3-rc.1 || ^0.1.5-rc.2`), `@deepseek-ai/cordis` reste obligatoire — aligné sur l'exigence B.3 de la soumission awesome-dsh-plugin.
- **Nouveau `screenshots.json`** (8 captures, référençant `assets/img/`), la carte de soumission peut s'afficher.

### Changements

- `package.json` `version` passe à 0.11.0 ; npm `files` gagne `dsh.plugin.json` (`screenshots.json`, par convention de détection awesome-dsh-plugin, ne vit que dans le dépôt git, pas dans le paquet npm).

### À tester sur le terrain

- Sur v0.1.5-rc.2, la sémantique des slots `conversation.input.left` / `settings.section` et de `session.surface.nodes` de Session V3 (estimation d'occupation) n'est pas encore testée en conditions réelles, voir la matrice de compatibilité du README.

## [Non publié]

> 📘 **Manuel des pièges et des remèdes** : les pièges réellement rencontrés au cours de ce tour et des deux précédents, et les directions prises à tort, sont systématiquement consignés dans
> [`ENGINEERING-NOTES.md`](./ENGINEERING-NOTES.md) (une page de consultation rapide + par entrée « symptôme / cause racine / bonne pratique / comment vérifier »
> + liste de vérification avant livraison). Au programme : `nullable` qui fait s'écrouler tout l'arbre de plugins, deps non injectées masquées par une branche de repli,
> parseurs dupliqués condamnés à pourrir, garde posée dans un `finally` équivalente à ne pas en poser, longue tâche sans `running` donc interface sans progression,
> champ optionnel qui empêche `tsc` d'attraper l'identifiant non défini, tests à données vides qui masquent un défaut fatal, `vitest` qui ne fait que transpiler et laisse le contrat dériver,
> `spawn EPERM` de la sandbox (et pourquoi `ESBUILD_BINARY_PATH` n'y change rien), capture PowerShell qui réduit les erreurs `tsc` à zéro,
> encodages BOM/caractères corrompus/décalage de numéros de ligne, et pièges Git comme `git amend -m` qui vide le corps du commit.

### Ajouts

- **§E Périmètre de stockage `scope` (visibilité, orthogonal à `family`)**. Jusqu'ici tous les projets partageaient une seule base de mémoire : les souvenirs de la famille `work` déposés par le projet A étaient rappelés jusque dans les sessions du projet B. Nouvelle configuration `scope` (`global` par défaut / `workspace`), **orthogonale** au `family` existant (type de contenu) — `family` demande « quel est ce contenu », `scope` demande « dans quel périmètre doit-il être visible » ; les quatre quadrants existent. « En mode `workspace`, isoler la famille `work` par espace de travail, `chat` restant global par défaut » est un **choix de valeurs par défaut, pas une règle dérivée** (les mémoires personnelles doivent traverser les projets ; c'est entre projets que gît la surface de pollution).
  - **Le zéro dérive est constructif, pas comparatif** : dès que `cfg.scope` n'est pas `workspace`, le `scopeFilterOf` unifié renvoie toujours `undefined` (= pas de filtrage) ; aucun point d'appel ne peut donc faire passer par accident un identifiant d'espace de travail. Les déploiements existants (qui ne définissent pas la clé) gardent un comportement **mot pour mot identique** à celui d'avant la modification.
  - **L'isolation se pose au même étage que l'isolation par famille** : pas seulement à la sortie de la recherche — **le rappel des candidats de déduplication** filtre aussi. Le pool de candidats décide des nouvelles déductions ; sans filtrage, des mémoires croisées produiraient « invisibles dans le projet B, mais qui ont déjà décidé du sort des mémoires du projet A » — pire que pas d'isolation du tout ([`ADR-0008`](./docs/adr/0008-storage-scope-vs-family.md)). Le chemin du graphe filtre au même étage selon l'appartenance de **l'enregistrement source** ; les chemins d'écriture (pipeline d'extraction / `memory_add` / `memory_import`) partagent le même `resolveRecordScope`.
  - **L'identité de l'espace de travail prend le cwd canonique, pas le `WorkspaceId` (uuid) du `dsh-workspace` de l'hôte** : même couloir d'en-têtes que le `parentSession` du §A, disponible en synchronie ; déclarer un `inject` ferait échouer tout l'arbre sur un hôte dépourvu du service ; le critère d'appartenance de l'hôte lui-même est « le cwd canonique de l'en-tête de session == chemin de l'espace de travail » ; l'uuid exigerait « un espace de travail enregistré » et l'isolation tomberait en silence dans les répertoires non enregistrés. Limite connue : **les liens symboliques ne sont pas résolus**, la conséquence est une sur-isolation (dans le sens sûr) et non une fuite ([`ADR-0009`](./docs/adr/0009-workspace-identity-source.md)).
  - **La migration n'étiquette que l'appartenance, sans déménagement ni suppression** : `l1_records` / `l1_fts` gagnent chacun les colonnes `scope` + `workspace_id`, les données existantes sont marquées `global` par le `DEFAULT` du `ALTER` — nombre d'entrées, id, content, created_time inchangés au mot près.
  - **Deux vrais problèmes attrapés en cours d'exécution** : ① **la réinjection après reconstruction du FTS, si elle omet le scope, écrase l'isolation en silence** (quand les paramètres de `backfillL1Fts` ne s'alignent pas sur l'insert, c'est avalé par son propre `catch` ligne à ligne ; symptôme : un index vide avec `count=0`) ; ② **le manque de normalisation de forme côté écriture → la mémoire entre en base mais n'en sort plus jamais** (la recherche passe le chemin en minuscules normalisé, l'écriture stocke la majuscule du demandeur telle quelle, le test d'égalité de chaîne ne peut que tomber à l'eau). Les deux attrapés et réparés par tests de bout en bout et sondes de mutation.
- **§F Colonne vectorielle des nœuds du graphe `graph_node_vec` (socle de stockage et de dégradation)**. Le graphe ne disposait jusque-là que d'un score lexical pondéré, sans colonne vectorielle — des entités **sémantiquement équivalentes mais littéralement différentes** comme « cloud深处 » et « DeepRobotics » ne pouvaient se résoudre mutuellement. Nouvelle table virtuelle vec0 **de même schéma** que `l1_vec` (même encodage, même déclaration `float[N] distance_metric=cosine`), dont la dimension **réutilise** le résultat de détection de capacité existant — pas une seconde tuyauterie.
  - **Dégradation digérée à l'intérieur** : l'absence de vec0 fait lever la création de table ; si l'exception montait jusqu'au `catch` externe de `GraphStore.init`, le graphe passerait de « voie vectorielle indisponible » à « **tout le domaine graphe indisponible** » — recherche lexicale, projection, arbitrage, tout y passerait. La colonne vectorielle porte donc son propre `try/catch` étroit. Aux états désactivés, l'interface répond no-op, l'appelant n'a pas besoin de tester le bit de capacité ([`ADR-0011`](./docs/adr/0011-graph-node-vector-storage-and-degradation.md)).
  - **Cette vague ne livre que la porte, sans producteur ni consommateur** : le pipeline de projection n'est pas encore câblé pour calculer les embeddings. Enregistré honnêtement comme inachevé — c'est le point de départ du §F, pas son achèvement.
- **§B Chaîne de récépissés des décisions L1 (infrastructure de traçabilité)**. Chaque enregistrement L1 de `memory.db` est **le résultat d'une décision de déduplication** (store / update / merge / skip), mais la décision elle-même ne laissait pas de trace — après coup on ne voyait que « le résultat a cette tête », jamais « sur quelle base il avait été rendu ». Nouvelle table `l1_receipts` : chaque décision de déduplication laisse un récépissé (`run_id` / `record_id` / `kind` / **digest sha256 de la séquence ordonnée du pool de candidats** `input_digest` / `decided_at`), avec le nouvel outil **`memory_receipts`** et l'endpoint RPC **`dsh-memory/receipts`** pour la retrace sur deux axes, par enregistrement ou par lot (les deux donnés ensemble font ET). Le récépissé doit exister **avant** l'événement — l'instantané d'entrée **ne peut pas être reconstitué après coup**, donc la capacité est posée en amont, sans déclencheur symptomatique ([`ADR-0006`](./docs/adr/0006-l1-decision-receipts.md)).
  - **Trois partis pris délibérés pour `input_digest`** : **sensible à l'ordre** (le pool est ordonné ; « quels candidats étaient visés et dans quel ordre » est justement l'entrée à reconstituer), **les doublons ne sont pas pliés** (les doublons du pool sont eux-mêmes un fait), **encodage avec préfixe de longueur** (sinon `['a|b']` et `['a','b']` entreraient en collision — si la sérialisation n'est pas injective, le digest perd sa valeur d'empreinte).
  - **Politique de rétention** : élagage par **nombre de runs** (`RECEIPTS_MAX_RUNS = 1000`) — une fenêtre temporelle **ne donne aucune borne au nombre de lignes** (le seuil est indépendant du débit d'écriture ; un usager intensif peut écrire autant de lignes qu'il veut en 90 jours, la croissance illimitée n'est que **repoussée**) ; la granularité de l'élagage est le run, pas la ligne — élaguer par ligne découperait des « demi-lots » et ferait répondre à « que-t-on jugé ce tour-là » une conclusion **apparemment complète mais en réalité trouée**, dommage **supérieur** à « introuvable ».
  - **Ligne rouge** : l'élagage **ne touche que `l1_receipts`, jamais `l1_records`** — la première est une donnée d'observation jetable, la seconde la source de vérité de l'utilisateur ; rogner la mémoire elle-même pour économiser quelques Mo, c'est transformer une optimisation de capacité en perte de données.
  - **Isolement des échecs** : le récépissé est une infrastructure de contournement ; son échec d'écriture se contente d'un `warn` et **n'interrompt jamais la distillation L1**.

- **§C Gel des contradictions (optionnel, désactivé par défaut)**. Jusque-là le **vocabulaire de décision** de la déduplication ne comptait que `store` / `update` / `merge` / `skip` — le « détecteur de conflits » (`CONFLICT_DETECTION_SYSTEM_PROMPT`) repérait la contradiction puis **le LLM tranchait et écrivait directement** (`update` pour écraser ou `merge` pour fondre), **sans option « s'arrêter et attendre l'arbitrage humain »**. Avec `conflictFreeze.enabled`, le vocabulaire gagne l'action `conflict` : quand le LLM juge que « les deux semblent vrais et que la machine ne peut pas trancher », la paire conflictuelle est **parquée** dans la file `conflict_pending` — **la nouvelle mémoire entre normalement en base, le contenu des deux parties reste intact**, et le nouvel outil **`memory_resolve_conflict`** (RPC : `dsh-memory/conflict-resolve`) remet l'arbitrage à la personne, conclusions `winner` / `loser` / `both`.
  - **Le gel n'est pas « bloquer l'écriture », c'est « ne pas trancher automatiquement »** — l'implémenter comme la première aurait fait perdre de l'information, pire que le problème qu'il prétend résoudre.
  - **Soupape de sûreté** : `maxPending` (limite de file) / `timeoutDays` (dégradation par expiration). La sémantique est « **ne plus en accepter** » et non « supprimer en catimini les anciens » : les paires automatiquement soldées **restent consignées dans la file**, avec `resolution` noté `auto` pour les distinguer des conclusions humaines. Sans soupape, deux conséquences certaines : croissance sans borne de la file ; « deux mémoires contradictoires rappelées côte à côte » pour toujours en base.
  - **Côté graphe** : les nœuds de graphe touchés par les sources d'un enregistrement gelé sont marqués `disputed` (état existant réutilisé ; il reste dans les candidats de recherche : un état intermédiaire « rappelé comme d'habitude, mais visible »). Ce marquage est une **synchronisation dérivée** et non un tampon unidirectionnel — l'arbitrage **lève** le litige ; un marquage à sens unique laisserait des nœuds déjà arbitrés bloqués sur `disputed`, et ce serait **le graphe dérivé qui mentirait**.
  - **Zéro dérive** : à l'état éteint, le prompt de déduplication est **octet pour octet identique** à celui d'avant — garantie **constructive** (l'état éteint fait directement `return base`), pas une comparaison manuelle ([`ADR-0010`](./docs/adr/0010-conflict-freeze-default-off-and-timeout.md)).

### Changements

- **Nouvelles configurations** `conflictFreeze.enabled` (désactivé par défaut) / `conflictFreeze.maxPending` (100) / `conflictFreeze.timeoutDays` (30, `0` = pas de dégradation par expiration) ; **nouveaux endpoints** `dsh-memory/receipts` et `dsh-memory/conflict-resolve` (face des endpoints 26 → 28).
- **`L1ReceiptKind` gagne `conflict`**. Quand on étend un vocabulaire, il faut vérifier **tous les endroits qui le consomment** (normalisation des récépissés, journaux de statistiques, textes de rendu, descriptions de schéma) — constaté en pratique : une omission de registre consignerait « le modèle **a dit expressément** ne pas pouvoir trancher » comme `skip_missing` (= « le modèle **n'a pas répondu »), alors que toute l'auditabilité de l'arbitrage du §C repose sur la chaîne de récépissés — la conclusion de l'audit serait **exactement l'inverse du fait** (pire que l'absence d'un récépissé : absent veut dire « introuvable », faux veut dire « trouvé mais erroné »).
- **`GraphStore.markSourcesDisputed` (tampon unidirectionnel) → `syncDisputed` (synchronisation dérivée)** : `active` et sources touchées → `disputed` ; `disputed` et sources ne touchant plus → retour à `active` ; les pierres tombales `archived` ne bougent pas. Le pipeline transmet **l'ensemble des enregistrements des paires non arbitrées du moment**, et non la seule paire neuve du tour.
- **Ordre de l'arbitrage délibéré** : poser d'abord `resolved_at`, retirer ensuite de scène le perdant — dans l'ordre inverse, « l'enregistrement a disparu mais la file montre encore la paire en attente » exigerait un second clic pour s'en apercevoir ; le marquage utilise `WHERE resolved_at = ''`, **un second arbitrage n'écrase pas la première conclusion**.

### Tests

- **§B : 5 nouveaux fichiers de test** (création de table et digest des récépissés, points d'écriture et isolement des échecs, politique de rétention, requêtes à deux axes, retrace de bout en bout), dont une **sonde de mutation** : remplacer la table élaguée par `l1_records` fait bien échouer le cas de la ligne rouge.
- **§C : 7 nouveaux fichiers de test** (vocabulaire / création de table / interrupteur / sémantique du gel / soupape / arbitrage / boucle fermée), tous passés par TDD avec observation du RED d'abord. Trois critères **discriminants** méritent mention : `version===0` (distinguer la sémantique store de celle de merge/update), capturer en bout en bout le prompt réellement envoyé par le pipeline (une fonction statique toute verte **ne prouve pas** que le pipeline transmet l'interrupteur), et la mutation de la branche `both` qui fait rougir le cas.
- Total **34 fichiers / 341 cas** ; chaîne CI en sept pas (`typecheck` / `test` / `lint` / `build` / `build:smoke` / `smoke` / `verify-catalog`) toute verte.
- Boucle fermée consignée sur pièces : deux vrais `runExtraction` (seule la couche de transport LLM est bouchonnée) → vrai endpoint d'arbitrage, JSON brut archivé dans `evidence/` du domaine de planification.

### Corrections

- **Les actions non reconnues étaient capturées en silence par la branche de repli.** La boucle d'application de `pipeline/l1.ts` ne branchait explicitement que `store` / `skip`, **tout le reste tombait dans la branche update/merge**. Les décisions conflict ne portent pas de `target_ids` par conception, donc `targets=[]` → l'enregistrement était ajouté comme produit d'une fusion « ayant remplacé 0 entrée », et `version` calculé à `1`. **Ni erreur, ni perte : seule trace, un chiffre de version** — autrement dit « conflict dégradé silencieusement en merge/update », précisément le comportement que le §C devait éradiquer. **Remède** : branche `conflict` explicite ; en cas de validation manquante ou d'interrupteur éteint, **retour à `store`**, jamais à la branche de repli.
- **Le gardien des endpoints était une copie recopiée à la main.** Le `ENDPOINTS` de `tests/contract-keys.test.ts` est une **copie manuscrite** du vrai registre (`MEMORY_ENDPOINTS` de `src/stats.ts`) ; ses deux assertions n'étaient cohérentes qu'avec cette copie (`ENDPOINTS.length === 26`). Quand le §B a fait monter le vrai registre à 27 avec `dsh-memory/receipts`, la copie **n'a pas suivi**, tandis que l'assertion de comptage restait à 26 — et « l'assertion s'accorde à la copie, la copie ne s'accorde pas aux faits » est passé **tout vert d'un bout à l'autre** ; après l'ajout de `conflict-resolve` ce tour-ci, **toujours tout vert**. Le gardien testait sa propre ombre : changez le système testé, il ne rougira jamais. **Remède** : nouvelle assertion `expect([...ENDPOINTS].sort()).toEqual([...MEMORY_ENDPOINTS].sort())` — la liste locale doit coïncider **entrée par entrée** avec l'unique source de vérité ; l'assertion de comptage reste comme jalon explicite au moment des changements.

- **Arbre de plugins au tapis : le schéma de sortie des outils utilisait le mot-clé `nullable`, non supporté par le DSL** (correctif de régression, DSH devenait totalement incapable de démarrer). Les schémas de sortie de `memory_ruminate` et `memory_ruminate_status` déclaraient `nullable: true` sur `startedAt`/`finishedAt`/`error`, alors que le DSL de value schema de DSH n'accepte qu'un jeu en liste blanche de clés d'auteur (`description`/`title`/`default`/`examples`/`required`/`enum`/`const` et, par type, `type`/`properties`/`additionalProperties`/`items`/`oneOf`). À la compilation du schéma par `defineTool()`, levée de `JsonSchemaError: schema.properties.startedAt.nullable is not supported by the value schema DSL`, le loader a jugé l'entrée `dsh-memory (dsh-prime-memory)` non chargeable, l'application de tout l'arbre s'est arrêtée et le processus est sorti sur exception non attrapée.
  **Remède** : suppression des 4 `nullable: true`. Sémantique inchangée — dans ce DSL, une propriété est facultative par défaut ; seul `required: true` explicite rend obligatoire ; et la validation runtime ignore `undefined`, donc le `startedAt: undefined` renvoyé par `execute` reste légal. Vérification : `tsc` passe + plus aucune occurrence dans les artefacts dist + nouveau cas de régression d'enregistrement des outils.
- **Endpoints RPC de rumination tous inatteignables : le contrôleur n'a jamais reçu ses deps d'endpoint.** `dsh-memory/ruminate-status` renvoyait toujours `{supported:false,running:false,phase:'idle'}`, `ruminate-start`/`ruminate-cancel` levaient toujours « contrôleur de rumination non initialisé ». Cause racine : `EndpointDeps.ruminate` était bien déclaré et les trois implémentations d'endpoint bien écrites, mais `registerMemoryRpc`, en assemblant les arguments de deps, n'injectait pas le contrôleur — `deps.ruminate` restait `undefined` et les endpoints restaient épinglés à la branche de dégradation.
  **Impact visible pour l'utilisateur** : le panneau de rumination (`RuminatePanel.tsx`) fait un `return null` intégral dès `supported === false`, donc il se présentait comme « fonctionnalité inexistante » plutôt que comme une erreur — d'où une panne passée inaperçue très longtemps ; après correction, le panneau se rend pour la première fois.
  **Remède** : l'assemblage des deps est extrait en couture testable `buildEndpointDeps()` (unique propriétaire), qui écrit explicitement le contrôleur dans le champ `ruminate` ; `rebuild`/`embedManager`/`sessionInfo` empruntent désormais exactement le même couloir d'injection que `ruminate`, plus aucun paramètre positionnel de rechange.
  **Vérification** : après injection d'un stub, `dsh-memory/ruminate-status` renvoie `supported !== false`.

- **La rumination plantait à tous les coups : `pending.json` était parsé deux fois sans déballer `buckets`, `TypeError: messages is not iterable`**. Le `RuminateController.start()` passait `JSON.parse(readFileSync(file))` par son propre `readPendingBuckets()` et l'affirmait directement comme `PendingBuckets` (`{auto,chat,work}`), alors que la vraie forme disque est `PendingFile` (`{version,buckets:{auto,chat,work},warmup}`) — **il manquait le déballage d'un niveau `buckets`**, donc `buckets[mode]` restait `undefined` et la boucle `for (const m of messages)` de `groupPendingBySession` levait.
  **Impact visible** : **cette fonctionnalité n'a jamais réussi une seule fois**. L'erreur ne passait par le `catch` (repli en seaux vides) que si « le fichier n'existait pas » ; or `persistPending` écrit ce fichier à chaque tour, donc dans tout déploiement réel ayant un tampon, cliquer sur Ruminate plantait à coup sûr, panneau en rouge. **À noter, contre-intuitif** : lever ou non n'a **rien à voir** avec le contenu des seaux — des seaux vides levaient pareil ; l'ancienne conclusion « trois seaux vides, c'est pourquoi rien ne s'est vu » était fausse : la vraie raison est que la rumination n'a jamais été déclenchée (`memory.log` ne porte aucun `反刍开始`).
  **Remède** : suppression de `readPendingBuckets()` et `readFileSync`, remplacés par le `loadPending()` de `store/pending.ts` — l'**unique autorité** de la forme des seaux, qui apporte gratuitement la validation de forme, la vérification `Array.isArray` par seau, le comptage des lignes corrompues `isMessage` jetées, le regroupement de l'ancien format `LEGACY_SESSION` et la validation de `warmup`. **Pas de seconde entrée dans `pending.ts`** (c'est précisément la cause du défaut : deux chemins d'implémentation pour la même sémantique, dont un qui pourrit sans que personne ne le voie).
  **Vérification** : nouveau cas au niveau du contrôleur, rouge puis vert (rouge : `TypeError: messages is not iterable` @ `pending.ts:104` ← `ruminate.ts:75` ← `:139` ; vert : `total` == nombre de groupes de sessions, `mode` déduit des clés de seaux) ; `dist/pipeline/ruminate.js` ne contient plus `readPendingBuckets`.
- **Après un échec de rumination, l'état et l'interface se contredisaient.** Le chemin d'échec n'écrivait jamais `this.status` (l'original `:149-155` n'assignait que sur le chemin du succès), donc `ruminate-status` continuait de renvoyer `phase:'idle'`/`error:null` et la branche `failed` de l'UI ne s'allumait jamais — l'utilisateur voyait l'erreur en rouge, l'endpoint d'état assurait que tout allait bien. **Remède** : dans le `catch`, écriture de `phase:'failed'` et `error`, avec `logger.warn` avant relance.
- **Progrès et production de la rumination toujours à zéro, impossible de juger de l'effet des corrections.** `totalL1` n'était que déclaré/remis à zéro/lu, **jamais incrémenté** ; `status.done` n'avait aucun point d'incrémentation, donc `recordsBuilt` restait à `0` et le journal de fin disait toujours `0/N sessions, 0 enregistrements produits`. **Remède** : `PipelineTask` gagne un rappel de complétion `onDone` (appelé dans `drain`, une exception du rappel n'affecte pas le pipeline), `enqueue` expose `onTurnDone`, la rumination y cumule le vrai nombre d'enregistrements ; `doEnqueue` pose `status.done = index` à la fin.
- **Trois points d'échec silencieux** : le `catch` de `loadPending` et le `.catch(() => {})` de `doLightRefresh` compressaient « fichier inexistant (normal) », « illisible/corrompu (à alerter) » et « forme non conforme (à alerter) » en une même dégradation silencieuse, indiscernable dans les journaux et l'état du « rafraîchissement léger d'un pending vide légitime » — l'utilisateur voyait `phase:'done'` et croyait au succès. **Remède** : `loadPending` distingue `ENOENT` (silence) du reste (`warn` avec chemin du fichier et motif), forme non conforme en `warn` aussi ; `doLightRefresh` passe en `await` et **ne remet le drapeau à zéro qu'après succès** (avant, il le remettait même en échec — on avalait ainsi la chance de réessayer).
- **Pendant le « rafraîchissement léger » de la rumination : mensonge sur l'inactivité, ni progrès, ni annulation** (remontée de terrain réelle). `start()` faisait `return await this.doLightRefresh()` quand aucune tranche n'était en attente, et cette branche **ne posait jamais `running`** — pendant ce temps, `ruminate-status` continuait de répondre `phase:'idle'`/`running:false`. Or le L2/L3 ici est un **vrai appel LLM** (70 secondes et plus, constaté) ; `start()` restait suspendu sur l'await, occupant la garde.
  **Impact visible** : après le clic, l'interface n'affichait qu'une phrase statique, **sans barre de progrès, sans bouton d'annulation, sans phase, sans durée** ; recliquer donnait « la rumination est déjà en cours » — exact mais sans aucune information, impossible de dire si ça tourne ou si c'est figé.
  **Remède** : le rafraîchissement léger **rapporte honnêtement** — enregistre `total` d'après le nombre de familles en attente L2/L3, incrémente `done` étape par étape, et gagne `RuminatePhase='refreshing'` avec un `detail` décrivant l'action en cours (ex. « consolidation de scène L2 (chat) ») ; le journal de fin passe du silence à `rafraîchissement léger terminé : 2/3 étapes, 84 s`. Le panneau affiche le nom de la phase, `effectuées/total (pourcentage)`, la **durée réellement écoulée** et l'action courante, et traite `refreshing` comme état actif.
- **Durée écoulée invisible pendant la rumination** : un appel L2/L3 peut durer des minutes ; afficher seulement « en cours » ne permet pas de distinguer « ça tourne » de « c'est figé ». **Remède** : pendant l'exécution, recalcul et affichage chaque seconde de `écoulé X min Y s`.

### Changements

- **`RuminateStatus` gagne `detail` ; `RuminatePhase` gagne `refreshing`** : observabilité pour les étapes à l'échelle de la minute (rétrocompatible : champ optionnel ajouté + nouveau membre de type union). `detail` donne « session <id> (i/N) » en phase de distillation, et l'action L2/L3 en cours en phase de clôture/rafraîchissement.
- **`DshMemoryRequestMap` complète les trois clés de rumination** (correctif de contrat, rétablit le garde-fou de types en CI) : la table des réponses déclarait depuis longtemps `dsh-memory/ruminate-status|start|cancel`, et `DshMemoryEndpoint = keyof DshMemoryResponseMap` les incluait donc dans le type union des endpoints ; mais **la table des requêtes manquait des trois clés correspondantes** — le `DshMemoryRequestMap[K]` de `client/src/rpc.ts` levait `TS2536`, `tsc -p tsconfig.client.json` échouait en permanence et **le `npm run typecheck` de CI rougissait à coup sûr**. Corrigé en trois lignes `Record<string, never>` de même forme que `rebuild-*` (aucun des trois endpoints ne prend de paramètre). Vérification : les trois tsconfig sortent 0, la chaîne complète de `npm run typecheck` sort 0.
- **L'assemblage des deps de `registerMemoryRpc` extrait en `buildEndpointDeps()`** : couture testable pour « quel contrôleur tombe dans quel champ », avec le type `EndpointDepsInput` pour borner la face d'injection et faire apparaître les oublis d'injection dès la compilation (ce défaut restait jusque-là une dégradation silencieuse à l'exécution). `handleEndpoint` et `EndpointDeps` exportés aussi pour appel direct par les tests.
- **Verrou de démarrage `starting` pour la rumination** : `loadPending` introduit un point de cession de boucle entre la garde et la mise à `status.running`, un double-clic / tir en rafale de RPC peut franchir la garde des deux côtés et les deux `sessions` s'écrasent mutuellement. Nouveau drapeau pour fermer cette fenêtre. **Attention** : ce drapeau se réarme explicitement à la fin de la branche distilling, pas dans un `finally` — car `doEnqueue` met en file en asynchrone et le `finally` lèverait le drapeau aussitôt, désarmant la garde ; la garde persistante à travers les `await` est `status.running`.

### Tests

- Nouveaux « garde-fous d'injection de contrôleur dans les endpoints » de la couche RPC, 5 cas : pour les deux familles `rebuild` et `ruminate`, « assemblé → status/start/cancel atteignables » et « non assemblé → status dégrade, start/cancel renvoient non initialisé », plus la branche de garde de dégradation du stockage de `rebuild-start`. Les deux familles partagent le même patron (contrôleur optionnel + réponse de dégradation + injection de deps) ; `rebuild`, dont l'injection était déjà correcte, sert de témoin pour épingler la forme du patron. Cas de test 194 → 199.
- Nouveau `tests/ruminate.test.ts`, 5 cas, épinglant **le vrai chemin de lecture du contrôleur**, contrat jusque-là à couverture nulle : trois seaux avec de vrais messages → pas d'exception et `total`/`mode` corrects ; JSON de forme disque écrit à la main (**sans aller-retour `savePending`**, pour éviter que les deux côtés se trompent de conserve et passent) ; trois seaux vides → rafraîchissement léger ; fichier absent → rafraîchissement léger (ENOENT, chemin normal) ; `start()` concurrents, un seul passe. Cas de test 199 → 204.
- **Nettoyage au passage des 10 erreurs de lint préexistantes de `tests/`** (imports/variables inutilisés, `require()` en imports ESM de tête, conditions toujours vraies), pour que `lint` puisse englober `tests`. **Jusque-là, le répertoire de tests vivait entièrement hors du lint.**
- **`npm test` et `npm run lint` raccordés à CI pour la première fois** : `.github/workflows/ci.yml` ne tournait que `typecheck → build → build:smoke → smoke → verify-catalog` et **ne lançait jamais les tests** — autant ne pas les avoir écrits. Le garde-fou est maintenant en place.

### Limites connues

- **Le garde-fou de types de `tests/` n'est que partiellement ouvert (ratchet)** : nouveau `tsconfig.test.json` intégré à `npm run typecheck`, mais comme 8 fichiers de tests existants portent environ 60 erreurs de types (`MemoryConfig` déplacé, `DistillBudgets` sans `graph`, `UserMessage.turn`, affectation de tableaux en lecture seule, `as` nus en masse dans `rpc.test.ts` etc.), seuls `tests/ruminate.test.ts` et `tests/stores.test.ts` sont inclus pour l'instant. Voir `pending-issues.md` P8 — **ce constat traduit que les tests ont dérivé des contrats de types et que vitest ne fait que transpiler sans vérifier, d'où un tout-vert à l'exécution que personne ne remarquait**.
- **La rumination souffre d'une double source de vérité disque/mémoire** : la liste des sessions vient du `pending.json` disque, mais l'extraction réelle, dans `runner.ts:667`, prend les messages dans les **seaux mémoire** par `sessionId` — donc le `session.messages` passé n'influence pas le résultat. Dans la fenêtre, distillations manquées ou tours à vide possibles (`total` gonflé). Remède suggéré : exposer par le runner une vue mémoire en lecture seule, voir `pending-issues.md` P9.
- **Course à la clôture de la rumination** : la chaîne de `setImmediate` n'attend pas que la file se vide, une seule session déclenche aussi un `finalize` immédiat, faisant courir L2/L3 pour rien sur du L1 périmé (les enregistrements sont complétés ensuite par `l1.ts:264`, **pas perdus**). Voir `pending-issues.md` P10.
- **Un appel LLM en cours de rumination ne peut pas être interrompu** : « annuler » ne s'arrête qu'**après l'étape en cours**. Un L2/L3 peut durer des minutes ; voilà l'origine du délai d'annulation.

## [0.10.0] — 2026-09-06

### Ajouts

- **Projection en graphe de connaissances** (projection reconstruisible de L1, répond à « quel est l'état actuel des personnes/projets/organisations/outils/lieux ») : les enregistrements produits par la distillation L1 sont donnés par lots au modèle qui propose entités et relations orientées ; `applyGraphProjection` valide en dur avant écriture — **zéro fait sans provenance** : les `sourceRecordIds` de chaque nœud/fact/arc doivent tous appartenir aux enregistrements réclamés par le lot, toute proposition hors lot est jetée en silence, et toute conclusion du graphe se retrace par `nœud → sourceRecordIds → enregistrements L1 → source de vérité JSONL`. Désambiguïsation des entités (normalisation NFKC + fusion par cohérence de type, accumulation d'alias), historique d'état (supersede + clôture par validTo, `currentState` reconstruit uniquement à partir des faits actifs), chaîne d'ancrage temporel à quatre étages (`activity_start_time → activity_end_time → timestamps → createdAt`, sans preuve, pas de date devinée). Les tables du graphe peuvent être droppées et refaites à tout moment, elles ne servent pas de source de vérité.
- **File de tâches de projection** (GraphStore, dégradation indépendante : un échec d'initialisation ne rend le graphe que no-op, sans contaminer le stockage principal) : état de job persisté en machine à états pending → running → completed/dead, déduplication poussée dans le SQL (mapping en vol + registre de projection, deux tables d'index, sans balayage complet des jobs) ; pas d'inversion de priorité (nouvelle distillation 10000 > rattrapage du stock 100) ; plafond d'attempts puis passage en dead, `nextAttemptAt` à back-off exponentiel, récupération au démarrage running→pending ; après `deleteL1Batch`, propagation des suppressions (nœuds/arcs dont les sources sont toutes invalides marqués paresseusement archived). Les appels LLM n'entrent jamais dans une transaction (claim et complete sont deux coutures de transaction ; complete commite atomiquement en une seule).
- **Recherche dans le graphe et outils** : recherche pondérée par champs (name×6/aliases×5/tags×5/currentState×4/facts×4/relations×3/type×2), filtrage du bruit d'adjacence quand seuls les mots de relations frappent, sortie explicable avec `matchedFields` + `matchReason` en chinois ; nouveaux outils `memory_search_graph` (cartes de nœuds compactes) et `memory_expand_graph_node` (facts au complet avec historique + arcs de relations), soumis au même refus de lecture par mode/injection que `memory_search`, et filtrés par famille de session (le mode pur ne voit que les nœuds dérivés de sa famille).
- **Endpoints RPC 24 → 26** : `dsh-memory/graph-search` (recherche) et `dsh-memory/graph-node-get` (développement du détail ; un id suspendu renvoie `node=null` sans lever) ; contrat à source de vérité unique synchronisé, la face d'appels génériques du client obtient les types des nouveaux endpoints sans aucune modification.
- **Élargissement des clés de budget** : `DistillBudgets` gagne la clé `graph` (défaut 8000, ligne graphe de la page de paramètres éditable) ; `layerKeyFor('graph')` revient explicitement à la résolution globale, jamais dans la chaîne de couche l1 ; les coûts de la projection du graphe entrent dans le total et le groupement par modèle, mais pas dans la table stratifiée l1→l2→l3 ni dans les tendances (exemption de contournement).

### Changements

- **Nouvelle configuration** : `config.graph.enabled` (niveau déploiement, **false** par défaut — même ouverte, l'interrupteur runtime de distillation doit aussi être vrai ; garde-fou de la pompe : au plus une tâche graphe par drain, en cédant toujours la priorité aux tours de distillation en temps réel).
- Version du plugin 0.9.0 → 0.10.0 (changement de la face des endpoints).

## [0.9.0] — 2026-09-01

### Ajouts

- **Couloir de classification grossière Hall** : face d'attributs grossiers orthogonale à `family`/`type`. `types.ts` définit `HALL_CATALOG` (source de vérité unique : ligne principale `work`/`relationships`/`general` activées par défaut, `finance`/`journey` expérimentaux marqués `experimental`) ; `config.hall.enabled` décide des Halls qui participent au marquage. À la phase d'extraction L1, `metadata.hall` est étiqueté automatiquement selon la liste activée (si la classification n'est pas sûre, le champ est omis, sans forcer General) ; le contrat `ListRecordsRequest.hall` et `UiRecord.hall` est étendu, le navigateur de mémoires gagne un menu déroulant de filtrage par Hall et les cartes un badge Hall.
- **Surcharge runtime de l'embedding distant** : `baseUrl`/`apiKey`/`model`/`dimensions` de l'embedding deviennent **éditables dans la page de paramètres**, surchargeant à runtime le YAML de déploiement (`effectiveCfg` injecte le sous-arbre `cfg.embedding`, indépendamment du couloir llm) ; `EmbeddingManager` gagne `getEff()` qui lit la configuration effective après surcharge runtime, pour que l'édition sur la page prenne effet immédiatement.
- **Outils d'écriture-suppression à hauts privilèges** : enregistrement de `memory_add` (« retiens X » explicite → écrit directement une entrée L1 en base, `hall` optionnel) et de `memory_delete` (suppression après hit de recherche sémantique, au plus 10 entrées), tous deux sous la barrière `live.memoryMutate` (mode hauts privilèges de la page de paramètres) ; le navigateur de mémoires gagne un interrupteur hauts privilèges (avec double confirmation) et un bouton de suppression unitaire.
- **Documentation multilingue** (alignée sur `multilingual-docs-skill`) : `README`/`INSTALL`/`CHANGELOG` couverts en `zh`/`en`/`ja`/`ko`, interliens de bascule de langue en tête de chaque page (écrits dans la langue maternelle), pages `ja`/`ko` accompagnées d'une note de compatibilité DSH.
- **Chaîne d'outils** : branchement d'ESLint 9 en configuration plate et de Vitest, nouveaux `npm run lint`/`npm run test`, plus une première fournée de tests unitaires pour `HALL_CATALOG` et le prompt d'extraction Hall.

### Changements

- **`apiKey` de l'embedding distant devient optionnel** : acceptation des services `/embeddings` auto-hébergés sans clé (`remoteCeiling` n'exige plus `apiKey`) ; sans clé, l'en-tête `authorization` n'est pas injecté, pour éviter qu'un `Bearer` vide ne soit refusé.

### Corrections

- L'embedding distant n'envoie plus d'en-tête `Bearer` vide quand `apiKey` est vide.

### Limites connues

- Le point de construction d'`EmbeddingManager` (`src/index.ts`) ne reçoit pas encore `getEff` ; la surcharge runtime ne coule pas encore dans le service d'embedding interne du gestionnaire, raccord à faire plus tard.

## [0.8.11] — 2026-08-29

### Corrections

- **Adaptation mobile du contrôle de mode de session** : pill et sélecteur glissant n'avaient été pensés que pour la mise en page web de bureau — la couche flottante montait en s'articulant autour du centre de la pill, or la pill est à gauche de la barre de saisie : sur un viewport étroit de téléphone, la moitié gauche de la couche se faisait couper par l'écran. La couche fait désormais un clamp horizontal du viewport : mesuré à l'ouverture, si elle est coupée (y compris les décalages de mise en page comme l'ouverture de la barre latérale qui pousse la zone de saisie vers le bord), elle se colle au bord automatiquement ; sur bureau elle est naturellement dans l'écran, zéro changement de comportement ;
  la fermeture par clic extérieur passe de `mousedown` à `pointerdown` (sur iOS, la zone de texte pure ne synthétise pas d'événements mouse, l'ancienne implémentation laissait la couche ouverte sur téléphone) ; les zones de clic de la pill et du rail s'élargissent verticalement selon la norme tactile de 44 px par une zone chaude invisible (visuellement rien ne bouge d'un pixel, géométrie de la couche inchangée, uniforme sur tous les terminaux — sur bureau, la cible cliquée grossit aussi). La logique d'interaction du sélecteur glissant (pose du mode au clic, projection de l'élan de glissement avec aimantation) reste inchangée.

## [0.8.10] — 2026-08-28

### Ajouts

- **« Écriture seule » au niveau session (Issue #38)** : certaines sessions veulent que le système de mémoire « n'accepte que sans rien rendre » — continuer à capturer la conversation et à participer à la distillation, mais n'injecter aucune mémoire dans la session courante. Jusqu'ici le mode off était l'invisibilité totale (capture comprise, tranches en attente suspendues) et l'interrupteur de rappel n'avait que la granularité globale : cette combinaison était inexprimable. Le panneau flottant gagne désormais un **interrupteur « Injection » à trois états (suivre le global / on / off)** : sur « off », la session est en écriture seule — capture L0 et distillation L1→L2→L3 suivent normalement, tandis que l'injection de rappel, les zones stables profil/navigation et le guide d'outils s'arrêtent ensemble ;
  les outils de lecture comme `memory_search` renvoient l'avis d'écriture seule (l'écriture passe par le crochet de capture, pas par les outils : aucune brèche sémantique).
  La face de la pill change avec l'état en `记忆·只写` (l'état d'injection prime à l'écran, le nom de famille se replie dans le rail) ; la surcharge est persistée par session
  et orthogonale au mode (changer de mode ne la perd pas) ; « suivre le global » l'efface ; la combinaison inverse
  « global éteint + session particulière allumée » marche aussi. Chaîne de priorité : plafond de déploiement > interrupteur global > surcharge de session > mode off (l'invisibilité totale
  ne change pas). La raison de désactivation de « résultats de rappel » sur la carte flottante est affinée en même temps (nouvelle cause « session en écriture seule »).
  Convient aux sessions de débogage/évaluation, sensibles/éphémères, d'arrière-plan de longue durée — tout ce qui veut « absorber sans déranger ».

  ![Session en écriture seule : texte de la pill changé et interrupteur d'injection à trois états](assets/changelog/0.8.10/01-write-only-pill.png)

## [0.8.9] — 2026-08-27

### Ajouts

- **Routage indépendant de la distillation par couche (Issue #34 / ADR-0005)** : les couches de distillation demandent des choses différentes au modèle (L1
  très fréquent veut être bon marché, rapide et stable ; L3, rare avec de grosses entrées, veut de fortes capacités) ; on peut désormais **doter chaque couche de sa propre chaîne de repli complète**.
  Double entrée : le YAML de déploiement `llm.layerRoutes` (clés de couche l1/l2/l3, la ligne de tête doit porter explicitement fournisseur+modèle)
  et `distillLayerChains` en runtime depuis la page de paramètres ; priorité dans la couche : **chaîne runtime > chaîne statique > chaîne
  globale par défaut**, en repli niveau par niveau ; non vide = remplacement intégral de cette couche (la dégradation d'une couche couverte ne retombe jamais dans la chaîne globale) ; les couches non configurées ne changent pas d'un bit ; le pin de déploiement ne verrouille que le côté runtime (les chaînes statiques de couche restent efficaces). La section « Paramètres de distillation »
  de la page de paramètres est remaniée en **panneau par segments** (global / L1 / L2 / L3) : points d'état segmentés en vue d'ensemble (bleu plein = personnalisé runtime / creux = YAML statique / gris = suit le global)
  + une ligne de légende (la relation de priorité est en tooltip)
  + annotation « en service : quelles couches » sur le panneau global + budgets par couche regroupés par couche (sémantique inchangée). L'amplification ×4 des budgets de sortie par couche en high/xhigh/max
  suit désormais le niveau de la couche (candidat de tête de la chaîne de couche > candidat global) ; la comptabilité ne change pas (les lignes token_cost
  sont déjà attribuées par couche + route réellement servie).

  ![Panneau segmenté des paramètres de distillation · global](assets/changelog/0.8.9/03-layer-segmented-panel.png)
  ![Panneau de la couche L1 · aperçu en lecture seule du suivi du global et budgets par couche](assets/changelog/0.8.9/04-layer-l1-panel.png)

- **Indicateur d'occupation du contexte (arc lumineux de mémoire autour de l'anneau officiel + ventilation dans le panneau de détail)** : le contenu de mémoire injecté par le plugin se noyait jusque-là dans les grandes catégories de l'anneau officiel de contexte ; maintenant — autour de l'anneau officiel de la barre de saisie, un **mince arc lumineux** bleu de marque
  (longueur = part de la mémoire dans la fenêtre, même image que l'anneau officiel) ; en ouvrant le panneau officiel, une section « occupation mémoire » en bas
  liste deux lignes, **fragments de rappel / zone stable de mémoire** (au format officiel `~5.5K` et valeurs en couleur vive). Les chiffres suivent la même heuristique de densité fixe que le compteur officiel de tokens (`ceil(chars/4)+frais`,
  en UTF-16), le dénominateur étant la fenêtre déclarée officiellement du modèle principal de conversation ; les anciennes sessions restent servies (balayage du
  surface de la session live + remplissage par lecture des préfixes stockés du service de persistance), rien ne se perd au redémarrage (écriture traversante de occupancy.json) ;
  après OFF, l'état acquis reste visible et décroît naturellement avec la compression. Implémentation purement additive : retirez tous les nœuds ajoutés et l'interface revient bit à bit à la forme native.

  ![Ventilation de l'occupation mémoire dans le panneau de détail](assets/changelog/0.8.9/01-panel.png)
  ![Arc lumineux de mémoire autour de l'anneau officiel](assets/changelog/0.8.9/02-halo.png)

## [0.8.8] — 2026-08-26

### Ajouts

- **Source de vérité unique du contrat RPC `src/contract.ts`** : les types de requête/réponse des 23 endpoints `dsh-memory/*` sont centralisés dans un module types-only (zéro code runtime), partagé entre le côté hôte (table des case de stats.ts) et le côté client — la dérive de contrat se voit à la compilation, plutôt que d'attendre que l'UI rende undefined. Les types de données purs des modules hôte (MemoryStats / RebuildStatus / famille CostSnapshot /
  EmbeddingStateView / MemoryLiveSettings / RecallSessionStats etc.) migrent dans le contrat et gardent leur re-export sur place ; `EFFORT_CHOICES` verrouille en retour la dérive du vocabulaire par `satisfies`.
- **Migration de la moitié client en TS/TSX + bundle esbuild** : `client/client.js` (3433 lignes d'ES5 monofichier écrit à la main) est réécrit en TSX multifichiers dans `client/src/` (stratifié par socle/contrôles/pill/tabs),
  bundle via `scripts/build-client.mjs` (esbuild, corps cjs empaqueté dans un factory wrapper, isomorphe aux paquets officiels dsh-client-ui-*) qui produit un `dist/client.js` monofichier. react / react/jsx-runtime /
  @deepseek-ai/* tous externals (injectés par require de l'hôte, pour éviter un double react) ; **zéro changement de comportement** (UI équivalente au pixel, endpoints RPC et charges inchangés, protocole d'handoff inchangé). Nouveau
  `npm run typecheck` (double contrôle tsconfig principal + tsconfig.client.json) ; la section 21 du smoke devient une assertion sur **l'artefact** dist/client.js (forme du protocole + câblage des externals + migration équivalente des assertions existantes sur tokens/
  arrondis/champ de particules).
- **Éditeur de chaîne de routage de distillation (UI de la page de paramètres, liste unifiée)** : une liste ordonnée remplace l'ancien sélecteur global de « réflexion de distillation » et le sélecteur monoroute de « modèle de distillation » — la 1re ligne est la route principale (badge « principale », peut rester vide et suivre le modèle par défaut), les lignes suivantes dégradent dans l'ordre ; **le niveau se règle route par route** (défaut « suivre la configuration du déploiement »,
  toujours passé au clamp de capacités). Nouvelle clé runtime `distillChain` (≤ 8 entrées ; ligne principale vide en double ou pleine en double, lignes de réserve obligatoirement explicites, doublons refusés ; tableau vide = suivre la configuration du déploiement). RPC : llm-providers gagne un bloc `chain`
  (current avec projection des anciennes clés / static / effectiveChain / source), llm-models ajoute à chaque modèle une table `efforts` des niveaux. La position est la priorité : la 2e ligne peut permuter avec la principale / la suppléer (une principale vide remplacée n'est pas conservée) ; pinned en lecture seule ; en mode « suivre », un bouton « éditer en chaîne runtime » copie la chaîne statique en un clic. Spécification de design dans `design/settings-spec.md` (section RouteChainEditor).
- **Chaîne de repli de distillation (option 1 du #31)** : `llm.fallbacks`, liste d'objets (entrée = provider + model +
  `reasoningEffort` optionnel) — en cas d'échec de la route principale (erreur/coupure/erreur réseau/sortie vide), dégradation automatique dans l'ordre des entrées, retour dès qu'une route réussit ; les entrées identiques à la principale sont sautées ; chaque route jouit de l'intégralité de `llm.timeoutMs` ; le niveau d'une entrée non vide écrase le niveau global (la prise de contrôle intégrale de l'ancienne clé runtime
  `reasoningEffort` — y compris le tampon des entrées — reste effective sur les valeurs existantes quand `distillChain` n'est pas configurée) ; l'annulation volontaire du client ne dégrade pas et remonte telle quelle ; en cas d'échec total, la dernière erreur est levée vers le back-off exponentiel
  par session existant. Coûts en tokens et usage de distillation comptabilisés à chaque tentative, la réussite enregistre la route réellement servie ; bascule de dégradation en journal info + alerte unique si une route unique échoue sans fin. Défaut tableau vide = comportement mono-route inchangé. Les README chinois et anglais gagnent une section « chaîne de repli de distillation et modèles à TTFT lent » (avec exemples de configuration et trois niveaux d'atténuation).

### Changements

- **La page de paramètres supprime le sélecteur global « réflexion de distillation » et le sélecteur monoroute « modèle de distillation »** : fusionnés dans l'éditeur de chaîne de routage unifié (niveaux routés par route). Les anciennes clés runtime `reasoningEffort`/`distillProvider`/
  `distillModel` gardent leur sémantique bit à bit (effectiveCfg ne reconnaît qu'un `distillChain` explicite, les valeurs existantes restent lues par compatibilité), l'UI n'y écrit plus.
- **La sortie vide est reclassée en échec d'appel** : `callLLM` passe de « renvoyer une chaîne vide » (journal warn) à « lever une exception » (diagnostic complet conservé) quand « le flux se termine normalement avec 0 caractère de sortie » — l'ancien comportement ne faisait que différer l'échec au parseur JSON/Markdown aval, avec un diagnostic plus pauvre ; les déploiements sans chaîne de repli sont aussi concernés, le chemin existant de repli sur échec des couches de distillation (journal seul, sans bloquer le pipeline) reste compatible tel quel.

## [0.8.7] — 2026-08-25

### Ajouts

- **Tableau de bord des coûts en tokens (#30, contributeur @Irvington258)** : le coût en tokens de chaque appel LLM de distillation
  (l1-extract / l1-dedup / l2 / l3) est écrit par clé composite `provider/model` dans la table de détail SQLite `token_cost` (avec migration de la colonne provider de l'ancienne table), la page de paramètres gagne un onglet « Coûts » :
  courbe de tendance colorée par modèle (jetons de séries de graphes `--dsh-mem-chart-1..8`, granularité jour/semaine/mois +
  fenêtre des N derniers jours forcée en granularité jour + filtre par niveaux L1/L2/L3), table niveaux × fenêtres temporelles (nombre d'appels /
  tokens de sortie et de réflexion / moyenne / médiane, le median calculé côté JS), liste des cumuls par modèle,
  récupérée par le RPC en lecture seule `dsh-memory/token-cost`, sondé toutes les 5 s. Critères des données : entrées comptées en caractères
  (l'usage en streaming de dsh n'inclut pas les tokens d'entrée, même critère que llm-usage), sortie/réflexion en tokens ;
  la comptabilité est accrochée à la sortie de callLLM, enregistrée sur les deux voies succès/échec, un échec de comptabilisation ne fait que warn et ne bloque jamais la distillation ;
  caches de prepare à la construction des requêtes ; libération des références de module à la désinstallation du plugin.
- Clé de configuration `tokenCost.retentionDays` (défaut `365`, `0` = conservation illimitée) : jours de conservation du détail des coûts,
  avec nettoyage glissant à l'écriture ; la borne de la fenêtre « N derniers jours » du tableau de coûts est la même (après libération de la rétention, la limite d'entrée du client
  s'élargit à 3650, la vraie limite étant vérifiée côté backend selon la configuration).

### Changements

- Réécriture de la spécification de design : `global-spec.md` gagne une section « couleurs de séries de graphes » (catégories de couleurs d'encodage pour la visualisation de données —
  exemption fonctionnelle du verrou monochrome d'accentuation, précédent des couleurs de modes ; 8 niveaux de jetons à double thème + valeurs de contraste AA recalculées,
  clair ≥ 3:1 partout / sombre ≥ 4.29 partout, le niveau 1 ancré sur le bleu de marque, le niveau 8 en gris neutre pour « autres ») ;
  `settings-spec.md` gagne une section « onglet Coûts (CostTab) » ; README chinois et anglais synchronisés en explications de fonctionnalités et lignes de la table de configuration ; le smoke gagne des assertions sur le défaut/bornes de retentionDays et le câblage des jetons de graphes.

## [0.8.6] — 2026-08-24

### Ajouts

- **Pondération de fraîcheur du rappel (#29 option B)** : le tri du rappel pondère doucement par `pertinence × max(0.5, 0.5^(Δjours/demi-vie))`
  (Δ sur le updated_at de la mémoire) — entre candidats de pertinence proche, les mémoires fraîches passent d'abord ; dans les longues sessions, les places de rappel
  tournent naturellement à l'usage, les entrées d'antiquité ne monopolisent plus le top-N. Choix de conception (au regard des arbitrages de Generative Agents et des
  pratiques RAG de production) : **multiplicatif et non additif** — la fraîcheur ne fait qu'ajuster les rangs entre candidats de pertinence voisine, elle ne se substitue
  jamais à la pertinence (l'addition laisserait des mémoires neuves mais hors sujet grimper par recency) ; **plancher de décroissance à 0.5** — une vieille mémoire perd au plus la moitié
  de son score de tri, les faits de long terme (« la préférence de café écrite il y a trois ans ») ne coulent jamais au fond, ce qui rend la demi-vie un réglage peu sensible ;
  les enregistrements sans updated_at sont traités comme les plus vieux (le plancher prend le relais, aucune exception codée). Suspendu à l'unique couture de la recherche
  (après les seuils des trois voies de `L1Store.search()`, avant la troncature), l'injection de rappel et l'outil memory_search sont cohérents automatiquement ;
  **le rappel des candidats de déduplication (searchCandidates) n'applique explicitement pas la pondération** — le chemin d'écriture qui cherche les vieux enregistrements de même
  sémantique doit ignorer le neuf et le vieux, la décroissance ferait rater des doublons à la déduplication. `recall.decayHalfLifeDays` par défaut 30 jours, 0 = désactivé
  (faisable à 0 pour la comparabilité des bases de bench) ; le champ score des hit n'est pas réécrit (le tri utilise le score pondéré, l'affichage continue de refléter la pertinence de recherche) ;
  l'idf n'est pas isolé (intégré à la voie BM25, sans équivalent sur la voie vectorielle) ; l'importance (priority) reste pour l'instant inactive (la sortie d'extraction
  actuelle est quasi constante, son gain au tri tendrait vers zéro ; la formule lui réserve une place).
- **Déduplication du rappel (économie de tokens)** : au sein d'une même session, les mémoires déjà injectées ne le sont plus une seconde fois — quand l'utilisateur insiste
  sur une question apparentée/similaire, la recherche retombe sur les mêmes enregistrements, mais le contexte du modèle les contient déjà : réinjecter est du gaspillage pur
  (~2000 caractères ≈ 1000 tokens par tour au maximum). Sémantique de filtrage pur : autant de nouvelles touches que l'on en injecte, la suppression intégrale (0 entrée)
  est un état correct, pas un raté. La granularité = id d'enregistrement L1 : une fusion/mise à jour de déduplication change l'id, les mémoires au contenu modifié se
  libèrent naturellement du blocage et se réinjectent. Quand le contexte est comprimé par `/compact` ou vidé par `/clear`
  (événement `agent/session-start`), le registre se réinitialise — le contenu injecté a quitté le contexte du modèle, la mémoire peut être réinjectée ;
  `resume` ne réinitialise pas (l'historique est toujours là). Le registre est persisté dans `recall-dedupe.json` du répertoire de données
  (écriture traversante sérialisée et atomique, même recette que session-modes ; LRU de 200 sessions / plafond de 512 ids par session /
  expiration à 90 jours ; tout échec d'I/O dégrade en mémoire sans jamais bloquer la voie du rappel — le surcoût du chemin chaud se limite à un Set mémoire en O(hits)). Les statistiques gagnent le compteur cumulatif `suppressedRecalls` (consultable via le RPC session-stats),
  debug journalisé à chaque suppression ; le critère de la carte flottante reste continu (les tours à suppression intégrale comptent dans hitTurns — la mémoire
  pertinente est déjà dans le contexte, essence d'un hit).

### Corrections

- **Import des records.jsonl de l'ancienne version bloqué à jamais (#28)** : quand les enregistrements produits par l'ancien générateur manquaient de l'un des champs `type`/`priority`/
  `scene_name`, le `undefined` était refusé par la couche de binding de node:sqlite — le repli unitaire échouait aussi systématiquement (les champs manquants de la même
  génération de générateur arrivent en lot), le fichier restait en place, chaque démarrage réessayait et les données n'entraient jamais en base. Correctif :
  **filet de sécurité des champs à la couche de binding** (`upsertL1InTx`/`upsertL0Batch` normalisent les variables locales, table principale/vecteur/FTS partagent
  les mêmes valeurs sources ; valeurs par défaut issues des colonnes du schéma : `type='' / priority=50 / scene_name=''`, côté L0 `sessionId='default' / role='' / recordedAt='' / timestamp=0`) —
  un seul correctif couvre les importations d'anciennes versions, reindex, backfill et les écritures ordinaires ; au passage disparaît le risque de TypeError de `familyForType(undefined)`
  (retour à la famille chat après normalisation). L'import L0 des anciennes versions reçoit en même temps un seuil minimal de validité (comptage des mauvaises lignes
  sans id/content jetées, jusqu'ici zéro filtrage). Note : la « absence d'isolation ligne à ligne » rapportée ne tient pas — le repli unitaire existait déjà
  (le journal du rapport s'en fait témoigner), ce qui manquait vraiment était le filet des champs ; le fusible `.failed` est passé par consensus (la cause connue de la boucle
  est guérie ; les formes inconnues attendront d'apparaître réellement).
- **L'embedding local gelait la page entière (incident de niveau performance)** : le chargement du modèle transformers.js et l'inférence ONNX s'exécutaient à l'origine de façon synchrone sur le thread principal de l'hôte — le `run`/`loadModel` d'onnxruntime-node (v1.24.3) sont des appels synchrones dans un rappel setImmediate (l'emballage Promise ne décharge pas le calcul) ; une fois l'embedding local activé (embeddinggemma-300m, ~0,3-1,3 s d'inférence par entrée constaté), chaque tour de conversation — écriture L0, query de rappel, écriture de distillation, lots de reindex — gelait la boucle d'événements pendant des secondes : plus aucune interaction ne répondait sur les pages dsh. Correctif :
  l'inférence migre en bloc dans un thread worker (`resources/embedding-worker.cjs`, le thread principal ne garde que le proxy de protocole
  `LocalEmbeddingService`) : inférence entrée par entrée + cession entre les entrées, une demande unitaire (query de rappel) passe devant et n'attend pas la queue du
  lot de reindex ; constaté : pendant un lot de 8 embeddings (l'ancien chemin gelait ~10 s d'affilée), l'échantillonnage du thread principal relève 0,0 ms de dépassement. En prime, un renforcement sémantique : le clamp interne `embeddingTimeoutMs` de la voie de rappel, jusqu'ici « ignoré » pour l'embedding local, devient réellement effectif (abandon par race, réponses tardives jetées). Le crash du worker ne s'auto-répare pas (passage en état failed avec descente de la chaîne FTS ; changement de source/redémarrage pour récupérer) ;
  `close()` = terminate, la sémantique « terminated ne ressuscite pas » est maintenue.
- **Tempête de réessais de distillation (appels brûlés en rafale pendant une panne LLM)** : après un échec d'extraction L1 (ex. timeout de passerelle de 120 s), le filet d'inactivité
  continuait d'empiler toutes les 30 s des tâches de distillation force, s'accumulant en appels en rafale infinie pendant l'attente du LLM
  (preuve dans memory.log du 2026-08-24 : un tour d'appels de 120 s toutes les 2 minutes, sans convergence). Correctif : back-off exponentiel par session
  (60 s au départ, doublement, plafond 30 minutes, remise à zéro à la consommation réussie ; les tours de reconstruction sont exemptés — l'action explicite de l'utilisateur
  a son propre UI d'échec/annulation), pendant le back-off, le filet d'inactivité et le déclencheur de seuil sautent tous deux cette session.
- **Renforcement de sécurité en prime (sémantique inchangée)** : toutes les frontières de lecture/écriture de fichiers des outils bench et du smoke passent en écriture
  de containment inline (vérification startsWith de la racine après resolve / whitelist SAFE_NAME ;
  assertions de contrat pour les variables d'environnement de type répertoire : chemin absolu et sans segment `..`).

## [0.8.5] — 2026-08-23

### Corrections

- **Rectification du critère de notation** (bench) : ① pour les questions avec stale (mise à jour/chaîne/oubli), la condition de FAIL passe de « l'ancienne valeur apparaît » à « l'ancienne valeur **énoncée comme situation actuelle** » — raconter simplement l'évolution avec une valeur finale juste ne pénalise plus
  (mesuré au retour lifecycle du 2026-08-23 : une question de chaîne d'updates répondant juste sur platine/diamant mais évoquant la trajectoire du sable pour chats était massacrée par lot entier) ; ② le FAIL des questions à refus se limite à « énoncer comme fait connu ce qu'on demandait précisément », citer le contexte réel pour expliquer « pourquoi on ne sait pas le point demandé » vaut PASS (« je ne connais que A et B, aucun enregistrement de C » était auparavant massacrée). La question update de work-project-stack passe du contains-all au jugement LLM (le jugement programmatique ne sait pas distinguer l'énoncé actuel du récit d'évolution ; plus aucun couple contains-all+stale dans toute la bibliothèque).
- **Mauvais étiquetage de famille du mode auto : les faits personnels « planifiés » aspirés dans la famille work** (constaté au premier lancement de la piste lifecycle) :
  le préfixe de type de la sortie d'extraction décidait implicitement de la famille, et des faits personnels de forme « règle » comme « plan de démoustication / calendrier de vaccins / choix de litière », sans formulation collante dans le vocabulaire chat, se faisaient aspirer par la sémantique de forme de work_fact/work_method → famille mal étiquetée → le même fait existait en double famille (la déduplication ne franchit jamais les familles → résurrection de l'ancienne valeur, échec des questions de chaîne) + fuite du filtrage par famille (une session en mode chat pouvait sortir des faits work, 2/2×2 mesurés en lifecycle). Correctif : le prompt d'extraction du mode auto **sort explicitement un champ family par mémoire** (le jugement regarde le contexte, pas la forme — métier/équipe/projet → work, famille/animaux/santé/agenda personnel → chat ; family borne le vocabulaire de type, sans croisement) ; côté ingénierie, chaîne de repli à trois niveaux `resolveRecordFamily` (pur forcé → explicite de l'extraction → préfixe de type). La divergence d'avec l'amont MemoryCore est annotée en tête de prompt. **Une base mal étiquetée doit être reconstruite une fois après la mise à niveau pour guérir** (L1 vidé et réimporté ; attention : le rebuild ressuscite de L0 les faits « oubliés » — sémantique existante).

### Ajouts

- **Complément du triangle d'efficacité** (bench + plugin) : « le coût de la mémoire » et l'« économie de mémoire » déjà mesurée de la piste workflow composent un ROI complet —
  ① **coût d'injection** (différentiel de temps de réponse entre tours injectés et tours non injectés — les horodatages d'événements sont écrits à la dispatch des étapes, le temps propre du crochet d'injection n'est pas directement observable, d'où le passage au critère différentiel après vérification de terrain ;
  le groupe A fait sa propre base en interne) ; ② **part injectée** (caractères injectés du tour sonde / tokens d'entrée du tour, en convertissant 1 caractère chinois ≈ 1 token) ; ③ **comptabilité de distillation** (nouveau compteur toujours actif `src/llm-usage.ts`, callLLM accumule par couche l1-extract/l1-dedup/l2/l3 les caractères d'entrée/tokens de sortie/de réflexion, lu via le service de contrôle bench
  `getDistillUsage`, proratisé par message capturé ; le rebuild du lifecycle dispose en propre d'une différenciation avant/après). patch-arm-on active en même temps benchControl ; les anciens runs sans les nouveaux champs sautent automatiquement la section.
  Au passage, réparation d'une brèche de garde de liens de run.mjs : les worktrees frères sous l'arbre principal (.worktree/…) étaient jusque-là
  laissés passer — constaté le 2026-08-23, un vieux runner pointant .worktree/dev a couru toute la procédure en silence.
- **Piste de cycle de vie** (bench `--track lifecycle`, groupe A seul) : elle ne teste que les invariants de cycle de vie que cette architecture seule peut tester —
  **filtrage par famille** (une session en mode chat ne peut pas faire sortir des faits de la famille work, symétriquement, une fuite inter-familles non nulle signifierait « écriture et rappel dans le même mode » rompus), **capture du mode off** (double assertion : les faits nonce enseignés à une session off — la sonde auto doit refuser de répondre + absence intégrale dans records/conversations JSONL, revérifiée après rebuild), **fidélité du rebuild** (après reconstruction intégrale, sonde ×2 témoin ×1, un recul significatif signifierait que la chaîne de rebuild perd de l'information), **demandes d'oubli** (demander en conversation naturelle de supprimer un souvenir → voie de suppression de la détection de conflits L1 → reposer la même question doit donner un refus sans répéter l'ancienne valeur ; la résurrection par rebuild des vieux faits depuis L0 est la sémantique documentée). Zéro nouveau fichier de scène, réutilisation de la bibliothèque de dialogues.
- **Courbe de dégradation à l'échelle** : ① inondation hors ligne (`retrieval-metrics.mjs --flood N1,N2`) — dupliquer la base de référence avec N enregistrements synthétiques déterministes (domaines thématiques décalés, zéro chiffre en texte intégral pour éviter les collisions accidentelles avec les golds numériques) et recalculer recall@k, courbe « qualité de recherche vs volume de la base » à coût d'exécution nul (base archivée 0.8.3 mesurée : +400 entrées → recall@5 de 70,2 % à 65,8 %) ; ② bruit en exécution (run.mjs `--noise k`) — insérer entre les scènes de dialogue des sessions de remplissage (`fillers.json`, 25 sessions, assertion au chargement contre les collisions de marqueurs) pour mesurer la dégradation de bout en bout, le report gagne une section « analyse de position à l'échelle » (trois seaux début/milieu/fin) ; le remplissage ne touche pas la liste scenarioFiles, les compare entre niveaux de noise ne déclenchent pas d'alerte d'environnement.
- **Service de contrôle bench** (configuration `benchControl` du plugin, désactivé par défaut) : service cordis intra-processus `dsh-memory-bench` (déclenchement de rebuild / sondage d'état / réglage des modes de session) au service de la piste lifecycle — côté hôte, connection.rpc n'a que handle et pas call, c'est le seul couloir intra-processus propre ; les déploiements de production n'ouvrent pas cette configuration, surface nulle.
- **Indicateurs hors ligne de la couche de recherche de la référence** (bench) : calculés automatiquement par report/compare + CLI autonome
  (`bench/harness/retrieval-metrics.mjs`) — tables par type de question pour recall@5 / couverture des golds / MRR (les questions sondes rejouées de façon contrôlée sur la base de mémoire finale du rep avec la recherche keyword, critères de pool/seuils/exceptions de petit corpus et d'exécution identiques point par point, tokenisation et index partagés avec les search-utils de dist) + précision d'injection (part des lignes injectées contenant les points gold) + comptage des injections portant de l'information périmée (les stale de type update entrent dans l'injection, l'échec de mise à jour devient visible au niveau de l'injection). Le runner écrit en plus `recall.lines` (détail des lignes de mémoire injectées).
  Au problème du taux de réussite de bout en bout comme arme émoussée, voici désormais un signal direct qui ne dépend ni du jugement ni de l'échantillonnage.
- **Quatre nouveaux types de questions + scènes de workflow à mémoire prospective** (bench, inspirés de MemoryAgentBench /
  GoodAI LTM / BEAM) : `accretive` (accumulation incrémentale : un fait complet éclaté en plusieurs sessions à assembler),
  `update-chain` (mise à jour en chaîne v1→v2→v3, avec chaînes à retour en arrière), `ordering` (ordonnancement d'événements),
  `paraphrase` (reformulation synonymique pour éprouver les manques lexicaux) — bibliothèque de dialogues 15→20 (nouvelles scènes toutes en 10 questions,
  90→140 questions par rep), les scènes peuvent porter des sessions de renforcement (0~2, insérées entre teach et change) ; côté workflow, nouvelle `wf-preflight`
  (enseignement d'une convention permanente « écrire d'abord le fichier de pré-vol avant de générer », la sonde ne donne qu'une tâche floue, le groupe A doit compléter de lui-même l'étape en s'appuyant sur la mémoire).

### Changements

- Mise à jour des règles du validateur de scènes de dialogue : nombre de questions sondées 6→6~10 (les six centrales exactement 1 chacune + au plus 1 par type étendu),
  sessions de renforcement autorisées (ordre forcé teach → reinforce → change),
  `update-chain` doit porter du stale ; le critère spécial « mise à jour » est absorbé dans les questions de chaîne.
  Le changement de liste des scènes fait alerter les comparaisons avec les vieilles bases « environnement non conforme » — attendu ; relancez la base ou pointez `--scenarios` sur le même sous-ensemble pour comparer.

## [0.8.4] — 2026-08-22

### Corrections

- **Le nouveau vocabulaire de niveaux de réflexion de la page de paramètres se faisait refuser par la porte d'écriture** (introduit en 0.8.3) : quand la table des niveaux s'est élargie à huit mots, la whitelist RPC de `settings-set` n'a pas suivi (elle ne reconnaissait que `''/off/high/max`), et la page de paramètres renvoyait « niveau de réflexion illégal » avec annulation pour toute sélection `none/minimal/low/medium/xhigh`. La whitelist et le schema/settings tirent désormais de la même source — le vocabulaire converge vers la source de vérité unique `EFFORT_CHOICES` de `config.ts` (la même liste était recopiée littéralement en 4 endroits).
- **Le budget de sortie explicite `xhigh` était doublé deux fois, ×16** (introduit en 0.8.3) : le `layerMaxTokens` côté phases et le garde-fou du mode auto de `callLLM` portaient chacun leur propre table littérale des hauts niveaux, divergents (le garde-fou oubliait `xhigh`) ; avec la configuration `xhigh` et un modèle qui le déclare, on multipliait ×4 puis encore ×4. Les deux côtés partagent désormais la constante unique `HIGH_EFFORT_TIERS`, et quand la configuration est elle-même un haut niveau, le garde-fou n'amplifie plus.
- **Le sélecteur de niveau de réflexion regagne l'entrée « Auto »** : depuis la suppression de l'option « suivre la configuration » en 0.8.3, le sélecteur ne montrait que les niveaux déclarés du modèle et, une fois un niveau explicite choisi, impossible de revenir à l'automatique depuis l'UI. La première entrée est désormais fixée « Auto » (clé='', le clic réécrit la chaîne vide), et la triple répétition dans la construction des options converge en un seul calcul.
- Dérive documentaire : la liste des valeurs de `llm.reasoningEffort` des README chinois et anglais gagne `minimal` (aligné sur le schema) ; la mention « high/max ×4 » des infobulles de budget de la page de paramètres et des commentaires du code est complétée en high/xhigh/max.

### Changements

- **Mise à niveau du runtime hôte 0.1.0-rc.8 → 0.1.1-rc.2** (devDeps épinglées exactement, peers passés à la ligne `^0.1.1-rc.2`) : les 9 paquets de dépendances directes comparés fichier par fichier dans le tarball — 7 paquets sans changement de code,
  dsh-llm / dsh-client-connection en pur incrément (déchargement d'images multimodales / Files API /
  `prepareCall` de l'adapter / paramètre optionnel RPC `doFetch`), les GenerateOptions/StreamChunk/createUserMessage/installModelSelection/
  rpc.handle|call utilisés par ce projet sont identiques octet pour octet, zéro adaptation. Vérification : build/smoke/dump-config des deux profils/
  smoke du fixture de bench tous au vert. L'ERESOLVE de npm pour la traversée de familles pré-release passe par `--legacy-peer-deps` (annoté dans AGENTS.md).

### Référence

- **La piste workflow de DSH-MemBench passe à 7 scènes** (`bench/`), avec trois nouvelles familles d'épreuves :
  mise à jour du savoir-faire de processus (`wf-heap-update` — enseignement v1 → session de changement annonçant la v2 → sonde sur
  « le processus actuellement en vigueur », les artefacts propres à l'ancien processus ne doivent plus apparaître, mesure opérationnalisée de la mise à jour par déduplication L1),
  désambiguïsation de workflows jumeaux (`wf-twin-runbook` — runbooks jumeaux, configurer le mauvais service est condamné par les vérifications négatives),
  continuité des conventions de style (`wf-report-style` — conventions de nommage/structure/séparateur de milliers/pied de page appliquées d'une session à l'autre). La vérification de complétude s'élargit d'un unique contrôle positif à quatre types de critères (`contains`/`notContains`/
  `absent`/`exists`), le vérificateur extrait en `checks.js` unitestable isolément ; le runner accepte une session `change` optionnelle ; la validation de la bibliothèque de scènes se resserre en même temps (exactement un critère au choix, le marqueur doit figurer dans le texte d'enseignement).
  La base officielle (`bench/baseline/`) reste à la version 4 scènes ; la première régression après l'élargissement devra reconstruire la base.

### Durcissement de la référence (lot de corrections après audit des brèches)

- **Groupes A et B en parallèle** : `run.mjs --arm AB` fait tourner les deux groupes en deux processus concurrents (les témoins n'ont aucune dépendance mutuelle), le parent produit à la fin le rapport conjoint ; les enfants sont exemptés de nettoyage et de rapport automatique pour ne pas se gêner.
- **Bouchage du couloir d'archéologie entre runs** : avant chaque run, nettoyage des sandboxes historiques de `%TEMP%/dsh-mem-bench/` et des répertoires de sessions de namespace bench dans `~/.dsh/sessions` (seul `dsh-mem-bench` est visé, les sessions/données de l'utilisateur ne sont pas touchées).
- **Retrait du groupe B de la piste dialogue** : les sessions du Harness sont mutuellement indépendantes, la sonde du groupe B sans mémoire échoue nécessairement (17,8 % mesurés historiquement ≈ le sol), le contrôle n'informe de rien — `--track dialog --arm B` refuse de tourner, seul le groupe A est conservé.
- **Empreinte du code et garde de liens** : l'en-tête environment des résultats enregistre `gitSha` ; run.mjs vérifie au démarrage que les deux dépendances link: du profil bench pointent vers le dépôt testé (le code d'un ancien worktree polluait silencieusement les résultats, accident constaté le 2026-08-21).
- **Audit à deux niveaux des lectures hors frontière** (piste workflow) : niveau strict, un hit (mémoire/sessions de `~/.dsh`, memory.db, chemins de stockage records/conversations/scenes) → toutes les vérifications des scènes impliquées sont condamnées ; niveau laxiste, simple demande de re-vérification ;
  correction du faux positif par sous-chaîne de `.MemoryMappedFiles` ; les appels légitimes d'outils mémoire (memory_read_scene etc., paramètres étant des chemins) n'entrent pas dans l'audit.
- **Dés-autorévélation des scènes** : `wf-heap-update` passe à une convention en deux pas `target.env + apply.sh` et `wf-twin-runbook` à des fichiers `svc-a/svc-b` isomorphes (la correspondance ne vit que dans le texte d'enseignement) — réparation de la brèche de discriminabilité « le groupe B peut fouiller les fichiers de la sandbox et reconstituer le processus » (mesuré, la sonde B était montée à 12/12 puis 11/12, presque la note maximale).
- **Pollution du workflow mesurée** : l'injection de rappel des sondes workflow entre dans les statistiques de contamination (le champ manquait, le rapport affichait 0) ; le report gagne une colonne **complétude du segment sonde** (dans les segments enseignement/changement, les deux bras ont le contexte sur place ; seul le segment sonde est la fenêtre de mémoire pure).
- **Validation de la bibliothèque de scènes resserrée** : marqueurs uniques dans toute la bibliothèque, dédoublonnage des sessions de même kind, les golds de contains-all doivent apparaître dans le texte d'enseignement (question sans réponse sans mémoire = mauvaise question), les golds ne doivent pas fuiter dans le texte des questions ; la détection d'appels à l'aide gagne des motifs anglais ; les fixtures se séparent par piste en `dialog/`, `workflow/` (une scène workflow sous un patch de dialogue sans outils échouerait à coup sûr, le smoke mélangé aurait faussement alerté).

### Ergonomie de la référence (configuration des modèles par bench.env)

- **Configuration centralisée des modèles en trois rôles** : `bench/harness/bench.env` (modèle à copier depuis `bench.env.example`, avec API key gitignorée) configure d'un seul endroit l'agent testé / le juge / la distillation —
  `BENCH_PROVIDER/BENCH_MODEL`, `BENCH_JUDGE_*`, `BENCH_DISTILL_*` ; les arguments de ligne de commande ont priorité sur le fichier env. Nouveaux paramètres `--distill-provider/--distill-model`, le modèle de distillation passe du codage en dur dans le patch aux variables d'environnement (défaut en repli : official/flash).
- **Passerelle personnalisée compatible OpenAI** : après avoir rempli dans bench.env `BENCH_TEST_BASE_URL + API_KEY` (le juge peut en avoir une autre paire), run.mjs génère automatiquement le patch llm-pi-ai qui enregistre `bench-gw` /
  `bench-judge-gw` (juge/distillation réutilisant la passerelle testée : fusion automatique et déduplication de la table des modèles), la clé API référencée par apiKeyEnv n'est injectée que dans l'environnement du sous-processus. Une fois la passerelle configurée, les fournisseurs personnalisés du run sont entièrement dictés par bench.env (la passerelle du settings.yaml de l'utilisateur n'y participe pas : isolation et reproductibilité).
- **Suppression du repli par défaut du modèle testé** : sans `--provider/--model` ni bench.env, refus de tourner (l'ancien repli tombait sur le modèle par défaut du settings.yaml et le profil bench, sans adapter, explosait au démarrage).
- L'analyse et la construction du patch passerelle extraites en module de fonctions pures `env-config.mjs` (22 tests unitaires + validation de structure dump-config, tout au vert).
- **Intensité de réflexion configurable en trois rôles** : `BENCH_REASONING_EFFORT` (testé) / `BENCH_JUDGE_REASONING_EFFORT`
  (juge) / `BENCH_DISTILL_REASONING_EFFORT` (distillation, off par défaut) + paramètres `--effort/
  --judge-effort/--distill-effort` correspondants ; transmis via `ModelSelection.reasoningEffort`
  (porte officielle installModelSelection) et les GenerateOptions du juge ; vide = ne pas transmettre, suivre le défaut du fournisseur ; l'en-tête environment des résultats enregistre l'effort des deux côtés (reproductibilité).

### Mise à jour des données mesurées de la référence (README chinois et anglais synchronisés)

- **Nouvelles données après l'élargissement de la piste workflow à 7 scènes** (v4-flash@high, juge glm-5.3, plugin 0.8.3) :
  complétude du segment sonde groupe A (mémoire allumée, 3 tours) **85,5 %** (59/69) contre groupe B (mémoire éteinte, 1 tour)
  **43,5 %** (10/23) ; les tokens d'entrée par scène du groupe B valent **6,8 fois** ceux du groupe A (1,81M contre 266k,
  en niveau high le coût de la re-exploration sans mémoire est nettement amplifié) ; sonde de la scène de conventions de style groupe B 0/4 (les conventions
  ne vivent que dans la mémoire, plafond de la discriminabilité) ; dans la scène de mise à jour de processus, le groupe B peut encore reconstituer en lisant les scripts (discriminabilité limitée par les
  affordances de la sandbox, noté honnêtement dans le README). Le graphique `bench-workflow.svg` refait avec les nouvelles données ; les anciennes données de la
  piste dialogue sont étiquetées base d'archive 0.8.0 (groupe B retiré).
- **Barrère de coût du groupe B** : `--repeats` ne s'applique qu'au groupe A, le groupe B ne tourne qu'une fois (le coût en tokens des longues tâches
  sans mémoire est trop élevé, décision de l'utilisateur).
- **Panneau de progression en temps réel** : pendant le benchmark, `run.mjs` lance automatiquement `panel.mjs` (zéro dépendance, lié uniquement à
  127.0.0.1) et ouvre le navigateur — cartes des deux bras A/B, progression par scènes/phases/messages, coûts cumulés,
  queue d'événements ; le double indicateur battements (5 s) + fraîcheur d'activité tranche « figé vs processus mort ». La source de données est l'écriture atomique incrémentale du runner dans `rep-N/progress.json` (throttlée à ≥ 1 s) + le `plan.json`
  du démarrage de `run.mjs` (la boucle des reps reste dans le parent, les enfants ignorent le nombre total de tours). `--no-panel` désactive ;
  le panneau est moissonné automatiquement à la sortie du run (unref des enfants, sinon ils suspendraient la boucle d'événements du parent).

## [0.8.3] — 2026-08-21

### Changements

- **Les niveaux de réflexion de la distillation deviennent conscients du modèle (répare l'explosion garantie de la distillation sur les modèles non deepseek)** : jusqu'ici le plugin transmettait le niveau de réflexion de la distillation (défaut `off`) tel quel à n'importe quel modèle — `off` est un concept de la couche d'adaptateur deepseek, que les passerelles pi-ai/openai-responses ne reconnaissent pas (qwen en local refusait, l'amont renvoyait 400 Invalid
  reasoning.effort). Désormais, avant envoi, on interroge `resolveModelInfo` sur les capacités du modèle (avec cache par route, invalidé au changement de topologie) : si déclaré → envoyé tel quel ; `off` face au vocabulaire OpenAI → alias `none` ; non supporté ou non déclaré → rien n'est envoyé + une seule alerte ; **l'option « suivre la configuration » est supprimée**, '' = auto (niveau par défaut du modèle →
  high) ; la table des niveaux choisissables de la page de paramètres suit l'affichage en direct du modèle courant (si rien n'est déclaré, seul high s'affiche) ; le vocabulaire de la table s'élargit à off/none/minimal/low/medium/high/xhigh/max ; quand le niveau auto se résout en un haut niveau, le garde-fou de ×4 du budget de sortie entre en jeu en même temps.
- **Bascule du modèle de distillation avec sélection automatique du modèle** : après changement de fournisseur, le modèle retombe automatiquement sur le premier modèle du fournisseur (écriture en paire avec couverture), le menu déroulant du modèle n'a plus d'« suivre le défaut » (suivre le défaut = vider le premier item du menu fournisseur, couverture) ;
  la liste des modèles est mise en cache par fournisseur + préchargée en arrière-plan au chargement du panneau (bascule instantanée sans creux, en cas de manqué, affichage « chargement de la liste des modèles… » plutôt que le nom d'un modèle périmé). **Le texte du bouton basculait tout seul, maintenant corrigé** : l.optimisme de `writeLlm` fusionnait jusque-là les clés settings `distillProvider/distillModel` directement dans `info.current`
  alors que la couche d'affichage lisait `current.provider/model` — les clés ne correspondaient pas, la mise à jour optimiste était un no-op pour le texte du bouton,
  et il fallait attendre le rafraîchissement par sondage de 5 s (sensation « quelques secondes avant que ça change ») ; maintenant les clés sont mappées en clés de vue et écrites simultanément dans `current` et
  `effective`, les réponses périmées du sondage sont jetées pendant l'écriture en vol (anti-aller-retour visuel), et après le succès on tire immédiatement une fois la vraie valeur du serveur.
- **Menu déroulant entièrement redessiné en interne, aligné sur l'allure du MenuDropdown de dsh** : la liste éclatée du `<select>` natif est dessinée par le système d'exploitation (coins droits, surlignage système), hors de portée du CSS — remplacé par bouton déclencheur + panneau flottant (arrondi 12px
  / fond dsw-specific-menu / projection lv3, options à arrondi 10px + fond au survol + coche pour la sélection,
  clavier ↑↓/Enter/Esc intégralement supporté, sémantique aria listbox). Les quatre endroits — les deux niveaux fournisseur/modèle du modèle de distillation et les filtres type/contexte de l'onglet mémoire — sont tous remplacés, plus aucun `<select>` natif dans le bundle.
- **Les blocs de scène de la page de paramètres deviennent repliables** : les cartes de scène de l'onglet scènes sont repliées par défaut (seule la tête + une ligne de résumé),
  un clic sur la tête déplie/replie le corps, la flèche de repli tourne de 90° en état déplié (respect de reduced-motion).
- **L'onglet des journaux défile d'office en bas** : lire des journaux, c'est vouloir la queue la plus récente (sémantique tail) ; après chargement/rafraîchissement, collage automatique au fond, plus d'arrêt par défaut en haut.
- **Guide de déblocage quand le déploiement est épinglé** : quand le modèle de distillation est verrouillé par le pin statique du profil (`llm.provider`+
  `llm.model` remplis tous les deux) et que le sélecteur ne se montre pas, un texte statique explique « comment retirer le pin pour retrouver
  la bascule de la page » (avant, on ne montrait que la route figée, sans rien dire de pourquoi la bascule était impossible).

Lot de corrections après revue de code complète (sécurité + robustesse + cohérence documentaire).

### Corrections

- **Une configuration de proxy malformée ne fait plus s'effondrer le chargement du plugin** (haute gravité) : quand `embedding.proxy` est écrit sans schéma
  (ex. `127.0.0.1:7890`) ou que la variable d'environnement de proxy n'a pas de schéma, le constructeur `ProxyAgent` levait un TypeError de façon synchrone → échec d'apply. Même tolérance que pour le miroir malformé : capture puis repli en connexion directe + warn.
- **Expurgation des journaux d'URL de proxy** : le journal des téléchargements passant par le proxy imprimait l'URL du proxy telle quelle (avec d'éventuels
  identifiants user:pass) et la persistait dans `memory.log` ; désormais les userinfo sont dépouillés, ne reste que `scheme//host`.
- **`NO_PROXY=*` avec astérisque prend effet** (jusqu'ici l'entrée `*` ne matchait jamais, le proxy restait utilisé malgré tout).
- **Boucle de visibilité des échecs de double écriture** : l'échec « JSONL source de vérité écrit, écriture par lot dans la base de recherche en échec » de L0/L1 était silencieux
  (enregistrements dès lors introuvables, candidats de déduplication manquants) ; désormais monté en journal error avec la mention que « Reconstruire la mémoire » permet de réimporter intégralement depuis la source de vérité.
- **Durabilité des écritures atomiques** : les écritures atomiques tmp+rename de state/pending/scènes/persona gagnent le fsync du bloc de données
  (avant, une coupure de courant pouvait laisser un fichier vide ou à moitié écrit) ; le nom du tmp gagne un segment aléatoire contre les collisions à la même milliseconde, nettoyage des tmp orphelins en cas d'échec.
- **Sémantique d'annulation de l'installateur runtime** (plateforme principale Windows) : après annulation en phase ci, plus de chute dans la branche de repli « ci échoué » qui relancerait un install inutile ; l'annulation entre la sortie du ci et le départ du repli est elle aussi prise en compte ; sous `shell:true`, le kill passe par `taskkill /T /F` pour couper l'arbre de processus (avant, on ne tuait que cmd.exe et les petits-fils npm continuaient de courir — timeout comme annulation ne faisaient que s'arrêter en surface).
- **Troncature lue mal pour l'embedding local** : `embedding.maxInputChars` ne s'appliquait qu'à l'embedding distant, la voie locale codait 5000 en dur ; les deux voies tirent désormais de la même source.
- **Durcissement des noms de fichiers de scènes** : les noms de périphériques réservés de Windows (CON/NUL/COM1… sous leur forme avec extension) reçoivent un préfixe `_` d'évitement ; les noms trop longs sont tronqués à 120 caractères (défense contre ENAMETOOLONG).
- **Critère de migration du L1 ancien format** : quand l'ancien `records.jsonl` contenait des lignes corrompues, la migration ne se terminait jamais (le même lot était réimporté à chaque démarrage) ; le critère passe au nombre de lignes valides après filtrage.
- **Bornes des paramètres d'entrée RPC** : sessionId ≤ 512 / query ≤ 4096 / provider·model·activeModel ≤ 200,
  offset de pagination ≤ 1 million — contre les charges surdimensionnées malformées sur le panneau en loopback (gonflement de session-modes.json, pics CPU de tokenisation jieba intégrale).
- **Garde de limit des recherches FTS/vecteur** : les trois entrées de recherche refusent `limit ≤ 0` (LIMIT négatif en SQLite = non borné ; la face d'appels actuelle est déjà clampée, pure défense contre les futurs appelants).
- **Alerte quand un appel d'outil manque d'identifiant d'agent** : quand `exec.agent` n'est pas transmis, le filtrage par mode se dégrade en recherche toutes familles ; désormais une seule alerte (le comportement fail-open est conservé, l'appel n'est pas refusé).

### Documentation

- Le README chinois rattrape la section entière « Journaux et diagnostic » qui n'existait que dans la version anglaise (brèche qui violait la loi du synchronisme chinois-anglais),
  et les deux versions gagnent ensemble la note sur la borne de durabilité du JSONL ; la version épinglée des exemples passe de 0.8.0 à 0.8.2.
- **Correction de deux erreurs factuelles de l'entrée 0.8.2** : ① la plage peer est en réalité restée `^0.1.0-rc.6` (rc.6~rc.8 compatibles), la phrase « l'exigence peer est passée à dsh ≥ 0.1.0-rc.8 » ne correspondait pas au package.json ; ② le document cité
  `docs/dsh-dev-experience.md` n'est pas distribué avec le dépôt (gitignored), une référence pendante vers l'extérieur.

## [0.8.2] — 2026-08-20

Suivi des dépendances hôte vers dsh 0.1.0-rc.8.

- **Mise à niveau épinglée des dépendances hôte 0.1.0-rc.6 → 0.1.0-rc.8** (devDependencies épinglées exactement, pour le
  développement/test ; les peerDependencies restent sur la plage `^0.1.0-rc.6` — rc.6→rc.8 mesuré comme **zéro dérive
  d'API**, compilation des types/smoke/démarrage réel tous au vert). À partir de rc.8, le corps dsh passe à une disposition d'**installation globale**
  (`profiles/node_modules` entretenu par le mécanisme de heal comme une ferme de liens symboliques) ; l'ancienne installation « arbre matériel » échouait au démarrage.
- bench `run.mjs` : l'entrée du CLI dsh devient une chaîne de résolution (`DSH_BIN` → préfixe global npm → repli ancienne disposition),
  suppression des chemins personnels codés en dur, exécutable directement sur les autres machines.

## [0.8.1] — 2026-08-20

Bascule runtime du modèle de distillation + réessais anti-pollution des téléchargements de modèles + DSH-MemBench v3.

### Ajouts

- **Ajustement runtime du budget de sortie de la distillation** (page de paramètres → Mémoire → Aperçu → Paramètres de distillation → budget de sortie) :
  le plafond de tokens de chacune des quatre couches extraction / déduplication / scène L2 / profil L3 devient réglable dans l'UI (c'étaient des constantes du code, tout ajustement exigeait de toucher le fichier de configuration et de réinstaller) ; vide ou 0 = suivre les défauts intégrés (16k/8k/32k/16k),
  l'amplification ×4 des niveaux de réflexion high/max s'applique toujours au-dessus de la valeur effective. Le panneau d'interrupteurs de la page de paramètres est réorganisé au passage en deux groupes « mode mémoire / paramètres de distillation », regroupement des options plus lisible.
- **Ajustement runtime du budget d'entrée de la distillation** (même groupe → budget d'entrée) : le plafond de caractères d'entrée d'un appel de distillation
  (`llm.maxInputChars`, défaut 700 000) devient réglable dans l'UI, vide/0 = suivre la configuration statique ; le blocage de l'extraction L1, la troncature L2/L3 et l'estimation du nombre d'appels de reconstruction suivent toute la chaîne sur la valeur effective.
- **Bascule runtime du modèle de distillation** (page de paramètres → Mémoire → Aperçu → sélecteur « modèle de distillation ») : choix du provider/model de distillation parmi les **routes de fournisseurs configurées** de l'hôte
  (y compris les fournisseurs compatibles OpenAI personnalisés ajoutés dans dsh → réglages → modèles), effet immédiat, sans redémarrage, persistant au redémarrage. Priorité :
  pin statique du déploiement (`llm.provider`+`llm.model` remplis tous les deux, pour empêcher un choix utilisateur d'expédier la conversation ailleurs)
  > sélection runtime > modèle par défaut. Nouveaux endpoints RPC `dsh-memory/llm-providers`
  (catalogue des fournisseurs + sélection par défaut + surcharge courante + route réellement effective + le fournisseur choisi est-il toujours enregistré)
  et `dsh-memory/llm-models` (modèles par fournisseur ; si l'adaptateur ne fournit pas de catalogue, l'UI dégrade en saisie manuelle) ;
  après suppression du fournisseur/modèle, l'UI indique explicitement « sorti de la liste » et invite à choisir de nouveau.

### Corrections

- **EmbeddingGemma impossible à installer** (vraie cause racine) : le sha256 de `generation_config.json` du catalogue était recopié avec un caractère faux (`a736d1b3` au lieu de `a736b1b3`) — le miroir n'a jamais renvoyé un seul octet erroné, c'est le contrat d'intégrité lui-même qui était faux ; le téléchargement échouait à coup sûr en « échec de vérification sha256 » sans aucune piste. Corrigé selon les mesures, et les 19 fichiers du catalogue ont fait l'objet d'une vérification autoritaire (fichiers LFS confrontés aux oid de l'arbre HF, petits fichiers hachés réellement) — tous les autres concordent. Nouveau `npm run verify-catalog`
  (`scripts/verify-catalog.mjs`) pour revérifier d'un coup à chaque montée du catalogue, afin d'exclure les accidents de recopie du même genre.
- **Téléchargements de modèles qui n'aboutissent pas / trop lents** (problème concomitant, mesuré dans le même scénario) : le miroir en direct est par intermittence inaccessible dans les réseaux chinois (alternance de timeouts TCP et de fenêtres accessibles), et le fetch de Node ne lit pas les variables d'environnement de proxy —
  le téléchargeur supporte désormais le proxy (nouvelle configuration à trois états `embedding.proxy` : par défaut détection automatique des
  `HTTPS_PROXY`/`ALL_PROXY` etc. en respectant `NO_PROXY`, `none` force la connexion directe,
  ou URL de proxy explicite ; passe par le `ProxyAgent` d'undici, même sémantique que curl/npm).
- **Résilience du téléchargeur** : réessai automatique en cas d'échec d'un fichier (2 fois par défaut, à 1 s/3 s d'intervalle) et à chaque réessai ajout de
  `?dshmem-retry=N` pour changer la clé de cache — dans la fenêtre d'un objet de cache corrompu côté CDN du miroir, la même URL reçoit de façon déterministe la même mauvaise réponse, seul le changement de clé permet de récupérer un autre objet. Échec de vérification → retéléchargement de zéro (point de reprise pollué supprimé),
  compte de fichiers non concordant/erreur réseau → conservation de la reprise après interruption ; l'annulation n'est pas affectée ; la sémantique de reprise inter-processus est inchangée.

### Référence et documentation

- **DSH-MemBench v3** (`bench/`) : piste dialogue (15 scènes × 6 types × 3 passages
  = 270 questions/groupe) + piste workflow (4 scènes en sandbox d'outils réelle), double rail de comparaison A/B — **groupe A (mémoire
  allumée) contre groupe B (mémoire éteinte)**, même bibliothèque de scènes, entrées identiques au mot, pilotage automatisé sans tête (profil dsh headless + plugin runner local), notation à deux niveaux programme/LLM ; indicateurs d'intégrité complets : détection de contamination inter-scènes (balayage des marqueurs de scène), audit des débordements d'outils, taux de cache stationnaire (hors premières requêtes de session), spécial mise à jour des connaissances (répondre l'ancienne après revirement = 0) et spécial refus de réponse (inventer = 0). `run.mjs` lance A/B d'une commande,
  `report.mjs` produit le rapport structuré, `compare.mjs` sert aux comparaisons de régression avant/après modification du plugin ;
  la base officielle (résultats complets des deux pistes × A/B × 3 passages) est archivée dans `bench/baseline/`. L'ancien scénario manuel agentic (v2) est retiré.
- **Le README « comparaison mesurée » se remplit des chiffres réels** (synchronisé chinois-anglais) : piste dialogue, précision totale groupe A 92,6 %
  (250/270) contre groupe B 17,8 % (48/270), zéro invention des deux côtés ; décomposition du double canal de rappel (75,1 % de touches par injection passive + 84 questions en requête active, 60 questions sauvées par les outils de mémoire) ; piste workflow, le groupe B paie +49 % de pas / +61 % d'appels d'outils / +43 % de tokens d'entrée, scène de connexion +88 % d'entrée (les identifiants ne vivent que dans la mémoire, le groupe B repose la question à l'utilisateur à chaque tour). Les tableaux de mesures passent aux graphiques SVG (`bench-dialog` /
  `bench-workflow`), l'ensemble des illustrations SVG du README prend la nouvelle identité or/bleu profond (`flow` /
  `storage` synchronisés).

## [0.8.0] — 2026-08-18

Paquet d'optimisation de la mémoire (décisions enregistrées ADR-0001/0002/0003) :
injection côté messages du rappel + refonte des déclencheurs de distillation (seuil progressif + isolation de session sur toute la chaîne) + budgets de sortie par couche + correction de la voie d'écriture FTS.

### Ajouts

- **Injection côté messages du rappel** (ADR-0001) : les mémoires pertinentes sont injectées dans le flux comme un message synthétique signé du plugin (`form: 'recall'`,
  l'UI de l'hôte affiche la ligne de signature **« context injection · memory »**) placé avant chaque nouveau message utilisateur
  — l'utilisateur voit directement que « la mémoire a agi ». Balise `<relevant-memories>` + phrase d'escorte « à titre indicatif » ; les pas d'outils purs / décisions reject sont transmis tels quels ; déclenchement seulement aux étapes qui ont un nouveau message utilisateur
  (début de tour + interjections de pilotage). Le guide d'outils précise que dans les environnements restreints (comme le mode code-runtime n'autorisant que l'entrée d'exécution de code), les outils mémoire doivent être utilisés indirectement via le mécanisme d'appel de cet environnement. Le prompt système ne garde que le contenu stable
  (profil/navigation/guide de filtrage), le slot dynamique `memory:recall` est retiré ;
- **Budget de rappel** : `recall.maxCharsPerMemory` (défaut 500) / `recall.maxTotalRecallChars`
  (défaut 2000) — au-delà, troncature avec l'escorte `… (tronqué ; utilisez memory_search ou conversation_search
  pour le détail)` qui aiguise le modèle vers les outils pour le texte intégral (la troncature est un entonnoir : le chemin des outils renvoie l'enregistrement complet) ; au-delà du total, on perd la queue à bas score ; troncature sûre par point de code ;
- **Timeout de rappel** : `recall.timeoutMs` (défaut 5000, 0 = illimité) comme budget total, au-delà l'injection du tour est sautée ;
  clamp interne à 3000 ms du fetch d'embedding distant (pour laisser le temps à la descente FTS), pas de clamp pour l'inférence locale ;
- **Seuil progressif de distillation** (ADR-0003) : le seuil effectif grimpe 1→2→4→stationnaire (la sémantique de `extract.minMessages`
  devient seuil stationnaire, défaut 1→6) — les nouveaux utilisateurs obtiennent une mémoire dès le premier tour, en régime établi l'accumulation en lots économise les appels ; l'état de la montée est persisté avec pending.json ;
- **Filet d'inactivité** : `extract.idleSeconds` (défaut 300, 0 = désactivé) — après que la session s'est tue le temps voulu, les tranches non distillées
  tombent dans le sac automatiquement ; les sessions off suspendues sont sautées ;
- **Synchronisation des tranches au changement de mode** : bascule entre modes non off → les tranches de cette session sont distillées immédiatement selon le mode de capture ; bascule vers off → suspension ; retour depuis off → les tranches suspendues tombent selon le mode de capture (les tranches ne se mélangent jamais entre modes) ;
- **Budgets de sortie par couche** : extraction 16k / déduplication 8k / L2 32k / L3 16k ; ×4 automatique en niveaux de réflexion high/max
  (garde contre l'accident historique du reasoning qui dévorait le budget) ; `llm.maxTokens` par défaut 256k→65536, rétrogradé en vanne générale de secours.

### Corrections

- **Contamination inter-sessions** (défaut existant) : les messages de contexte de l'extraction étaient un tableau mémoire global (le contenu de la session A servait de contexte à la session B et se perdait au redémarrage) ; désormais interrogés à la volée dans L0 par session (via l'index de session) en excluant la tranche elle-même ; les déclencheurs de distillation comptent les tranches par session et n'extraient que les tranches au seuil atteint — les cinq couloirs (seuil/idle/contexte/changement de mode/résidus de réessai) sont tous isolés par session (ADR-0003) ;
- **Amplification O(N²) de la voie d'écriture FTS** : la suppression défensive du FTS passe à une pré-vérification d'existence par requête ponctuelle sur la table principale (record_id est UNINDEXED dans la table FTS, un DELETE par id = balayage complet — les chemins d'insertion neuve comme reconstruction/re-embedding/import payaient à chaque enregistrement un balayage complet). Comportement externe identique point par point (ADR-0002 ; le schéma de mapping par rowid a été écarté pour son risque de suppression erronée silencieuse par cartographie périmée).

### Changements

- Le guide d'outils passe à un filtrage à trois conditions (`tools activé && profil ∥ navigation ∥ toucher de rappel au tour`) : les utilisateurs de base vide et ceux qui ont désactivé les outils ne paient plus ces tokens fixes à chaque étape ;
- pending.json gagne un champ `sessionId` dans ses entrées persistées (l'ancien format tombe automatiquement dans le groupe de session legacy),
  et persiste en même temps l'état du seuil progressif ;
- le rattrapage de démarrage met en file par tranches de session ;
- **la tokenisation de la recherche chinoise passe des bigrammes CJK à la tokenisation par mots jieba** (alignée sur l'implémentation officielle de MemoryCore) :
  `@node-rs/jieba` (binaire napi Rust précompilé) produit l'union ordonnée et dédoublonnée de **tokens jieba ∪ mots latins ∪ bigrammes CJK** — les tokens donnent à BM25 les hits de mots entiers à fort idf, les bigrammes garantissent la ligne de fond du rappel de sous-mots ; échec de chargement → repli automatique sur les seuls bigrammes (mode intra-processus, dérive impossible) ; estampille de version du tokeniseur FTS (`fts_tokenizer` : `jieba-v1` /
  `bigram-v1`) : si l'estampille ne correspond pas, drop + reconstruction + réinjection automatiques ; les anciennes bases sans estampille sont traitées comme `bigram-v1` au premier démarrage, migration automatique.

## [0.7.1] — 2026-08-17

Lot de corrections de la revue intégrale (2026-08-17) : compléments documentaires + performances du stockage + durcissement de la chaîne d'approvisionnement de l'installation runtime.

### Performances

- **`PRAGMA synchronous=NORMAL`** (niveau recommandé officiel du WAL) : l'écriture par lots passe d'un fsync par transaction à un par
  checkpoint, re-embedding et import s'accélèrent ; le seul prix, c'est la perte des dernières transactions commises en cas de coupure de courant (on perd, on ne corrompt pas) ;
- **Écritures vectorielles du reindex transactionnalisées** : les écritures brutes ligne à ligne du re-embedding L1/L0 deviennent des lots par blocs (16/32 lignes) en une transaction
  (échec du lot entier → repli unitaire, les bonnes lignes ne sont pas perdues), qui, avec le point précédent, raccourcit fortement le temps de re-embedding des grosses bases.

### Sécurité

- **Le runtime d'embedding local passe à `npm ci` + lockfile embarqué** : `resources/runtime-package-lock.json`
  (copié dans dist/ à la construction) fige chez l'auteur l'arbre complet des dépendances transitives de `@huggingface/transformers` —
  l'ancien `npm install pkg@version-exacte` ne verrouillait que les dépendances directes, les transitives flottaient au gré du semver, et les publications/empoisonnements ultérieurs du registry dérivaient selon l'heure d'installation. Échec du ci (dérive du lock etc.) → repli automatique sur install (la disponibilité d'abord).

### Documentation

- Le CHANGELOG reçoit les entrées [0.5.3] / [0.5.4] manquantes (npm avait déjà publié) ;
- la table de configuration des README chinois et anglais gagne 5 lignes : `recall.includePersona` / `recall.includeSceneNav` /
  `embedding.maxInputChars` / `embedding.timeoutMs` / `llm.timeoutMs` ;
- correction de la coquille du texte chinois « inter-famille » (il fallait « inter-familles/cross-family ») ; les anciens chemins de layout de stockage du document d'expérience développeur
  (`l0/ l1/` → `conversations/ records/`) ; le nom du fichier persona de CONTEXT.md passe à la forme par famille.

## [0.7.0] — 2026-08-17

Modèles d'embedding locaux et bascule à chaud (la plus grosse fonctionnalité), double thème Light/Dark, lot de corrections de la revue de code intégrale (issues #1-#24).

### Ajouts

- **Modèles d'embedding locaux** (#20-#24) : **source d'embedding à trois états** (éteinte / distante / locale) commutable à runtime,
  état persisté dans `embedding-source.json`, l'effet = plafond de déploiement AND choix runtime ;
  - **Catalogue de modèles intégré** (liste blanche, révision verrouillée + sha256 par fichier) : BGE small chinois
    (512 dimensions / ~25 Mo), EmbeddingGemma 300M (768 dimensions / ~330 Mo, même modèle que l'amont MemoryCore),
    BGE-M3 (1024 dimensions / ~590 Mo, contexte 8192) ; miroir par défaut `hf-mirror.com` configurable
    (`embedding.mirror`), reprise `.part` après interruption + vérification sha256 en flux après téléchargement ;
  - **Runtime d'inférence à la demande** (transformers.js 4.2.0) : installé par npm dans le répertoire de données `runtime/` seulement au premier passage en local
    (ancré par son propre package.json, hors de l'arbre de dépendances du plugin) ; les modèles s'installent dans `models/<id>/`,
    supprimables depuis la page de paramètres (le modèle en cours d'utilisation est protégé) ;
  - **Chaîne de bascule à chaud** : préchauffage et chargement → changement de service + swapProvider (changement de dimension = DROP de la table vectorielle) →
    synchronisation immédiate du meta → ré-embedding intégral en arrière-plan (progression par compteurs L1/L0, annulable) → l'état n'est persisté qu'après succès ;
    en cas d'échec, l'ancienne source reste (redémarrage sur la source d'origine) ; annulation/échecs partiels du ré-embedding rattrapés par le backfill périodique de 30 minutes ;
  - Nouvelles configurations : `embedding.allowLocalModels` (le déploiement interdit le mode local), `embedding.mirror` ;
- **Adaptation double thème Light/Dark de la page de paramètres et de la barre de saisie** (#15-#19) : deux étages de jetons (alias dsh de l'hôte en chaîne +
  surcharge du jeu entier des jetons sémantiques propres), le changement de theme échange les valeurs des variables CSS sur place sans re-rendu React ;
- **Refonte de l'UI du sélecteur de mode** : modes traduits en chinois (日常 / 工作 / 智能 / 关闭), panneau flottant refait,
  remplissage du curseur (clair à gauche, sombre à droite, toujours visible pendant le glissement), bulle de glissement (double pointe en triangle inversé), **couche de particules**
  (champ de particules en pointillés, intensité du champ par mode : 日常 épars / 工作 ondulations / 智能 plein champ, blending multiply en thème clair) ;
  le système de design est archivé dans le répertoire `design/` (quatre specs : global / pill / slider / settings).

### Corrections (revue intégrale #1-#14 + revue indépendante F1-F4 + coutures d'assemblage)

- store : l'échec d'écriture FTS entraîne le rollback de toute la transaction (fin des trous d'index silencieux, #2) ; le complément d'embedding passe en incrémental +
  vecteurs nuls notés skipped (répare la boucle infinie de ré-embedding intégral toutes les 30 minutes, #3) ; échec de lot → repli unitaire +
  invalidation du cache de requêtes au DROP + plafond du set de skip (F2-F4) ;
- cycle de vie : ordre d'arrêt — stopper d'abord les tâches/flusher la chaîne L0 avant de fermer la base (#5) ; libération des références au tampon de capture/snapshot de reconstruction/pending
  en trois endroits (#4) ;
- recall : la query ne prend que les 8 derniers messages + plafond de 2000 caractères, query vide → cache vidé (#6) ;
- settings : réutilisation du scope intra-processus au redémarrage de fibre, les interrupteurs ne sont plus ignorés en silence (#8) ; scope mis en cache à la vie près par instance de service,
  re-montage automatique au redémarrage du service (F1) ;
- rpc : re-montage automatique des enregistrements RPC après départ/remplacement du service connection (#9) ;
- client : états d'erreur des trois panneaux + badge de dégradation de l'aperçu (#7) ; numéros de série des requêtes de liste qui jettent les réponses périmées (#10) ;
- tools : les trois outils en mode off répondent uniformément par l'avis ; pagination des recherches avec marqueur de troncature explicite (#11) ;
- log : lecture par blocs à rebours de log-tail + repli de troncature en cas d'échec répété de rotation (#12) ;
- config : bornes numériques + troncature de la persistance pending + remise à zéro de l'interrupteur d'extension (#13) ;
- **couture d'assemblage des stats** : le handler `/rpc` ne transmettait pas `embedManager` dans ses deps — l'UI de gestion des embeddings affichait en permanence
  « stockage dégradé » (l'absence du champ optionnel n'était interceptable ni par TS ni par le smoke ; réparé).

### Performances

- Réutilisation des requêtes précompilées du chemin chaud de recherche + découpage des IN + transactions par lots L1 (#14).

### Documentation

- Grande révision du README : nouvelle section « recherche sémantique (source d'embeddings) » (table à trois états / table du catalogue de modèles / téléchargement et bascule à chaud) ;
  Hero / mémoire stratifiée / modes de session passent aux images générées image2 ; nouvelle aperçu d'interface (vraies captures des deux thèmes clair et sombre) ;
  storage.svg gagne les trois états de la source d'embedding et les nouvelles formes de fichiers ; la table de configuration gagne deux lignes ;
- le contexte développeur gagne un glossaire « embeddings et recherche » ; archivage du rapport de revue de code intégrale du 2026-08-17.

## [0.6.1] — 2026-08-17

- Défaut de `llm.maxTokens` 20000 → **256000** : en niveau de réflexion high par défaut, v4-flash pouvait épuiser n'importe quel budget de sortie laissant le corps à 0 caractère ; budget donné en large et, avec lui, réflexion par défaut sur off.

## [0.6.0] — 2026-08-17

Niveaux de réflexion de la distillation + refonte de l'UI du sélecteur de mémoire + renforcements de fiabilité.

### Ajouts

- **Niveaux de réflexion de la distillation** : configuration `llm.reasoningEffort` (`off`/`high`/`max`/chaîne vide, défaut `off`)
  + bascule runtime dans l'onglet Aperçu de la page de paramètres (choisir « suivre la configuration » revient au défaut du déploiement, persisté par le service settings) ;
  le réflexion par défaut des modèles de raisonnement pouvait épuiser le budget de sortie et laisser le corps à 0 caractère, d'où réflexion éteinte par défaut pour la distillation ;
- **Persistance du tampon non distillé** : messages en échec à re-tenter et messages en cours d'accumulation avant seuil, stockés par mode dans des seaux de `pending.json`
  (écrits atomiquement après chaque tentative de distillation), rien ne se perd au redémarrage, rattrapage automatique 20 secondes après le démarrage ;
- **Reconstruction intégrale de la mémoire** (page de paramètres → Mémoire → Aperçu → Reconstruire la mémoire) : réimport de tous les niveaux dérivés en prenant L0 comme source de vérité,
  les anciens produits archivés en bloc sans suppression, blocage en basse priorité (cède la place à la conversation normale), avec pop-up de confirmation/progression/annulation ;
  re-distillation unifiée en mode intelligent (auto), blocage par sessions (sessions triées par heure du premier message), pendant la reconstruction les nouvelles conversations passent par les tours normaux.

### Changements

- Refonte de l'UI du sélecteur de mémoire : flux conic bleu froid sur les bords du mode auto, couche flottante de verre à la Apple (structure à trois étages, réparation du
  échec d'échantillonnage de backdrop-filter sous Chromium), glissement 1:1 du curseur + aimantation par projection d'élan au lâcher ;
  couleurs des lignes/arrêts/étiquettes thématisées.

## [0.5.4] — 2026-08-16

Industrialisation de la publication : lancement de npm Trusted Publishing (OIDC GitHub Actions) — le push d'un tag `v*` publie automatiquement,
sans token ni 2FA ; le contrôle de cohérence entre tag et version du package.json n'agit que sur déclenchement par tag (un essai manuel via `workflow_dispatch`
peut parcourir la chaîne d'authentification de la publication, pour vérifier l'OIDC). Aucun changement visible de l'utilisateur.

## [0.5.3] — 2026-08-16

### Corrections

- Le compteur de seuil est persisté immédiatement après l'extraction L1 (une sortie en cours de processus ne revient pas en arrière, pas de double extraction au redémarrage) ;
- le budget de sortie de la distillation passe uniformément par `llm.maxTokens` (défaut 20000, pour empêcher le reasoning des modèles de réflexion de dévorer le budget et laisser le corps à 0 caractère).

### Ajouts

- L'injection du profil/de la navigation de scènes du mode auto se structure : regroupement par catégories + balises de domaine `<domain family>`, à la place de la concaténation brutale des deux familles.

### Documentation

- Le README passe l'installation par npm en premier choix (GitHub / chemin local en options), `files` embarque la ressource hero.

## [0.5.2] — 2026-08-16

Correction du grave bug sur Linux/macOS où « tout appel d'outil renvoyait
`Cannot read properties of undefined (reading 'prepare') »`
(accident réel sous WSL : dès le premier appel de l'outil bash, crash, échec au niveau du tour).

### Cause racine

Le plugin déclarait les paquets de runtime de l'hôte (`@deepseek-ai/cordis`, `dsh-tools` etc.) comme simples
`dependencies` — l'installateur en installait des **copies privées** pour le plugin, formant avec le graphe de modules de l'hôte un **double
`dsh-tools` en deux instances**. Le service `ToolRuntime` était instancié depuis la copie du plugin, tandis que
`dsh-agent-loop` lisait le scheduler avec le `Symbol(@deepseek-ai/dsh-tools.scheduler)` de la copie de l'hôte — les identités de Symbol n'étaient pas égales (même nom, instances différentes), la lecture tombait à l'eau → chaque appel d'outil
levait un TypeError à `scheduler.prepare`. Sous Windows, l'ordre de résolution des deux graphes coïncidait par chance et ça marchait ; sous Linux (hoisting pnpm + disposition en liens symboliques), c'était systématique.

### Corrections

- **Les paquets de runtime hôte passent en `peerDependencies`** (alignés sur la convention des plugins officiels, comme
  `dsh-bash-local` : cordis / dsh-agent / dsh-home-paths / dsh-llm /
  dsh-session / dsh-settings / dsh-system-prompt / dsh-tools, plage `^`),
  l'installation ne produit plus de copies privées, plugin et hôte partagent le même graphe de modules ;
- les versions nécessaires au développement local migrent dans `devDependencies` (construction/maîtrise de fumée non affectées) ;
- les dépendances de pure bibliothèque restent en `dependencies` (schemastery, sqlite-vec).

## [0.5.1] — 2026-08-16

Correction du bug d'enregistrement client introduit par le renommage du 0.5.0 (accident réel : après installation depuis GitHub, le côté navigateur affichait
`client-modules: bundle ... loaded without registering "dsh-prime-memory"` et tous les contrôles de mémoire de la page de paramètres comme de la barre d'entrée étaient inutilisables).

### Corrections

- **L'id d'enregistrement du bundle client suit le nouveau nom du paquet** : dans `client/client.js`, le
  `window.__ModuleLoader__.load({ id: ... })` passe de l'ancien nom `dsh-memory-plugin` à
  `dsh-prime-memory` — lors du renommage du 0.5.0, on n'avait changé que le côté hôte et la déclaration de bundle, en oubliant la moitié navigateur,
  de sorte que le nom de l'entrée du loader et le nom d'enregistrement divergeaient et le chargement du bundle échouait aussitôt. Le nom du plugin côté hôte
  `dsh-memory-plugin`, la clé de configuration `dsh-memory` et les endpoints RPC `dsh-memory/*` restent inchangés
  (les modifier briserait les configurations existantes et les canaux de données).

### Documentation

- Embellissement visuel du README (beautify-github-readme) : hero natif du projet (`assets/readme/hero.svg`,
  un SVG du pipeline stratifié L0→L3, la largeur décroissante traduisant la raffinage des données) ; réordonnancement en « valeur → mécanisme → premier usage → détails »,
  fusion des sections en doublon, incorporation sous la forme `<p align="center"><img width="100%">`.

## [0.5.0] — 2026-08-16

Refonte pour la publication publique : le paquet est renommé **`dsh-prime-memory`** (l'ancien nom `dsh-memory-plugin` était déjà occupé sur npm par
un plugin du même genre), et l'empaquetage conforme à la spécification officielle des paquets composés (bundle) est achevé.

### Changements

- **Déclaration de `dsh.bundle`** (nouveau `cordis.patch.yml` à la racine) : après l'installation en une commande `dsh plugin --profile <name> add`,
  **la ligne du plugin se monte automatiquement**, plus besoin de retoucher à la main le patch.yml du profil ;
  `files` embarque ce fichier au passage ;
- **Dé-machinisation des dépendances** : les `@deepseek-ai/*` passent des chemins absolus `file:` (pointant vers le profil local) aux versions exactes npm
  (`0.1.0-rc.6` d'un côté, cordis `4.0.1`, schemastery `3.18.1`) — n'importe quelle machine résout par `npm install` / `dsh plugin add`
  (rc.6 est suspendu au dist-tag `next`, ne pas utiliser de plage `^`) ;
- hygiène du dépôt : LICENSE MIT, `.gitignore` (ignore `node_modules/`, `dist-smoke/`, `.zcode/`),
  réécriture de la section installation du README (installation en une commande + désinstallation + conseil de sûreté + développement depuis les sources), correction des titres dupliqués.

## [0.4.2] — 2026-08-16

Diagnostic renforcé des sorties vides du LLM de distillation (accident réel : deux tours d'affilée de déduplication/extraction L1 avec 0 caractère de sortie, et dans les journaux rien qu'une
`excerpt des 400 premiers caractères de la sortie brute :` vide, aucun indice sur place).

### Valeur du diagnostic de cause racine

`callLLM` ne journalisait à l'origine que le nombre de caractères d'entrée/sortie ; quand « le flux se terminait normalement sans avoir émis un seul mot », impossible de distinguer
« le modèle n'a produit que du reasoning (texte vide) » d'« une réponse vide côté serveur ». Les deux échecs constatés
(35~38 s, 0 caractère, 13 000 caractères d'entrée) étaient loin du budget de timeout (120 s) et de maxTokens (4096).

### Changements

- `callLLM` collecte des **statistiques par blocs** dans le flux : raison de fin (stop/max-tokens/tool-calls/error/aborted),
  compteurs de tokens du usage (outputTokens/reasoningTokens), nombre et caractères des blocs text-delta,
  caractères des reasoning-delta (avec extrait de 300 caractères), distribution des types de block-end ;
- **journal warn de diagnostic quand la sortie est vide**, portant toutes ces statistiques — la prochaine sortie vide permettra de trancher d'emblée si le reasoning a dévoré le budget, la raison de fin, ou si le serveur a répondu vide ;
- le journal ordinaire `LLM 调用` ajoute la raison de fin (zéro surcoût quand la sortie n'est pas vide).

## [0.4.1] — 2026-08-16

Correction du défaut de capture L0 qui perdait le message user des tours à longues réponses (accident réel : dans une conversation de 4 tours, le tour 3 perdait le message user et le tour 4 perdait user + le premier message assistant).

### Cause racine

Le session.jsonl exporté est un journal **après compression** ; dans le flux temps réel de `session/event`, chaque réponse en streaming transporte en plus de nombreux événements
text-delta/reasoning chunk. Les tours à longues réponses (long texte + raisonnement + recherche en ligne) dépassaient le `MAX_BUFFER=500` du tampon de capture en nombre d'événements, et la coupe par la tête (`splice(0, len-500)`) emportait le `turn/start` **le plus ancien** du tour et le message user — `findTurnStart` ne trouvait plus le début du tour et la capture dégénérait en « tout le tampon comme tour courant », ne laissant que les messages de queue du tour. Les tours à réponses courtes n'atteignaient pas la limite, d'où l'intégrité des tours 1 et 2.

### Corrections

- **Le tampon n'accepte que 4 types d'événements** (user/message, assistant/message, turn/start, turn/end),
  les chunks de streaming sont jetés à l'entrée (`isCaptureRelevant`) — le volume du tampon passe de centaines/tour à quelques unités/tour ;
- **loi de coupe** : les événements d'un tour en cours (après un turn/start non refermé) ne se coupent jamais, on ne coupe que le préfixe terminé qui le précède
  (`trimBuffer`, défensif et quasiment inatteignable) ;
- **écriture L0 immédiate** : au turn/end, écriture aussitôt via une chaîne sérielle indépendante (`capture.ts`), sans passer par la file de distillation —
  avant, L0 pouvait être bloqué par un appel LLM lent (26 s mesurés) et si dsh sortait en pleine distillation, le L0 en file se perdait ; le runner n'a plus en charge l'écriture du L0.

### Vérification

- Le smoke gagne une section 12 : whitelist des 4 types d'événements, exclusion des chunks, scénario de coupe à 600 événements + tour en cours
  (turn/start + user non perdus), limite de 500 quand aucun tour en cours, pas de coupe sous la limite.

## [0.4.0] — 2026-08-16

Modes de mémoire par session : contrôle à quatre états (auto/chat/work/off) + isolation écriture-rappel dans le même mode + stockage L2/L3 par familles.

### Ajouts (UI)

- **Contrôle de mode dans la barre d'entrée** (`conversation.input.left`, à droite du sélecteur de mode) : le pill affiche le mode courant
  (`记忆·自动` etc., coloré selon le mode), un clic fait flotter au-dessus un **sélecteur glissant à la macOS** —
  rail horizontal + quatre points d'arrêt (off · chat · work · auto), la ligne traverse le centre de la boule,
  poignée de glissement (avec ombre), **aimantation au point d'arrêt le plus proche au lâcher** puis envoi optimiste par RPC (rollback en cas d'échec + indication rouge) ;
  le mode courant est indiqué par le surlignage de l'étiquette du dessous (pas de texte au-dessus) ; cliquer l'étiquette d'un arrêt saute directement au mode, clic extérieur/Esc pour fermer ;
  au changement de session, le composant se remonte automatiquement et récupère le mode de cette session ;
- le navigateur de la page de paramètres garde la **vue mixte** des deux familles (concaténation des endpoints scènes/profil), et le « Famille de prompts » de l'aperçu devient « mode par défaut ».

### Ajouts (sémantique : écriture et rappel dans le même mode)

- **Quatre états de mode** (`MemoryMode = auto | chat | work | off`), indépendant par session, persisté par sessionId dans `session-modes.json`
  (> 90 jours / > 500 entrées nettoyage automatique, écritures sérialisées) :
  - `chat` / `work` : le prompt étroit distille sa famille → écriture seulement dans la bibliothèque de sa famille ; le rappel ne consulte que les mémoires de la famille + profil/navigation de scènes de la famille ;
  - `auto` (**défaut des nouvelles sessions**) : extraction en un seul passage avec prompt à vocabulaire fusionné (trois classes personnelles + quatre classes de travail, les 7 ouvertes),
    chaque mémoire reçoit son étiquette de famille par préfixe de type ; le rappel ouvre les deux familles (profil/navigation concaténés des deux familles) ;
  - `off` : cette session est totalement invisible pour le système de mémoire — pas d'écriture L0, pas de distillation, pas de rappel, les trois outils du modèle répondent par l'avis ;
- le mode par défaut des nouvelles sessions = configuration `family` (l'union s'élargit à `auto|chat|work`, défaut `auto`, sémantique rétrogradée en
  « mode par défaut » ; les chat/work configurés explicitement par les anciens déploiements restent valables) ; le changement en cours de session s'applique au tour suivant, les mémoires déjà extraites restent dans leur famille d'origine ;
- se superpose à l'interrupteur global : le global est la vanne maîtresse, les modes de session se déclinent en dessous.

### Changements (isolation de stockage par familles)

- **memory.db reste une base unique** : `l1_records`/`l1_fts` gagnent une colonne `family` (stock existant remis par préfixe de type,
  la table FTS se reconstruit automatiquement) ; les trois stratégies de recherche (FTS/vecteur/hybrid) supportent toutes le filtrage par famille (voie vectorielle : sur-rappel + re-filtrage en aval) ;
- **L2/L3 éclatés en fichiers par famille** : `scenes/chat|work/` (les anciens `scenes/*.md` migrent automatiquement en chat),
  `persona-chat.md` / `persona-work.md` (l'ancien `persona.md` est renommé automatiquement), `state.json` monte en v2
  avec checkpoint par famille (le contenu plat ancien tombe dans le seau chat) ; compteurs de seuils L2/L3, chaînes de contexte, variantes de prompt, tous indépendants ;
- les candidats de déduplication ne sont rappelés que dans la même famille (la déduplication ne franchit jamais les familles) ; le tampon L1 à re-tenter est mis en seaux par mode ;
- les outils du modèle se filtrent selon le mode de la session appelante (`exec.agent.id === sessionId`) ;
  `memory_read_scene` cherche par nom dans les répertoires des deux familles, le paramètre persona devient `persona-chat.md|persona-work.md`.

### Ajouts (RPC)

- `dsh-memory/session-mode-get {sessionId} → {mode, defaultMode}` et
  `dsh-memory/session-mode-set {sessionId, mode}` (validation par whitelist des quatre valeurs).

### Migration (tout s'exécute automatiquement dans init)

1. `l1_records` : ALTER pour ajouter la colonne family + remplissage par préfixe de type ; si `l1_fts` manque la colonne, drop + reconstruction + réinjection ;
2. `state.json` : v1 plat → v2 par familles (anciennes données rangées en chat) ;
3. `scenes/*.md` → `scenes/chat/` ; `persona.md` → `persona-chat.md` ;
4. **synchronisation du déploiement** : supprimer du `cordis.patch.yml` du profil web la ligne `family: chat` (sinon le mode par défaut resterait chat).

### Vérification

- Le smoke gagne une section 11 : inférence des étiquettes de famille / persistance du stockage des modes et mode par défaut / filtrage FTS par famille + isolation des candidats +
  filtrage des listes par famille / migration et remplissage d'une vraie ancienne base (sans colonne family) + reconstruction FTS / migration des anciens fichiers scènes et profil /
  state v1→v2 / prompt à vocabulaire fusionné contenant les 7 classes / endpoints RPC de modes (refus des valeurs illégales comprises) ;
- `Config['~standard'].validate({})` passe avec family=auto par défaut.

## [0.3.0] — 2026-08-16

Navigateur de mémoires + interrupteurs du mode mémoire : la page « Mémoire » des paramètres monte d'une simple table de comptes en texte à un panneau de contenu à plusieurs onglets.

### Ajouts (UI)

- **Navigateur de mémoires multi-onglets** (Paramètres → Mémoire) :
  - **Aperçu** : compteurs d'exécution + panneau d'interrupteurs du mode mémoire + rafraîchissement automatique toutes les 5 secondes ;
  - **Mémoire** : liste des cartes de mémoires L1 — recherche par mots-clés (BM25, même source que le rappel) + filtres par type/contexte +
    affichage de la pertinence + clic pour déplier le détail (chaîne d'horodatages/version/messages sources) ; tri par mise à jour décroissante par défaut, chargement paginé ;
  - **Scènes** : texte intégral des blocs de scène L2 (avec META popularité/résumé) ;
  - **Profil** : texte intégral du persona L3 ;
  - **Journaux** : défilement des 200 dernières lignes de memory.log.
- **Interrupteurs du mode mémoire** (interrupteur général + trois sous-interrupteurs capture/distillation/rappel, grisés quand le général est éteint) :
  passent par le service settings officiel (namespace `dsh-memory`, effet live, persistance officielle),
  les interrupteurs de page écrivent via le RPC en loopback ; sémantique = configuration statique (plafond de déploiement) AND interrupteur runtime.

### Ajouts (Host)

- Nouveaux endpoints RPC (en gardant le couloir loopback `/rpc`) : `dsh-memory/settings-get` / `settings-set` /
  `list-records` (pagination de navigation + double voie par mots-clés + facettes de scènes) / `scenes` / `persona` / `log-tail` ;
- `L1Store.list()` (SQL trié par mise à jour décroissante + filtres type/contexte + pagination) et `distinctScenes()` ;
- filtrage runtime en trois endroits : l'entrée des événements de capture, l'étape de distillation du runner, la fonction de texte d'injection du rappel ;
- si le service settings est prêt après le plugin, montage automatique en complément (écoute `internal/service`), en cas d'absence tout reste ouvert avec une note.

### Vérification

- Le smoke gagne : pagination/filtres des interfaces de navigation, valeurs par défaut du schéma des interrupteurs, distribution des endpoints RPC de bout en bout
  (assertions endpoint par endpoint sur une fausse connection, écriture des interrupteurs comprise et refus des endpoints inconnus) ;
- démarrage réel : journal `interrupteurs du mode mémoire prêts (namespace settings dsh-memory)` confirmé, HTTP 200.

## [0.2.4] — 2026-08-16

Diagnosticabilité renforcée : les nœuds clés de tout le pipeline entrent dans les journaux ; à la moindre anomalie, le seul fichier `memory.log` suffit à reconstituer le chemin d'exécution.

### Ajouts

- **Statistiques des appels LLM** : chaque appel de distillation enregistre `provider/model, caractères d'entrée/sortie, durée`,
  et tout échec enregistre la cause + la durée (avant, un échec ne laissait qu'un message brut, sans contexte de route) ;
- **extrait de l'original en cas d'échec de parse JSON** : échec d'analyse des opérations d'extraction L1 / déduplication L1 / scène L2, on enregistre les 400 premiers caractères
  de la sortie brute du modèle (l'information clé pour enquêter sur la dérive des sorties du modèle) ;
- **statistiques des décisions de déduplication** : journal d'une ligne `extraction de N entrées → rappel de M candidats → décisions store/update/merge/skip=x/y/z/w`,
  sans enregistrement de décision, compté comme skip ;
- **durées des phases du pipeline** : début/fin du pipeline de distillation (avec le nombre de nouveautés du tour et la durée totale), écriture L0, durées des phases L1/L2 ;
- **détail de la capture L0** : la capture au niveau tour passe de debug à info (avec la distribution des entrées user/assistant) ;
- **touches de rappel** : au rappel, nombre d'entrées + extrait de la query (debug → info) ;
- **informations de démarrage enrichies** : la ligne du répertoire de données porte le numéro de version du plugin ; nouvelle ligne de résolution de la route du modèle de distillation
  (une erreur de route éclate au démarrage, plus d'attente du premier échec d'extraction) ;
- raisons de saut de L2 (progression du seuil) et de non-déclenchement de L3 (progression du seuil) en journal debug ;
- tous les échecs de pipeline warn avec la première frame de la pile d'erreur (`errDetail`).

## [0.2.3] — 2026-08-16

Correctifs de diagnosticabilité : après deux tours de vraie conversation, L0 avait des données mais L1 ne produisait rien, et l'hôte dsh sans journaux persistants ne permettait pas de localiser la cause.

### Ajouts

- **Journal de fichier** : le niveau info et au-dessus est miroité dans `memory.log` du répertoire de données (rotation en `.1` au-delà de 2 Mo),
  échec d'écriture ignoré en silence — l'hôte dsh n'envoie les journaux du plugin qu'à la console ; désormais, les problèmes du pipeline de distillation s'enquèrent après coup.
- **Raisons de saut de la capture L0 en journal** : les messages user interceptés par la protection de démarrage à froid et les messages d'origine non utilisateur (`source.kind≠user`)
  font chacun l'objet d'une entrée info — pour diagnostiquer les creux de capture du genre « un tour qui ne laisse que des messages assistant ».

### Corrections

- **Distinction possible entre l'état L1 « succès mais zéro production » et « échec »** : quand l'extraction réussit sans mémoire extractible,
  `state.lastExtractAt` avance aussi (avant, il restait à 0, indiscernable d'une exception d'extraction).
- **Fuite du rechargement à chaud du contexte de rappel** : le disposer de `systemPrompt.context()` n'était pas accroché au cycle de vie du plugin,
  après un hot reload les anciens enregistrements restaient et les nouvelles instances se heurtaient (`"memory:recall" is already registered`) ;
  maintenant, à la désinstallation du plugin, tous les `memory:recall` / `memory:profile` des agents se désenregistrent activement.

## [0.2.2] — 2026-08-15

Lot de corrections de la revue de code.

### Corrections (haute gravité)

- **Auto-dégradation du constructeur MemoryDb (S1/P5)** : tout échec d'ouverture de base / création de répertoire / PRAGMA ne lève plus, mais fait entrer en
  mode dégradé (toutes lectures/écritures en no-op sûrs), et `init()` court-circuite directement sur une instance déjà dégradée — **plus aucun défaut de stockage ne peut faire tomber le démarrage de l'hôte dsh** (l'invariant storage-degrade est rétabli).

### Corrections (sémantique de recherche, alignement officiel)

- **Plus de filtrage par seuil avant la fusion hybrid (P6)** : l'hybride officiel fusionne directement par RRF les listes complètes de chaque voie,
  `scoreThreshold` ne s'applique qu'aux stratégies mono-voie keyword/embedding (documenté) ;
- **scores de fusion hybrid normalisés à 0~1 (P6)** : double liste avec rang 1 = 1.0, liste unique ≤ 0.5, ce qui répare la sémantique brisée de memory_search qui rapportait au modèle des scores de 0.02~0.03 ;
- **coefficient de sur-rappel aligné officiel (P1)** : le pool de candidats est fixé à limit × 3 (même formule que la voie tool officielle),
  la suramplification du filtrage par type est retirée (le document qui disait ×5 est corrigé au passage — la description du 0.2.0 était inexacte, le code réel multipliait ×9).

### Corrections (robustesse)

- **Écriture retardée de embedding_meta (P7)** : le meta n'est persisté qu'après un ré-embedding entièrement réussi (ou une base vide sans vecteurs historiques) ; en cas d'échec, réarmement au prochain démarrage — répare la brèche « meta écrit trop tôt, table vectorielle vide pour toujours et bit de capacité à true » ;
- **complément vectoriel périodique (P3)** : quand la capacité vectorielle est activée, toutes les 30 minutes (première course 1 minute après le démarrage), comparaison du nombre de lignes vectorielles et de lignes de métadonnées, avec ré-embedding automatique des manquants — les lots d'embedding en échec ne demandent plus d'intervention manuelle ;
- **migration des anciennes données réellement vérifiée (P8)** : le renommage en `.imported` n'a lieu que si tous les enregistrements sont entrés en base, et un échec de rename / import partiel journalise vraiment et retente au prochain démarrage (upsert idempotent) ;
- **décisions de déduplication L1 en requêtes précises (S3)** : `pipeline/l1.ts` récupère les enregistrements par `getByIds()` sur l'union des ids candidats/cibles,
  au lieu d'un balayage complet `all()` à chaque tour.

### Corrections (panneau d'état)

- Le numéro de version des stats est lu depuis `package.json` (avant, 0.1.0 codé en dur) ; `message` reflète l'état dégradé ;
  `pendingExtract` est raccordé au vrai compteur à re-tenter du runner (P4) ; l'affichage du répertoire de données passe uniformément par `resolveDataDir`.

### Nettoyage (jugements de la revue)

- `EmbedHelper` converge la logique de dégradation/alerte d'embedding dupliquée entre L0/L1 ; `EmbeddingProviderInfo` exporté uniformément par
  `embedding.ts` ; le titre de la navigation de scènes référence uniformément le `NAV_HEADER` de `persona.ts` ;
- code mort retiré : `Bm25Index.add`/drapeau sale/`snippet`, `makeSnippet`, `readTodayCount`,
  les exports non consommés du recall, le paramètre onProgress inutilisé de `reindex` (la valeur de retour devient `{written, failed}` pour juger du moment du meta) ;
- la sémantique de `[DELETED]` est alignée documentairement (delete côté LLM → suppression de fichier côté ingénierie ; la liste tolère les marqueurs hérités).

## [0.2.1] — 2026-08-15

### Ajouts (contrôle du budget de tokens d'entrée)

Contexte du modèle de distillation de 1M tokens, utilisé au quotidien avec un budget d'environ 700k (`llm.maxInputChars`, défaut 700 000 caractères,
converti prudemment à 1 caractère chinois ≈ 1 token) :

- **Extraction L1 par blocs** : quand les messages à extraire dépassent le budget, découpage automatique par blocs et extraction chaînée en plusieurs passages (les noms de contexte s'enchaînent de bloc en bloc, `chunkByCharBudget`),
  aucun message ne se perd — couvre les deux chemins des tours d'agent surlongues et de l'entassement des réessais d'extraction (pire cas ~840k caractères) ;
- **troncature de secours de callLLM** : quand le prompt utilisateur d'un appel de distillation dépasse le budget, troncature avec annotation (dernier filet pour L2/L3 et les scènes anormales) ;
- les messages unitaires sont toujours tronqués côté capture à `capture.maxMessageChars` (4000 caractères), et les entrées L2/L3 sont naturellement bornées par la taille des fichiers de scènes.

### Configuration

- Le modèle de distillation est explicitement fixé à `deepseek-official / deepseek-v4-flash` (`cordis.patch.yml`),
  sans suivre les bascules du modèle par défaut de dsh.

## [0.2.0] — 2026-08-15

Refonte des couches de stockage et de recherche selon l'architecture du backend sqlite officiel de [MemoryCore](https://github.com/TencentDB-Agent-Memory) (TencentDB Agent Memory) :
**double écriture JSONL comme source de vérité + SQLite comme moteur principal de recherche + recherche mixte à trois stratégies**.
Motivation : dans l'ancienne implémentation, chaque requête de recherche L0 relisait près de 30 jours de fichiers et bâtissait un index BM25 en mémoire à la volée, et L1 se chargeait intégralement en mémoire en réécrivant tout le fichier à chaque déduplication — au-delà d'un certain volume, performances et taux de rappel s'effondraient tous les deux.

### Changements (architecture de stockage)

- **Nouvelle base de recherche `memory.db`** (`src/store/sqlite.ts`, module intégré `node:sqlite` + WAL + FTS5 +
  table vectorielle cosinus vec0 de `sqlite-vec`), la combinaison PRAGMA est reprise de l'officiel (busy_timeout/WAL/cache_size/mmap/wal_autocheckpoint).
- **Sémantique de double écriture (comme l'officiel)** : les fichiers JSONL en append sont rétrogradés en source de vérité de sauvegarde/restauration, **en ajout seul, jamais modifiés** ;
  toute la recherche passe par SQLite — L0 ne scanne plus les fichiers pour bâtir un index, L1 ne se charge plus en bloc ni ne se réécrit.
- **Disposition des données alignée sur l'officiel** : L0 `l0/*.jsonl` → `conversations/YYYY-MM-DD.jsonl` ;
  L1 `l1/records.jsonl` (réécriture intégrale monofichier) → `records/YYYY-MM-DD.jsonl` (append par jour). L'ancienne disposition est importée automatiquement dans la base de recherche au démarrage du plugin puis renommée `.imported` (`l0/` → `l0.imported/`,
  `l1/records.jsonl` → `l1/records.jsonl.imported`), sans migration manuelle.
- **Voie d'écriture déduplication/fusion réécrite** : l'application des décisions par `pipeline/l1.ts` passe de la réécriture intégrale `all() + replace(next)` à la sémantique officielle — le résultat d'une fusion est **ajouté comme nouvel enregistrement** (version +1), et la cible remplacée est retirée par `deleteBatch` de la seule base de recherche.
- Les champs d'enregistrement L1 s'alignent sur l'officiel : nouveaux `version`, `source_message_ids`, `metadata`
  (version/metadata écrits dans la base de recherche ; source_message_ids ne vit que dans la source de vérité JSONL).

### Changements (recherche)

- **Recherche à trois stratégies** (`recall.strategy`, défaut `hybrid`) :
  - `keyword` : recherche plein texte FTS5 BM25 (`bm25()` rank → score 0~1, formule reprise de l'officiel) ;
  - `embedding` : KNN cosinus vec0 de sqlite-vec (score = 1 − distance cosinus), capacité optionnelle ;
  - `hybrid` : les deux voies en parallèle + **fusion RRF (k=60)**, même recette que la recherche mixte officielle.
- **Paramètres de recherche officiels transposés** : multiple de sur-rappel (pool de candidats = limit × 3), tampon de compensation des vecteurs nuls du KNN vec
  (+10), seuil de score de rappel `recall.scoreThreshold` (défaut 0.3, avec l'exception de petit corpus du FTS —
  si le nombre de résultats ne dépasse pas maxResults, les touches à bas score sont conservées), filtrage postérieur par type (la voie des outils ne passe pas le seuil).
- **Le rappel des candidats de déduplication monte à 3 niveaux officiels** : base vide → sauter ; vecteurs d'abord → FTS en filet (avant : BM25 mémoire, un seul niveau).
- Construction de requête FTS : tokens mis entre guillemets reliés par OR + filtrage des mots vides chinois (petite table officielle) ; tokenisation par les
  bigrammes CJK + tokeniseur de mots anglais du projet (même tokeniseur en lecture et en écriture pour garantir l'alignement), **sans dépendance jieba native**.
- **Format des lignes de rappel** aligné sur le style officiel : `- [type|scene] content`.

### Ajouts (embedding, capacité optionnelle, désactivée par défaut)

- Groupe de configuration `embedding.*` : tout service `/embeddings` compatible OpenAI (`baseUrl/apiKey/model/dimensions`
  etc. ; le `ctx.llm` de DSH n'a pas d'endpoint embeddings, à apporter soi-même). Normalisation L2 du client vectoriel (comme l'officiel).
- `embedding_meta` persiste provider/modèle/dimension ; au changement de configuration, drop automatique de la table vectorielle et **ré-embedding intégral en arrière-plan**
  (`reindex()`, sans bloquer le démarrage).
- Embedding éteint équivaut au mode `provider="none"` officiel en FTS pur — **par défaut, zéro dépendance externe pour tourner**.

### Chaîne de dégradation (degrade-don't-crash de bout en bout)

- Échec de chargement de sqlite-vec → mode FTS pur (bit de capacité dégradé, un seul warn) ;
- échec de création FTS5 → `ftsSearch=false` ; échec d'initialisation du schéma → base de recherche dégradée → fonctions de mémoire désactivées mais
  **l'hôte dsh démarre quand même** (chaîne de dégradation storageOk maintenue) ;
- échec d'un appel d'embedding → cette recherche dégrade en FTS + une seule alerte, le côté écriture saute le vecteur (rattrapable par reindex) ;
- à la désinstallation du plugin, fermeture de la connexion DB (WAL sur disque), enregistrée dans `ctx.effect`.

### Dépendances

- Nouvelle dépendance runtime `sqlite-vec@0.1.7-alpha.2` (même version que MemoryCore ; extension native précompilée,
  la seule dépendance native).
- `node:sqlite` est un module intégré de Node ≥ 22.13 (les engines exigent déjà ≥ 22.16, aucune exigence runtime en plus).

### Changements cassants

- Disposition des données : `l0/` → `conversations/`, `l1/records.jsonl` → `records/` (anciennes données importées automatiquement,
  fichiers d'origine conservés en `.imported`, nettoyage manuel possible).
- `L1Store.search` / `searchCandidates` passent de synchrones à **async** (la voie vectorielle exige un appel distant),
  le troisième paramètre passe de `type?: string` à un objet d'options `{ type?, scoreThreshold? }` (API interne du plugin uniquement ;
  le comportement des outils/rappels externes ne change pas).

### Vérification

- Le smoke gagne/réécrit des assertions sur le stockage et la recherche : double écriture SQLite, recherche FTS chinois-anglais, filtrage par type, seuil et exception de petit corpus,
  sémantique d'append/delete de la fusion, **vec0 + hybrid + reindex** (faux embeddings déterministes), migration de l'ancienne disposition,
  fonctions pures RRF/bm25RankToScore/buildFtsQuery — tout passe.
- Validation du remplissage des valeurs par défaut du Standard Schema de Config (`embedding`/`recall.strategy`/`scoreThreshold`) passée.
- Vérification au démarrage réel : `dsh --profile web` monte normalement, `~/.dsh/memory/` génère `memory.db` (avec WAL) +
  `conversations/` + `records/`, schéma complet (l0_conversations/l1_records/l0_fts/l1_fts/embedding_meta),
  arrêt propre.

## [0.1.0] — 2026-08-14

Première version utilisable.

- Pipeline de distillation stratifiée L0~L3 (capture → extraction/déduplication L1 → consolidation de scènes L2 → distillation de profil L3), prompts transplantés de
  MemoryCore (double famille chat/work).
- Rappel automatique agent/pre-step + injection de contexte en scope agent (`<relevant-memories>` / `<user-persona>` /
  `<scene-navigation>` / guide d'outils), le côté capture dépouille les balises d'injection pour éviter les boucles de rétroaction.
- Outils du modèle : memory_search / conversation_search / memory_read_scene.
- Panneau d'état de la page de paramètres (bundle client, canal de données Connection RPC).
- Correction de bugs fatals : le nom d'export du schéma de configuration passe de `schema` à `Config` (cordis ne lit que `plugin.Config`,
  un mauvais nom d'export fait échouer le démarrage de tout le profil) ; la collecte du texte en streaming du LLM passe au block-end comme autorité (répare la sortie en double).
