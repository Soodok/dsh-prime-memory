<div align="center">

<img src="./assets/img/Hero.png" width="100%"
alt="DeepSeek Harness ヒーロー画像：会話がバックグラウンドで階層的に蒸留されて記憶に、モデルの各ステップ前に自動で想起・注入される">

# dsh-prime-memory

**DeepSeek Harness 向けの階層的蒸留記憶プラグイン：会話はバックグラウンドで L0 捕捉 → L1 原子記憶 → L2 シナリオ統合 → L3 ペルソナ蒸留を経て処理され、関連記憶はモデルの各ステップ前に自動でコンテキストへ注入されます。**

[中文 README](./README.md) · [English README](./README.en.md) · [日本語 README](./README.ja.md) · [한국어 README](./README.ko.md) · [最新リリース](https://github.com/drscrewdriver/dsh-prime-memory/releases/latest) · [問題を報告](https://github.com/drscrewdriver/dsh-prime-memory/issues)

[![npm version](https://img.shields.io/npm/v/dsh-prime-memory?color=6f83ff&style=flat-square&label=npm)](https://www.npmjs.com/package/dsh-prime-memory)
[![DSH 0.2.0-rc.1](https://img.shields.io/badge/DSH-0.2.0--rc.1-8b5cf6?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![MIT License](https://img.shields.io/badge/license-MIT-536990?style=flat-square)](LICENSE)

</div>

<details open>
<summary>🌐 言語 / Language</summary>

- [中文 README](./README.md)
- [English README](./README.en.md)
- [日本語 README](./README.ja.md)
- [한국어 README](./README.ko.md)
- [README en français](./README.fr.md)
- [README auf Deutsch](./README.de.md)
- [README in italiano](./README.it.md)
- [README на русском](./README.ru.md)
- [README en español](./README.es.md)
- [インストールガイド（日本語）](./INSTALL.ja.md)
- [Installation guide (English)](./INSTALL.en.md)
- [中文安装指南](./INSTALL.md)
- [한국어 설치 안내](./INSTALL.ko.md)
- [Guide d'installation (français)](./INSTALL.fr.md)
- [Installationsanleitung (Deutsch)](./INSTALL.de.md)
- [Guida all'installazione (Italiano)](./INSTALL.it.md)
- [Руководство по установке (Русский)](./INSTALL.ru.md)
- [Guía de instalación (Español)](./INSTALL.es.md)
- [日本語 changelog](./CHANGELOG.ja.md)
- [Changelog (English)](./CHANGELOG.en.md)
- [更新日志（中文）](./CHANGELOG.md)
- [한국어 changelog](./CHANGELOG.ko.md)
- [Changelog en français](./CHANGELOG.fr.md)
- [Changelog auf Deutsch](./CHANGELOG.de.md)
- [Changelog in italiano](./CHANGELOG.it.md)
- [Changelog на русском](./CHANGELOG.ru.md)
- [Changelog en español](./CHANGELOG.es.md)

</details>

> **互換性の注意**：本プラグインはドキュメントを日本語・韓国語で提供しますが、公式 DSH の `LocaleRuntime` が登録する言語は `zh` / `en` のみです。`ja` / `ko` を選択すると `locale "<id>" is not registered` となります。プラグイン側は辞書を持ち込めますが、DSH グローバルのロケール一覧は拡張できません。DSH を fork して `LOCALE_IDS`（locale-settings.ts）と `LOCALES` ラベル（client/index.ts）を更新し再ビルドすることで利用可能になります。

## DSH バージョン互換マトリクス

| DSH バージョン | settings 登録 API | 状態 |
|---|---|---|
| 0.1.1-rc.2 | `settings.register()`（ライブスコープ） | ✅ 検証済み |
| 0.1.2-rc.1 | `settings.register()`（フォールバック可） | ⚠️ フレームワークドキュメントから推定、未実測 |
| 0.1.3-rc.1 | `settings.register()`（フォールバック可） | ⚠️ 未実測（0.1.3+ で名前空間が文字列化、本プラグインは対応済み） |
| 0.1.5-rc.2 | `settings.register()`（フォールバック可） | ⚠️ 未実測。Session V3 の surface セマンティクスと入力バー/設定スロットは回帰待ち |
| 0.2.0-rc.1 | `settings.register()`（ライブスコープ） | ✅ 今回の適用ライン（イベント配線 agent/session-start → agent/created） |

> 互換メカニズム：settings 登録は 3 分岐のランタイム判定（`register` → `installSection` ブリッジ → 常時オン縮退）。
> 詳細は [CHANGELOG.md](./CHANGELOG.md) の 0.11.0 エントリ参照。`dsh.plugin.json` は
> `engines.dsh` 为逐 rc 精确枚举串（0.1.0-rc.2 → 0.2.1-rc.3，18 rc） を宣言。

## クイックスタート

Node ≥ 22.16 が必要です。2 通りの呼び出し方式から選べます（`npx` 接頭辞は以下のどの `dsh` コマンドも置き換え可能）：

```bash
# 方法1：npx で公式 CLI を直接実行（dsh の事前導入不要。バージョン固定も可、例: dsh-prime-memory@0.8.4）
npx -y @deepseek-ai/dsh plugin --profile web add dsh-prime-memory

# 方法2：dsh CLI 導入済みの場合（dsh は pnpm フォワーダ。未導入なら先に npm i -g pnpm）
dsh plugin --profile web add dsh-prime-memory

# その他のソース：GitHub リポジトリ / ローカルパス（開発・デバッグ用。link: はリポジトリを指し、npm run build + dsh 再起動で反映）
dsh plugin --profile web add https://github.com/drscrewdriver/dsh-prime-memory
dsh plugin --profile web add /path/to/dsh-prime-memory
```

### Agent にインストールさせる（推奨）

現在の Agent がターミナルコマンドを実行できるなら、以下の文をそのまま送ってください：

```text
DeepSeek Harness の web プロファイルに dsh-prime-memory プラグインをインストールしてください。

以下の2コマンドのみを実行し、他のプロファイルは変更しないでください：
dsh plugin --profile web add dsh-prime-memory
dsh --profile web --dump-config

出力に dsh-prime-memory が表示されたら、インストール結果を教えてください。
稼働中の DSH を勝手に閉じたり再起動したりしないでください。インストール後、DSH Web Host の手動再起動を促してください。
```

Agent はインストール結果と、設定に `dsh-prime-memory` が現れたかを報告します。

本パッケージは `dsh.bundle` 合成層（`cordis.patch.yml`）を宣言しており、インストール後に**プラグイン行が自動マウント**されます——`$DSH_HOME/profiles/web/cordis.patch.yml` を手修正する必要はありません。その後 DeepSeek Harness を再起動し、確認：`~/.dsh/memory/` 配下に `conversations/ records/ scenes/` ディレクトリと `memory.db` が現れればプラグイン適用成功；設定画面に「記憶」ページ、入力バーにモードピルが現れればクライアント側準備完了です。

**アンインストール**：`dsh plugin --profile web remove dsh-prime-memory` + 再起動。データは `~/.dsh/memory/` に残ります。不要ならそのディレクトリごと手動削除してください。

### ソースから開発

```bash
git clone https://github.com/drscrewdriver/dsh-prime-memory
cd dsh-prime-memory
npm install && npm run build
dsh plugin --profile web add .        # link: インストール。コード変更後は npm run build + dsh 再起動で反映
npm run smoke                         # スモークテスト（先に再ビルド：下記コマンド参照）
npx tsc src/smoke.ts --outDir dist-smoke --module nodenext --moduleResolution nodenext --target es2022 --strict --skipLibCheck --esModuleInterop
```

## ランタイム・データフロー

<p align="center">
  <img src="./assets/readme/flow.svg" width="100%"
       alt="dsh-prime-memory のランタイム・データフロー：左のユーザーとアシスタントのセッションイベントがプラグイン（L0 捕捉、L1–L3 蒸留、検索想起、記憶ツール）に流れ込み、プラグインが関連記憶を agent/pre-step で右の DSH コアへ注入。蒸留はコアの ctx.llm を再利用、データは ~/.dsh/memory/ に二重書き込み">
</p>

プラグインは DSH ネイティブのイベントシームに付着します（`session/event` で捕捉、`agent/pre-step` で注入）、蒸留はホストの `ctx.llm` を再利用します。想起は**メッセージ側注入**として提示されます——関連記憶はユーザーの新メッセージの直前に置かれた合成メッセージとして表示され、チャットフローには **「コンテキスト注入 · memory」** 行（展開でヒット内容を表示）として現れます。注入内容は長さ・時間予算で上限があり、超過は切り捨て/タイムアウトでスキップされ、対話を遅延させることはありません。**同一セッション重複排除**：すでに注入済みの記憶は再注入しません（コンテキストにあればトークン節約）。`/compact` 等でリセットされれば再注入可能。**時効重み付け**：想起順位は `関連度 × max(0.5, 0.5^(最終更新からの日数/30))` でソフト重み付けされます（`recall.decayHalfLifeDays` で調整、`0`=無効）。

**コストダッシュボード**：各蒸留 LLM 呼び出し（抽出/重複排除/L2/L3）のトークンコストを `provider/model` 単位で SQLite 明細表へ記録（保持期間は設定可、既定 365 日）。設定 → 記憶 → **コスト** タブで可視化。

**記憶ツール(3)**：

- memory_search
- conversation_search
- memory_read_scene

## 階層的記憶（L0–L3）

<p align="center">
  <img src="./assets/img/Layers.png" width="100%"
       alt="階層的記憶の4層：L0 生会話 → L1 原子記憶 → L2 シナリオブロック → L3 コアペルソナ">
</p>

## セッション単位の記憶モード

<p align="center">
  <img src="./assets/img/Modes.png" width="100%"
       alt="セッション単位の記憶モード：4つの停点（日常・工作・智能・关闭）を持つガラスカプセル型レール">
</p>

- **コントロール**：入力バー内、モードセレクタ右のピル（`記憶·自動`）をクリックで档位スライダが開く（深浅テーマ自適応）。
- ポップオーバー下半は**セッション情報エリア**：想起ヒット、バッチ進行、本セッション産出記憶数、セッションメッセージ数に加え、異常状態行（ストレージ低下 / ベクトル検索不可）と全体サマリ。
- 各セッションの選択は sessionId 単位で `session-modes.json` に永続化され、再起動/復元でも失われません。
- **読み書き分離（#38）**：ポップオーバー内の「注入」3態スイッチ（全体に従う / オン / オフ）——「オフ」で**書き込み専用セッション**：捕捉と蒸留は通常通り（会話は L0→L1→L2/L3 へ蓄積）ですが、本セッションへは何も注入されません。ピル面文は `記憶·只写` に変化。

## UI プレビュー

<p align="center">
  <img src="./assets/img/ui-dark.jpg" width="49.5%"
       alt="ダークテーマの設定ページ記憶ブラウザ概要">
  <img src="./assets/img/ui-light.jpg" width="49.5%"
       alt="ライトテーマの同一設定ページ">
</p>

## 測定比較（DSH-MemBench：自動ベンチマーク）

「見た目」に加えて、この節は**自動ベンチマーク**の実測数値で「**有効にすると何が得られるか**」に答えます（[`bench/`](./bench/)、1コマンドで再現可能）。手法：同一シナリオバンク・同一入力で **A 群（記憶オン）を3回マージ**、**B 群（記憶オフ）を1回**（記憶なしの長タスクは数倍のトークンを消費するためコストガードレール）。対話トラックは A 群のみ。

### 対話トラック（20 シナリオ × 10 型 × 3 回 = 420 問）

> 0.8.5 ベースライン（A 群データ；対話トラック B 群は廃止、A 群のみ）。

<p align="center">
  <img src="./assets/readme/bench-dialog.svg" width="100%"
       alt="DSH-MemBench 対話トラック精度図（A群・記憶オン）：総精度 95.2%（400/420）">
</p>

**想起の二重チャネル**（A 群）：受動注入の想起率 **78.1%**（281/360）、残りはモデルが**記憶ツールを能動呼び出し**で補完（106 問が能動クエリ、うち 75 問をツールで救済）。エンドツーエンド 95.2% は両チャネルとモデルの活用の合成結果。記憶庫が膨張しても精度は前段 92.8% → 後段 97.7% へ上昇、検索層 recall@5 は合成ノイズ 600 件注入でも 2.8pp しか低下しませんでした。

**階層別の弱点**：検索層オフライン指標（recall@5）は全体 73.3%（イベント順序 0%、シナリオ想起 50%）。**効率の三角形**（記憶のコスト）：注入は遅延を増やさず（注入ターンは平均 210ms 速い）、注入は各ターン入力の約 10.3%、蒸留全リンクは捕捉メッセージ1件あたり約 2727 入力 / 240 出力トークン（1172 回呼び出し・0 失敗）。

### ワークフロートラック（0.8.3 保存版）

<p align="center">
  <img src="./assets/readme/bench-workflow.svg" width="100%"
       alt="DSH-MemBench ワークフロートラック A/B 対照図">
</p>

**プローブ段完了 85.5% vs 43.5%（+42pp）**：3 つの新プローブ原型（フロー知識更新 / 双子ランブック識別 / スタイル規約継続）で A 群は全て 12/12 満点かつ3回一致。B 群はスタイル規約プローブで **0/4**（命名/構造/桁区切り/フッター規約は記憶のみに存在）。

**長タスクコスト：B 群のセッションあたり入力トークンは A 群の 6.8 倍**（1.81M vs 266k）。

### 手法と再現

```bash
node bench/harness/run.mjs --arm A --repeats 3 --provider deepseek-official --model deepseek-v4-flash   # 対話トラック（A 群のみ）
node bench/harness/run.mjs --track workflow --arm AB --repeats 3 ...                                  # ワークフロートラック（A/B 並列）
node bench/harness/run.mjs --track lifecycle --arm A ...                                              # ライフサイクルトラック
node bench/harness/report.mjs --latest [dialog|workflow]                                               # 集計レポート
node bench/harness/retrieval-metrics.mjs <runDir> --flood 200,600                                     # 検索層指標 + 注入曲線
```

詳細は [`bench/baseline/`](./bench/baseline/) を参照。

## ストレージ・レイアウト

<p align="center">
  <img src="./assets/readme/storage.svg" width="100%"
       alt="ストレージ・レイアウト：二重書き込みアーキテクチャ（JSONL 真実源 + memory.db 検索庫）">
</p>

ベクトル能力は既定でオフ（純 FTS）。DSH の `ctx.llm` には embeddings エンドポイントがなく、意味検索は**3態の埋め込みソース**（オフ / リモート / ローカル）が提供します。設定画面からランタイムで切り替え可能（次節参照）。

## 意味検索（埋め込みソース）

設定 → 記憶 → 概要 → 意味検索で埋め込みソースを選択、即時反映、設定変更・再起動不要：

<p align="center">
  <img src="./assets/img/EmbeddingSource.png" width="70%"
       alt="設定画面の意味検索（埋め込みソース）パネル：3態セレクタ（オフ/ローカル/リモート）">
</p>

3 つのソース：**オフ**（既定、純 BM25 キーワード検索）、**リモート**（任意の OpenAI 互換 `/embeddings` サービスを持ち込み、`embedding.*` 4 点セットが揃えば選択可）、**ローカル**（内蔵モデルカタログから選択、ONNX 量子化 **CPU 推論**——API Key 不要、データは本機から出ない）。ローカルカタログはプラグイン内蔵の許可リスト（各モデルを revision + ファイルごと sha256 で固定、任意リポジトリはダウンロード不可）。

- **ダウンロード**：モデルカード1クリック（既定ミラー `hf-mirror.com`、再開対応 + sha256 整合性検証）。単ファイル失敗は自動リトライ（キャッシュキー変更 `?dshmem-retry=N`）。
- **オンデマンド・ランタイム**：ローカル档への初回切り替え時のみ推論ランタイム（transformers.js、約 100〜200MB）をデータディレクトリ `runtime/` へ導入（プラグイン依存ツリー・導入ディレクトリには触らない）。モデル読み込みと推論は**専用ワーカースレッド**で実行。
- **ライブ切り替え**：1クリックでソース交換——バックグラウンドで全量再埋め込み（進行可視・キャンセル可、その間は検索がキーワードへ自動劣化、対話に影響なし）。
- **有効規則 = デプロイ上限 AND ランタイム選択**：`embedding.allowLocalModels=false` でローカル档を全体無効化、未設定ならリモート档は選択不可（企業デプロイで収口可）。状態は `embedding-source.json` に永続化。

## 設定

上書き設定は profile 自身の `cordis.patch.yml` に**トップレベルの裸 patch エントリ**で書きます（直接 `id:` を使い、`insert:` で包まないこと）：

```yaml
- id: dsh-memory
  name: dsh-prime-memory
  config:                    # キーは行単位で全体置換（ディープマージなし）
    family: auto             # 新セッションの既定档：auto | chat | work
    llm:
      provider: ''
      model: ''
```

| フィールド | 既定 | 説明 |
| --- | --- | --- |
| `family` | `auto` | 新セッションの既定記憶档：`auto` \| `chat` \| `work` |
| `dataDir` | `$DSH_HOME/memory` | データディレクトリ |
| `capture.enabled` | `true` | L0 捕捉 |
| `capture.stripCodeBlocks` | `true` | アシスタントメッセージからコードブロックを除去 |
| `capture.maxMessageChars` | `4000` | 単メッセージ最大文字数 |
| `capture.redactSecrets` | `true` | ペイロード赤字化：捕获書き込み時に 8 種の秘密（PEM/Bearer/JWT/Cookie/ベンダー API キー/メール/長数字/高エントロピー ID）を `[REDACTED:<KIND>]` に置換——L0・蒸留入力・手動書き込みをカバー。`false` で平文に戻す（有効化後は原文不可逆） |
| `trace.enabled` | `true` | 構造化トレース：リコール/蒸留イベントを日次 JSONL で保存（`<dataDir>/trace/`）、設定ページの「ログ」Tab で切替表示 |
| `trace.retentionDays` | `14` | トレース保持日数（`0` = 無期限） |
| `trace.captureContent` | `false` | `true` でリコール query 原文を保存（既定は長さ + sha256 のみ） |
| `extract.enabled` | `true` | L1 抽出 |
| `extract.minMessages` | `6` | 定常トリガ閾値：単セッションが N 件新メッセージを溜めて L1 抽出を1回実行。立ち上がりは 1→2→4→…→N と倍増 |
| `extract.idleSeconds` | `300` | アイドル兜底：セッションが N 秒無言で未蒸留スライスを落とす。`0` で無効 |
| `extract.backgroundMessages` | `10` | 抽出時付随の背景メッセージ数 |
| `extract.candidatePool` | `5` | 重複排除候補プールサイズ |
| `l2.enabled` | `true` | L2 シナリオ統合 |
| `l2.minNewMemories` | `5` | 前回 L2 からの新記憶閾値 |
| `l2.maxScenes` | `12` | シナリオブロック数上限 |
| `l2.sceneContextLimit` | `3` | L2 prompt 付随の類似シナリオ全文上限 |
| `l3.enabled` | `true` | L3 ペルソナ蒸留 |
| `l3.interval` | `20` | L3 蒸留間隔（新記憶件数） |
| `recall.enabled` | `true` | 自動想起 |
| `recall.maxResults` | `5` | 各新ユーザーメッセージ前に注入する L1 件数上限 |
| `recall.maxCharsPerMemory` | `500` | 注入記憶1件の文字上限（超過は切り捨て）。`0` で無制限 |
| `recall.maxTotalRecallChars` | `2000` | 1回注入の総文字上限。`0` で無制限 |
| `recall.timeoutMs` | `5000` | 想起総予算（ms）。タイムアウトはそのターンの注入をスキップ。`0` で無制限 |
| `recall.includePersona` | `true` | システムプロンプトへペルソナ文脈注入（`<user-persona>`、安定域） |
| `recall.includeSceneNav` | `true` | システムプロンプトへシナリオナビ注入（`<scene-navigation>`、安定域） |
| `recall.strategy` | `hybrid` | 検索戦略：`keyword` / `embedding` / `hybrid` |
| `recall.scoreThreshold` | `0.3` | 想起スコア閾値（これ未満は注入しない） |
| `recall.decayHalfLifeDays` | `30` | 想起時効減衰半減期（日、`0`=無効） |
| `embedding.enabled` | `false` | ベクトル検索スイッチ。オフは純 FTS |
| `embedding.baseUrl` | 空 | OpenAI 互換 `/embeddings` アドレス |
| `embedding.apiKey` | 空 | API Key（**リモート档は任意**——ローカル自己ホストの免キー `/embeddings` も許可） |
| `embedding.model` | 空 | 埋め込みモデル名 |
| `embedding.dimensions` | `0` | ベクトル次元（有効時必須） |
| `embedding.maxInputChars` | `5000` | 単テキスト最大文字数（超長は切り捨て） |
| `embedding.timeoutMs` | `10000` | 単回埋め込み呼び出しタイムアウト（ms） |
| `embedding.allowLocalModels` | `true` | ローカル埋め込み档を許可（デプロイ上限） |
| `embedding.mirror` | `https://hf-mirror.com` | ローカルモデルダウンロードミラー根 |
| `embedding.proxy` | `''` | モデルダウンロードプロキシ3態：`''`（既定）= プロキシ環境変数自動検出；`none` = 強制直結無効；その他 = プロキシ URL |
| `llm.provider/model` | 空 | 蒸留モデル静的ルート（デプロイ pin）：両欄揃えでロック |
| `llm.fallbacks` | `[]` | 蒸留フォールバックチェーン（主ルート失敗時に順次試行） |
| `llm.layerRoutes` | `{}` | **層別蒸留ルーティング**：`l1`/`l2`/`l3` 各に完全チェーン |
| `llm.maxTokens` | `65536` | 非層別呼び出しの兜底出力総闸 |
| `llm.reasoningEffort` | 空 | 蒸留思考档位：空 = **自動** |
| `llm.temperature` | `0.3` | 蒸留温度 |
| `llm.maxInputChars` | `700000` | 単回蒸留入力文字予算 |
| `llm.timeoutMs` | `120000` | 単回蒸留呼び出しタイムアウト（ms） |
| `tokenCost.retentionDays` | `365` | 蒸留コスト明細保持日数。`0` = 永久 |
| `tools` | `true` | モデル呼び出し可能な記憶ツールを登録するか |
| `benchControl` | `false` | ベンチ制御サービス登録（既定オフ） |
| `scope` | `global` | **ストレージスコープ**（可視範囲）：`global`（既定）= ワークスペースをまたいで可視；`workspace` = **`work` 族**をワークスペース単位で隔離。`family`（内容タイプ）と**直交**——二軸は別の問いに答えるもので、四象限すべてが存在します（`chat×global` / `chat×workspace` / `work×global` / `work×workspace`）。`chat` 族は既定でグローバルのまま：個人的な記憶はプロジェクトをまたぐべきものです。**既定の `global` では、本設定が存在しなかったときと挙動がバイト単位で同一**——既存の単一根データはすべて `global` に分類され、移行は帰属を記すだけで移動も削除もしません（[ADR-0008](./docs/adr/0008-storage-scope-vs-family.md) / [ADR-0009](./docs/adr/0009-workspace-identity-source.md)）。ワークスペースを解決できない場合は `global` にフォールバックします（例外を投げず、起動も妨げません） |
| `conflictFreeze.enabled` | `false` | **矛盾凍結**の総スイッチ。有効にすると重複排除の決定語彙に `conflict` が加わります——LLM が「どちらも正しそうで機械には判定できない」と判断したとき、**自動で `update` 上書きや `merge` 統合を行わず**、そのペアを**待機キューに停める**。新しい記憶は通常どおり保存され、**双方の内容は書き換えられません**。裁定は `memory_resolve_conflict` ツールで人間が行います。無効時、重複排除プロンプトは機能追加前と**バイト単位で同一**（ゼロドリフト）。既定オフ：凍結は人の注意力を消費するため既定で全開にはできません（[ADR-0010](./docs/adr/0010-conflict-freeze-default-off-and-timeout.md)） |
| `conflictFreeze.maxPending` | `100` | 待機キューの上限。未裁定数が上限に達すると、新しい衝突は**もう停めず**、その場で LLM の winner/loser により自動決着します（そのペアも**キューの行として残ります**。`resolution` は `auto` となり人間の結論と区別されます）。意味は「**新しいものを受け取らない**」であり「古いものを黙って消す」ではありません——これにより上限が構造的な保証になります |
| `conflictFreeze.timeoutDays` | `30` | タイムアウト降格（日）。これを超えて停まったままのペアは**次回の蒸留の冒頭**で自動決着します（同様に `resolution=auto`）。`0` = タイムアウト降格を**行わない**（明示的な無効化であり「即座に全部期限切れ」ではありません）。安全弁が無いと「互いに矛盾する 2 件が永久に並んで検索される」状態が庫内に残り続けます |

### 蒸留フォールバックチェーンと遅い TTFT モデル

一部プロバイダの無料/遅い档位は**最初のトークン遅延（TTFT）が 20 秒超**になり得ます。3 つの緩和策：

1. **ルート切り替え**（最も直接）：設定 → 記憶 → 概要 → 蒸留パラメータのルートチェーンエディタで主ルートを即時変更。
2. **フォールバックチェーン**（自動降格）：主ルート失敗時に順次バックアップルートを試行。
3. **層別ルーティング**：L1（高頻度・安価・安定重視）と L3（低頻度・強能力）で別チェーン。
4. **タイムアウト引き上げ**：`llm.timeoutMs` はルートが実際に遅いがゲートウェイが切らない場合のみ有効。

## ログとトラブルシューティング

dsh ホストはプラグインのログをコンソールへ出力します。プラグインは info 以上をデータディレクトリの `memory.log` にもミラーします。1 ターンの典型経路：`L0 捕捉` → `L0 落盘` → `蒸留パイプライン開始` → `LLM 呼び出し` → `L1 段完了` → `パイプライン終了`；次ターン冒頭は `想起注入 N 件 L1`。

## MemoryCore との違い

- 完全なパイプラインを内蔵（外部 Gateway 非依存）、蒸留は DSH 自身の LLM を再利用；
- L2/L3 を「LLM がファイルツールを操作」から「LLM が操作 JSON / 完全文書を出力、工学的側が実行」へ変更；
- 想起注入点は `agent/pre-step`（メッセージ側合成メッセージ）＋ エージェント作用域 `systemPrompt.context`（ペルソナ/ナビ安定域）；
- ストレージ/検索は公式 sqlite バックエンドの単機削ぎ版（マルチテナント分離列・TCVDB クラウドバックエンド・監査表を削除；トークン化は公式同様 jieba を使用）。

## 記憶の退場・復元・クリーンアップ

削除は**二段階**で、段階はコストで決まります：**可逆な側が既定**、不可逆な側は明示的に要求する必要があり、常にエクスポートを伴います。

| 操作 | 端点 / ツール | 可逆 | 説明 |
| --- | --- | --- | --- |
| 退場（ソフト削除） | `memory_delete` · `dsh-memory/records-delete` | ✅ | 主テーブルの行を残し `valid_to` を閉じ、取代マーカーを書き、FTS/ベクトル行だけを落とします。**既定は 1 件のみ退場**。一括は意味的マッチではなく厳密な `ids` を渡してください |
| 復元 | `dsh-memory/records-restore` | — | 退場マーカーを消しインデックスを再構築して、想起対象に戻します |
| 物理クリーンアップ | `dsh-memory/cleanup-retired` | ❌ | 本プラグインで**唯一不可逆**な操作。**既定はドライラン**（`dryRun` 省略なら何も削除しません）。明示実行でも先に全庫スナップショットを書き、**内容ハッシュで検証**し、不一致なら中止して 1 件も削除しません |
| スナップショット一覧 | `dsh-memory/snapshots-list` | — | `snapshots/` 下で有効なマニフェストを持つスナップショットを、理由と件数つきで列挙 |
| スナップショットから復元 | `dsh-memory/snapshot-restore` | — | クリーンアップ済みの記録を書き戻します。**既定はドライラン**。受け付けるのはディレクトリ名のみでパスは不可 |

三つの退場経路——裁定敗北、重複排除による取代（`update`/`merge`）、手動削除——は**同一プリミティブを共有**するため、「削除」はどの経路でも同じ意味になります：復元可能です。

### クリーンアップの「後悔薬」の構成

物理削除の前には必ず検証を通過したスナップショットが必要です（上の表を参照）。戻る道は次のとおりです：

1. `dsh-memory/snapshots-list` —— スナップショットのディレクトリ名（`l1-<タイムスタンプ>-<理由>` 形式）を取得；
2. `dsh-memory/snapshot-restore` —— まずドライランで `missing`（スナップショット総数ではなく、実際に戻る件数）を確認し、明示的に `dryRun:false` で書き戻します。

復元の入口は**ディレクトリ名のみを受け付け、パスは受け付けません**。そうでなければこの RPC が「任意のディレクトリを読んで内容を検索 DB に書き込む」能力を副次的に得てしまいます。復元自体は冪等な upsert で、安全に再実行できます。

> **知っておくべき一つの意味論**：`cleanup-retired` は**既に退場した**記録しか消さず、スナップショットは削除**前**に撮られるため、クリーンアップのスナップショットで戻せる記録はすべて退場マーカー付きです。既定では `snapshot-restore` は行を主テーブルに書き戻すだけ（`stillRetired` で正直に報告）で、**「主テーブルに戻った」≠「想起に戻った」**。真の一発ロールバックには `unretire: true` を付けるか、後でその id 群に対して `records-restore` を呼んでください。

## ロードマップ

[Issues](https://github.com/drscrewdriver/dsh-prime-memory/issues) で要望と優先度を募集中：

- [ ] **Git ブランチ認識**：記憶を現在の git ブランチと関連付け、想起をブランチでフィルタ/強調
- [ ] **Claude Code / Codex 記憶インポート**：既存資産（`CLAUDE.md`、Claude Code 記憶ファイル、Codex `AGENTS.md` 等）の1クリック移行

## 謝辞

本リポジトリの直接の上流は [JunNanLYS/dsh-layered-memory](https://github.com/JunNanLYS/dsh-layered-memory)
——DSH 向けの階層的蒸留記憶プラグインです。原作者 **JunNanLYS** が公開してくださったことに感謝します。
本リポジトリはその上で実装層を書き直しました（最初のコミット `0b506b8` は
「净室重写清场 — 旧実装とビルド成果物の削除」）。ドキュメント・画像・モジュール構成は上流から引き継いでいます。
上流と比べて本リポジトリが追加したのは、Agent 向けの 12 個の記憶ツール（高権限書き込み
`memory_add` / `memory_delete` / `memory_import`、反芻制御 `memory_ruminate` シリーズ、記憶グラフ
`memory_search_graph` / `memory_expand_graph_node`、決定証跡の遡及 `memory_receipts`、矛盾の裁定
`memory_resolve_conflict`）、`skills/memport` によるツール横断の記憶移行、
およびストア用スクリーンショット宣言です。

このうち 2 つは**追跡可能性**のためのツールです：

- `memory_receipts` ——「この記憶が**どこから来たか**」を遡ります。L1 の重複排除判断ごとに
  証跡（判断時に見ていた**候補プールのダイジェスト** + 結論）を残すので、記録単位で
  「どのバッチ由来か、どんな候補を見ていたか」を、バッチ単位で「その回は何を判断したか」を問えます。
  証跡はイベントの**前に**存在しなければなりません——入力スナップショットは後から補填できないためです
  （[ADR-0006](./docs/adr/0006-l1-decision-receipts.md)）。
- `memory_resolve_conflict` —— **矛盾凍結**が待機させた衝突ペアを裁定します（`conflictFreeze.*` 設定）。
  結論は `winner` / `loser` / `both`：どちらかを真と判定すれば他方は検索から退場し、
  `both` は両者が実は独立した事実であるとして両方残します。

核心記憶能力（階層的蒸留パイプライン、プロンプト設計、二重書き込みストレージ）は [TencentCloud/TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) の **MemoryCore** を参考にしています。

## License

[MIT](LICENSE)
