<div align="center">

<img src="./assets/img/Hero.png" width="100%"
alt="DeepSeek Harness 히어로 이미지: 대화가 백그라운드에서 계층적으로 증류되어 기억으로, 모델의 매 스텝 전에 자동으로 회상·주입됨">

# dsh-prime-memory

**DeepSeek Harness용 계층적 증류 기억 플러그인: 대화는 백그라운드에서 L0 포착 → L1 원자 기억 → L2 장면 통합 → L3 페르소나 증류를 거쳐 처리되며, 관련 기억은 모델의 매 스텝 전에 자동으로 컨텍스트에 주입됩니다.**

[中文 README](./README.md) · [English README](./README.en.md) · [日本語 README](./README.ja.md) · [한국어 README](./README.ko.md) · [최신 릴리스](https://github.com/drscrewdriver/dsh-prime-memory/releases/latest) · [문제 제보](https://github.com/drscrewdriver/dsh-prime-memory/issues)

[![npm version](https://img.shields.io/npm/v/dsh-prime-memory?color=6f83ff&style=flat-square&label=npm)](https://www.npmjs.com/package/dsh-prime-memory)
[![DSH 0.2.0-rc.1](https://img.shields.io/badge/DSH-0.2.0--rc.1-8b5cf6?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![MIT License](https://img.shields.io/badge/license-MIT-536990?style=flat-square)](LICENSE)

</div>

<details open>
<summary>🌐 언어 / Language</summary>

- [中文 README](./README.md)
- [English README](./README.en.md)
- [日本語 README](./README.ja.md)
- [한국어 README](./README.ko.md)
- [README en français](./README.fr.md)
- [README auf Deutsch](./README.de.md)
- [README in italiano](./README.it.md)
- [README на русском](./README.ru.md)
- [README en español](./README.es.md)
- [설치 안내（한국어）](./INSTALL.ko.md)
- [Guide d'installation (français)](./INSTALL.fr.md)
- [Installationsanleitung (Deutsch)](./INSTALL.de.md)
- [Guida all'installazione (Italiano)](./INSTALL.it.md)
- [Руководство по установке (Русский)](./INSTALL.ru.md)
- [Guía de instalación (Español)](./INSTALL.es.md)
- [Installation guide (English)](./INSTALL.en.md)
- [中文安装指南](./INSTALL.md)
- [日本語インストールガイド](./INSTALL.ja.md)
- [한국어 changelog](./CHANGELOG.ko.md)
- [Changelog en français](./CHANGELOG.fr.md)
- [Changelog auf Deutsch](./CHANGELOG.de.md)
- [Changelog in italiano](./CHANGELOG.it.md)
- [Changelog на русском](./CHANGELOG.ru.md)
- [Changelog en español](./CHANGELOG.es.md)
- [Changelog (English)](./CHANGELOG.en.md)
- [更新日志（中文）](./CHANGELOG.md)
- [日本語 changelog](./CHANGELOG.ja.md)

</details>

> **호환성 참고**: 본 플러그인은 일본어·한국어 문서를 제공하지만, 공식 DSH의 `LocaleRuntime`이 등록하는 언어는 `zh` / `en`뿐입니다. `ja` / `ko`를 선택하면 `locale "<id>" is not registered` 오류가 납니다. 플러그인은 자체 사전을 들고 있을 수 있으나 DSH 전역 로케일 목록은 확장할 수 없습니다. DSH를 fork하여 `LOCALE_IDS`(locale-settings.ts)와 `LOCALES` 라벨(client/index.ts)을 갱신하고 재빌드하면 사용 가능해집니다.

## DSH 버전 호환성 매트릭스

| DSH 버전 | settings 등록 API | 상태 |
|---|---|---|
| 0.1.1-rc.2 | `settings.register()`（라이브 스코프） | ✅ 검증됨 |
| 0.1.2-rc.1 | `settings.register()`（폴백 가능） | ⚠️ 프레임워크 문서 기반 추정, 미실측 |
| 0.1.3-rc.1 | `settings.register()`（폴백 가능） | ⚠️ 미실측（0.1.3+에서 네임스페이스가 문자열화, 본 플러그인은 대응 완료） |
| 0.1.5-rc.2 | `settings.register()`（폴백 가능） | ⚠️ 미실측. Session V3 surface 시맨틱스와 입력바/설정 슬롯 회귀 대기 |
| 0.2.0-rc.1 | `settings.register()`（라이브 스코프） | ✅ 이번 적용 라인（이벤트 배선 agent/session-start → agent/created） |

> 호환 메커니즘: settings 등록은 3분기 런타임 분기（`register` → `installSection` 브리지 → 상시 온 강등）.
> 자세한 내용은 [CHANGELOG.md](./CHANGELOG.md)의 0.11.0 항목 참조. `dsh.plugin.json`은
> `engines.dsh` 为逐 rc 精确枚举串（0.1.0-rc.2 → 0.2.1-rc.3，18 rc） 선언.

## 빠른 시작

Node ≥ 22.16 필요. 두 가지 호출 방식 중 선택（`npx` 접두사는 아래 모든 `dsh` 명령을 대체 가능）：

```bash
# 방식 1: npx로 공식 CLI 직접 실행（dsh 사전 설치 불필요. 버전 고정 가능, 예: dsh-prime-memory@0.8.4）
npx -y @deepseek-ai/dsh plugin --profile web add dsh-prime-memory

# 방식 2: dsh CLI 설치된 경우（dsh는 pnpm 포워더. 없으면 먼저 npm i -g pnpm）
dsh plugin --profile web add dsh-prime-memory

# 기타 소스: GitHub 저장소 / 로컬 경로（개발·디버깅용. link: 는 저장소를 가리키며, npm run build + dsh 재시작으로 반영）
dsh plugin --profile web add https://github.com/drscrewdriver/dsh-prime-memory
dsh plugin --profile web add /path/to/dsh-prime-memory
```

### Agent에게 설치시키기（권장）

현재 Agent가 터미널 명령을 실행할 수 있다면 아래 문장을 그대로 보내세요：

```text
DeepSeek Harness의 web 프로파일에 dsh-prime-memory 플러그인을 설치해 주세요.

다른 프로파일은 수정하지 말고 아래 두 명령만 실행해 주세요:
dsh plugin --profile web add dsh-prime-memory
dsh --profile web --dump-config

출력에 dsh-prime-memory가 나타나면 설치 결과를 알려 주세요.
실행 중인 DSH를 임의로 닫거나 재시작하지 마세요. 설치 후 DSH Web Host 수동 재시작을 알려 주세요.
```

Agent는 설치 결과와 설정에 `dsh-prime-memory`가 나타났는지 보고합니다.

본 패키지는 `dsh.bundle` 합성 계층（`cordis.patch.yml`）을 선언하며, 설치 후 **플러그인 행이 자동 마운트**됩니다——`$DSH_HOME/profiles/web/cordis.patch.yml`을 손으로 고칠 필요가 없습니다. 이후 DeepSeek Harness를 재시작하고 확인：`~/.dsh/memory/` 아래에 `conversations/ records/ scenes/` 디렉터리와 `memory.db`가 나타나면 플러그인 적용 성공；설정 페이지에 "기억" 페이지, 입력 바에 모드 pill이 나타나면 클라이언트 준비 완료.

**제거**：`dsh plugin --profile web remove dsh-prime-memory` + 재시작. 데이터는 `~/.dsh/memory/`에 남습니다. 필요 없으면 해당 디렉터리 전체를 수동 삭제하세요.

### 소스에서 개발

```bash
git clone https://github.com/drscrewdriver/dsh-prime-memory
cd dsh-prime-memory
npm install && npm run build
dsh plugin --profile web add .        # link: 설치. 코드 변경 후 npm run build + dsh 재시작으로 반영
npm run smoke                         # 스모크 테스트（먼저 재빌드: 아래 명령 참조）
npx tsc src/smoke.ts --outDir dist-smoke --module nodenext --moduleResolution nodenext --target es2022 --strict --skipLibCheck --esModuleInterop
```

## 런타임 데이터 흐름

<p align="center">
  <img src="./assets/readme/flow.svg" width="100%"
       alt="dsh-prime-memory 런타임 데이터 흐름: 좌측 사용자·어시스턴트 세션 이벤트가 플러그인(L0 포착, L1–L3 증류, 검색 회상, 기억 도구)으로 흐르고, 플러그인이 관련 기억을 agent/pre-step에서 우측 DSH 코어로 주입. 증류는 코어의 ctx.llm 재사용, 데이터는 ~/.dsh/memory/에 이중 기록">
</p>

플러그인은 DSH 네이티브 이벤트 심（`session/event`로 포착, `agent/pre-step`로 주입）에 부착되며, 증류는 호스트의 `ctx.llm`을 재사용합니다. 회상은 **메시지 측 주입**으로 표시됩니다——관련 기억은 사용자의 새 메시지 바로 앞에 배치된 합성 메시지로 표시되며, 채팅 흐름에는 **"컨텍스트 주입 · memory"** 행（펼치면 히트 내용 표시）으로 나타납니다. 주입 내용은 길이·시간 예산으로 제한되며, 초과는 잘림/타임아웃으로 건너뛰어 대화를 지연시키지 않습니다. **동일 세션 중복 제거**：이미 주입된 기억은 재주입하지 않습니다（`/compact` 등으로 리셋되면 재주입 가능）. **신선도 가중**：회상 순위는 `관련도 × max(0.5, 0.5^(마지막 갱신 후 경과일/30))`로 소프트 가중됩니다（`recall.decayHalfLifeDays`로 조정, `0`=비활성）.

**비용 대시보드**：각 증류 LLM 호출（추출/중복제거/L2/L3）의 토큰 비용을 `provider/model` 단위로 SQLite 명세 테이블에 기록（보존 기간 설정 가능, 기본 365일）. 설정 → 기억 → **비용** 탭에서 시각화.

**기억 도구(3)**：

- memory_search
- conversation_search
- memory_read_scene

## 계층적 기억（L0–L3）

<p align="center">
  <img src="./assets/img/Layers.png" width="100%"
       alt="계층적 기억의 4계층: L0 원시 대화 → L1 원자 기억 → L2 장면 블록 → L3 코어 페르소나">
</p>

## 세션 단위 기억 모드

<p align="center">
  <img src="./assets/img/Modes.png" width="100%"
       alt="세션 단위 기억 모드: 4개 정지점（日常·工作·智能·关闭）을 가진 유리 캡슐 레일">
</p>

- **컨트롤**：입력 바 내, 모드 셀렉터 우측의 pill（`기억·자동`）을 클릭하면档位 슬라이더가 열립니다（라이트/다크 테마 자적응）.
- 팝오버 하단은 **세션 정보 영역**：회상 히트, 배치 진행, 본 세션 산출 기억 수, 세션 메시지 수에 더해 이상 상태 행（저장소 저하 / 벡터 검색 불가）과 전체 요약.
- 각 세션 선택은 sessionId 단위로 `session-modes.json`에 영속화되어 재시작/복원에도 유실되지 않습니다.
- **쓰기 전용（#38）**：팝오버 내 "주입" 3상 스위치（전역 따름 / 켜기 / 끄기）——"끄기"로 **쓰기 전용 세션**：포착과 증류는 평소대로（대화는 L0→L1→L2/L3로 축적）이나 본 세션에는 아무것도 주입되지 않습니다. pill 면문은 `기억·只写`로 변경.

## UI 미리보기

<p align="center">
  <img src="./assets/img/ui-dark.jpg" width="49.5%"
       alt="다크 테마 설정 페이지 기억 브라우저 개요">
  <img src="./assets/img/ui-light.jpg" width="49.5%"
       alt="라이트 테마 동일 설정 페이지">
</p>

## 실측 비교（DSH-MemBench: 자동 벤치마크）

"볼거리"에 더해 이 절은 **자동 벤치마크**의 실측 수치로 "**켜면 대체 무엇을 얻는가**"에 답합니다（[`bench/`](./bench/), 1명령으로 재현 가능）. 방법：동일 시나리오 뱅크·동일 입력으로 **A군（기억 켜기） 3회 병합**, **B군（기억 끄기） 1회**（기억 없는 장작업은 수 배 토큰 소모로 비용 가드레일）. 대화 트랙은 A군만.

### 대화 트랙（20 시나리오 × 10형 × 3회 = 420문）

> 0.8.5 베이스라인（A군 데이터；대화 트랙 B군은 폐지, A군만）.

<p align="center">
  <img src="./assets/readme/bench-dialog.svg" width="100%"
       alt="DSH-MemBench 대화 트랙 정확도 도（A군·기억 켜기）: 총정확도 95.2%（400/420）">
</p>

**회상 이중 채널**（A군）：수동 주입 회상률 **78.1%**（281/360）, 나머지는 모델이 **기억 도구를 능동 호출**로 보완（106문이 능동 쿼리, 그중 75문을 도구로 구제）. 엔드투엔드 95.2%는 양 채널과 모델 활용의 합성 결과. 기억库가 팽창해도 정확도는 전단 92.8% → 후단 97.7%로 상승, 검색층 recall@5은 합성 노이즈 600건 주입에도 2.8pp만 하락했습니다.

**계층별 약점**：검색층 오프라인 지표（recall@5）는 전체 73.3%（이벤트 순서 0%, 장면 회상 50%）. **효율 삼각형**（기억의 비용）：주입은 지연을 더하지 않고（주입 턴이 평균 210ms 빠름）, 주입은 턴당 입력의 약 10.3%, 증류 전체는 포착 메시지 1건당 약 2727 입력 / 240 출력 토큰（1172회 호출·0 실패）.

### 워크플로 트랙（0.8.3 보관판）

<p align="center">
  <img src="./assets/readme/bench-workflow.svg" width="100%"
       alt="DSH-MemBench 워크플로 트랙 A/B 대조 도">
</p>

**프로브 단계 완료 85.5% vs 43.5%（+42pp）**：3개 신규 프로브 원형（플로 지식 갱신 / 쌍둥이 runbook 구분 / 스타일 규약 계속）에서 A군은 모두 12/12 만점且 3회 일치. B군은 스타일 규약 프로브에서 **0/4**（명명/구조/천단위 구분/푸터 규약은 기억에만 존재）.

**장작업 비용：B군 세션당 입력 토큰은 A군의 6.8배**（1.81M vs 266k）.

### 방법론과 재현

```bash
node bench/harness/run.mjs --arm A --repeats 3 --provider deepseek-official --model deepseek-v4-flash   # 대화 트랙（A군만）
node bench/harness/run.mjs --track workflow --arm AB --repeats 3 ...                                  # 워크플로 트랙（A/B 병렬）
node bench/harness/run.mjs --track lifecycle --arm A ...                                              # 라이프사이클 트랙
node bench/harness/report.mjs --latest [dialog|workflow]                                               # 집계 리포트
node bench/harness/retrieval-metrics.mjs <runDir> --flood 200,600                                     # 검색층 지표 + 주입 곡선
```

자세한 것은 [`bench/baseline/`](./bench/baseline/) 참조.

## 저장소 레이아웃

<p align="center">
  <img src="./assets/readme/storage.svg" width="100%"
       alt="저장소 레이아웃: 이중 기록 아키텍처（JSONL 진실원 + memory.db 검색库）">
</p>

벡터 기능은 기본 꺼짐（순수 FTS）. DSH의 `ctx.llm`에는 embeddings 엔드포인트가 없으며, 의미 검색은 **3상 임베딩 소스**（끄기 / 원격 / 로컬）가 제공합니다. 설정 페이지에서 런타임 전환 가능（다음 절 참조）.

## 의미 검색（임베딩 소스）

설정 → 기억 → 개요 → 의미 검색에서 임베딩 소스를 선택, 즉시 반영, 설정 변경·재시작 불필요：

<p align="center">
  <img src="./assets/img/EmbeddingSource.png" width="70%"
       alt="설정 페이지 의미 검색（임베딩 소스）패널: 3상 셀렉터（끄기/로컬/원격）">
</p>

3가지 소스：**끄기**（기본, 순수 BM25 키워드 검색）, **원격**（임의의 OpenAI 호환 `/embeddings` 서비스 지참, `embedding.*` 4점 세트가 갖춰지면 선택 가능）, **로컬**（내장 모델 카탈로그에서 선택, ONNX 양자화 **CPU 추론**——API Key 불필요, 데이터는 본기에서 나가지 않음）. 로컬 카탈로그는 플러그인 내장 허용 목록（각 모델을 revision + 파일별 sha256로 고정, 임의 저장소 다운로드 불가）.

- **다운로드**：모델 카드 1클릭（기본 미러 `hf-mirror.com`, 재개 대응 + sha256 무결성 검증）. 단일 파일 실패는 자동 재시도（캐시 키 변경 `?dshmem-retry=N`）.
- **온디맨드 런타임**：로컬档으로의 첫 전환 시에만 추론 런타임（transformers.js, 약 100〜200MB）을 데이터 디렉터리 `runtime/`에 도입（플러그인 의존 트리·설치 디렉터리에는 손대지 않음）. 모델 로드와 추론은 **전용 워커 스레드**에서 실행.
- **라이브 전환**：1클릭으로 소스 교환——백그라운드 전량 재임베딩（진행 가시·취소 가능, 그 사이 검색은 키워드로 자동 열화, 대화 무영향）.
- **유효 규칙 = 배포 상한 AND 런타임 선택**：`embedding.allowLocalModels=false`로 로컬档 전체 무효화, 미설정이면 원격档 선택 불가（기업 배포에서 수구 가능）. 상태는 `embedding-source.json`에 영속화.

## 설정

덮어쓰기 설정은 profile 자신의 `cordis.patch.yml`에 **최상위 수준의 naked patch 항목**으로 작성합니다（직접 `id:` 사용, `insert:`로 감싸지 마세요）：

```yaml
- id: dsh-memory
  name: dsh-prime-memory
  config:                    # 키는 행 단위 전체 교체（딥 머지 아님）
    family: auto             # 새 세션 기본档: auto | chat | work
    llm:
      provider: ''
      model: ''
```

| 필드 | 기본 | 설명 |
| --- | --- | --- |
| `family` | `auto` | 새 세션 기본 기억档：`auto` \| `chat` \| `work` |
| `dataDir` | `$DSH_HOME/memory` | 데이터 디렉터리 |
| `capture.enabled` | `true` | L0 포착 |
| `capture.stripCodeBlocks` | `true` | 어시스턴트 메시지에서 코드 블록 제거 |
| `capture.maxMessageChars` | `4000` | 단메시지 최대 문자 수 |
| `capture.redactSecrets` | `true` | 페이로드 마스킹：캡처 쓰기 시 8종 시크릿(PEM/Bearer/JWT/Cookie/벤더 API 키/이메일/긴 숫자/고엔트로피 ID)을 `[REDACTED:<KIND>]`로 치환 — L0·증류 입력·수동 쓰기 커버. `false`로 평문 복귀(활성화 후 원문 비가역) |
| `trace.enabled` | `true` | 구조화 트레이스：리콜/증류 이벤트를 일별 JSONL로 저장(`<dataDir>/trace/`), 설정 페이지 "로그" 탭에서 전환 조회 |
| `trace.retentionDays` | `14` | 트레이스 보존 일수(`0` = 무기한) |
| `trace.captureContent` | `false` | `true` 시 리콜 query 원문 저장(기본은 길이 + sha256만) |
| `extract.enabled` | `true` | L1 추출 |
| `extract.minMessages` | `6` | 정상 트리거 임계값：단세션이 N건 새 메시지 누적 시 L1 추출 1회. 시작 단계는 1→2→4→…→N 배증 |
| `extract.idleSeconds` | `300` | 유휴兜底：세션이 N초 무음이면 미증류 슬라이스 투하. `0` 비활성 |
| `extract.backgroundMessages` | `10` | 추출 시 수반하는 배경 메시지 수 |
| `extract.candidatePool` | `5` | 중복 제거 후보 풀 크기 |
| `l2.enabled` | `true` | L2 장면 통합 |
| `l2.minNewMemories` | `5` | 직전 L2 이후 신규 기억 임계값 |
| `l2.maxScenes` | `12` | 장면 블록 수 상한 |
| `l2.sceneContextLimit` | `3` | L2 prompt 수반 유사 장면 전문 상한 |
| `l3.enabled` | `true` | L3 페르소나 증류 |
| `l3.interval` | `20` | L3 증류 간격（신규 기억 건수） |
| `recall.enabled` | `true` | 자동 회상 |
| `recall.maxResults` | `5` | 각 신규 사용자 메시지 전 주입하는 L1 건수 상한 |
| `recall.maxCharsPerMemory` | `500` | 주입 기억 1건 문자 상한（초과 잘림）. `0` 무제한 |
| `recall.maxTotalRecallChars` | `2000` | 1회 주입 총 문자 상한. `0` 무제한 |
| `recall.timeoutMs` | `5000` | 회상 총 예산（ms）. 타임아웃은 해당 턴 주입 스킵. `0` 무제한 |
| `recall.includePersona` | `true` | 시스템 프롬프트에 페르소나 문맥 주입（`<user-persona>`, 안정 영역） |
| `recall.includeSceneNav` | `true` | 시스템 프롬프트에 장면 내비 주입（`<scene-navigation>`, 안정 영역） |
| `recall.strategy` | `hybrid` | 검색 전략：`keyword` / `embedding` / `hybrid` |
| `recall.scoreThreshold` | `0.3` | 회상 점수 임계값（이하 주입 안 함） |
| `recall.decayHalfLifeDays` | `30` | 회상 신선도 감쇠 반감기（일, `0`=비활성） |
| `embedding.enabled` | `false` | 벡터 검색 스위치. 끄면 순수 FTS |
| `embedding.baseUrl` | 빈값 | OpenAI 호환 `/embeddings` 주소 |
| `embedding.apiKey` | 빈값 | API Key（**원격档은 임의**——로컬 self-host의 무키 `/embeddings`도 허용） |
| `embedding.model` | 빈값 | 임베딩 모델명 |
| `embedding.dimensions` | `0` | 벡터 차원（활성 시 필수） |
| `embedding.maxInputChars` | `5000` | 단텍스트 최대 문자 수（초장 잘림） |
| `embedding.timeoutMs` | `10000` | 단회 임베딩 호출 타임아웃（ms） |
| `embedding.allowLocalModels` | `true` | 로컬 임베딩档 허용（배포 상한） |
| `embedding.mirror` | `https://hf-mirror.com` | 로컬 모델 다운로드 미러 루트 |
| `embedding.proxy` | `''` | 모델 다운로드 프록시 3상：`''`（기본）= 프록시 환경변수 자동 검출；`none` = 강제 직결 비활성；기타 = 프록시 URL |
| `llm.provider/model` | 빈값 | 증류 모델 정적 경로（배포 pin）：양란 일치 시 잠금 |
| `llm.fallbacks` | `[]` | 증류 폴백 체인（주 경로 실패 시 순차 시도） |
| `llm.layerRoutes` | `{}` | **계층별 증류 라우팅**：`l1`/`l2`/`l3` 각 완전 체인 |
| `llm.maxTokens` | `65536` | 비계층 호출兜底 출력 총闸 |
| `llm.reasoningEffort` | 빈값 | 증류 사고档位：빈값 = **자동** |
| `llm.temperature` | `0.3` | 증류 온도 |
| `llm.maxInputChars` | `700000` | 단회 증류 입력 문자 예산 |
| `llm.timeoutMs` | `120000` | 단회 증류 호출 타임아웃（ms） |
| `tokenCost.retentionDays` | `365` | 증류 비용 명세 보존 일수. `0` = 영구 |
| `tools` | `true` | 모델 호출 가능한 기억 도구 등록 여부 |
| `benchControl` | `false` | 벤치 제어 서비스 등록（기본 꺼짐） |
| `scope` | `global` | **스토리지 스코프**(가시 범위): `global`(기본) = 워크스페이스를 넘어 가시; `workspace` = **`work` 패밀리**를 워크스페이스 단위로 격리. `family`(내용 유형)와 **직교**——두 축은 서로 다른 질문에 답하며 네 사분면이 모두 존재합니다(`chat×global` / `chat×workspace` / `work×global` / `work×workspace`). `chat` 패밀리는 기본적으로 전역 유지: 개인 기억은 프로젝트를 넘어야 합니다. **기본 `global`에서는 이 설정이 없던 때와 동작이 바이트 단위로 동일**——기존 단일 루트 데이터는 모두 `global`로 분류되고, 마이그레이션은 귀속만 표시할 뿐 옮기지도 삭제하지도 않습니다([ADR-0008](./docs/adr/0008-storage-scope-vs-family.md) / [ADR-0009](./docs/adr/0009-workspace-identity-source.md)). 워크스페이스를 해석할 수 없으면 `global`로 폴백합니다(예외를 던지지 않고 시작을 막지도 않습니다) |
| `conflictFreeze.enabled` | `false` | **모순 동결** 총 스위치. 켜면 중복 제거 결정 어휘에 `conflict`가 추가됩니다——LLM이 "양쪽 다 맞아 보여 기계가 판단할 수 없다"고 판단하면 **자동으로 `update` 덮어쓰기나 `merge` 병합을 하지 않고** 그 쌍을 **대기 큐에 세워 둡니다**. 새 기억은 평소대로 저장되고 **양쪽 내용 모두 바뀌지 않습니다**. 재정은 `memory_resolve_conflict` 도구로 사람이 합니다. 꺼져 있을 때 중복 제거 프롬프트는 기능 추가 전과 **바이트 단위로 동일**합니다(제로 드리프트). 기본 꺼짐: 동결은 사람의 주의를 소모하므로 기본으로 전면 개방할 수 없습니다([ADR-0010](./docs/adr/0010-conflict-freeze-default-off-and-timeout.md)) |
| `conflictFreeze.maxPending` | `100` | 대기 큐 상한. 미재정 수가 상한에 도달하면 새 충돌은 **더 이상 세워 두지 않고** 그 자리에서 LLM의 winner/loser로 자동 결착합니다(그 쌍도 **큐의 행으로 남습니다**. `resolution`은 `auto`가 되어 사람의 결론과 구분됩니다). 의미는 "**새것을 받지 않는다**"이지 "오래된 것을 조용히 지운다"가 아닙니다——이로써 상한이 구조적 보증이 됩니다 |
| `conflictFreeze.timeoutDays` | `30` | 타임아웃 강등(일). 이보다 오래 미재정으로 남은 쌍은 **다음 증류 회차의 맨 앞**에서 자동 결착합니다(역시 `resolution=auto`). `0` = 타임아웃 강등을 **하지 않음**(명시적 비활성이며 "즉시 전부 만료"가 아닙니다). 안전밸브가 없으면 "서로 모순되는 두 기억이 영구히 나란히 검색되는" 상태가 저장소에 남습니다 |

### 증류 폴백 체인과 느린 TTFT 모델

일부 공급자의 무료/느린档位는 **첫 토큰 지연（TTFT）이 20초를 넘을** 수 있습니다. 3가지 완화책：

1. **경로 전환**（가장 직접）：설정 → 기억 → 개요 → 증류 파라미터의 경로 체인 편집기에서 주 경로 즉시 변경.
2. **폴백 체인**（자동 강등）：주 경로 실패 시 순차 백업 경로 시도.
3. **계층별 라우팅**：L1（고빈도·저렴·안정 중시）과 L3（저빈도·강능력）에 별도 체인.
4. **타임아웃 상향**：`llm.timeoutMs`는 경로가 실제로 느리되 게이트웨이가 끊지 않는 경우에만 유효.

## 로그와 문제 해결

dsh 호스트는 플러그인 로그를 콘솔로 출력합니다. 플러그인은 info 이상을 데이터 디렉터리의 `memory.log`에도 미러합니다. 1턴의 전형 경로：`L0 포착` → `L0 투하` → `증류 파이프라인 시작` → `LLM 호출` → `L1 단계 완료` → `파이프라인 종료`；다음 턴 머리에 `회상 주입 N건 L1`.

## MemoryCore와의 차이

- 완전한 파이프라인 내장（외부 Gateway 비의존）, 증류는 DSH 자신의 LLM 재사용；
- L2/L3를 "LLM이 파일 도구 조작"에서 "LLM이 조작 JSON / 완전 문서 출력, 공학측 실행"으로 변경；
- 회상 주입점은 `agent/pre-step`（메시지 측 합성 메시지）＋ 에이전트 범위 `systemPrompt.context`（페르소나/내비 안정 영역）；
- 저장/검색은 공식 sqlite 백엔드의 단기 슬림판（멀티테넌트 분리열·TCVDB 클라우드 백엔드·감사표 삭제；토큰화는 공식과 동일 jieba 사용）.

## 기억 퇴장·복구·정리

삭제는 **두 단계**이며 단계는 비용으로 정해집니다: **되돌릴 수 있는 쪽이 기본**이고, 되돌릴 수 없는 쪽은 명시적으로 요청해야 하며 항상 내보내기를 동반합니다.

| 동작 | 엔드포인트 / 도구 | 되돌리기 | 설명 |
| --- | --- | --- | --- |
| 퇴장(소프트 삭제) | `memory_delete` · `dsh-memory/records-delete` | ✅ | 메인 테이블 행을 유지하고 `valid_to`를 닫으며 대체 마커를 쓰고 FTS/벡터 행만 제거합니다. **기본은 1건만 퇴장**. 일괄은 의미 매칭이 아니라 정확한 `ids`를 전달하세요 |
| 복구 | `dsh-memory/records-restore` | — | 퇴장 마커를 지우고 인덱스를 재구축해 회상 대상으로 되돌립니다 |
| 물리 정리 | `dsh-memory/cleanup-retired` | ❌ | 이 플러그인의 **유일한 비가역** 동작. **기본은 드라이런**(`dryRun` 생략 시 아무것도 삭제하지 않음). 명시 실행이라도 먼저 전체 라이브러리 스냅샷을 쓰고 **내용 해시로 검증**하며, 불일치면 중단하고 한 건도 삭제하지 않습니다 |
| 스냅샷 목록 | `dsh-memory/snapshots-list` | — | `snapshots/` 아래에서 유효한 매니페스트를 가진 스냅샷을 사유와 건수와 함께 나열 |
| 스냅샷에서 복원 | `dsh-memory/snapshot-restore` | — | 정리된 기록을 다시 씁니다. **기본은 드라이런**. 디렉터리 이름만 받고 경로는 받지 않습니다 |

세 가지 퇴장 경로 — 판정 패배, 중복 제거 대체(`update`/`merge`), 수동 삭제 — 는 **동일한 프리미티브를 공유**하므로 "삭제"는 어느 경로에서나 같은 의미입니다: 복구 가능합니다.

### 정리의 "되돌리기 수단" 구성

물리 삭제 전에는 반드시 검증을 통과한 스냅샷이 있어야 합니다(위 표 참조). 돌아가는 길은 다음과 같습니다:

1. `dsh-memory/snapshots-list` —— 스냅샷 디렉터리 이름(`l1-<타임스탬프>-<사유>` 형식)을 얻습니다;
2. `dsh-memory/snapshot-restore` —— 먼저 드라이런으로 `missing`(스냅샷 총수가 아니라 실제로 되돌아오는 건수)을 확인하고, 명시적으로 `dryRun:false`로 기록합니다.

복원 진입점은 **디렉터리 이름만 받고 경로는 받지 않습니다**. 그렇지 않으면 이 RPC가 "임의 디렉터리를 읽어 내용을 검색 DB에 쓰는" 능력을 부수적으로 얻게 됩니다. 복원 자체는 멱등 upsert이므로 안전하게 재실행할 수 있습니다.

> **반드시 알아야 할 의미론 하나**: `cleanup-retired`는 **이미 퇴장한** 기록만 지우고 스냅샷은 삭제 **전**에 찍히므로, 정리 스냅샷으로 되찾을 수 있는 모든 기록에는 퇴장 마커가 붙어 있습니다. 기본적으로 `snapshot-restore`는 행을 메인 테이블로 되돌릴 뿐이며(`stillRetired`로 정직하게 보고), **"메인 테이블로 돌아옴" ≠ "회상으로 돌아옴"** 입니다. 진정한 한 번의 롤백에는 `unretire: true`를 붙이거나, 이후 해당 id들에 `records-restore`를 호출하세요.

## 로드맵

[Issues](https://github.com/drscrewdriver/dsh-prime-memory/issues)에서 요구와 우선순위 환영：

- [ ] **Git 브랜치 인식**：기억을 현재 git 브랜치와 연관, 회상을 브랜치로 필터/가중
- [ ] **Claude Code / Codex 기억 가져오기**：기존 자산（`CLAUDE.md`, Claude Code 기억 파일, Codex `AGENTS.md` 등）1클릭 이전

## 감사

이 저장소의 직접적인 업스트림은 [JunNanLYS/dsh-layered-memory](https://github.com/JunNanLYS/dsh-layered-memory)
——DSH용 계층적 증류 기억 플러그인입니다. 원작자 **JunNanLYS**께 공개해 주신 데 감사드립니다.
이 저장소는 그 위에서 구현 계층을 다시 작성했습니다（첫 커밋 `0b506b8`은
「净室重写清场 — 기존 구현과 빌드 산출물 제거」）. 문서·이미지·모듈 구조는 업스트림에서 이어받았습니다.
업스트림과 비교해 이 저장소가 추가한 것은 Agent용 기억 도구 12개（고권한 쓰기
`memory_add` / `memory_delete` / `memory_import`, 반추 제어 `memory_ruminate` 시리즈, 기억 그래프
`memory_search_graph` / `memory_expand_graph_node`, 결정 증거 추적 `memory_receipts`, 모순 재정
`memory_resolve_conflict`）, `skills/memport` 도구 간 기억 이전,
그리고 스토어 스크린샷 선언입니다.

이 중 두 도구는 **추적 가능성**을 위한 것입니다:

- `memory_receipts` —— "이 기억이 **어디서 왔는지**"를 추적합니다. L1 중복 제거 판단마다
  증거(판단 당시 본 **후보 풀 다이제스트** + 결론)를 남기므로, 레코드 단위로는
  "어느 배치에서 나왔고 어떤 후보를 봤는지", 배치 단위로는 "그 회차가 무엇을 판단했는지"를 물을 수 있습니다.
  증거는 이벤트 **이전**에 존재해야 합니다——입력 스냅샷은 사후에 채워 넣을 수 없기 때문입니다
  ([ADR-0006](./docs/adr/0006-l1-decision-receipts.md)).
- `memory_resolve_conflict` —— **모순 동결**이 대기시킨 충돌 쌍을 재정합니다(`conflictFreeze.*` 설정).
  결론은 `winner` / `loser` / `both`: 한쪽을 참으로 판정하면 다른 쪽은 검색에서 퇴장하고,
  `both`는 둘이 실은 독립된 사실임을 뜻해 둘 다 남깁니다.

핵심 기억 능력（계층적 증류 파이프라인, 프롬프트 설계, 이중 기록 저장소）은 [TencentCloud/TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)의 **MemoryCore**를 참고했습니다.

## License

[MIT](LICENSE)
