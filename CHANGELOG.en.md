# Changelog (English)

- [中文更新日志](./CHANGELOG.md)
- [English Changelog](./CHANGELOG.en.md)
- [日本語 changelog](./CHANGELOG.ja.md)
- [한국어 changelog](./CHANGELOG.ko.md)

This file covers the **0.12.0** release notes and the current **unreleased** changes in English. For the full history, see [CHANGELOG.md](./CHANGELOG.md) (Chinese).

<!-- Gap: entries for 0.21.0 and 0.20.x are not yet translated. -->

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
