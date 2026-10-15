# Changelog (English)

- [中文更新日志](./CHANGELOG.md)
- [English Changelog](./CHANGELOG.en.md)
- [日本語 changelog](./CHANGELOG.ja.md)
- [한국어 changelog](./CHANGELOG.ko.md)

This file covers the **0.12.0** release notes and the current **unreleased** changes in English. For the full history, see [CHANGELOG.md](./CHANGELOG.md) (Chinese).

## [0.26.1] — 2026-10-15

### Added

- **Backfill panel: auto-resumed progress + scan progress + honest summary.** The three backfill endpoints are trigger-plus-status hybrids, so a bare call while idle **starts a run**. New request body `BackfillTriggerRequest { probe?: boolean }` — `probe:true` returns the current snapshot and never starts anything; `BackfillSection` probes all three on mount and re-attaches polling if one is running (leaving and returning to the overview no longer needs a manual re-click). `BackfillProgress` gains `scanned/scanTotal` ("scanning 1252/1252 rows…"), and a 0-candidate scan now reports "no records missing keywords, nothing to backfill" instead of "0 updated", which read as a failure.
- **Cancel switch for the three batch actions (bounded hard-stop).** The contract gains `cancel?: boolean` and `BackfillProgress.cancelled`; each module exports `cancelXBackfill()`. Cancellation is **bounded**: after the signal a one-shot grace timer fires `runAbort.abort()` to cut in-flight requests. The hard bound is clamped by `backfill.cancelGraceMs` (schema max 30_000, default 15s) — no YAML value can exceed it.
- **Skill tool-group seal `toolSkills`.** The four `memory_skill_*` tools now go through the host seal mechanism (`reg('skills', …)`, ANDed with the `skillsEnabled` feature switch); both hot-apply on `loader/volatile-update` (toggling in the panel registers/unregisters immediately, no restart). Previously they gated once at registration, sat unconditionally in the model tool list once enabled, and did not hot-update on toggle.

### Changed

- **All LLM batch sites unified to one-record-at-a-time serial.** The remaining three merged batches — wing (`labelWingOne`/`tagOne`), `pipeline/relabel.ts`, `room-review.ts` (`roomCandidateOne`) — were converted; all five batch sites now send exactly one memory per request and await it before the next (`concurrency` defaults to 1). Rationale: a single 35B record measures ~2.6s, while a multi-record batch loses the whole batch to one truncation or empty output.
- **Reshape exclusion now keyed by a version stamp.** `dsh_reshape_ver` (=2) with `isReshapedAtCurrentVersion(meta, content)` — the stamp is written **only on a successful write-back**; a record left unchanged gets **no marker** and stays retryable next run (the legacy boolean `dsh_reshape_tried` is read only for legacy compatibility). Bumping the schema version re-runs earlier outputs automatically.
- **`backfill.maxRecords` defaults to 300** (was wrongly set to 40, so a real 251-record target only advanced 40 per run).

### Fixed

- **Bare-call polling hot loop (the real cause of "it doesn't start").** The UI tick called the trigger+status hybrid endpoints bare, so while idle it started a new run every 3s and the panel stayed on "scanning". The tick now sends `{ probe: true }`.
- **Batch scans returning empty output: thinking models used as direct-answer models.** `LlmCallOptions` gains a **call-level `reasoningEffort` override** and all five batch labelers pass `'off'`. With the route effort at `""` (auto) a thinking model defaulted to thinking on, the budget went to reasoning and the body came back at 0 characters (156 of 162 real failures were `local-9b` empty output).
- **`client/src/ui/MarkdownBody.tsx` typecheck failure.** The four `string | undefined` regex captures brought in with 0.26.0 failed under `noUncheckedIndexedAccess`; added non-null assertions.

## [0.26.0] — 2026-10-14

### Added

- **Existing-memory re-distillation reshaping (`redistill`)**: new independent batch scan `src/redistill-backfill.ts` (mirrors wing/keyword backfill: single-flight / background / bounded / failures leave records untouched) rewrites the body of **active, skeleton-incomplete** L1 records into the G2 per-type "cause→effect" sectioned form, and produces `metadata.dsh_keywords` / `metadata.dsh_usage_scenario` in the same pass. New endpoint `dsh-memory/redistill-backfill` (returns `{started,running,enabled,updated,skipped,failed}` immediately); a "Re-distill & Reshape" button in the WingWheel panel. Config `redistill.enabled` defaults **off** — off means no reshaping and content/FTS/projection byte-for-byte unchanged (zero drift).
  - **Quality gate**: writes back only when the reshaped body's `scoreSkeleton` hit count is **strictly better**, and stamps the reshape version `dsh_reshape_ver` (excluded from later runs); otherwise it keeps the original **unstamped** so it stays eligible for a retry — never fakes a label or fabricates content just to "look structured".
  - **Active only**: retired/superseded records are not touched.
- **Durable write-back for content edits**: reshaping writes via `L1Store.appendNew`, which in one shot appends to the JSONL fact source, recomputes the embedding, re-indexes `l1_fts`, and overwrites the `.memory.md` projection (the exporter re-renders from the DB and overwrites on any difference). Entry requires `vectorsReady()` — the whole run is skipped when embeddings aren't ready, to avoid silently dropping a record's vector.
- **`dsh-memory/records-meta` endpoint**: batch lookup (≤50) by `record_id` returning full metadata *and* body (name/type/priority/content/maturity/createdAt/updatedAt/scene/scope/workspaceId/keywords/usageScenario/filePath/retired) straight from SQLite via `stores.l1.getByIds`. The memory viewer therefore **no longer reads `.memory.md` files** — the earlier fileViewer approach (a fake `<id>.memory` path) was resolved by the host's EditorHost as a physical file and always hit ENOENT. Contract lives in `contract.ts`; endpoint count 62→63 (`tests/contract-keys.test.ts` pins it).
- **Display titles stop guessing from the body**: `memoryRecall` and slot `refViews` prefer the record's `name` (the short title the name-distillation produces) and only fall back to the first body line. `firstLine()` is now markdown-aware: H1 (`# xxx`) is a document title and is kept, H2+ (`## Findings`) is a section marker and is skipped — previously `## Findings` was rendered as the memory's "name" although it is plainly body text.
- **Single source of truth for projection paths, `relPathFor()`**: `renderRecord` (disk write), `records-meta`'s `filePath` and slot `refViews.filePath` now share one algorithm. The projection had copied its own sanitizing regex, so a single record could yield two different file names — the address the projection reports would not match the file on disk, which is exactly what those three consumers exist to cross-check. `refViews` also carry `filePath`/`workspaceId` so callers can build `<workspaceId>/.agents/memory/<filePath>` (workspace scope) or resolve against the projection root (global).
- **Markdown-rendered bodies in the records panel** (client): expanded record bodies go through the new `client/src/ui/MarkdownBody.tsx` (heading levels / bold / inline code / lists, zero external deps), so `## Findings` is no longer a bare line of text.

### Fixed

- **`client-session-recalled-bundle` regression guard**: after 0.25.0 handed the pill's "this-session recalled" rendering to dsh-brief-sidebar, this test still asserted the pill contained the recalled strings (missed in that release). Now asserts the prime-memory pill does **not** re-render recalled, keeping the projection-wiring assertions.

## [0.25.0] — 2026-10-14

### Added

- **Keyword-distillation backfill (producer for `metadata.dsh_keywords`)**: the `keywords` axis reserved in `l1_fts` had no producer and stayed dormant. New independent batch scan `src/keyword-backfill.ts` (mirrors wing-backfill: single-flight / background / bounded / failures leave records untouched) sends existing L1 records missing `dsh_keywords` to the LLM in chunks, normalizes via `normKeywords` (≤5, dedupe, length clamp) and writes back. New endpoint `dsh-memory/keyword-backfill`; a "Keyword Backfill" button in the WingWheel panel. Config `keyword.enabled` defaults **off** — off means no backfill and `l1_fts` byte-for-byte unchanged (zero drift).
- **`patchMetadataAndReindex`**: `patchMetadata` only updates `l1_records`, never `l1_fts`, so backfilling through it would write keywords BM25 never sees. Added per-row FTS re-indexing (threaded through MemoryDb→L1Store→backend→InProc/Worker→worker dispatch) so new keywords enter the retrieval axis immediately. Test includes a reverse control (plain patchMetadata does not match; AndReindex does).

### Changed

- **Input-area popup no longer renders the session recall list**: WingWheel drops `SessionRecalledArea` — recall display is now owned by brief-sidebar, so a second copy in the input popup was redundant (component file kept for rollback).

## [0.24.2] — 2026-10-14

### Added

- **Projection identity fields in the records panel**: card headers now show "Name" and "Scope" badges, and the expanded detail adds three rows (Name / Keywords / Scope), so users can directly verify the "memory ↔ projection filename" mapping. The `UiRecord` contract (`contract.ts`) gains optional `name`/`scope`/`workspaceId`/`keywords`; `stats.ts::hitToUiRecord` reads them from the record and the `metadata.dsh_keywords` reserved key.
- **FTS keyword axis as a separate, reserved column (dormant)**: `l1_fts` is ordered `keywords → content`, so keywords form an independent BM25 axis rather than being diluted into body-text term frequency. No keyword-distillation producer exists yet ⇒ the column is always empty and retrieval behaves byte-for-byte as before (zero drift); when distillation ships, no schema change is needed (FTS5 cannot ALTER).

### Changed

- **Hook-consolidation comment cleanup**: the retired factory name `makeSuffixSync` no longer appears anywhere in `src/` (acceptance grep = 0), leaving a single source of truth for the consolidation conclusion.

## [0.24.1] — 2026-10-14

### Added

- **Suffix invariant for the projection (`convergeDisabledSuffix`)**: `.memory.md` vs `.memory.md.disable` is decided solely by "is this record retired in the library" — independent of `name` and of which path retired it. Every record is reconciled through three checks (file existence, current suffix, fingerprint match). A hand-made `.disable` is a file-side retirement proof (the library cannot see it while P2 is off), so it is only reported as `both`, never touched.
- **The library→file hook moved into `L1Store` (`store/memory-md-sync.ts`)**: `setFileSyncHook` fires at the four confluence points (`appendNew` / `retire` / `restore` / `rename`) instead of the eight call sites where event hooks used to hang — on a real machine 920 retired records had only 8 `.disable` files, all from the recall panel path. Machine-side retirements (merge supersede, conflict loss) and model-side `memory_add` now follow automatically, and new call sites cannot be forgotten.
- **Rename follows the file**: after `rename()` the projection moves to the new name (the `.disable` sibling travels with it) and the ledger key is rewritten; if the old path had no file the new name is written instead, and an occupied target is reported rather than overwritten.
- **Rolling projection with a progress bar (`store/memory-md-run.ts`, new endpoint `dsh-memory/mem-run-status`)**: one click pushes the export cursor to the end of the table and then the suffix cursor, with cross-round `maxPasses` / `totalBudgetMs` guards; if the budget runs out it says how many files remain instead of stopping silently. The panel reuses the ruminate/rebuild progress bar.

### Changed

- **Per-click file-update budget**: `memExport.maxRecords` default 300 → **2000**, plus a runtime knob `live.mdExportMaxRecords` (0 = follow the deployment default, no restart). The panel's misleading "single-action guardrail" is renamed to **"per-click file update budget"**, counted in files, and echoed from the server's actually applied `appliedMaxRecords`.

### Fixed

- **The quota counted traversal, not disk actions** — unchanged entries consumed budget, so a second click rescanned the same first N; at 1210 records backfilling meant four clicks.
- **O(n²) ledger writes**: the converger flushed the ledger per rename (the ledger is one atomic JSON rewrite), so 300 records meant 300 full rewrites and the wall-clock budget split the job into several clicks. Now: mark dirty in the loop, flush once at the end.
- **Adjacent fires stepping on each other**: projection work is now serialized in the background. Previously each fire opened its own promise, so `appendNew` followed immediately by `retire` overlapped — the second task's converger saw "no such file" before the first one wrote it, and the retired record stayed on `.memory.md` until the next full export.
- **Permanent duplicates after revival**: the "both files exist" case for a live record only reported and never reconciled. The stale `.disable` is now removed only when all three hold: same ledger id, its bytes unchanged since we wrote it, and the `.memory.md` copy is exactly the current render.

## [0.24.0] — Unreleased (local line `0.24.0-local.0…3`, 2026-10-13)

### Added

- **Single source of truth for the type vocabulary (`src/memory-types.ts`)**: the 29 original names of the host memory taxonomy + the plugin's legacy 7 types + the `unclassified` fallback, 37 types in total. The projection-directory whitelist, the `memory_add` write whitelist, the panel labels, the enum strings in the extraction and dedup prompts, and the type codes in memport's TS/Python dual implementations are **all derived from it**. Previously the "full set of types" was hand-copied in four places that each evolved on its own: `memory_add` **silently rewrote** external classifications into `episodic`, while the memport copy promised "passed through as-is" — two contradictory accounts of the same thing.
- **Name distillation (`cfg.naming`)**: extraction produces a `title` on the spot, **defined separately from** `content` (the title is the noun phrase answering "what is this entry about", the content is the full narrative body); the dedup merge also produces a `merged_title`. On write, `title` is only a **name candidate** and must pass the `validateTitle` shape gate — if it fails, the naming engine still handles it; the source of truth for name uniqueness does not split into two sets of criteria just because one more source appears.
- **few-shot standard-format example set (`src/prompts/examples.ts`)**: per-type positive and negative examples, with a cap on the total length budget (examples are a fixed cost paid on every distillation round); the positive examples themselves must pass the gate and carry a complete skeleton, and the test cases consume `auditFewShot()` directly instead of hand-copying the criteria.
- **Executable skeleton criteria (`SKELETON_ELEMENTS` + `scoreSkeleton`)**: turning "no cause-and-effect chain, an incomplete write does not count as usable" from a wish inside the prompt into a criterion that can be measured and used to set defaults. Declared limitation: a keyword heuristic, usable only for relative comparison between two arms on the same input — not an absolute quality score.
- **Directory skeleton + a per-type `_index.md` (`memory-md-skeleton.ts`)**: each type directory holds one index file (type name + entry count in the library). Empty directories get dropped by git and by archives, while "there is no such directory" and "this type has 0 entries" look identical to a human. Idempotent: unchanged content means zero writes and no mtime bump; zero action while the projection surface is off.

### Changed

- **Three defaults flipped per A/B measurement** (`narrativeTemplates.enabled` / `naming.enabled` / `naming.fewShot`). The basis is two measurements in **opposite directions**: on the real-session distillation path, skeleton completeness is **0.000** (0/23) without examples and **0.703** (26/37) with them; while for the naming task of renaming existing entries, adding examples actually **−0.113** (18/160 missed answers). Conclusion: **examples must not cross tasks** — they only enter the extraction prompt, never the naming script.
- **md projection on by default** (`memExport.enabled`): the whole plan rests on "files are the authority on content + the database is the index"; defaulting it off means defaulting it unused. `mdSync.enabled` **still defaults off** — it writes to the database, and the risk is asymmetric.
- **The workspace-attribution config key renamed `workspaceHints` → `workspaceSource`**: a hard rename with no compatibility alias (the key has never shipped externally with any release; adding an alias means nurturing a second source of truth). On by default; the routing `path` now stores the **workspace root** (old values were written as `E:\test\rewrite-agently\.agents`, and `targetFor` appends `.agents/memory` again → producing a `.agents\.agents\memory\` orphan tree; the guardrail "fall back to a single root only when the root does not exist" cannot catch this shape). Backfill on a real machine gave **724/1166** existing records their attribution, with `hashRecords` byte-for-byte unchanged.

### Fixed

- **The ledger loader overwrote absolute keys into `relPath`**: since N10 the ledger keys are absolute paths, and the "on mismatch, rewrite from the key" line fired on every single load, measurably contaminating **1167/1241** entries; downstream symptoms were orphan archiving assembling an illegal directory containing a colon, and 75 moves all failing with ENOENT. Now derived from `root` + key (new `deriveRelPath`); the archiving side no longer trusts the stored `relPath`.
- **`--revert` did not fall back to hooks**: `findArchivedOld` touched `deps.hooks.exists` directly, while `runCli` does not pass hooks when calling revert (the apply side has `deps.hooks ?? defaultHooks`, the revert side omitted it). The first rollback run in the sandbox errored out on all 74 entries. The point is the asymmetric harm: an apply failure is escaped via `--revert`, so **a broken rollback means the backup is the only way out**.
- **Cross-root duplicate files bypassed "if both sides changed, touch neither"**: `roots = the record's landing root ∪ the roots the ledger has recorded`, so one record can have one file under each of two roots; the decision used the old root's copy while the write went to the new root's copy computed by `targetFor` — a human edit in the old root overwrote the authoritative copy, and the report looked entirely compliant. Now only the current landing root is acknowledged; the rest are counted in the new field `staleRootFiles` and displayed on the panel.
- **A name collision pushed the whole memory out of the retrieval library**: the `{ ...old record, id: new id }` idiom wrote to the database carrying "a name already belonging to another row" → hit the partial unique index → the batch write fell back to per-row and still failed → that entry's merged product **silently vanished** (the old record had already retired, so this supersede left nothing behind). The naming criterion changed from "name is empty" to "**this name does not belong to it**".
- **The vector "N pending" counter never reached zero while "rebuild index" said there was nothing to do**: the display-side `missing = total − embedded` denominator included retired rows, while retired rows legitimately have no vectors by design; the two SQL statements driving the backfill both exclude retired rows, so "pending 114" and "nothing to do" appeared on the same screen. The denominator is now unified on active rows.
- **The projection guardrail was counting "traversal" instead of "action"**: `maxRecords` also charged entries judged "unchanged" against the quota, so the second click scanned the same first N — the panel's "click again to continue" was a lie (real-machine symptom: `已写 9 · 未变 291 · 剩余 866` stayed constant). Now only entries that touched disk are counted; total scan volume is bounded by `timeBudgetMs`.
- **O(n²) ledger flush**: `set()` serialized the whole ledger to JSON and atomically rewrote it once per entry. On 1200 entries on the same disk, measured **9442ms → 1954ms** (dirty flag + batch window + forced `flush()`).
- **`NAME_MAX`(40) and `NAME_CLIP_MAX`(28) split into two numbers**: the character counter priced ASCII and Han characters the same, so `dsh-agent-teams` / `Python-3.13` ate 15 units in a single word, and legitimate names of just one or two words were judged `too-long`; while setting both to 40 lets `deriveName` copy a narrative sentence into a sentence tail (observed in practice). Also removed the hard-coded 28 inside `validateTitle` (one threshold, two sources of truth).
- **Three false kills by the name gate**: the preamble-strip table and the name-reject table were **separated** (the bare subjects 「用户/团队」 no longer mistakenly kill noun phrases like 「用户npm账号用户名」, 10 real-machine entries); `has-id-fragment` narrowed to "4+ digits following a non-ASCII character" (`ADR-0006`, `Han-1413141` now pass, 4 real-machine entries).

### Known boundaries

- Incremental projection at the end of rumination relies on an `id→updatedAt` baseline diff, while relabel / retirement go through `patchMetadata` and do not touch `updated_time` ⇒ **a metadata-only rewrite is not re-projected in that round**.
- P2 reverse sync still owes two items: the startup automatic hook (changed to endpoint + button only) and the batch of `pending` entries not yet on the `conflicts` adjudication surface.
- **The 8-language translations have not been kept up since 0.20.0** (this pass only backfilled the entries from 0.22.0 onward; the 0.20/0.21 gap remains, noted separately).

## [0.23.0] — Unreleased (local line `0.23.0-local.1…8`, 2026-10-12…13)

### Added

- **md authoritative projection surface (P0/P1/U/N10/N11)**: the `l1_records.name` column (file identity key + partial unique index); `renderRecord` + the dual-fingerprint ledger (`dbDigest`/`fileDigest`) + the `mem-export` / `mem-reconcile` endpoints; the panel's "external archive" section; the projection root switched to **workspace-first** (`<ws>/.agents/memory/<类型>/<名>.memory.md`); staleness judgment now also couples with `.memory.md.disable`.
- **P2 reverse sync (file → index)**: a **three-way quadrant** computed from the ledger's dual digest — only the file changed → backfill into the database and rewrite with the canonical render (breaking the write-back loop); only the database changed → reuse `exportRecords` to rewrite the file; **both changed → neither side is touched**, only `pending` is raised; `.disable` goes through retirement without deleting the file; unrecognized new files are only counted, never imported (import must pass through the write kernel). Endpoint `dsh-memory/mem-sync`.
- **P3 archive + physical delete**: the `exportThenPurge` gate moved from a whole-database hash to a **batch-level projection** (with concurrent distillation, as soon as any record unrelated to the batch is changed, the old implementation made cleanup never able to delete anything); after deletion a human-readable `retired.md` is written + the batch's projected files (including `.disable`) moved into a snapshot directory; `cleanup-retired` dry run returns a **preview of the to-delete list**; the graph projection index table gained `forgetRecords` (previously the whole repo only ever added and never removed — records restored from a snapshot were treated as "already projected" because the projection row was still there, so **they were never re-projected**, and the retrieval graph silently lacked one entry without raising an error).
- **P4.1 default class `unclassified` + P4.2 body layout standardization** (`normalizeContentMd`). Idempotence is a hard requirement: without it the ledger's `fileDigest` changes every round, and the write-back loop is introduced by the renderer itself. Layout only, no semantics (no bulletizing prose, no inserting an H1, no stuffing metadata into the body).
- **Orphan projection file archive `dsh-memory/mem-orphans`**: only moves files "the ledger records us as having written, and that no record currently claims this path for"; unrecognized files absent from the ledger are **left alone** (they may be input a human placed in the projection directory waiting to be synced back). Never deleted, only moved, preserving the relative shape and the original text.

### Behavior fixes (recall display surface)

- Recall entries no longer vanish instantly: the view carries `body` / `retired`, the removal of `session_recalled` rows stopped, and the pill shows a "judged stale" strikethrough annotation.
- Startup cleans up existing retirement residue (725 rows still dirty in `l1_fts` on this machine); the retirement invariant gained two bypass write paths (fixing "after marking invalid, it revives on the retrieval surface").
- Recall scoring end to end: `-1..5` (0..5 relevance; `-1` declares stale and retires), scores feed the maturity metric (`-1/1/2` pull down and sink, `4/5` push up and float).
- Workspace content routing landed for the first time (dsh ecosystem → `rewrite-agently`, non-dsh → `agent-no-dsh`; **only writes `workspace_id`, does not touch `scope`, does not touch `updated_time`**, and syncs the attribution columns carried by the `l1_fts` rows).

### Discipline

- Two giant memport functions split over two rounds (Extract Function, behavior preserved, CLI gold standard byte-for-byte regression).
- The endpoint-contract **five-places-changed-together** discipline stayed in force (`MEMORY_ENDPOINTS ≡ switch ≡ contract dual map ≡ contract-keys count ≡ config`), count chain 55→56→57→58→59.

## [0.22.2] — 2026-10-12

### Added

- Skin tri-state (auto/light/dark) + token override block; the panel's 11 Tabs tightened onto a single row.
- `ext_key` idempotence for `memory_import` (`l1_records.ext_key` + partial unique index + `deduped` receipt).
- **Memport Connect**: `.mem` parsing / pre-filtering / scanning + source registry + Connect Tab (cross-implementation sha256 gold-standard alignment).
- **Skill crystallization**: skill-store (JSON sidecar) + candidate detection + skill recall injection + the board switch `skillsEnabled`.
- G4 graph causal edges (导致 / 因为 / 修复了 / 取代, without bumping `projectorVersion`).
- G3 maturity derived at read time (record-card badge + contradiction-adjudication view annotation, not part of automatic adjudication).
- G1 `usageScenario` gating end to end (extraction → landing in `metadata.dsh_usage_scenario` → recall fine ranking; off stays byte-for-byte unchanged).
- G2 per-type narrative templates (gated prompt variant; off is a prefix of on).
- wing / cognition hall two axes do not cross (orthogonal accessors + disjoint value-domain regression lock).
- **G-live live recall set of this session**: persistent sidecar + the `session-recalled` read-only endpoint + the pill read-only list.
- `memoryRecall` session-aware projection (the data source of the brief sidebar's "recalled this session" section, `init(header).id`).
- `cfg.slots.migrateLegacy` (off by default): softly retires rule slots that are "pinned as resident while their content is already carried by live L1".

### Fixed

- Rumination re-feed resetting or inflating the pending count (ruminate now passes empty messages, same semantics as `enqueueSessionSlices`).
- The rumination finalize and `doLightRefresh`'s L3 forced real run + count zeroing + `state.save()` flush (fixing "pending L2/L3 not cleared after rumination, bouncing back on restart").

### Discipline

- All new capabilities off by default; in the off state the artifacts and injections are byte-for-byte unchanged; the cross-plugin display contract (the `memorySlots` projection) stays wired.

## [0.22.1] — 2026-10-09

### Fixed

- **Popover underlay made opaque**: the memory popover in the input bar (`.dsh-mem-popover`) and the dropdown / filter panels (`.dsh-mem-pop`) previously followed the host's `--dsw-specific-menu`, which the host resolves to a translucent glass value ⇒ the panel let the background show through. Now an alias layer is stacked on an **opaque `bg-primary` underlay** (the underlay technique), so the panel is solid regardless of the host's alpha.

## [0.22.0] — 2026-10-09

### Changed

- **Declaration surface adapted to 15rc**: 9 dsh peers covering all published host rcs (`0.1.0-rc.2..0.2.0-rc.2`, evidenced entry by entry via `npm view` and consistent across the line sets), all optional; `engines >= 0.1.0-rc.2` as a coarse fence (the precise gate is peers), `package.json` and `dsh.plugin.json` in sync.
- **Dual-manifest version restored**: `dsh.plugin.json` had drifted at `0.20.0-beta.6-dsh0.2.0.1`, this batch aligned it byte-for-byte with `package.json` (the V1 gate).
- **`dsh.client.inject` shrunk to `ui-primitives` only**: `dsh-client-connection` only exists as a package from 0.1.2 on, and declaring it would hang the entire client entry on 0.1.0/0.1.1 (`rpc.ts` has long lazily `ctx.get`s that connection).

### Discipline

- All build-type repos inject `prepack: npm run build` — `npm pack` only triggers prepack, not `prepublishOnly`; this is one of the three defense layers against the stale-build miscarriage.

## [0.21.0] — 2026-10-04

### Added

- **Tool-group sealing (memory panel → Memory → Tool Sealing)**: 5 toggles (room management / graph / ruminate / conflict / mutate write-delete, covering 13 tools). Off = that group's tools **are not registered**, vanishing straight from the model's tool list (not a rejection at execution time). A flip takes effect instantly via a volatile hot update, no restart needed. The core reads (memory_search / memory_read_scene / memory_receipts / conversation_search) and the three slot tools are not under control. Background: most grouped tools (e.g. Room governance, rumination) are used extremely rarely day to day, so keeping them resident in the tool list only wastes attention and lures the model into mis-invoking them.
- **Existence check on mem_ references in memory_slot_write**: L1 record_ids of the `mem_*` shape in refs are run through a `getByIds` existence check before writing; a hallucinated or misspelled id is rejected outright with a prompt to go through memory_search — guaranteeing that "memories activated by search" entering a slot reference are necessarily real records (the brief side's name-summary resolution therefore has reliable input). File-path / URL refs are not checked.

## [0.20.4] — 2026-10-04 (local build, unreleased)

### Fixed

- **Full fault tolerance for projection refViews resolution**: the call to L1 `getByIds` inside `resolveRefViews` is wrapped in try/catch — the registry's drive has no exception protection, so any throw at the resolution layer (sqlite busy / backend degradation / abnormal record state) would take down the whole session-event driver and even the host process. On failure it degrades to that frame carrying no refViews (the front end falls back to the raw refs).

## [0.20.3] — 2026-10-03

### Fixed

- **The `memory_search` render text now carries the id**: v0.20.2 added record_id to the output JSON and the schema, but the model sees the render product, not the raw JSON — the rendered line had no id, which for the model is as good as no return (found on real-machine retest). Each result now ends in `— id: mem_xxx`, directly writable into slot refs.

## [0.20.2] — 2026-10-03

### Fixed

- **Projection `memorySlots` dirtiness loosened to any event**: previously dirtiness was judged by store rev only on `tool/result` (settled, non-error) — after a write it relied on "another tool result happening to come in" to refresh, and cross-session viewing had to wait for the viewing session's own tool calls; the real machine exposed the sidebar sitting on an empty frame long after a write. Changed to an O(1) rev comparison on any committed event — when rev changes, rebuild and push; the isError guard is removed (rev only increments after a real change; the event is just a trigger, not the data source).
- **Resident injection moved to a `<system-reminder>` tag frame** (aligning with the dsh-agent-instructions AGENTS.md injection house style): the user-role carrier is unchanged, but it now presents as a tag box + authority declaration (no reply needed / do not echo / does not override system prompts or the user's direct instructions) — fixing weak models that echoed slot content verbatim as if it were the user's own speech and disrupted normal replies; closing tags inside the slot body are escaped (`</system-reminder>`) to prevent slot content from forging the frame boundary.

### Added

- **`memory_search` results expose `id` (L1 record_id)**: breaking the deadlock of "retrieval can't get an id → can't write slot refs / feed memory_receipts"; the schema description notes the two destinations of id.
- **wire view exposes `refs` + `refViews`**: `mem_*` references are resolved at projection-frame build time via L1 `getByIds` into `[type] 名称简述` (first line of content, truncated at 80 chars), rendered directly by brief-sidebar (≥0.5.0-beta.2); path / URL references stay literal; missing or retired records produce no entry. Resolution happens at frame-build time — the reference set is frozen when the slot is written, so later edits to the L1 record do not flow back into old frames. The self-implemented schema only validates extra fields "if present", so old checkpoint rows pass wholesale (stateVersion untouched).

## [0.20.1] — 2026-10-03 (promoted to stable; the beta channel's full capability set since beta.1 finalized)

The complete Hall·Room classification-management chain (two-level registry / merge / rename / retire / update / adoption / retirement-with-records / retiring an unregistered entry adds a registry record), independent Hall and Room management pages (search filter, default-collapsed, pointer drag-and-drop classification, retirement filter), aging-weight display + recall usage stats (only entering topN counts as used). The last beta before promotion was 0.20.0-beta.26, identical in content to 0.20.1; the `dsh-0.2.0-beta` channel continues to receive subsequent betas.

## [0.20.0-beta.26] — 2026-10-03

### Added (usability after Hall/Room growth)

- **Hall/Room name search filter**: a new search box on the Hall page (slug, display name, alias, case-insensitive) — a hit on the hall itself shows all its child rooms, otherwise only the matching child rooms are kept, and a group with no match at all is hidden; while searching, matching groups auto-expand (the collapsed state no longer hides results); the self-grown unregistered area is filtered the same way. The Room page has the same search box, composing with the retirement-filter chips.
- **Hall grouping collapse, default all collapsed**: the hall header only shows "total N entries · M rooms"; tap the header or the ▸/▾ button to expand/collapse child rooms; "expand all / collapse all" batch buttons; the expanded state is remembered in localStorage (`dsh.memory.halls.open`). The click-to-classify priority (tap the hall header to finish classifying) is unchanged.

## [0.20.0-beta.25] — 2026-10-02

> Fix for self-grown rooms becoming state-invisible after retirement + the Hall child-room display rule (user ruling).

### Fixed / Changed

- **Self-grown unregistered rooms become "retired / restore" on retirement**: previously retirement only soft-deleted records, the vocabulary had no entry to change, and the button was always "adopt / retire". Now retire withRecords, for an unregistered slug, **auto-adds a grown registration entry and sets it retired** — the panel row instantly switches to the "retired" state, and "restore" (active:true) brings it back into the vocabulary. Persisted, survives restart.
- **Hall page child rooms show only active**: retired rooms no longer appear under the hall grouping (see them on the Room page, which includes a "retired" filter); the group aggregate count accordingly includes only active subtypes.

## [0.20.0-beta.24] — 2026-10-02

### Fixed

- **Hall page expand/retire aligned with the Room page**: expanding a room row on the Hall page also pulls only active records (`retired:false`); after a retirement confirmation, if that room is expanded, the expanded area auto-refreshes. (beta.23 only patched the Room page, the Hall page missed the sync — the other spot behind the user-observed "retire but I see no effect".)

## [0.20.0-beta.23] — 2026-10-02

> **Room page retirement filter completed** (beta.22's filter chips never landed due to a patch script failing mid-way, only the badge made it into the package — this pass writes each item to disk via Edit and verifies all green).

### Fixed / Added

- **Retirement-filter chips** (Room page, above the registration form): all / active (vocabulary not retired) / retired.
- **Instant retirement effect**: expanding an entry pulls only **active** records (`retired:false`) — after retirement the expanded area shows "no memory entries"; if the room is expanded after a retirement confirmation it **auto-refreshes**; [retired] badge + grey-out fallback (already in beta.22).

## [0.20.0-beta.22] — 2026-10-02

> Retirement-effect visibility + Room page retirement filter (real-machine feedback: after a retirement confirmation the UI showed no change and there was no way to filter).

### Fixed / Added

- **Instant retirement effect**: expanding a Room-page entry pulls only **active** records (`retired:false`) — after retirement the expanded area shows "this Room has no memory entries"; if that room is expanded after a retirement confirmation its entries **auto-refresh**; mixed-listing fallback: retired entries show a [retired] badge and are greyed out.
- **Retirement filter**: the Room page gains "all / active / retired" chips (a vocabulary retirement-state filter).

## [0.20.0-beta.21] — 2026-10-02

> **Retire with records**: retiring a room can optionally **retire all its active memories along with it** (previously there was only the verb table, and self-grown rooms especially had no way to be handled).

### Added

- **`retire withRecords`** (the Room/Hall page "retire" button, red): vocabulary retirement + batch soft-delete of all **active** records under that room (each batch ≤200, the same primitive as records-delete; reason=manual) — records can be restored one by one in the memory page's "retired" section. A self-grown unregistered row also gets a "retire" (records only, no vocabulary entry to touch). The response carries a `retiredRecords` count.
- The "export orphans" button is relocated back to the **memory query panel** (inline in the orphan-filter row).

### Fixed

- recall-usage test isolation (a persisted-roundtrip case racing under parallelism); the literal `\n` display fix in the RoomTab retirement confirm dialog.

## [0.20.0-beta.20] — 2026-10-02

> **Room on its own tab** (separated from Hall): a room's existence, name, and entries each have their own management surface; the memory page no longer piles up Room tags.

### Added

- **The "Room" tab** (after Hall): a flat list of all rooms (registered entries ∪ self-grown unregistered) — **existence** (register a two-level slug / adopt grown / retire·restore), **name** (edit the display name + classification note; renaming can use a two-level slug, records follow), **entries** (▸ expand to browse that room's memory entries, default collapsed, first pull of 10); the orphan export / high-privilege toggles ride along.
- **Re-editable after registration**: a new `room-admin update` (rewrite label/description, fields not provided are left untouched) + store `RoomRegistryStore.update` + tool `memory_room_admin action=update` + a panel "edit" entry — previously, after registration the label/description could only fill in blanks, not be rewritten.
- **Room-row content expansion** (same as Hall-page room rows): default collapsed, ▸ expand to view entries.
- **Memory-page Room block separated**: removed the slug chips / paging / expand block (duplicating the Hall/Room pages), keeping only the "no binding · N" orphan filter and the guidance text — room tag browsing/management belongs to the Hall/Room pages.

### Changed

- The merge/classify/rename forms and preview sticky-follow scroll (with many halls you no longer swipe up and down hunting for the confirm dialog).
- Pointer-based custom drag-and-drop (the same pointer scheme as ego-browser, a fallback for webviews where HTML5 DnD does not fire).

## [0.20.0-beta.19] — 2026-10-02

> Classification interaction redone (real-machine feedback: HTML5 drag-and-drop does not fire in some webviews; after tapping a hall the preview was buried inside the source row and looked like "no response").

### Changed

- **Pointer-based custom drag-and-drop** (the same pure-pointer scheme as ego-browser): hold a room / self-grown slug → a floating ghost chip follows the finger → hover a hall header for a dashed highlight → release to classify. Not dependent on HTML5 DnD, works in any webview. Click-to-classify ("classify" / "assign" → selection state → tap the hall header) is kept.
- **Global action bar**: the merge/classify/rename forms and the dryRun preview are **permanently at the page head** (the red confirm dialog does not scroll with the row and is no longer buried inside the source room row) — after tapping a hall you always see it.
- **Room-row layout**: buttons pinned to one row no longer wrap (Export is no longer stranded on its own line); name/alias wrap naturally in the left info area (aliases can break mid-word).

## [0.20.0-beta.18] — 2026-10-02

### Maintenance

- lint cleanup: the two dead imports left in stats.ts / rooms-registry.ts by beta.17's isTag→isRoomSlug replacement (missed by the release gate — after the pipe `$?` took the tail's exit code, the D2 pitfall recurring). No functional change.

## [0.20.0-beta.17] — 2026-10-02

> **Fix for hall/room relations lost after restart**: the loader of `rooms-registry.json` was still filtering slugs with `isTag` — on restart-from-disk all `major/minor` two-level entries were treated as illegal and **silently dropped** (single-segment halls passed, so they survived). This is the third spot of the isTag/isRoomSlug mixup; the same batch cleared the identical landmine in `normTags`.

### Fixed

- **Loader dropping two-level entries** (`store/rooms-registry.ts` init): the filter changed to `isRoomSlug`. **Your on-disk rooms-registry.json data was intact** (the two-level entries were always in the file, only dropped at startup) — after upgrading and reloading the relations recover automatically, no repair action needed.
- **normTags washing out slash tags** (`metadata-validators.ts`): the gate "every tags write-back point must pass through here" used isTag, so a `hall/minor` tag written back by classification would be silently stripped the next time distillation or relabeling touched it. Now two-level room slugs pass (three-level still rejected); the `isRoomSlug` source of truth was moved into this file (to avoid a dependency cycle), and the rooms-registry re-export stays compatible.
- **list-records two-level tag filter wrongly rejected** (same shape as stats.ts tagSel): changed to `isRoomSlug` — tapping a two-level room's record filter on the Hall page used to 400.
- Red-test-first ×3 (two-level persistence roundtrip / normTags passing / integration two-level tag filter), verified red then fixed back to green.

## [0.20.0-beta.16] — 2026-10-02

> **Self-grown unregistered slugs classified straight into a hall**: each chip in the bottom "self-grown unregistered" area can now be dragged onto a hall header — adoption + becoming its subtype in one step.

### Added

- **grown chip drag / click classify**: drag an unregistered slug (e.g. `git-commits`) onto a hall header (or tap the "assign" button on the chip to enter selection state, then tap the target hall) → dryRun preview → confirm to run for real. Semantics = **adopt in place (from, source=grown) → rename to `hall/子类`**: record tags follow, the old name goes into the target's aliases, the entry is active and does not wear ⭐ (adoption identity). Falling back to a two-level slug under its own hall (e.g. `dsh-plugin/xxx`) = adopt in place.
- The composition order is pinned in an integration test (markMered early-exits on an unregistered from — you must adopt from first, then rename); execMerge auto-adopts an unregistered from.

## [0.20.0-beta.15] — 2026-10-02

> Two back-to-back fixes from real classification feedback: ① a renamed entry wrongly carrying "retired" (it would fall out of the annotation vocabulary); ② HTML5 drag-and-drop not working in some webviews → a **click-to-classify** main path added.

### Fixed

- **Entry wrongly marked retired after classify (rename)**: renameRoom reuses the merge orchestration, and `markMerged`'s "turn the old entry retired" came along — the newly-classified room displayed "retired" and **fell out of the annotator vocabulary** (the listActive filter). Now rename's tail restores the prior state (an active entry stays active after rename); a real merge (union semantics) is unaffected. Red-test-first (unit + HTTP-surface integration).

### Changed

- **Click-to-classify as the main path**: tap the room row's "classify" → enter selection state (the button becomes "pick hall…", all hall headers dashed-highlight) → tap the target hall header → dryRun preview → confirm to run. Drag-and-drop is kept (still usable in supporting environments) but no longer depended on.

## [0.20.0-beta.14] — 2026-10-02

> Memory cards gain **aging weight** and **recall usage** display, and start accumulating data for "aging-weight effect statistics". Definitions (user ruling): **only entering topN (being injected into context) counts as used**; a participation attempt that did not enter = attempt only.

### Added

- **Card fields**: an "aging N%" chip (the read-path decay coefficient `max(0.5, 0.5^(Δ天/半衰期))`, same formula and same source as the recall ranking; ≤60% turns red = aging) + a "used/attempts" counter (the title carries last-used / last-attempt times). The toolbar gains a summary "recall usage used/attempted(rate%)".
- **Stats surface**: `RecallUsageStore` (a recall-usage.json sidecar, the same discipline family as rooms-registry — a corrupt file falls back to read-only degrade, never blocking the recall read path); each recall round records at the three terminal states (inject / all-suppressed / budget-zeroed) (candidates attempts++, injected used++, timestamp takes the latest); in-memory immediate + a debounced 5s atomic flush, 50k entries evicted by most-recent-attempt; un-assembled = a zero-cost bypass.
- Contract: UiRecord gains `agingWeight`/`usage`, ListRecordsResponse gains `usageSummary` (optional fields, zero breakage for old clients); the contract key count is unchanged.

### Effect-statistics definitions (for later analysis)
- usageSummary: tracked (memories with usage stats) / attempted (Σ attempts) / used (Σ used) / rate (usage %)
- Fine-grained analysis (usage distribution by type/age band, half-life tuning basis) accumulates data from this version; the analysis view is to be discussed separately.

## [0.20.0-beta.13] — 2026-10-02

> Classification logic completed: putting a room under an existing hall (previously you could only add a new hall, or merge into another room and erase its identity). The panel supports **drag-and-drop classification** — drag a room and drop it on a hall header.

### Added

- **Hall-page drag-to-classify**: a room row is draggable (grab cursor when hiPriv is on), hall headers are drop targets (dashed highlight); release = a pre-filled rename (major/minor) straight to a dryRun preview, confirm to run — records follow, the old name goes to aliases, the grouped view hangs it under that hall. Touchscreens / environments without drag use the room-row "classify" button or the hall quick-select chips in the rename form as fallback.
- Backend fix: `renameSlug` target validation `isTag` → `isRoomSlug` — previously two-level targets (major/minor) were wrongly rejected, so "classify under a hall" was actually broken (and the rename orchestration would rewrite records first, then throw when renaming the registry, leaving a half-done state). Per the C3 removal/change discipline: red-test-first (unit + HTTP-surface integration, one each), verified red then fixed to green.

### Fixed

- Same as above: the `renameSlug` two-level target validation (a gap introduced in beta.5).

## [0.20.0-beta.12] — 2026-10-02

> lint cleanup + the removal discipline written down (C3 added to ENGINEERING-NOTES). **No functional change**.

### Maintenance

- **eslint cleanup (13 error → 0)**: longtask removal residue (stats.ts dead imports ×2, RecordsTab dead state) + older batches' debt (recluster.ts dead interface and let, rooms-registry.ts / ruminate.ts / room-review.ts / two test files' dead imports and let). The remaining 4 warnings are pre-existing baseline (the any in primitives/tools).
- **C3 "removal is also TDD" added to ENGINEERING-NOTES**: removal first changes tests to express the new expectation (red) → then removes the implementation (green); lint is a must-run gate for deletion-type changes (an unused import = an auto-detector for "not fully removed").

## [0.20.0-beta.11] — 2026-10-02

> Hall·Room **integration tests** landed (`tests/hall-room.integration.test.ts`: HTTP-surface full chain × real-storage user journey, 9 cases); the first integration run caught and fixed a unit-test blind spot.

### Fixed

- **rooms-get merged view hardcoding source `pre-registered`** (introduced in beta.4): when registry entries were merged into the count list the source was written fixed, so an adopted (source=grown) entry always wore the ⭐ pre-registered badge in the panel count chips — identity distortion. Now it uses the entry's real source (⭐ belongs only to pre-registered; adoption shows grown). Cause of the unit-test blind spot: the rooms-registry unit tests only tested the store layer, and no one asserted the source of a grown entry on the endpoint's merged row.

### Tests

- `hall-room.integration.test.ts`: empty-table self-grown count → two-level registration / illegal slug rejection → adoption → export three kinds → merge dryRun zero-write → run for real (backup to disk / retirement row rewrite / metadata preservation / scene recompute enqueue source='room-merge') → rename aliases → retire/restore → big-class 200 cap + small-class not counting against quota → corrupt read-only degrade red line (rooms-get not blocking, disk not written back).

## [0.20.0-beta.10] — 2026-10-02

> **Full removal of longtask (long-task mode)**: this family's home was on the context-compression side ("suggest starting compaction" is its domain), pm carried it by mistake — beta.8 removed the floating ball, this version removes the remaining backend. pm returns to the pure memory domain. Should "immediately distill the tail" and the like be needed later, redesign it from pm's own standpoint and re-charter it.

### Removed

- **Endpoints `longtask-hint-get` / `longtask-compress-tail`** (contract keys 48 → 46) and the `compressTailTurns` / debounced ruminate loop: context metering (`ContextUsageStore`), todo drift detection (`TodoRefStore`), the suggestion decision — all removed together; `hooks/long-task.ts`, `store/context-usage.ts`, `store/todo-ref.ts` three files deleted (including the todo/write-event declare module augmentation).
- **The `cfg.longTask.*` config block** (defaults + two Schema sites): longTask keys in old config files are ignored by the schema, no migration needed.
- **The session-level `longTask` flag and the tail-compression watermark `lastTailCompressedTurn`** (session-modes): leftover keys in old session-modes.json are naturally ignored by the load filter.
- **`session-mode-set`'s `mode` restored to required** (that optionalization existed only for the longTask either-or); the `longTask` request/response fields deleted.
- Kept: beta.9's roomRegistry RPC wiring fix (stands on its own); the Hall management page and Room classification management surface unchanged.

## [0.20.0-beta.9] — 2026-10-02

> Fix for deps being dropped across the whole panel RPC chain: `roomRegistry` and `longTaskDeps` were lost when rpcHandler assembled sources, so panel-side Room-management / long-task endpoints always read "not assembled" (the tool surface passes them directly and was unaffected, hence tools worked since beta.4 while panel registration kept erroring).

### Fixed

- **`registerMemoryRpc`'s rpcHandler dropped `roomRegistry`/`longTask`** (introduced in beta.4): HTTP dispatch uniformly goes through `buildEndpointDeps`, but sources carried only 7 items — `rooms-get` did not send down the registry, `room-register`/`room-admin` threw "Room registry not assembled (needs a plugin reload to initialize)", `longtask-hint-get`/`longtask-compress-tail` were always disabled. Now they are sent down with sources; a regression test pins the whole HTTP surface (register → rooms-get merge → room-admin, rpc.test.ts).

## [0.20.0-beta.8] — 2026-10-02

> Remove the floating-ball UI: the floating suggestion panel's home was on the context-compression side ("suggest starting compaction" is its domain), pm carried it by mistake — the FAB shipped since beta.1 is removed in this version.

### Removed

- **Floating ball + suggestion card (`client/src/longtask-fab.ts`, shipped since beta.1)**: entirely removed, the client reverts to two surfaces — `settings.section` (memory panel) + `conversation.input.left` (tier pill), no more application-wide floating UI. The long-task mode itself (context metering / todo reference / tail turn compression) is unaffected; the `longtask-hint-get` / `longtask-compress-tail` endpoints are kept as the backend surface, and the long-task toggle and manual-compaction entry will land in the memory settings section at finalize time.

## [0.20.0-beta.7] — 2026-10-02

> Room classification management third voyage (the **management-panel volume**): a dedicated "Hall" tab, hall (big class) + room (small class) managed together — manually viewing/managing Rooms no longer has to borrow the agent tool.

### Added

- **The "Hall" management tab** (after "Scene"): a hall grouping tree — `major/minor` go under their prefix big-class, a standalone slug forms its own hall (it is both a hall and the only room under it); the hall header row aggregates counts + a one-click "+small class" (pre-filled `hall/`); room rows show ⭐pre-registered / source / state / aliases / counts, retired greyed out. The UI terms Hall/Room are the grouping view, unrelated to Wing (the `metadata.hall` domain) and to cognition hall (ADR-0020 §7 disambiguation).
- **Full-operation UI entry (high-privilege memoryMutate gate)**: two-level slug registration (a controlled form, placeholder `dsh-plugin` / `dsh-plugin/merge`); self-grown slug **adoption** (`source=grown`); **rename/merge** via the new RPC — dryRun preview (affected count + samples) → "confirm run", the same orchestration as the memory_room_admin tool (auto-backup before execution + scene recompute enqueued on completion); retire/restore one click (restore has no second confirm, retire does confirm); a per-room record-list CSV export; vocabulary / orphan export consolidated onto this page; merge/rename carry an "execute when rumination is idle" hint.
- **New endpoint `dsh-memory/room-admin`** (merge/rename/retire; memoryMutate gate, endpoint-side throw semantics): contract keys 47 → 48. `rooms-export` gains `kind='records'` (export a record list by Room, `tag` required); `room-register` gains an optional `source` (adoption passes `grown`).
- The memory Tab Room block slimmed: the management sub-panel removed (orphan export moved to the header row), the hint points to the Hall page.

### Fixed

- The `rooms-export` records branch kind type narrowing (TS2322) and a garbled historical error string; the CHANGELOG beta.1-beta.5 duplicate header line fix.

## [0.20.0-beta.6] — 2026-10-01

### Fixed

- **Annotator vocabulary wired to the registry (beta.5's missing item completed)**: beta.5's merge/rename/retire landed, but the candidate annotator's (`annotateOrphanCandidates`) vocabulary was still a pure self-grown aggregate — pre-registered Rooms could not enter candidates at all. Now OrphanAnnotateIO carries a registry: the merged vocabulary = registry entries ordered first (count=0, with label/description) + the self-grown directory, capped at 120; both the ruminate and memory_room_admin annotate paths pass the argument. **Pre-registered Rooms now genuinely influence candidate annotation.**

## [0.20.0-beta.5] — 2026-10-01

> Room classification management second voyage (the **destructive surface**). dryRun defaults to true — merge/rename preview the impact first, run only after confirmation; auto-backup to `rooms-merge-backups/` before execution.

### Added

- **Room registry two-level system**: slugs support a `major` or `major/minor` two-level shape (e.g. `dsh-plugin`, `dsh-plugin/merge`); **big-class cap 200**, small-class subdivisions do not count against the big-class quota (an overall insurance of 2000). The isTag vocabulary is not loosened (slash is only allowed at the registry layer).
- **merge/rename/retire (tool `memory_room_admin`, high-privilege)**: merge rewrites the tags of all matching records via a cursor (re-read-merge-write before writing, keys preserved across roomCandidates/roomReview/hall/anchors etc.; includes already-retired rows, consistent with the count definition); rename = 1:1 merge + registry rename (aliases absorb the old name); retire is vocabulary retirement only (existing data untouched). merge/rename running concurrently with rumination overwrite each other — stagger them (both the tool hint and ADR-0020 declare this).
- **Rewrite-safety trio**: dryRun by default returns only affected + preview with zero writes; auto-backup matching records to `rooms-merge-backups/<ts>-<slug>.json` before running; on completion auto `invalidateRooms` + enqueue scene recompute by affected (family, scene) (`source='room-merge'`).
- **Panel Room management sub-panel** (appears after high-privilege is enabled): a registration form (slug/name/description, via the new RPC `room-register`), orphan-list export; merge/retirement suggestions go through the agent tool (dryRun preview is more detailed).
- Endpoint surface 46 → 47 (`room-register`).

## [0.20.0-beta.4] — 2026-10-01

> Room classification management first voyage (the **zero-drift surface**): an empty registry = behavior byte-identical to beta.3. The merge/rename/retire destructive surface comes with beta.5 (dryRun default true held back one version).

### Added

- **Room registry (`rooms-registry.json` sidecar)**: pre-register curated Rooms (slug/label/description); corrupt/empty → degrade back to a pure self-grown directory, never blocking the panel or the annotator; cap 200 to prevent spam. The `rooms-get` endpoint layer merges: a registered entry enters the vocabulary even at count=0 and carries `source`/`label`, the response gains a full `registry` field (optionally read by the client).
- **Export endpoint `dsh-memory/rooms-export`** (kind=rooms|orphans, CSV direct out): rooms = registry ∪ self-grown vocabulary with counts; orphans = the active-record list with no Room binding (including candidate/recheck state columns).
- **Tool `memory_room_admin`** (action=list|register): list shows the registry + self-grown overview; register pre-registers a Room (high-privilege gate, idempotent completion) — paired with `memory_room_review`'s per-item recheck, the agent gains a full "register → pre-mark → confirm one by one" classification-management entry.
- Client: Room chips carry a "pre-registered / self-grown" source badge; orphan chips carry a pending-recheck semantics.

## [0.20.0-beta.3] — 2026-10-01

### Added

- **Record panel Room classification improvements**: ① expand/collapse (collapse = header + a preview of the top 8 high-frequency Rooms, open/close state persisted); ② full paging in the expanded state (40 per page, ◀▶ to page), replacing the old hard cut of "only the first 40 shown"; ③ **orphan memory filter** — a leading "no binding · N" chip that shows only memories with no Room binding at all (`list-records` gains an `untagged` filter channel, `rooms-get` gains `orphanCount`, same definition as the Room count); ④ filter conditions instantly visible + one-click clear. The retrieval path has the same orphan filter.

## [0.20.0-beta.2] — 2026-10-01

> dsh-0.2.0-beta channel +1: full-context rumination optimization (repo soft fence / per-project scene migration / closed loop). Packaged with longtask (see beta.1), real-machine feedback merged in.

### Added

- **Repo soft fence (ADR-0015, `recall.scopeFence.*`, default off)**: repoKey=basename(normalized cwd) computed at write time into L1 metadata (repo_key_name/repo_key_owner/applicability, DEFAULT zero backfill, not entering FTS or the snapshot hash); recall and memory_search exits soft-downrank by `this-repo`/`cross-project` (×0.2 tunable, **only downrank, never exclude**, the chat family and unattributed records are not fenced, a dedup-path sentinel guards against mis-entry). Zero drift: when off by default, the recall order sha1 roundtrips identical.
- **Per-project scene migration (L2 repo awareness + re-clustering)**: the L2 consolidation prompt sees repoKeyName/applicability — this-repo records are no longer merged into cross-project scenes; a `scene_recluster_jobs` queue + a rumination idle-tier consumer (snapshot → delete-summary projection → full rollback on failure, zero new LLM channel); after a repo attribution patch it auto-queries affected scenes by repoKey and enqueues a recompute.
- **Compaction closed loop**: a 10-minute debounced rumination after a tail-compaction enqueue succeeds (flush → L2 → L3 → relabel → re-clustering consumption), fixing the break of "compacted records stranded in the distillation bucket".

## [0.20.0-beta.1] — 2026-10-01

> The first beta-channel release of the dsh-0.2.0 line (`dsh-0.2.0-beta` tag): long-task mode real-machine preview. Beyond the items below, this version also carries all prior main changes parked in `[Unreleased]` (activation slots / source anchors / evidence reader / memory retirement loop / three-axis conflicts etc.) — they shipped with the 0.1.7 line but the main line had no corresponding version number.

### Added

- **Long-task mode (`longTask.*`, default off) — the three-piece set for "long-running sessions": context metering, task reference, tail compression, plus a non-blocking floating suggestion panel.**
  - **Context usage (`store/context-usage.ts`)**: listens to the input side of `assistant/message`'s official `usage` (input + cache read/write), taking the **most-recent value** semantics (each round's input side already contains all history, no accumulation); zeroed and recounted after `compaction/summary`. A pure in-memory per-session Map — the first assistant message after a restart can rebuild it; persistence would only resurrect stale samples.
  - **todo reference (`store/todo-ref.ts` + `hooks/long-task.ts`)**: listens to the host's structured `todo/write` event (a full snapshot; the package types had not declared it as of 0.2.0-rc.1, so the plugin self-augments via declare module — the same precedent as §E's dsh-compaction). **Long-task sessions only**: the snapshot is flushed into one pinned `todo` slot (`SlotStore.refreshByTitle` managed refresh — repeated writes by the same subject must update in place, otherwise within the ≤8 slot cap you pile up closed-slot trails), injected residently via slot-recall — after compaction evicts the old context, the task north-star is still there. Adjacent snapshots get a lexical Jaccard drift detection (repeated writes of the same snapshot do not dilute the signal); body ≤512 bytes, truncation stated.
  - **Tail turn compression (`longtask-compress-tail` endpoint + `compressTailTurns`)**: immediately `enqueue(force:true)`-distills the most recent N turns within (compaction watermark, latest captured turn] into memory — landing the tail conversation into searchable memory right away rather than waiting for the distillation threshold. The watermark (`SessionModeStore.lastTailCompressedTurn`) only moves forward, and repeated presses are naturally idempotent; the off tier is fully invisible; un-anchored old data is only included on the first compression (watermark 0) — rather take less than re-distill.
  - **Suggestion state (`longtask-hint-get`) + floating ball (`client/src/longtask-fab.ts`)**: an ego-browser-style vanilla overlay (FAB + panel, drag / position persistence / viewport clamping), **the suggestion does not block** — the glow lights only when "context occupancy reaches `contextThresholdPct`" or "todo drift reaches `driftThreshold`" and long-task is off; inside the panel: the long-task toggle (temporary, per-session, **carries no mode** — flipping the switch does not reset the user's tier), the occupancy / drift progress bars, a manual tail-compaction button (only usable when long-task is on). Polling busy 2s / idle 5s, RPC failures silent; the seat contract is unchanged (settings.section exactly one, the body singleton occupies no seat).
  - **`session-mode-set`'s `mode` made optional**: either it or `longTask` is required — flipping only the long-task switch is no longer forced to send a tier (old clients always send mode, behavior unchanged). The response `mode` is changed back to the currently effective value.

## [0.19.0] — 2026-09-29

### Changed

- **DSH 0.2.0 adaptation (compat/0.2.0)**: peerDependencies and engines.dsh (package.json + dsh.plugin.json) moved wholesale to `>=0.2.0-rc.1 <0.2.1-0` (single-range replacement; the 0.1.7 line remains served by the compat/0.1.7 branch); the 9 dsh-* devDependencies re-pinned 0.1.1-rc.2 → 0.2.0-rc.1 and the type-only dependency `@deepseek-ai/dsh-compaction` added. Code-level adaptation to 0.2.0 host API drift: the `agent/session-start` event merged into `agent/created` (listeners made async to satisfy the serial contract); session event reads switched from `session.events` to `session.snapshotEvents()` (host deprecated synchronous full reads; degradation chain preserved); test stubs updated (projection cursor offset semantics).
- **Release metadata**: version 0.18.4 → 0.19.0; publishConfig.tag `dsh-0.1.7` → `dsh-0.2.0`; dsh.plugin.json version → `0.19.0-dsh0.2.0.1`.

## [0.17.0-dsh0.1.7.1] — 2026-09-25

> First release of the **host 0.1.7** compatibility line (dist-tag `dsh-0.1.7`, based on main @ 85d9b05). **Requires host ≥0.1.7-rc.1**; hosts 0.1.5 / 0.1.6 should stay on the `dsh-0.1.5` tag. Contains everything from main plus the adaptation below.

### Changed

- **Runtime toggles moved into a Config volatile section (0.1.7 declarative settings).** Host 0.1.7 removed both generations of imperative registration APIs (`settings.register` / `installSection`). The runtime toggles (master/capture/distill/recall, distill route chains, remote-embedding overrides, write-delete gate — 20 keys) are now carried by a whole-section `.volatile()` on `memorySchema.live`: the host projects volatile fields into a settings form automatically, and runtime changes flow through `ctx.settings.update` → configEditor → profile patch → loader volatile-only commit (no plugin remount). The `LiveSettingsHandle` contract is unchanged; RPC and all consumers untouched. The plugin ships its own custom settings page, so the host's auto-generated form page is suppressed (`suppressAutoSettingsForm`).
- **⚠️ Old setting values do not migrate automatically**: the legacy `dsh-memory` section in `settings.yaml` holds flat top-level keys that do not match the new `live.*` paths (and its boolean `conflictFreeze` collides with the same-named object section in the new Config), so the host importer rejects the whole section. After upgrading, hand-write the old values into the profile patch as `- id: dsh-memory / config: { live: {…} }` (key names are identical to the old namespace, just one `live.` level deeper).
- devDeps bumped to the 0.1.7 stack (cordis 4.0.4 / schemastery 3.18.4 / cordis-plugin-loader 1.0.5); not shipped to consumers.

### Fixed

- **Silent first-write loss regression**: lock files are created before the write; when the target's parent directory did not exist yet, `open('wx')` failed with ENOENT and stores swallowed it as a warn. `rmwJson` now `ensureDir`s before acquiring the lock (included from the main line).
- Also includes everything from the main line: file-layer hardening (atomic writes / read-side classification / version fail-closed / file locking / path safety — see [Unreleased] entries).

## [0.18.4] — 2026-09-28

### Added

- **Crash recovery (§A)**: a turn interrupted by a host crash was previously lost forever with the in-memory capture buffer (the resume cold-start floor discarded all history). On `agent/session-start(resume)` the plugin now reconciles against the host's persisted event log: with the max L0-persisted turn as watermark it recovers complete trailing turns (cap 2; crash-orphaned turns are closed by the host with `turn/end{reason:'interrupted'}` — 98 instances found on this machine). Idempotency = watermark + per-turn existence check; when host read services are unavailable it degrades stepwise (`sessionQuery.readSession` → `sessionPersistence.readFrom` → current behavior + one-time notice), always fail-open and never blocking session startup.
- **Payload redaction (§C, `capture.redactSecrets`, default on)**: the capture boundary replaces 8 classes of secrets (PEM keys / Authorization headers / Bearer & JWT / Cookies / vendor API key shapes / emails / ≥9-digit numbers with dates excluded / high-entropy IDs) with typed `[REDACTED:<KIND>]` placeholders — a single choke point covering L0 JSONL, L0 SQLite, distill input and manual `memory_add`/`memory_import`. Safe values (`example` / `$VAR` / `${{…}}`) are kept; placeholders preserve the category so keyword search still matches. Note: once enabled the original L0 text is changed (rebuild cannot recover it); `false` restores plaintext.
- **Distill prompt anti-injection (§B)**: all six distill prompt files (L1 extract ×3 / L1 dedup ×3 / L2 scene ×2 / L3 persona ×2 / graph projection / reconcile) now carry a "content boundary (anti-injection)" declaration plus data-delimiter notes — conversation text, existing memory pools and scene contents embedded in prompts are data, not instructions, so instruction-like text in conversations can no longer hijack distillation, dedup or adjudication. Decision vocabularies and output contracts are unchanged.

### Improved

- **Injection acknowledgment (§D)**: recall injection no longer marks the dedupe store on return; it is now a two-phase "pending → log receipt" — the mark happens only when the host actually writes the injected message into the session log (`user/message` with the `plugin:memory` signature and stable id). Injections overwritten or cancelled no longer suppress memories (they can be re-injected next turn); after 5 minutes without a receipt the mark is applied anyway (guards against an ack-chain failure disabling dedupe), unconfirmed-expired entries are dropped.
- **Compaction-aware re-injection (§E)**: after `compaction/end` (no error), the session's next turn performs one targeted enhanced recall — dedupe suppression is skipped (compaction evicted prior injections from context), the persona section is re-delivered immediately, and the occupancy ledger resets; consumed on use. The existing compact/clear full reset remains as a fallback; both paths are idempotent.
- **Structured trace (§F, `trace.*`)**: recall and distill events are persisted as daily JSONL under `<dataDir>/trace/` (14-day retention by default; 5 MB per-day cap with a marker). Recall events carry a query fingerprint (metadata-only by default: length + sha256; `trace.captureContent` stores the text ≤200 chars), hit/injected ids, scores, latency and four outcomes; distill events carry runId, the six-value decision aggregation (same source as `l1_receipts`, cross-auditable), latency and success. New `dsh-memory/trace-tail` endpoint; the Log tab gains a three-source switch (system log / recall trace / distill trace).

## [0.18.2] — 2026-09-27

### Fixed

- **Session format v4 signature adaptation (host >= 0.1.7-rc.1)**: the two memory-recall injection sites (cross-session recall in `hooks/recall.ts`, slot persistent injection in `hooks/slot-recall.ts`) no longer use the legacy signature `source: { kind: 'plugin', plugin: 'memory', form: 'recall' }` that the v4 host rejects (`SessionFormatError`, whole round fails — the source of "error on memory recall"). They now use the producer-owned `{ kind: 'plugin:memory', form: 'recall' }`. `form`, content and timing unchanged. Evidence: `source()` in `@deepseek-ai/dsh-session-format-v3-to-v4@0.1.7-rc.2` only checks that kind is non-empty and not `'plugin'`; companion fields are not validated.
- **Dual-shape read side**: the recall-share signature predicate `isOwnRecallSource` accepts both the new signature and legacy v3 rows — fixing only the write side would silently zero the "memory recall share" in the occupancy panel. `MessageSourceMap` is augmented via module merging to register `plugin:memory` (dsh-llm 0.1.7's map is `user|model|tool|'system-prompt'` with no plugin catch-all; merge-extensible per producer).
- **tool-result v4 native adaptation (N1)**: evidence text reading in `store/evidence-source.ts` gains a native branch (v4 first-class `role:'tool'` message: content is text/reasoning blocks directly, `isError` at message top level; the host's `assertBlock` hard-rejects legacy `tool-result` wrapper blocks). The legacy block-descend path is kept for historical logs — otherwise evidence text would be silently empty on v4. The isError guard in `projection/slots.ts` is natively adapted as well.

## [Unreleased]

### Added

- **Source anchors (R7) — a memory can now be traced back to a real position in the session.** Until now the traceability chain was broken: L1 carried `source_message_ids`, but those are **L0 message ids** (`msg_<epoch_ms>_<hex>`) while the L0 table had no `turn`/`step` columns, and the id list was never written to the retrieval DB at all (the store kept only `metadata`, silently dropping the field). Result: **no memory could be located in the original conversation**.
  - `l0_conversations` gains `turn`/`step` columns (idempotent `ALTER TABLE`; old rows stay NULL = "no anchor", never back-filled with a guess) plus an `(session_id, turn)` index.
  - The capture hook now folds `step/start`, so `user/message` events — which do not carry `step` in the kernel payload — still get their **same-turn** coordinate. `assistant/message` uses the `{turn, step}` it already carries. Messages before the first `step/start` keep `step` empty on purpose: **a missing coordinate is never invented.**
  - Anchors live under the reserved `metadata_json` key `dsh_source_anchors` (rendered as `t12 s3` in the UI). No new column, no disk-contract change. Both the fresh-store path and the **merge/update** path carry anchors — otherwise a single merge would lose the coordinate.
  - New host API `MemoryDb.l0ByAnchor(sessionId, turn, step?)` fetches L0 messages **by coordinate** instead of by recency; this is the single read entry point for the upcoming evidence reader.
- **The records panel now shows the source anchor** where it previously always showed a dash.

- **Memory retirement (soft delete) and a real cleanup round-trip: deleting no longer means losing data.** "Delete" used to be a **physical** delete — a mistake could only be undone by hand from the `records/*.jsonl` fact source. Deletion now has two tiers, and **the reversible one is the default**.
  - **Retirement (soft delete)**: the main-table row is kept, `valid_to` is closed, and a supersede marker is written (reserved `metadata` key `dsh_superseded`, carrying time / reason / verdict / conflict-pair id). Only the `l1_fts` and `l1_vec` rows are dropped. **The retrieval SQL is untouched** — zero query drift. All three retirement paths (conflict verdict / dedup supersede via `update`·`merge` / manual delete) **share one primitive**, so "delete" means the same thing everywhere.
  - **Endpoints 33 → 38**: `records-retired` / `records-restore` / `cleanup-retired` / `snapshots-list` / `snapshot-restore`. Three lists (the `contract.ts` map, the `MEMORY_ENDPOINTS` allow-list in `stats.ts`, and the dispatcher `case` table) plus the endpoint-count assertion were updated together — missing any one makes an endpoint permanently 404 while the client `rpc` catch swallows the error silently and the whole panel block disappears.
  - **`memory_delete` now retires 1 record by default** (was 3) and gained an exact `ids` path that skips semantic matching. The old semantic top-N batch delete **actually removed two unrelated real memories** during testing: precision has to come from exact ids, not from similarity.
  - **Physical cleanup defaults to dry-run**: omitting `dryRun` means `true`. Even when explicitly executed it first writes a **full-library snapshot**, verifies it **by content hash**, and aborts with zero deletions on any mismatch. To make that impossible to bypass, `deleteL1Batch` was reduced to a **single caller** (`exportThenPurge`), pinned by a source-level guard test — "there is no physical-delete path that skips the export" is now a structural fact rather than a convention.
  - **The return ticket was missing.** `restoreL1Snapshot` had **no production caller at all**, so "export before cleanup" was only half true: the export existed, the way back did not. `snapshots-list` / `snapshot-restore` now wire it up — snapshot **directory names only** (paths and `..` are rejected), dry-run by default, and `stillRetired` reported honestly. That field is not optional: cleanup only ever removes **already-retired** records and the snapshot is taken **before** deletion, so every record it can bring back carries a retirement marker. **Back in the main table ≠ back in recall**, and staying silent about it makes people believe recovery finished. Pass `unretire: true` for a genuine one-call rollback (it reuses the existing `restore`, no new write path).
  - **Panel**: the records tab gained a collapsed "retired (recoverable)" section that only fetches when expanded, and delete confirmations now state that the action is reversible. **Physical cleanup deliberately has no panel entry** — irreversible actions stay on the RPC/model surface.
- **§C conflict freeze: same-batch contradictions can now be frozen (fixing "the only thing the model ever says is exactly what gets rejected").** Investigation showed that `validateConflictPair`'s third condition required the other side to be a known record from the candidate pool — and **ids of memories created in the same batch are not in it** (they were just generated and are not stored yet). So the most typical "the machine cannot decide" case, two fresh contradictory memories in one batch, was **necessarily rejected and fell back to `store`** even when the model correctly emitted `conflict`. Evidence: the model emits it 7/7 at the model level, yet that hop never reached the database (`conflict_pending` has had 0 rows since the DB was created, and `conflict` receipts are 0 across `store 381 / merge 204 / update 172 / skip 7`). Fix: `validateConflictPair` takes an optional `batchIds` (omitted = previous behaviour) while still requiring exactly one side to be the current record, which keeps pairing unique; plus a queue-full guard so that **a loser belonging to the current batch is never auto-resolved** (otherwise freshly extracted output would be retired immediately with nobody informed) — it is simply not parked and stored as usual.

- **§C conflict freeze now understands the "three time axes": a content contradiction that is ordered in time is no longer always handed to a human.** A memory already carried three non-substitutable time axes (record time `createdAt/updatedAt`, fact validity `validFrom/validTo`, persistence `persistence`), yet conflict detection only used record time — the detector could not see validity or persistence when deciding `conflict`, so "an old fact was superseded by a new one" was routinely parked for a human; and the verdict panel showed only the two texts, leaving people to decide blind. Both ends of the freeze now carry the axes:
  - **Detection side**: with freeze **on**, the unified candidate pool passes each memory's `valid_from_ms` / `valid_to_ms` / `persistence` to the detector, and the `conflict` action clause gained a "three-axis first pass" — when content contradicts, compare validity and persistence first, and when one side has expired or is clearly later, prefer `update` / `merge` over `conflict`. **The three keys and the clause are both gated by `conflictFreeze`**: in the closed state the user prompt is **byte-identical** to the pre-change one (see Fixed below and [ADR-0012](./docs/adr/0012-conflict-3axis-advisory-time-axes.md)).
  - **Verdict side**: `ConflictPairView` gained optional `winner_*` / `loser_*` axis fields (backwards compatible); the pending list and its rendering attach a "valid from / valid to, persistence" comparison to each pair, so a person can see at a glance which side is newer and which has expired.
  - The machine **still does not auto-adjudicate**: the axes are advisory facts only, and the final verdict is still written by a human (or by the safety valve on timeout / full queue) — `ConflictResolution` values are unchanged.

### Fixed

- **Closed-state prompts silently gained the three axis fields (affects deployments with freeze off — the default).** The first version injected `valid_from_ms` / `valid_to_ms` / `persistence` into the candidate pool **unconditionally**, while that LLM call only read the switch for the system prompt — so with `conflictFreeze=false` (the deployment default) the model saw 3 extra keys per candidate, **explained by no clause at all**: extra tokens and a changed input. The keys are now gated by `conflictFreeze`, so the closed-state user prompt is **byte-identical** to the pre-change one, and the criterion was upgraded from "does not contain substring X" to a **sha1 golden anchor plus reverse verification** (breaking the gate turns that case red).
- **The panel reported "conflict freeze is off" while the switch was clearly on.** The `conflicts` / `conflict-resolve` endpoints read the **static deployment config** `cfg.conflictFreeze.enabled`, whereas the panel writes the **live runtime setting**. The deployment default is always `false`, so with the switch on and `true` persisted to `settings.yaml` the page still said it was off. It now resolves through `effectiveCfg(cfg, live)`, the same resolution the dedup pipeline uses: there is exactly **one** source of truth, and the read and write sides must see the same state — otherwise you get "the list says it is on while the verdict says it is off".
- **`dsh-memory/embedding-reindex` was declared but permanently 404.** The endpoint existed in the contract yet was missing from both the `MEMORY_ENDPOINTS` allow-list and the dispatcher `case` table, and `startReindex()` was **dead code** — which is why the settings "vector index" block only ever offered Cancel and never Start. Allow-list, `case`, and tests added.
- **`UiRecord.sourceMessageIds` was a dead field.** It read a column `l1_records` never had, so it always resolved to `[]` and the panel's source row **never rendered**. Replaced by `sourceAnchors`, which reads real data.

## [0.12.0] — 2026-09-17

### Added

- **Manual vector-index rebuild (`dsh-memory/embedding-reindex` + the "Vector index" block in settings).** A rebuild previously had exactly two triggers: the `db.init` change-detection chain at startup, and the periodic backfill that fills in missing vectors — **there was no manual entry point**. The settings page showed only "Cancel" (and only while a rebuild was already running): no "Start", no count of what was embedded versus outstanding.
  - **Endpoint surface 31 → 32.** New `EmbeddingReindexStartResponse` (`{accepted:true}`). **Accepting returns immediately and does not carry progress** — the client keeps polling `reindex` on `embedding-state-get`. Two progress vocabularies eventually disagree, so there is deliberately only one. All four places were updated together (`contract.ts` maps / the `MEMORY_ENDPOINTS` allowlist / the dispatcher `case` / the endpoint-count assertion) — **missing any one pins the endpoint at a permanent 404**, and since the client `rpc` catch swallows that silently, the whole panel just vanishes.
  - **`EmbeddingStateView` gained `vectors`**: `embedded` / `total` / `missing` / `skipped` for L1 and L0, which is where "X of Y embedded" comes from. The db layer's **`-1` sentinel passes through verbatim** — "vector capability unavailable" and "nothing embedded yet" must stay two different sentences; collapsing them into one number sends the user to click a button that can never respond.

### Fixed

- **Rebuild requests that would be accepted but never actually run are now rejected.** The first line of `L1Store.reindex` / `L0Store.reindex` **silently short-circuits** to `0/0/0` when vector capability is not ready. Ungated, the UI would report "rebuild complete, nothing outstanding" while the rebuild **never started**. That trap was already documented at `src/index.ts:240`, but only for the startup chain; the manual entry point was a new hole. `startReindex()` hoists all five gates, each with an **actionable** message: unloaded / already running / source switch holds the lock / **embedding source off** (`currentInfo` empty) / **service not ready**. ("Turn it on first" and "wait a bit" are different instructions and must not be merged.) This required a `vectorsReady()` accessor on both stores — `helper` is private, so nothing outside could ask.
- **Incomplete `db` test double in `embedding-subsystem.test.ts`.** It carried only `swapProvider` / `markEmbeddingSynced` and bypassed type checking via `as never`, so the gap never surfaced; once `snapshot()` began including vector counts it crashed (`getVecSkipSet is not a function`). **The double was completed rather than making `vectorCounts` defensive**: the signature declares a full `MemoryDb`, and swallowing missing methods swallows real wiring errors with them.

### Tests

- 5 new cases: rejected when off / rejected when not ready / accepted and drives L1+L0 with an immediate concurrent rejection / rejected after unload / `snapshot` count semantics. **Every rejection path asserts both "throws" and "downstream never called"** — asserting only the throw would let an implementation that calls downstream *and then* throws pass.
- **Falsified**: temporarily removing the readiness guard turns `向量能力未就绪 → 拒绝` red (`expected [Function] to throw an error`); restored and green again.
- Full suite **39 files / 403 cases**; `typecheck` (three tsconfigs), `build` and `smoke` all green.

## [Unreleased]

### Added

- **§E Storage scope `scope` (visibility range, orthogonal to `family`)**. Until now every project shared one memory store: `work`-family memories distilled in project A were recalled in project B. New `scope` setting (`global` default / `workspace`), **orthogonal** to `family` — `family` answers "what kind of content is this", `scope` answers "how far should it be visible". "In `workspace` mode the `work` family is isolated per workspace while `chat` stays global" is a **default, not a derivation rule** (personal memories are meant to cross projects; contamination lives between projects).
  - **Zero drift is constructed, not compared**: when `cfg.scope` is not `workspace`, the shared `scopeFilterOf` always returns `undefined` (= no filtering), so no call site can accidentally pass a workspace id. Existing deployments (key absent) behave **byte-identically**.
  - **Isolation sits on the same layer as family isolation**: not just the retrieval exit — **dedup candidate recall** is filtered too. The candidate pool decides the next dedup decision; leaving it cross-workspace produces memories that are "invisible in project B yet already decided project A's fate", which is worse than no isolation ([`ADR-0008`](./docs/adr/0008-storage-scope-vs-family.md)). The graph lane filters on the **source record's** ownership at the same layer; all write paths share one `resolveRecordScope`.
  - **The workspace identifier is the canonical cwd, not the host's `dsh-workspace` `WorkspaceId` (uuid)**: same header channel as §A's `parentSession`, synchronously available; declaring `inject` would fail the whole plugin tree on hosts lacking the service; the host's own membership rule is "session header's canonical cwd == workspace path"; a uuid requires a *registered* workspace, so unregistered directories would silently lose isolation. Known boundary: **symlinks are not resolved**, which over-isolates (the safe direction) rather than leaking ([`ADR-0009`](./docs/adr/0009-workspace-identity-source.md)).
  - **Migration labels ownership only, never moves or deletes**: `l1_records` / `l1_fts` each gain `scope` + `workspace_id`; existing data is graded `global` by the `ALTER` default — row count, id, content and created_time stay byte-identical.
  - **Two real defects caught during execution**: ① an FTS rebuild backfill that dropped scope would **silently erase isolation** (its per-row `catch` swallows the column-count mismatch, leaving `count=0` and an empty index); ② a missing **shape normalization** on the write side meant memories could be written and then be unreachable (retrieval passes a normalized lower-case path while the store kept the caller's upper-case string). Both were caught by end-to-end tests and mutation probes.
- **§F Graph node vector column `graph_node_vec` (storage and degradation groundwork)**. The graph only had lexical weighted scoring, so semantically equivalent but literally different entities ("云深处" vs "DeepRobotics") could not resolve to each other. Adds a vec0 virtual table **same-pattern** as `l1_vec` (one shared encoding, one `float[N] distance_metric=cosine` declaration); dimensions **reuse** the existing capability probe rather than adding a second one.
  - **Degradation is absorbed in an inner `try/catch`**: a missing vec0 makes table creation throw, and if that reached `GraphStore.init`'s outer catch the graph would degrade from "vector lane unavailable" to "**the entire graph domain unavailable**", taking lexical retrieval, projection and adjudication with it ([`ADR-0011`](./docs/adr/0011-graph-node-vector-storage-and-degradation.md)).
  - **This wave ships a door, not a producer or consumer**: projection does not yet compute embeddings. Recorded as incomplete — it is §F's starting point, not its end.

- **§B L1 decision-receipt chain (traceability infrastructure)**. Every L1 record is the *result* of a dedup decision (store / update / merge / skip), but the decision itself left no trace — you could see the outcome, never what it was based on. New `l1_receipts` table records one receipt per decision (`run_id` / `record_id` / `kind` / **a sha256 digest of the ordered candidate pool** / `decided_at`), with the new **`memory_receipts`** tool and **`dsh-memory/receipts`** RPC endpoint for **two-dimensional backtracking** (by record or by run; both = AND). Receipts must exist *before* the event — input snapshots **cannot be backfilled**, so this shipped as a prerequisite rather than waiting for a symptom ([ADR-0006](./docs/adr/0006-l1-decision-receipts.md)).
  - Retention is **by run count** (`RECEIPTS_MAX_RUNS = 1000`) — a time window **cannot bound the row count**. Trimming is **per run, not per row**: cutting rows yields *half batches*, which produce conclusions that look complete but silently omit entries — worse than finding nothing.
  - Hard line: trimming **touches `l1_receipts` only, never `l1_records`** (discardable observation data vs. the user's source of truth).
  - Failure isolation: receipts are a side channel — a write failure logs a warning and **never interrupts L1 distillation**.

- **§C conflict freeze (opt-in, off by default)**. The dedup **action vocabulary** was `store` / `update` / `merge` / `skip` — so the "conflict detector" adjudicated contradictions itself (`update` overwrite or `merge`), with **no "stop and ask a human" option**. With `conflictFreeze.enabled`, the vocabulary gains `conflict`: when the model judges that both sides look right and it cannot tell, the pair is **parked** in `conflict_pending` — **the new memory is still stored and neither side is rewritten** — and a human adjudicates via the new **`memory_resolve_conflict`** tool (RPC: `dsh-memory/conflict-resolve`) with `winner` / `loser` / `both`.
  - **Freeze is not "block the write", it is "do not auto-adjudicate"** — the former loses information, which is worse than the problem it solves.
  - **Safety valves**: `maxPending` (queue cap) and `timeoutDays` (timeout fallback). The semantics are "**stop taking new ones**", not "quietly delete old ones" — auto-settled pairs **are still written to the queue** with `resolution = auto`, distinguishable from a human verdict.
  - **Graph side**: nodes whose sources hit a frozen record are marked `disputed` (an existing status; still a retrieval candidate, i.e. "recalled as usual but visibly contested"). The mark is a **derived sync**, not a one-way flag: adjudication **cancels** the dispute, and a one-way flag would leave resolved nodes stuck at `disputed` — a derived graph lying about the facts.
  - **Zero drift**: while off, the dedup prompt is **byte-identical** to before. This is **structural** (the off path returns the base constant directly), not a manual diff ([ADR-0010](./docs/adr/0010-conflict-freeze-default-off-and-timeout.md)).

### Changed

- **New settings** `conflictFreeze.enabled` (off) / `conflictFreeze.maxPending` (100) / `conflictFreeze.timeoutDays` (30; `0` = no timeout fallback). **New endpoints** `dsh-memory/receipts` and `dsh-memory/conflict-resolve` (endpoint surface 26 → 28).
- **`L1ReceiptKind` gains `conflict`**. Extending an action vocabulary requires checking **every consumer of that vocabulary** (receipt normalisation, stats logs, rendered text, schema descriptions) — measured during this work: a missed registration recorded "the model **explicitly** said it cannot tell" as `skip_missing` ("the model **did not answer**"), and since §C's auditability depends **entirely** on the receipt chain, the audit conclusion was the exact opposite of the facts.

### Fixed

- **Unrecognised actions silently absorbed by the fallback branch.** The apply loop in `pipeline/l1.ts` branches explicitly only on `store` / `skip`; **every other action falls through to the update/merge branch**. A `conflict` decision carries no `target_ids` by design, so `targets=[]` and the record was appended as a "merged product that replaced 0 rows" with `version = 1`. **No error, no data loss — the only trace was a version number**, i.e. `conflict` had been silently downgraded to merge/update: exactly the behaviour §C exists to remove. **Fix**: an explicit `conflict` branch; when validation fails or the switch is off it falls back to `store`, never to the fallback branch.
- **The endpoint gate was a hand-copied list.** `tests/contract-keys.test.ts` duplicated the real registry instead of importing it, so both assertions were self-consistent with the copy. When §B added `receipts` the real registry went to 27 while the copy stayed at 26 and the count assertion stayed at `toBe(26)` — it went green regardless. Adding `conflict-resolve` this round **still** went green. **Fix**: assert the local list equals `MEMORY_ENDPOINTS` item by item.

## [0.11.0] — 2026-09-13

### Compatibility (adapted to the DSH plugin framework docs)

- **Cross-version settings registration (0.1.1-rc.2 ~ 0.1.5-rc.2)**. `src/settings.ts` previously **value-imported** `settingsNamespace()` from `@deepseek-ai/dsh-settings`, an export that v0.1.3+ removed — on newer hosts the module fails at load time with `Failed to load plugins`, taking down the whole plugin tree. Now:
  - The namespace is the string literal `'dsh-memory'` (the browser half only reads the raw string; equivalent on old and new hosts). Only type imports remain (erased at compile time, no load risk).
  - Registration uses a three-way runtime branch: prefer `settings.register()` (present in every target version; returns a get/watch/update scope used by the live toggles and UI writes); fall back to an `settings.installSection()` bridge (v0.1.2+ service surface, only when `register` is absent; runtime writes reject with a business error); if neither exists, degrade to always-on — the "settings failure must never take down the host" rule is unchanged.
  - `SettingsScope` is now a local structural type, no longer tied to package-level type exports.
- **Added `dsh.plugin.json`** (DSH discovery manifest: id / `engines.dsh` `>=0.1.1-rc.2 <0.2.0-0` / components pointing at `dist/` artifacts), aligned with the `dsh-plugin-template` standard file structure.
- **`@deepseek-ai/dsh-*` peerDependencies are now optional with widened ranges** (`^0.1.1-rc.2 || ^0.1.2-rc.1 || ^0.1.3-rc.1 || ^0.1.5-rc.2`); `@deepseek-ai/cordis` stays required — per awesome-dsh-plugin submission requirement B.3.
- **Added `screenshots.json`** (8 entries referencing `assets/img/`) for the submission card.

### Changed

- `package.json` version bumped to 0.11.0; npm `files` adds `dsh.plugin.json` (`screenshots.json` stays git-only per the awesome-dsh-plugin probe convention, not shipped in the npm package).

### Pending field verification

- The `conversation.input.left` / `settings.section` slots and the Session V3 `session.surface.nodes` semantics (occupancy estimate) on v0.1.5-rc.2 are not yet field-tested; see the compatibility matrix in the README.
