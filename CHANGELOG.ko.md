# 변경 기록（한국어 changelog）

- [更新日志（中文）](./CHANGELOG.md)
- [Changelog (English)](./CHANGELOG.en.md)
- [日本語 changelog](./CHANGELOG.ja.md)
- [한국어 changelog](./CHANGELOG.ko.md)

> **호환성 참고**: 본 플러그인은 한국어 문서를 제공하지만, 공식 DSH의 `LocaleRuntime`이 등록하는 언어는 `zh` / `en`뿐입니다. `ko`를 선택하면 `locale "ko" is not registered` 오류가 납니다. DSH를 fork하여 `LOCALE_IDS`와 `LOCALES` 라벨을 갱신하고 재빌드하면 사용 가능해집니다.

이 파일은 **0.12.0** 릴리스 노트와 현재 **미출시** 변경 사항의 한국어판입니다. 전체 이력은 [CHANGELOG.md](./CHANGELOG.md)（中文）를 참조하세요.

## [0.24.2] — 2026-10-14

### 신규

- **레코드 패널의 투사 정체성 필드**: 카드 헤더에 "이름" "범위" 배지를, 전개 상세에 3행(이름 / 키워드 / 범위)을 추가해 "기억↔투사 파일명" 대응을 직접 확인할 수 있게 했습니다. `UiRecord` 계약(`contract.ts`)에 선택 필드 `name`/`scope`/`workspaceId`/`keywords`를 추가하고, `stats.ts::hitToUiRecord`가 레코드 본체와 `metadata.dsh_keywords` 예약 키에서 읽어냅니다.
- **FTS 키워드 독립 검색 축(예약·휴면)**: `l1_fts`를 "keywords → content" 2열 인덱스로 배치해 키워드를 본문 어휘 빈도와 섞이지 않는 독립 BM25 축으로 예약했습니다. 현재 증류 생산자가 없어 해당 열은 항상 비어 ⇒ 검색 동작은 변경 전과 글자 그대로 동일(영 드리프트), 증류 도입 시 테이블 구조 변경 불필요(FTS5는 ALTER 불가).

### 변경

- **훅 수렴 주석 정리**: 퇴역한 구 팩토리명 `makeSuffixSync` 리터럴이 `src/`에서 사라져(검수 grep 0), 수렴 결론은 단일 사실 소스만 남습니다.

## [0.24.1] — 2026-10-14

### 추가
- **투영 접미사 불변식 수렴(`convergeDisabledSuffix`)**: `.memory.md` / `.memory.md.disable` 는 "이 기록이 라이브러리에서 퇴장했는지"로만 결정된다. `name` 과도, 어떤 경로로 퇴장시켰 과도 무관. 각 항목을 "파일 존재 + 현재 접미사 + 지문 일치" 세 조건으로 맞춘다. 사람이 만든 `.disable` 는 파일 측 퇴장 증표이므로 ``both`` 로 보고만 하고 손대지 않는다.
- **라이브러리→파일 고리를 `L1Store` 에 수구(`store/memory-md-sync.ts`)**: `appendNew` / `retire` / `restore` / `rename` 네 합류점에서 `setFileSyncHook` 을 점화한다. 이전처럼 8 개 호출점에 흩어진 이벤트 고리는 실측 920 건 퇴장 중 8 건만 `.disable` 를 만들었다(리콜 패널 한 경로). 기계 측 퇴장(병합 치환, 충돌 패배)과 모델 `memory_add` 도 자동으로-follow 한다.
- **이름 바꾸기 추적**: `rename()` 이후 투영 파일을 새 이름으로 옮기고(`.disable` 도 함께) 대장 키를 갈아치운다. 옛 경로에 파일이 없으면 새 이름으로 쓰고, 목적지가 이미 쓰여 있으면 덮어쓰지 않고 보고만 한다.
- **장시간 작업의 굴림 실행과 진행 표시(`store/memory-md-run.ts`, 새 엔드포인트 `dsh-memory/mem-run-status`)**: 한 번의 클릭으로 내보내기 커서를 표 끝까지, 이어서 수렴 커서를 표 끝까지 밀고, 가로막는 종합 한도(`maxPasses` / `totalBudgetMs`) 때문에 남은 분량은 `notice` 에 그대로 남긴다.
### 변경
- **1 회 클릭 파일 갱신 예산**: `memExport.maxRecords` 기본값 300 → **2000**, 실행 중 돌리기 `live.mdExportMaxRecords` 추가(0 = 배포 기본값, 재시작 불요). 패널의 이름 맞지 않던 "단차 동작 가드레일" 을 **"단차 파일 갱신 예산"** 으로, 단위를 "개 파일/회" 로, 표시는 서버가 실제로 쓴 `appliedMaxRecords` 를 쓴다.
### 수정
- 예산이 "순회 건수"를 셌다(변화 없음도 할당 소비) → 1210 건 복원에 클릭 4 회가 필요했다.
- 항목별 대장 flush = O(n²)(300 건 = 통째 JSON 재작성 300 회) → 루프에서는 더티 표시만, 마무리에서 1 회 flush.
- 겹쳐 점화한 두 작업이 서로 밟았다 → 투영 작업을 뒷에서 **직렬화**. 종래에는 `appendNew` 직후 `retire` 에서 두 번째 수렴기가 "파일이 없다" 고 판해 퇴장 기록이 `.memory.md` 에 남았다.
- 복권 후 영구 이중화 → "대장 동일 id + `.disable` 가 기록 후 손대지 않음 + `.memory.md` 가 현재 렌더와 동일" 세 조건이 갖춰질 때만 오래된 증표를 지운다.

## [0.24.0] — 미출시(로컬 라인 `0.24.0-local.0…3`, 2026-10-13)

### 새로 추가

- **타입 어휘의 단일 진실 출처(`src/memory-types.ts`)**: 호스트 기억 분류 29류의 원명 + 플러그인 구 7류 + `unclassified` 폴백, 합계 37류. 투영 디렉터리 화이트리스트, `memory_add` 쓰기 화이트리스트, 패널 라벨, 추출 및 중복제거 prompt의 열거 문자열, memport의 TS/Python 이중 구현 타입 코드 **전부가 여기서 파생된다**. 종전에는 "타입 전집"을 네 곳에 손으로 옮겨 적어 각자 진화했다: `memory_add`는 외부 분류를 **조용히 `episodic`으로 고쳐썼고**, memport 문구는 "있는 그대로 통과"를 약속했다 — 같은 사안에 규격이 두 개였다.
- **이름 증류(`cfg.naming`)**: 추출이 그 자리에서 `title`을 산출하며, `content`와 **분리 정의**한다(title는 "이 항목은 무엇을 다루는가"에 답하는 명사구, content는 완전한 서술 본문). 중복제거 merge는 `merged_title`도 함께 산출한다. 저장 시 `title`은 단지 **이름 후보**일 뿐이며 반드시 `validateTitle` 형태 게이트를 통과해야 하고, 통과 못 하면 여전히 작명기에 넘긴다 — 이름 유일성의 진실 출처가 출처가 하나 늘었다고 판정 기준을 두 벌로 갈라서는 안 된다.
- **few-shot 표준 형식 예시집(`src/prompts/examples.ts`)**: 유형별 모범 예 + 반례, 총길이에 예산 상한이 있다(예시는 매 라운드 증류마다 지불하는 고정 비용). 모범 예 스스로 반드시 게이트를 통과해야 하고 골격이 갖춰져 있어야 하며, 테스트 케이스는 판정 기준을 손으로 베끼지 않고 `auditFewShot()`을 직접 쓴다.
- **골격 판정 기준의 실행화(`SKELETON_ELEMENTS` + `scoreSkeleton`)**: "전후 인과가 없고 다 못 쓰면 쓸 수 있는 것이 아니다"를 프롬프트 속 소망에서 측정 가능하고 기본값 결정에 쓸 수 있는 판정 기준으로 바꿨다. 한계 선언: 키워드 휴리스틱이며 같은 입력의 두 팔 상대 비교에만 쓸 수 있고, 절대 품질 점수가 아니다.
- **디렉터리 골격 + 유형별 `_index.md`(`memory-md-skeleton.ts`)**: 각 유형 디렉터리에 인덱스 파일 하나(류명 + 라이브러리 항목 수). 빈 디렉터리는 git과 압축 패키지에서 사라져 버리는데, "이 디렉터리가 없다"와 "이 유형은 0건"은 사람의 눈에 같은 모양으로 보인다. 멱등: 내용이 그대로면 쓰지 않아 mtime이 갱신되지 않는다. 투영 면이 꺼져 있으면 동작이 전혀 없다.

### 변경

- **세 곳의 기본값을 A/B 실측으로 뒤집었다**(`narrativeTemplates.enabled` / `naming.enabled` / `naming.fewShot`). 근거는 **방향이 정반대**인 두 실측: 실제 세션 증류 경로에서 예시 없을 때 골격 완비 **0.000**(0/23), 예시 있을 때 **0.703**(26/37). 반면 기존 항목 이름을 바꾸는 작명 태스크는 예시를 넣으니 오히려 **−0.113**(답 누락 18/160). 결론: **예시는 태스크를 넘어 쓸 수 없다** — 추출 프롬프트에만 넣고 작명 스크립트에는 넣지 않는다.
- **md 투영 기본 켜기**(`memExport.enabled`): 계획 전체의 전제가 "파일이 내용의 권위 + 라이브러리가 인덱스"인데, 기본 끄기는 기본 미사용과 같다. `mdSync.enabled`는 **여전히 기본 끔** — 이는 라이브러리에 쓰므로 리스크가 비대칭이다.
- **workspace 귀속 설정 면의 이름 변경 `workspaceHints` → `workspaceSource`**: 호환 별명 없이 단명으로 바꾼다(이 키는 어떤 릴리스로도 외부 발송된 적이 없어, 별명을 두면 두 번째 사실 출처를 기르는 셈). 기본 켜기. 라우팅 `path`는 **workspace 루트**를 저장한다(구값은 `E:\test\rewrite-agently\.agents`로 적혔는데 `targetFor`가 `.agents/memory`를 한 번 더 이어 붙여 `.agents\.agents\memory\` 고아 트리가 나왔다. "루트가 없어야 단일 루트로 되돌린다"는 가드가 이 형태를 막지 못한다). 실머신 기존분 채우기에서 **724/1166**건이 귀속을 받았고, `hashRecords`는 한 글자도 변하지 않았다.

### 수정

- **장부 로더가 절대 키를 `relPath`에 덮어썼다**: N10 이후 장부 키는 절대 경로인데, 로드 시 "일치하지 않으면 키를 기준으로 다시 쓴다"는 저 한 문장이 로드마다 반드시 발동했다. 실측 오염 **1167/1241**건. 하류 증상은 고아 아카이브가 콜론을 포함한 불법 디렉터리를 조립하고, 75건 이동이 전부 ENOENT. `root` + 키 유도 방식으로 고쳐(신규 `deriveRelPath`) 아카이브 측은 저장된 `relPath`를 더 이상 신뢰하지 않는다.
- **`--revert`에 hooks 폴백이 없었다**: `findArchivedOld`가 `deps.hooks.exists`를 바로 만지는데, `runCli`가 revert를 호출할 때 hooks를 넘기지 않는다(apply 쪽에는 `deps.hooks ?? defaultHooks`가 있고 revert 쪽에서 빠졌다). 샌드박스에서 첫 롤백을 돌렸을 때 74건 전부 오류. 요점은 피해의 비대칭이다: apply에서 사고가 나면 `--revert`로 물러나는데, **롤백 자체가 망가져 있으면 백업이 유일한 퇴로라는 뜻**이다.
- **루트 간 중복 파일이 "양쪽 다 변했으면 손대지 않는다"를 우회했다**: `roots = 기록 착지 루트 ∪ 장부가 기록한 루트`라 같은 기록이 두 루트 아래 각 한 부씩 파일을 가질 수 있다. 판정은 구 루트 쪽을, 디스크 쓰기는 `targetFor`가 계산한 신 루트 쪽을 취한다 — 그래서 구 루트에서 사람이 한 편집이 권위 쪽을 덮어쓰는데, 보고는 완전히 적합해 보인다. 이제 현재 착지 루트만 인정하고 나머지는 신규 필드 `staleRootFiles`에 집계해 패널에 표시한다.
- **이름 충돌이 기억 한 통째를 검색 라이브러리에서 밀어냈다**: `{ ...구기록, id: 새 id }` 같은 작성 방식은 "이미 다른 행에 속한 이름"을 달고 DB에 쓴다 → 부분 유니크 인덱스에 충돌 → 일괄 쓰기가 실패해 건별 회수해도 여전히 실패 → 해당 merge 산물이 **조용히 사라진다**(구기록은 이미 퇴장했으므로 이번 치환은 아무것도 남기지 않는다). 작명 판정을 "name이 비어 있음"에서 **"이 이름이 그에게 속하지 않음"**으로 바꿨다.
- **벡터 "채울 N건"이 영영 0이 되지 않고 "인덱스 재구축 할 일 없음"**: 표시 면의 `missing = total − embedded` 분모에 퇴장 행이 포함되는데, 퇴장 행은 설계상 벡터가 없는 것이 합법이다. 채움을 구동하는 두 SQL 모두 퇴장 행을 제외하므로 같은 화면에 "채울 114"와 "할 일 없음"이 동시에 뜬다. 분모 규격을 활성 행으로 통일했다.
- **투영 가드가 센 것은 "순회"이지 "동작"이 아니었다**: `maxRecords`는 "변화 없음" 판정 항목까지 할당에 넣는다. 두 번째 클릭도 같은 앞 N건을 다시 훑는다 — 패널의 "한 번 더 누르면 계속"은 거짓말이었다(실기 증상: `已写 9 · 未变 291 · 剩余 866` 이 계속 그대로). 이제 디스크를 건드린 항목만 세고, 순회 총량은 `timeBudgetMs`가 마감을 맡는다.
- **장부 디스크 쓰기 O(n²)**: `set()`가 항목마다 장부 전체 JSON을 원자적으로 다시 썼다. 1200건 동일 디스크 실측 **9442ms → 1954ms**(더티 플래그 + 배치 창 + `flush()` 강제).
- **`NAME_MAX`(40)와 `NAME_CLIP_MAX`(28)를 두 개의 수로 분리**: 문자 계산은 ASCII와 한자를 같은 값으로 친다. `dsh-agent-teams` / `Python-3.13` 한 단어가 15 슬롯을 먹고, 의미상 한두 단어짜리 정당한 이름이 `too-long` 판정을 받았다. 반면 통째로 40으로 놓으면 `deriveName`이 서술문을 문장 꼬리까지 베껴 쓴다(실측함). 김에 `validateTitle`에 하드코딩된 28도 고쳤다(같은 임계치에 사실 출처가 둘이었다).
- **이름 게이트의 세 곳 오폭**: 앞부분 잘라내는 표와 이름 거부 표를 **갈라서 관리**한다(주어만 남은 "사용자/팀"이 "사용자 npm 계정 사용자명"류 명사구를 오폭하지 않게 됐다, 실기 10건). `has-id-fragment`는 "비 ASCII 문자 뒤의 4자리 이상 숫자"로 좁혔다(`ADR-0006`, `Han-1413141`은 통과, 실기 4건).

### 알려진 한계

- 반추 마감의 증분 투영은 `id→updatedAt` 기준 diff에 의존하는데, relabel / 퇴장은 `patchMetadata`를 타서 `updated_time`을 건드리지 않는다 ⇒ **metadata-only 재작성은 해당 라운드에 재투영되지 않는다**.
- P2 역방향 동기가 두 가지 미비: 시작 자동 훅(엔드포인트 + 버튼만 제공하는 것으로 바꿨다), `pending` 무리가 `conflicts` 재판 대기 면에 들어가지 않음.
- **8개 언어 번역본이 0.20.0 이후 따라오지 않았다**(이번에는 0.22.0 이후 항목만 채워 넣었고, 0.20/0.21 공백은 그대로다 — 별도 기록).

## [0.23.0] — 미출시(로컬 라인 `0.23.0-local.1…8`, 2026-10-12…13)

### 새로 추가

- **md 권위 투영 면(P0/P1/U/N10/N11)**: `l1_records.name` 컬럼(파일 신원 키 + 부분 유니크 인덱스). `renderRecord` + 이중 지문 장부(`dbDigest`/`fileDigest`) + `mem-export` / `mem-reconcile` 엔드포인트. 패널 "외부 아카이브" 절. 투영 루트를 **workspace 우선**으로 변경(`<ws>/.agents/memory/<유형>/<이름>.memory.md`). 만료 판정은 `.memory.md.disable`과 연동된다.
- **P2 역방향 동기(파일 → 인덱스)**: 장부 이중 digest로 **삼방 구획**을 그린다 — 파일만 변했으면 라이브러리로 되돌려 흘리고 정규 렌더링으로 다시 쓴다(쓰기 순환 소거), 라이브러리만 변했으면 `exportRecords`를 재사용해 파일을 다시 쓴다. **양쪽 다 변하면 양쪽 모두 손대지 않고** `pending`만 건다. `.disable`은 퇴장으로 처리하고 파일은 지우지 않는다. 출처 불명의 신규 파일은 수만 세고 라이브러리에 넣지 않는다(도입은 쓰기 커널을 통과해야 한다). 엔드포인트 `dsh-memory/mem-sync`.
- **P3 아카이브 + 물리 삭제**: `exportThenPurge` 게이트를 라이브러리 전체 해시에서 **배치 단위 투영**으로 바꿨다(동시 증류가 이번 배치와 무관한 어떤 기록이든 건드리면 구 구현은 정리가 영영 못 지우게 된다). 삭제 후 사람이 읽는 `retired.md`를 쓰고, 이 배치의 투영 파일(`.disable` 포함)을 스냅샷 디렉터리로 옮긴다. `cleanup-retired` 드라이런은 **삭제 대기 목록 미리보기**를 돌려준다. 그래프 투영 인덱스 테이블에 `forgetRecords` 신규 추가(종전 전체 저장소는 증가만 있고 감소가 없었다 — 스냅샷에서 복원된 기록은 투영 행이 남아 있어 "이미 투영됨"으로 취급되어 **영영 재투영되지 않는다**. 검색 그래프가 오류 없이 조용히 한 항목 결손).
- **P4.1 기본류 `unclassified` + P4.2 본문 형식 표준화**(`normalizeContentMd`). 멱등은 하드 요구사항이다: 멱등이 아니면 장부 `fileDigest`가 라운드마다 변하고, 쓰기 순환을 렌더러 스스로 불러온다. 형식만 하고 의미는 건드리지 않는다(산문을 bullet화하지 않고, H1을 삽입하지 않고, 본문에 메타데이터를 밀어 넣지 않는다).
- **고아 투영 파일 아카이브 `dsh-memory/mem-orphans`**: "장부가 우리가 썼다고 기록했고 지금 이 경로를 주장하는 기록이 하나도 없는" 파일만 옮긴다. 장부에 없는 출처 불명 파일은 **절대 손대지 않는다**(사람이 투영 디렉터리에 넣고 돌아오기를 기다리는 입력일 수 있다). 지우지 않고 옮기기만 해 상대 형태와 원문을 보존한다.

### 동작 수정(호출 표시면)

- 호출 항목이 더 이상 순간 사라지지 않는다: view에 `body` / `retired`를 담고, `session_recalled` 행 제거를 멈추며, pill에 "만료 판정" 취소선 주석을 표시한다.
- 시작 시 기존 퇴장 잔재를 청소한다(이 기기 실측 725 행이 여전히 `l1_fts`에 더러움). 퇴장 불변식에 두 개의 우회 쓰기 경로를 보완("무효 표시 후 검색 면에서 부활" 수정).
- 호출 채점 엔드투엔드: `-1..5`(0..5 관련도, `-1`은 만료 선언 및 퇴장). 채점이 성숙도 지표에 들어간다(`-1/1/2`는 끌어내려 침전, `4/5`는 끌어올려 부상).
- workspace 내용 라우팅 첫 착지(dsh 생태 → `rewrite-agently`, 비 dsh → `agent-no-dsh`. **`workspace_id`만 쓰고 `scope`를 건드리지 않으며 `updated_time`도 건드리지 않는다**. `l1_fts` 행이 스스로 지닌 귀속 컬럼도 동기한다).

### 규율

- memport 두 초거대 함수를 두 차례에 걸쳐 분리(Extract Function, 동작 보존, CLI 골든 표준 바이트 단위 회귀).
- 엔드포인트 계약 **다섯 곳 동시 변경** 규율이 계속 유효(`MEMORY_ENDPOINTS ≡ switch ≡ contract 이중 map ≡ contract-keys 카운트 ≡ config`), 카운트 체인 55→56→57→58→59.

## [0.22.2] — 2026-10-12

### 새로 추가

- 스킨 세 상태(auto/light/dark) + 토큰 오버라이드 블록. 패널 11 Tab 한 줄로 조이기.
- `memory_import`의 `ext_key` 멱등(`l1_records.ext_key` + 부분 유니크 인덱스 + `deduped` 영수증).
- **Memport Connect**: `.mem` 파싱 / 사전 필터 / 스캔 + 출처 레지스트리 + Connect Tab(구현 간 sha256 골든 표준 정렬).
- **스킬 결정화**: skill-store(JSON 사이드카) + 후보 감지 + 스킬 호출 주입 + 보드 스위치 `skillsEnabled`.
- G4 그래프 인과 간선(야기 / 원인 / 수정함 / 대체, `projectorVersion`을 bump하지 않음).
- G3 성숙도 읽기 시 파생(기록 카드 배지 + 모순 재판 뷰 주석, 자동 재판에는 참여하지 않음).
- G1 `usageScenario` 게이팅 엔드투엔드(추출 → `metadata.dsh_usage_scenario` 저장 → 호출 세밀 랭킹. off는 한 글자도 동일).
- G2 유형 서술 템플릿(게이팅 prompt 변형. off는 on의 접두어).
- wing / 인지 hall 두 축이 서로 섞이지 않는다(직교 접근자 + 값 범위가 겹치지 않음을 보장하는 회귀 잠금).
- **G-live 이번 세션 활성 호출 집합**: 지속 사이드카 + `session-recalled` 읽기 전용 엔드포인트 + pill 읽기 전용 목록.
- `memoryRecall` 세션 인식 투영(brief 사이드바 "이번 세션 호출" 구분의 데이터 소스, `init(header).id`).
- `cfg.slots.migrateLegacy`(기본 끔): "핀으로 상주화됐지만 내용은 이미 활성 L1이 담당하는" rule 슬롯을 소프트 퇴장한다.

### 수정

- 반추 되돌림이 처리 대기 카운트를 되돌리거나 늘렸다(ruminate는 빈 메시지를 넘기도록 변경, `enqueueSessionSlices`와 동일 시맨틱스).
- 반추 finalize와 `doLightRefresh`가 L3를 강제로 실제로 실행하도록 수정 + 카운트 0으로 초기화 + `state.save()` 디스크화("L2/L3 반추 후에도 안 사라지고 재시작하면 다시 뜀" 수정).

### 규율

- 신규 능력은 전부 기본 끔, off 상태 산출물과 주입이 한 글자도 동일. 플러그인 간 표시 계약(`memorySlots` 투영) 배선을 유지.

## [0.22.1] — 2026-10-09

### 수정

- **오버레이 하단을 불투명으로**: 입력란의 기억 오버레이(`.dsh-mem-popover`)와 드롭다운 / 필터 패널(`.dsh-mem-pop`)이 종전 호스트의 `--dsw-specific-menu`를 따랐는데, 호스트가 이를 반투명 유리 값으로 해석 ⇒ 패널이 배경을 투과시켰다. 이제 **불투명 `bg-primary` 바탕**에 별명 레이어를 얹는 underlay 방식으로 바꿔, 호스트의 alpha 값과 무관하게 패널이 항상 불투명하게 보인다.

## [0.22.0] — 2026-10-09

### 변경

- **선언 면 15rc 대응**: dsh peers 9건이 출시된 호스트 rc를 전부 커버(`0.1.0-rc.2..0.2.0-rc.2`, 건별 `npm view`로 증거를 확보했고 각 라인 집합이 일치), 전부 optional. `engines >= 0.1.0-rc.2`는 대략의 울타리(정밀 게이트는 peers), `package.json`과 `dsh.plugin.json`을 동기.
- **이중 매니페스트 버전 바로잡기**: `dsh.plugin.json`이 앞서 `0.20.0-beta.6-dsh0.2.0.1`에 흘러가 있었는데, 이번 배치에서 `package.json`과 한 글자까지 맞췄다(V1 게이트).
- **`dsh.client.inject`를 `ui-primitives` only로 축소**: `dsh-client-connection`은 0.1.2부터 패키지로 존재하므로 선언하면 client entry 전체가 0.1.0/0.1.1에서 로드 실패한다(`rpc.ts`는 진작 `ctx.get`으로 해당 연결을 게으르게 얻었다).

### 규율

- build형 저장소에 `prepack: npm run build`를 전부 주입 — `npm pack`은 prepack만 발동하고 `prepublishOnly`를 발동하지 않는다. stale-build 누명의 삼중 방어선 중 하나.

## [0.21.0] — 2026-10-04

### 새로 추가

- **도구 그룹 봉인（기억 라이브러리 패널 → 기억 → 도구 봉인）**: 5개 그룹 스위치(room 관리 / graph 그래프 / ruminate 반추 / conflict 충돌 / mutate 쓰기·삭제, 13개 도구 커버). 끔 = 그 그룹 도구가 **등록되지 않는다**, 모델 도구 목록에서 곧장 사라진다(실행 시점 거절이 아니다); 스위치 뒤집기는 volatile 열갱신으로 즉시 발효, 재시작 불요. 핵심 읽기(memory_search / memory_read_scene / memory_receipts / conversation_search)와 슬롯 3건은 제어 밖. 배경: 대다수 그룹 도구(예컨대 Room 통치·반추)는 일상 사용 빈도가 극히 낮아, 상주 도구 목록은 주의만 허비하고 모델의 오인 호출을 부른다.
- **memory_slot_write의 mem_ 참조 존재성 검증**: refs에서 `mem_*` 형태인 L1 record_id는 쓰기 전 `getByIds` 존재성 검증을 거친다, 지어냈거나 철자가 틀린 id는 곧장 거부하고 memory_search를 거치라 안내한다 — "search가 깨운 기억"이 슬롯 참조에 들어가면 반드시 실제 기록임을 보장한다(brief 쪽 이름 약술 해석이 신뢰할 만한 입력을 얻는 근거). 파일 경로/URL류 refs는 검증하지 않는다.

## [0.20.4] — 2026-10-04(로컬 빌드, 미출시)

### 수정

- **투영 refViews 해석의 전면 내결함**: `resolveRefViews` 안에서 L1 `getByIds` 호출에 try/catch를 걸었다 — registry의 drive에 예외 보호가 없어, 해석 계층이 아무 예외(sqlite 점유/백엔드 강등/기록 상태 이상)든 토하면 세션 이벤트 구동 전체는 물론 호스트 프로세스까지 무너진다. 실패 시 이번 프레임은 refViews 없이 강등(프론트는 원시 refs로 회수).

## [0.20.3] — 2026-10-03

### 수정

- **`memory_search` 렌더 텍스트에 id 보충**: v0.20.2가 record_id를 출력 JSON과 schema에 넣었지만, 모델이 보는 것은 render 산물이지 원시 JSON이 아니다 — 렌더 줄에 id가 없으면 모델로서는 안 돌려준 것과 같다(실머신 재측에서 발견). 이제 각 결과 끝에 `— id: mem_xxx`가 붙어, 그대로 슬롯 refs에 쓸 수 있다.

## [0.20.2] — 2026-10-03

### 수정

- **투영 `memorySlots`의 더티 판정을 임의 이벤트로 완화**: 종전엔 `tool/result`(settled, 비-error)일 때만 store rev로 더티를 판정 — 쓰기 후 "하필 또 도구 결과가 하나 더 와야" 갱신되고, 세션 간 조회는 조회 세션 자신의 도구 호출을 더 기다려야 했다; 실머신에서 쓰기 후 사이드바가 오래 빈 프레임에 고착되는 증상이 드러났다. 임의의 확정된 이벤트에서 O(1) rev 비교를 하고 rev가 변하면 곧장 재건·push하도록 변경; isError 가드는 제거(rev는 실제 변경 후에만 증가, 이벤트는 촉발자일 뿐 데이터 소스가 아니다).
- **상주 주입을 `<system-reminder>` 태그 프레임으로 변경**(dsh-agent-instructions의 AGENTS.md 주입 house style에 정렬): user 역할 담당은 불변, 다만 태그 상자 + 권위 선언(응답 불요/재서술 말 것/시스템 프롬프트와 사용자 직접 지령을 덮지 말 것)으로 제시 — 약한 모델이 슬롯 내용을 사용자 발화로 오인해 그대로 재서술하며 정상 답변을 방해하던 문제를 고쳤다; 슬롯 본문 안의 닫는 태그는 전이(`</system-reminder>`)시켜, 슬롯 내용이 프레임 경계를 위조하는 것을 막는다.

### 새로 추가

- **`memory_search` 결과가 `id`(L1 record_id)를 밖으로 드러냄**: "검색으로 id를 못 얻음 → 슬롯 refs / memory_receipts에 못 넣음"의 교착을 해제; schema 서술에 id의 사용처 두 곳을 명시.
- **wire view가 `refs` + `refViews`를 드러냄**: `mem_*`류 참조는 투영 프레임 구축 시 L1 `getByIds`를 거쳐 `[type] 이름 약술`(content 첫 줄, 80자 절단)로 해석되고, brief-sidebar(≥0.5.0-beta.2)가 직접 렌더하며, 경로/URL류 참조는 문자 그대로 유지; 결손/이미 퇴장한 기록은 항목을 만들지 않는다. 해석은 프레임 구축 시점에 일어난다 — 참조 집합은 슬롯 쓸 때 이미 동결되므로, L1 기록을 사후 편집해도 옛 프레임에 역류하지 않는다. 자체 구현 schema는 부가 필드에 대해 "있어야만 검증"하므로 옛 checkpoint 행은 통째로 통과(stateVersion을 건드리지 않는다).

## [0.20.1] — 2026-10-03(정식화; beta 채널이 beta.1 이후의 전 기능을 확정)

Hall·Room 분류 관리 전 연쇄(2단계 등록부/merge/rename/retire/update/편입/기록 동반 퇴장/미등록 퇴장 시 항목 보완), Hall과 Room 각각의 독립 관리 페이지(검색 필터·기본 접힘·포인터 드래그 분류·퇴장 필터), 노화 가중치 표시 + 호출 사용 통계(topN에 들어가야 비로소 used로 셈). 정식화 직전 beta는 0.20.0-beta.26이고 내용은 0.20.1과 일치; `dsh-0.2.0-beta` 채널은 이후 beta를 계속 받는다.

## [0.20.0-beta.26] — 2026-10-03

### 새로 추가(Hall/Room 증가 후의 사용성)

- **Hall/Room 이름 검색 필터**: Hall 페이지에 검색 상자를 신설(slug·표시 이름·별칭, 대소문자 무시) — hall 자기 이름에 걸리면 그 하위 room을 모두 보이고, 아니라면 걸린 하위 room만 남기며, 조 전체가 안 걸리면 숨긴다; 검색 중에는 매칭된 조가 자동 펼쳐진다(접힌 상태가 더는 결과를 가리지 않음); 자체 성장 미등록 영역도 같은 필터. Room 페이지에도 같은 검색 상자, 퇴장 필터 chips와 중첩 발동.
- **Hall 그룹 접기, 기본으로 전부 접힘**: hall 헤더에는 "합계 N 건 · M개 room"만 보이고, 헤더나 ▸/▾ 단추를 눌러 하위 room을 펼치거나 접는다; "전체 펼치기/전체 접기" 일괄 단추; 펼침 상태는 localStorage에 기억(`dsh.memory.halls.open`). 분류 지정 클릭(hall 헤더를 눌러 분류 완료) 우선순위는 변하지 않는다.

## [0.20.0-beta.25] — 2026-10-02

> 자체 성장 미등록 room 퇴장 후 상태 비가시 수정 + Hall 하위 room 표시 규칙(사용자 판정).

### 수정/변경

- **자체 성장 미등록 room은 퇴장하면 곧 "퇴역/복원"으로 바뀐다**: 종전엔 퇴장 시 기록만 소프트 삭제했고 어휘표에 항목이 없어 바낄 것이 없었으므로 버튼은 언제나 "편입/퇴장"이었다. 이제 retire withRecords가 미등록 slug에 **자동으로 grown 등록 항목 하나를 보완하고 retired로 전환** — 패널 줄이 즉시 "퇴역" 상태로 전환, "복원"(active:true) 후 어휘표에 복귀. 영속화하며 재시작해도 사라지지 않는다.
- **Hall 페이지 하위 room은 active만 표시**: retired/퇴장한 room은 더 이상 hall 그룹 아래에 안 나온다(Room 페이지에서 본다, "퇴역" 필터 포함); 그룹 집계 계수도 따라 active 하위류만 센다.

## [0.20.0-beta.24] — 2026-10-02

### 수정

- **Hall 페이지 펼치기/퇴장을 Room 페이지와 정렬**: Hall 페이지의 room 줄을 펼칠 때도 활성 기록만 당긴다(`retired:false`); 퇴장 확인 후 해당 room이 펼쳐져 있으면 펼침 영역을 자동 갱신.(beta.23은 Room 페이지만 보강하고 Hall 페이지 동기화를 빠뜨렸다 — 사용자 실측 "퇴장을 눌러도 효과가 안 보인다"의 또 다른 한 군데.)

## [0.20.0-beta.23] — 2026-10-02

> **Room 페이지 퇴장 필터 보강**(beta.22의 필터 chips는 패치 스크립트가 도중 실패해 디스크에 못 내려가고 배지만 패키지에 들어갔다 — 이번엔 항목별 Edit로 내려놓고 전부 통과 검증).

### 수정/새로 추가

- **퇴장 필터 chips**(Room 페이지, 등록 폼 위): 전체 / 활성(어휘표 미퇴역) / 퇴역.
- **퇴장 효과가 즉시 발현**: 전개 항목은 **활성** 기록만 당긴다(`retired:false`) — 퇴장 후 펼침 영역은 곧 "기억 항목 없음"; 퇴장 확인 후 해당 room이 펼쳐져 있으면 펼침 영역을 **자동 갱신**; [퇴장됨] 배지 + 회색화 폴백(beta.22에 이미 포함).

## [0.20.0-beta.22] — 2026-10-02

> 퇴장 효과 가시성 + Room 페이지 퇴장 필터(실측 피드백: 퇴장 확인 후 화면 변화 없음, 필터할 수도 없음).

### 수정/새로 추가

- **퇴장 효과가 즉시 발현**: Room 페이지에서 항목을 펼치면 **활성** 기록만 당긴다(`retired:false`) — 퇴장 후 펼침 영역에 곧 "이 Room에는 기억 항목이 없습니다" 표시; 퇴장 확인 후 해당 room이 펼쳐져 있으면 항목을 **자동 갱신**; 혼배 폴백: 이미 퇴장한 항목엔 [퇴장됨] 배지를 달고 회색화.
- **퇴장 필터**: Room 페이지에 "전체 / 활성 / 퇴역" chips 신설(어휘표 퇴역 상태 필터).

## [0.20.0-beta.21] — 2026-10-02

> **퇴역 시 기록 동반**: room 퇴역 시 **그 아래 활성 기억을 통째로 함께 퇴장**시킬 수 있다(종전엔 동사표만 있어, 특히 자체 성장 room은 처리 수단이 없었다).

### 새로 추가

- **`retire withRecords`**(Room/Hall 페이지 "퇴장" 버튼, 빨강): 어휘표 퇴역 + 그 room 아래 **활성** 기록 일체를 배치 소프트 삭제(매배치 ≤200, records-delete와 같은 원어; reason=manual) — 기록은 기억 페이지 "퇴장됨" 영역에서 건별 복원 가능. 자체 성장 미등록 줄도 "퇴장"이 있다(기록만 퇴장, 어휘표 항목은 손댈 것이 없음). 응답에 `retiredRecords` 건수를 담는다.
- "고아 내보내기" 버튼을 **기억 질의 패널**(고아 필터 줄 안)로 되돌렸다.

### 수정

- recall-usage 테스트 격리(영속 루프 케이스의 병렬 경합); RoomTab 퇴역 확인창의 문자 그대로 `\n` 표시 수정.

## [0.20.0-beta.20] — 2026-10-02

> **Room 독립 탭**(Hall과 분리): room의 존재·이름·항목 각각의 관리 면이 있다; 기억 페이지는 더 이상 Room 태그를 쌓지 않는다.

### 새로 추가

- **"Room" 탭**(Hall 뒤): 모든 room을 납작하게 나열(등록 항목 ∪ 자체 성장 미등록) — **존재**(2단계 slug 등록 / grown 편입 / 퇴역·복원), **이름**(표시 이름+분류 설명 편집; 개명은 2단계 slug 가능, 기록은 따라 이동), **항목**(▸ 펼쳐 그 room의 기억 항목 열람, 기본 접힘, 최초에 앞 10건만 당김); 고아 내보내기/고권한 스위치는 페이지를 따른다.
- **등록 후 재편집 가능**: 새 `room-admin update`(label/description 재작성, 미제공 필드는 그대로)+ store `RoomRegistryStore.update` + 도구 `memory_room_admin action=update` + 패널 "편집" 진입 — 종전엔 등록 후 label/설명은 빈칸만 채울 수 있고 재작성 불가.
- **room 줄 내용 전개**(Hall 페이지 room 줄과 동일): 기본 접힘, ▸로 펼치면 항목.
- **기억 페이지 Room 블록 분리**: slug chips/페이지네이션/전개 블록 제거(Hall/Room 페이지와 중복), "미바인딩 · N" 고아 필터와 안내 문구만 유지 — room 태그 열람/관리는 Hall/Room 페이지로.

### 변경

- 병합/분류/개명 폼과 미리보기 sticky 스크롤 추종(hall이 많을 때 확인창을 찾느라 위아래로 밀 필요가 없다).
- 포인터 자체 드래그(ego-browser과 같은 pointer 방식, 일부 webview에서 HTML5 DnD가 안 터지는 데 대한 폴백).

## [0.20.0-beta.19] — 2026-10-02

> 분류 상호작용 재작업(실측 피드백: HTML5 드래그가 일부 webview에서 안 터짐; hall 클릭 후 미리보기가 원본 줄에 묻혀 "반응 없음"처럼 보임).

### 변경

- **포인터 자체 드래그**(ego-browser과 같은 순수 pointer 방식): room/자체 성장 slug를 누른 채 → 유령 chip이 손을 따라 부유 → hall 헤더에 호버하면 점선 강조 → 손을 떼면 분류. HTML5 DnD에 의존하지 않아 어떤 webview에서도 발동. 클릭 지정 분류("분류" / "담기" → 지정 상태 → hall 헤더 클릭)는 유지.
- **전역 조작 바**: 병합/분류/개명의 폼과 dryRun 미리보기가 **페이지 최상단에 상주**(빨간 확인창은 줄과 함께 스크롤되지 않고, 더 이상 원본 room 줄에 묻히지 않음) — hall을 클릭하면 반드시 보인다.
- **room 줄 레이아웃**: 버튼을 한 줄에 고정해 더 이상 줄바꿈하지 않음(내보내기가 외톨이 줄 안 됨); 이름/별칭은 왼쪽 정보 영역에서 자연 줄바꿈(별칭은 단어 끊김 허용).

## [0.20.0-beta.18] — 2026-10-02

### 유지 보수

- lint 정리: beta.17의 isTag→isRoomSlug 치환이 남긴 stats.ts / rooms-registry.ts 두 개의 죽은 import(출시 게이트 미검 — 파이프 후 `$?`가 tail의 종료 코드를 취함, D2 함정 재발). 기능 변경 없음.

## [0.20.0-beta.17] — 2026-10-02

> **재시작 후 hall/room 관계 소실 수정**: `rooms-registry.json`의 로더가 여전히 `isTag`로 slug를 필터링 — 재시작 후 디스크에서 읽을 때 모든 `major/minor` 2단계 항목이 불법으로 **조용히 버려진다**(단독 hall은 통과해 남았다). 이는 isTag/isRoomSlug 혼용의 세 번째 장소; 같은 배치에서 `normTags`의 같은 지뢰도 걷어냈다.

### 수정

- **로더가 2단계 항목을 버림**(`store/rooms-registry.ts` init): 필터를 `isRoomSlug`로 변경. **당신의 디스크 위 rooms-registry.json 데이터는 온전하다**(2단계 항목은 줄곧 파일에 있었고, 단지 부팅 시 버려진 것) — 업그레이드 후 재로딩하면 관계가 자동 복원, 어떤 복구 조작도 불요.
- **normTags가 slash 태그를 씻어냄**(`metadata-validators.ts`): "모든 tags 재작성 지점은 반드시 여기를 통과" 게이트가 isTag를 썼는데, 분류 재작성 시 넣은 `hall/minor` 태그가 다음 증류/재라벨에 닿을 때 조용히 깎였다. 이제 2단계 room slug를 통과(3단계는 여전히 거부); `isRoomSlug`의 사실 소스를 가까운 해당 파일로 옮김(의존 순환 회피), rooms-registry의 re-export는 호환 유지.
- **list-records의 2단계 tag 필터 오거부**(stats.ts tagSel와 같은 지뢰): `isRoomSlug`로 변경 — Hall 페이지에서 2단계 room을 눌러 기록 필터링하면 이전엔 400을 반환했다.
- 빨간 테스트 선행 ×3(영속 루프 2단계 보존 / normTags 통과 / 통합 2단계 tag 필터), 빨강을 확인한 뒤 고쳐 초록 복귀.

## [0.20.0-beta.16] — 2026-10-02

> **자체 성장 미등록 slug를 곧장 hall에 편입**: 하단 "자체 성장 미등록" 영역의 각 chip을 이제 hall 헤더로 끌어다 놓을 수 있다 — 편입 + 그 하위류 지정이 한 단계로 끝난다.

### 새로 추가

- **grown chip 드래그/클릭 분류**: 미등록 slug(예 `git-commits`)를 hall 헤더로 끌거나(chip의 "담기" 버튼을 눌러 지정 상태로 들어간 뒤 대상 hall 클릭) → dryRun 미리보기 → 확인 실달. 의미 = **제자리 편입(from, source=grown) → `hall/하위류`로 rename**: 기록 tags는 따라 이동, 옛 이름은 대상 별칭에 들어가고, 항목은 active이며 ⭐를 달지 않는다(편입 신원). 자기 hall의 2단계 slug로 되떨어짐(예 `dsh-plugin/xxx`)= 제자리 편입.
- 조합 순서를 통합 테스트에 박았다(markMered는 미등록 from에서 조기에 빠짐 — 반드시 먼저 from을 편입한 뒤 rename); execMerge는 미등록 from에 자동 편입 보완.

## [0.20.0-beta.15] — 2026-10-02

> 분류 실측 피드백 2연속 수정: ①개명 후 항목이 잘못 "퇴역"을 달음(주석 어휘표에서 빠진다); ②HTML5 드래그가 일부 webview에서 안 먹힘 → **클릭 지정 분류**를 주 경로로 신설.

### 수정

- **분류(개명) 후 항목에 retired 오표**: renameRoom이 merge 편성을 재사용하면서 `markMerged`의 "옛 항목을 퇴역으로 전환"까지 딸려 왔다 — 분류 끝난 새 room이 "퇴역"을 표시하고 **주석 어휘표에서 빠진다**(listActive 필터). 이제 rename 마무리에서 직전 상태를 복원(active 항목은 개명 후에도 active); 진짜 merge(합집합 의미)는 영향 없음. 빨간 테스트 선행(unit + HTTP 면 통합).

### 변경

- **클릭 지정 분류를 주 경로로**: room 줄의 "분류" 클릭 → 지정 상태 진입(버튼이 "hall 선택…"으로 변하고 모든 hall 헤더 점선 강조) → 대상 hall 헤더 클릭 → dryRun 미리보기 → 확인 실달. 드래그는 유지(지원되는 환경에서는 여전히 쓸 수 있음), 다만 의존하지 않는다.

## [0.20.0-beta.14] — 2026-10-02

> 기억 카드에 **노화 가중치**와 **호출 사용** 표시를 신설, 그리고 "노화 가중치 효과 통계" 데이터 축적을 시작. 기준(사용자 판정): **topN에 들어가야(컨텍스트에 주입되어야) 비로소 사용된 것**; 시도했으나 안 들어감 = 시도만 셈.

### 새로 추가

- **카드 필드**: "노화 N%" chip(읽기 경로 감쇠 계수 `max(0.5, 0.5^(Δ일/반감기))`, 호출 정렬과 같은 식 같은 소스; ≤60%는 빨강=늙음)+ "used/attempts" 계수(title에 최근 사용/시도 시각 포함). 도구줄에 집계 "호출 사용 used/attempted(rate%)" 신설.
- **통계 면**: `RecallUsageStore`(recall-usage.json 사이드카, rooms-registry와 같은 가문 규율 — 손상 시 읽기 강등, 절대 호출 읽기 경로를 막지 않음); 매 라운드 호출을 주입/전부 억제/예산 0의 세 종착 상태에서 기록(후보 attempts++, 주입 used++, 타임스탬프는 최신); 메모리 즉시 + 디바운스 5s 원자 영속, 5만 건 초과 시 최근 시도 기준으로 폐기; 미장착 = 무비용 우회.
- 계약: UiRecord에 `agingWeight`/`usage` 추가, ListRecordsResponse에 `usageSummary` 추가(선택 필드, 옛 클라이언트는 파괴 없음); 계약 키 수는 불변.

### 효과 통계 기준(후속 분석용)
- usageSummary: tracked(통계 있는 기억 수)/ attempted(Σ시도)/ used(Σ사용)/ rate(사용률%)
- 세밀 분석(유형/연령대별 사용 분포, 반감기 튜닝 근거) 데이터는 이 버전부터 축적, 분석 뷰는 별도 논의.

## [0.20.0-beta.13] — 2026-10-02

> 분류 논리 보강: room을 기존 hall 아래에 넣기(종전엔 새 hall만 만들거나 다른 room에 병합해 신원을 지울 수 있었다). 패널은 **드래그 분류**를 지원 — room을 끌어 hall 헤더에 놓으면 된다.

### 새로 추가

- **Hall 페이지 드래그 분류**: room 줄을 끌 수(hiPriv 켜면 손잡이 커서), hall 헤더가 놓기 대상(점선 강조); 손을 떼면 = 미리 채워진 개명(major/minor) + 곧장 dryRun 미리보기, 확인 후 실달 — 기록은 따라 이동, 옛 이름은 별칭, 그룹 뷰에서는 곧 그 hall 아래로 걸림. 터치스크린/드래그 미지원 환경은 room 줄의 "분류" 버튼이나 개명 폼의 hall 빠른 선택 chips로 폴백.
- 백엔드 수정: `renameSlug` 대상 검증 `isTag` → `isRoomSlug` — 종전엔 2단계 대상(major/minor)이 오거부되어 "hall 아래로 분류" 길이 사실상 통하지 않았고(또 rename 편성이 기록을 재작성한 뒤 등록부 개명 시 예외를 던져 반쪽 상태를 남김). C3 제거/변경 규율대로: 빨간 테스트 선행(unit + HTTP 면 통합 각 하나), 빨강 확인 후 고쳐 초록 복귀.

### 수정

- 상동: `renameSlug` 2단계 대상 검증(beta.5에 들어간 결손).

## [0.20.0-beta.12] — 2026-10-02

> lint 정리 + 제거 규율 성문(ENGINEERING-NOTES에 C3 신설). **기능 변경 없음**.

### 유지 보수

- **eslint 정리(13 error → 0)**: longtask 제거 잔재(stats.ts 죽은 import ×2, RecordsTab 죽은 state)+ 더 이전 배치의 부채(recluster.ts 죽은 인터페이스와 let, rooms-registry.ts / ruminate.ts / room-review.ts / 테스트 파일 두 개의 죽은 import와 let). 남은 warning 4개는 기저선 기존(primitives/tools의 any).
- **ENGINEERING-NOTES에 C3 "제거도 TDD"**: 제거는 먼저 테스트로 새 기대를 표현(빨강) → 구현 제거(초록); lint는 삭제형 변경에서 반드시 돌려야 하는 문(unused import = 덜 제거된 것의 자동 탐지기).

## [0.20.0-beta.11] — 2026-10-02

> Hall·Room **통합 테스트** 도입(`tests/hall-room.integration.test.ts`: HTTP 면 전 연쇄 × 실제 저장소의 사용자 여정, 9 케이스), 통합 첫 실행에서 단위 테스트 사각지대 하나를 잡아 고쳤다.

### 수정

- **rooms-get 병합 뷰의 source를 `pre-registered`로 하드코딩**(beta.4 도입): 등록부 항목을 계수 목록에 합칠 때 출처를 고정해 썼는데, 편입(source=grown)된 항목이 패널 계수 chips에서 항시 ⭐ 사전등록 배지를 달았다 — 신원 왜곡. 이제 항목의 실제 출처를 씀(⭐는 사전등록에만; 편입은 grown 표시). 단위 테스트 사각지대 원인: rooms-registry 단위 테스트는 store 층만 해서, 단말 병합 줄이 grown 항목의 source를 주장하는 자가 없었다.

### 테스트

- `hall-room.integration.test.ts`: 빈 표 자체 성장 계수 → 2단계 등록/불법 slug 거부 → 편입 → 세 kind 내보내기 → merge dryRun 영쓰기→실달(백업 영속/퇴장 행 재작성/metadata 보존/장면 재계산 큐잉 source='room-merge')→ rename 별칭 → retire/복원 → 대분류 200 상한+소분류 미점액 → 손상 읽기 강등 빨간선(rooms-get은 막지 않음, 디스크에 역작성 안 함).

## [0.20.0-beta.10] — 2026-10-02

> **longtask(장기 작업 모드) 전면 제거**: 이 기능군의 소속은 본래 context-compression 쪽("압축 시작 제안"이 그 영역), pm에 잘못 실린 것 — beta.8에서 플로팅 공을 제거했고, 이번 버전에서 남은 백엔드를 전부 제거. pm은 순수 기억 영역으로 복귀. 장래에 "꼬리 즉시 증류" 같은 능력이 필요하면 pm 본위로 재설계해 별도 과제로 착수한다.

### 제거

- **엔드포인트 `longtask-hint-get` / `longtask-compress-tail`**(계약 키 48 → 46)및 `compressTailTurns`/디바운스 반추 폐루프: 컨텍스트 계량(`ContextUsageStore`), todo 표류 감지(`TodoRefStore`), 제안 판정이 함께 제거, `hooks/long-task.ts`, `store/context-usage.ts`, `store/todo-ref.ts` 세 파일 삭제(todo/write 이벤트의 declare module 확장 포함).
- **`cfg.longTask.*` 설정 블록**(기본값 + Schema 두 곳): 옛 설정 파일의 longTask 키는 schema가 무시, 마이그레이션 불요.
- **세션급 `longTask` 깃발과 꼬리 압축 수위선 `lastTailCompressedTurn`**(session-modes): 옛 session-modes.json의 잔여 키는 로드 필터가 자연히 무시.
- **`session-mode-set`의 `mode`를 필수로 되돌림**(그 선택화 가능은 longTask 2택1을 위해 태어남); `longTask` 요청/응답 필드 삭제.
- 보존: beta.9의 roomRegistry RPC 배선 수정(독립 성립); Hall 관리 페이지와 Room 분류 관리 면은 불변.

## [0.20.0-beta.9] — 2026-10-02

> 패널 RPC 전 연쇄의 deps 누락 수정:`roomRegistry`와 `longTaskDeps`가 rpcHandler 조립 때 sources에서 빠져, 패널 쪽 Room 관리/장기 작업 엔드포인트가 항시 "미장착"(도구 면은 직전달이라 영향 없음, 그래서 beta.4부터 도구는 쓸 수 있으나 패널 등록은 계속 오류).

### 수정

- **`registerMemoryRpc`의 rpcHandler가 `roomRegistry`/`longTask`를 빠뜨림**(beta.4 도입): HTTP 분배는 `buildEndpointDeps`로 통일되지만 sources는 7가지만 담았다 — `rooms-get`은 registry를 안 내림, `room-register`/`room-admin`은 "Room 등록부 미장착(플러그인 재초기화 필요)"를 던짐, `longtask-hint-get`/`longtask-compress-tail`은 항시 disabled. 이제 sources와 함께 내림; 회귀 테스트가 HTTP 면 전 연쇄를 고정(register → rooms-get 병합 → room-admin, rpc.test.ts).

## [0.20.0-beta.8] — 2026-10-02

> 플로팅 공 UI 제거: 부유 제안 패널의 소속은 본래 context-compression 쪽("압축 시작 제안"이 그 영역), pm에 잘못 실린 것 — beta.1부터 패키지와 함께 배포된 FAB를 이번 버전에서 제거.

### 제거

- **플로팅 공 + 제안 카드(`client/src/longtask-fab.ts`, beta.1부터 패키지와 함께)**: 통째 제거, 클라이언트는 두 좌석으로 복귀 — `settings.section`(기억 패널)+ `conversation.input.left`(단계 pill), 더 이상 앱 전역 플로팅 UI 없음. 장기 작업 모드 본체(컨텍스트 계량/todo 참조/꼬리 turn 압축)는 영향 없음; `longtask-hint-get`/`longtask-compress-tail` 엔드포인트는 백엔드 면으로 보존, 장기 작업 스위치와 수동 압축 진입은 정식화 때 기억 설정 분절에 착지.

## [0.20.0-beta.7] — 2026-10-02

> Room 분류 관리 세 번째 배(**관리 패널 면**): 전용 "Hall" 탭, hall(대분류)+ room(소분류)을 함께 관리 — 수동으로 Room을 보거나 관리할 때 agent 도구를 빌리지 않아도 된다.

### 새로 추가

- **"Hall" 관리 탭**("장면" 뒤): hall 그룹 트리 — `major/minor`는 접두 대분류로, standalone slug는 자체 hall(자기 자신이 hall이자 그 아래 유일한 room); hall 헤더 줄에 집계 계수 + 일괄 "+소분류"(미리 채움 `hall/`); room 줄은 ⭐사전등록/source/상태/별칭/계수를 표시, retired는 회색화. UI 용어 Hall/Room은 그룹 뷰로서, Wing(`metadata.hall` 영역) 및 인지 hall과는 무관(ADR-0020 §7 중의 해소).
- **전 조작 UI 진입(고권한 memoryMutate 문)**: 2단계 slug 등록(제한 폼, placeholder `dsh-plugin` / `dsh-plugin/merge`); 자체 성장 slug **편입**(`source=grown`); **개명/병합**은 새 RPC로 — dryRun 미리보기(영향 건수+샘플) → "확인 실행" 실달, memory_room_admin 도구와 같은 편성(실행 전 자동 백업 + 완료 시 장면 재계산 큐잉); 퇴역/복원 한 번 클릭(복원은 2차 확인 없음, 퇴역은 확인); room별 기록 목록 CSV 내보내기; 어휘표/고아 내보내기 이 페이지로 수렴; 병합/개명에 "반추 유휴 시 실행" 안내.
- **신규 엔드포인트 `dsh-memory/room-admin`**(merge/rename/retire; memoryMutate 문, 단말 측 예외 의미): 계약 키 47 → 48. `rooms-export`에 `kind='records'` 추가(Room별 기록 목록 내보내기, `tag` 필수); `room-register`에 선택 `source` 추가(편입 시 `grown`).
- 기억 Tab Room 블록 축소: 관리 하위 패널 제거(고아 내보내기는 헤더 줄로 위로 이동), 안내는 Hall 페이지를 가리킴.

### 수정

- `rooms-export` records 분기 kind 타입 축소(TS2322)와 과거 문자 깨짐 오류 메시지; CHANGELOG beta.1-beta.5 중복 제목 줄 수정.

## [0.20.0-beta.6] — 2026-10-01

### 수정

- **주석 어휘표가 등록부에 접속(beta.5 누락 보강)**: beta.5의 merge/rename/retire는 이미 착지했지만, 후보 주석기(`annotateOrphanCandidates`)의 어휘표는 여전히 순수 자체 성장 집계 — 사전등록 Room은 후보에 전혀 못 들어갔다. 이제 OrphanAnnotateIO가 registry를 담는다: 병합 어휘표 = 등록부 항목이 앞(count=0, label/description 첨부)+ 자체 성장 디렉터리, 상한 120; ruminate와 memory_room_admin annotate 두 경로 모두 인자 전달. **사전등록 Room이 이때부터 후보 주석에 실제 영향을 준다**.

## [0.20.0-beta.5] — 2026-10-01

> Room 분류 관리 두 번째 배(**파괴적 면**). dryRun 기본 true — merge/rename은 먼저 영향면을 미리보기, 확인 후 실달; 실행 전 `rooms-merge-backups/`에 자동 백업.

### 새로 추가

- **Room 등록부 2단계제**: slug가 `major` 또는 `major/minor` 2단계를 지원(예 `dsh-plugin`, `dsh-plugin/merge`); **대분류 상한 200**, 소분류 세분화는 대분류 점액을 쓰지 않음(총량 안전장치 2000). isTag 어휘표는 완화하지 않음(slash는 등록부 층에서만 허용).
- **merge/rename/retire(도구 `memory_room_admin`, 고권한)**: merge는 커서로 모든 매칭 기록의 tags를 재작성(쓰기 전 재읽기-병합-재작성, roomCandidates/roomReview/hall/anchors 등 키 보존; 이미 퇴장한 행 포함, 계수 기준과 일치); rename = merge 1:1 + 등록부 개명(aliases가 옛 이름을 수용); retire는 어휘표 퇴역만(기존 수량 불변). merge/rename과 반추를 병행하면 서로 덮어쓴다 — 실행 시각을 어긋나게 하라(도구 안내와 ADR-0020 모두 선언함).
- **재작성 안전 3종 세트**: dryRun은 기본 affected+미리보기만 반환하고 영쓰기; 실행 전 매칭 기록을 `rooms-merge-backups/<ts>-<slug>.json`에 자동 백업; 완료 시 자동 `invalidateRooms` + 영향받은 (family, scene)별로 장면 재계산 큐잉(`source='room-merge'`).
- **패널 Room 관리 하위 패널**(고권한 켜면 등장): 등록 폼(slug/이름/설명, 새 RPC `room-register` 거침), 고아 목록 내보내기; 병합/퇴역 제안은 agent 도구로(dryRun 미보기가 더 상세).
- 단말 면 46 → 47(`room-register`).

## [0.20.0-beta.4] — 2026-10-01

> Room 분류 관리 첫 번째 배(**영표류 면**): 등록부가 비면 beta.3과 동작이 글자 그대로 일치. merge/rename/retire 파괴적 면은 beta.5에 따른다(dryRun 기본 true는 한 버전 보존).

### 새로 추가

- **Room 등록부(`rooms-registry.json` 사이드카)**: 미리 기획된 Room을 사전 등록(slug/label/description); 손상/비면 → 순수 자체 성장 디렉터리로 강등 회피, 절대 패널과 주석기를 막지 않음; 상한 200으로 도배 방지. `rooms-get`은 단말 층에서 병합: 등록 항목은 count=0이어도 어휘표에 들고 `source`/`label`을 달고, 응답에 `registry` 전량 필드 신설(클라이언트는 선택 읽기).
- **내보내기 엔드포인트 `dsh-memory/rooms-export`**(kind=rooms|orphans, CSV 직출): rooms = 등록부∪자체 성장 어휘표에 계수 첨부; orphans = Room 바인딩 없는 활성 기록 목록(후보/재검 상태 열 포함).
- **도구 `memory_room_admin`**(action=list|register): list는 등록부+자체 성장 총람; register는 Room 사전 등록(고권한 문, 멱등 보완) — `memory_room_review`의 건별 재검과 조합하면, agent에게 "등록→사전 마킹→건별 확인"의 완결 분류 관리 진입이 생긴다.
- 클라이언트: Room chip에 "사전등록/자체 성장" 출처 표식; 고아 chip에 재검 대기 의미.

## [0.20.0-beta.3] — 2026-10-01

### 새로 추가

- **기록 패널 Room 분류 개선**: ①펼치기/접기(접기 = 헤더 + 앞 8개 고빈도 Room 미리보기, 개폐 상태 영속); ②펼침 상태 전량 페이지네이션(매 페이지 40, ◀▶ 넘김), 종전 "앞 40만 표시"의 경직 절단을 대체; ③**고아 기억 필터** — 선두 "미바인딩 · N" chip으로 Room 바인딩이 전혀 없는 기억만 봄(`list-records`에 `untagged` 필터 경로 신설, `rooms-get`에 `orphanCount` 신설, Room 계수와 같은 기준); ④필터 조건 즉시 가시 + 일괄 해제. 검색 경로에도 같은 고아 필터.

## [0.20.0-beta.2] — 2026-10-01

> dsh-0.2.0-beta 채널 +1: 반추 완전 context 최적화(repo 소프트 울타리/장면 프로젝트별 이전/폐루프). longtask(beta.1 참조)와 같은 패키지, 실머신 피드백 병합 수렴.

### 새로 추가

- **repo 소프트 울타리(ADR-0015, `recall.scopeFence.*`, 기본 끔)**: repoKey=basename(정규화한 cwd)을 쓸 때 계산해 L1 metadata(repo_key_name/repo_key_owner/applicability, DEFAULT는 백필 불요, FTS와 스냅샷 해시에 안 들어감)에 기록; 호출과 memory_search 출구에서 `this-repo`/`cross-project`로 소프트 감중 재정렬(×0.2 조정, **감중만 하고 배제하지 않음**, chat류와 미귀속 기록은 울타리 밖, 중복제거 경로는 센티널로 오입 방지). 영표류: 기본 끔일 때 호출 순서 sha1 대조가 일치.
- **장면 프로젝트별 이전(L2 repo 감지 + 재클러스터)**: L2 통합 prompt에 repoKeyName/applicability를 보이게 해 — this-repo 기록은 더 이상 프로젝트 횡단 장면에 안 들어감; `scene_recluster_jobs` 작업 큐 + ruminate 유휴 단계 소비자(스냅샷 → 요약 투영 삭제 → 실패 시 통째 롤백, 새 LLM 채널 0); repo 귀속 보강 후에는 repoKey로 역조회해 영향 장면을 큐잉 재계산.
- **압축 폐루프**: 꼬리 압축 큐잉 성공 후 10분 디바운스로 반추 한 번 촉발(플러싱→L2→L3→relabel→재클러스터 소비), "압축 기록이 증류 버킷에 고인다"의 끊김을 수정.

## [0.20.0-beta.1] — 2026-10-01

> dsh-0.2.0 라인의 첫 beta 채널 출시(`dsh-0.2.0-beta` tag): 장기 작업 모드 실머신 프리뷰. 아래 내용 외에도, 이번 버전은 종전 `[Unreleased]`에 parked된 모든 main 변경(활성 슬롯/출처 앵커/증거 리더/기억 퇴장 폐루프/3축 충돌 등)을 함께 담는다 — 이미 0.1.7 라인으로 출시됐지만 main 라인에는 대응 버전 번호가 아직 없다.

### 새로 추가

- **장기 작업 모드(`longTask.*`, 기본 끔) — "장시간 세션"의 3종 세트: 컨텍스트 계량, 작업 참조, 꼬리 압축, 그리고 비차단 플로팅 제안 패널 하나.**
  - **컨텍스트 사용량(`store/context-usage.ts`)**: `assistant/message` 공식 `usage`의 입력 측(input + cache 읽기/쓰기)를 감시, **최신값** 의미를 취함(매 라운드 입력 측에 이미 전체 이력이 들어 있으니 누적하지 않음); `compaction/summary` 후 0으로 재계. 순수 메모리 per-session Map — 재시작 후 첫 assistant 메시지로 재건 가능, 영속화하면 만료 샘플만 되살린다.
  - **todo 참조(`store/todo-ref.ts` + `hooks/long-task.ts`)**: 호스트 구조화 `todo/write` 이벤트(전량 스냅샷; 패키지 타입이 0.2.0-rc.1에서 미선언, 플러그인이 declare module로 자체 확장 — §E의 dsh-compaction 선례와 같음)를 감시. **장기 작업 세션에만**: 스냅샷을 pinned `todo` 슬롯 하나에 밀어 넣는다(`SlotStore.refreshByTitle` 관리 갱신 — 같은 주체가 반복 쓰려면 제자리에 갱신해야, ≤8 슬롯 상한 안에 닫힌 슬롯 잔해가 쌓임), slot-recall로 상주 주입 — 압축이 옛 컨텍스트를 밀어낸 뒤에도 작업 북극성은 남는다. 인접 스냅샷간에는 표면 Jaccard 표류 감지(같은 스냅샷 반복 쓰기는 신호를 희석하지 않음); body ≤512 바이트, 절단 시 명시.
  - **꼬리 turn 압축(`longtask-compress-tail` 엔드포인트 + `compressTailTurns`)**: (압축 수위선, 최신 캡처 라운드] 구간의 최근 N 라운드를 즉시 `enqueue(force:true)`로 증류해 기억에 넣는다 — 증류 임계치를 기다리지 않고 꼬리 대화를 곧장 검색 가능 기억으로. 수위선(`SessionModeStore.lastTailCompressedTurn`)은 앞쪽으로만 전진, 반복 누름은 자연 멱등; off 등급은 완전히 투명; 앵커 없는 옛 데이터는 첫 압축(수위선 0)에만 포함 — 덜 거두되 중복 증류는 안 함.
  - **제안 상태(`longtask-hint-get`)+ 플로팅 공(`client/src/longtask-fab.ts`)**: ego-browser식 vanilla overlay(FAB+패널, 드래그/위치 영속/뷰포트 클램핑), **제안은 차단하지 않음** — "컨텍스트 점유가 `contextThresholdPct`에 도달" 또는 "todo 표류가 `driftThreshold`에 도달"하고 장기 작업이 켜지지 않을 때만 숨쉬는 글로우를 점등; 패널 내: 장기 작업 스위치(임시, per-session, **mode 없음** — 스위치 전환이 사용자 단계를 리셋하지 않음), 점유/표류 진행바, 수동 꼬리 압축 버튼(장기 작업 켜야만 사용 가능), 작업 계수. 폴링 바쁠 때 2s / 한가할 때 5s, RPC 실패는 침묵; 시트 계약 불변(settings.section은 정확히 하나, body 싱글턴은 어떤 시트도 차지 않음).
  - **`session-mode-set`의 `mode`가 선택으로 전환**: `longTask`와 2택1 필수 — 순수 장기 작업 스위치 전환만 하면 더 이상 단계를 강제로 안 보낸다(옛 클라이언트는 항시 mode를 전송, 동작 불변). 응답 `mode`는 현재 유효값으로 되돌림.

## [0.19.0] — 2026-09-29

### 변경

- **DSH 0.2.0 대응（compat/0.2.0）**：peerDependencies와 engines.dsh(package.json + dsh.plugin.json)를 `>=0.2.0-rc.1 <0.2.1-0`로 일괄 갱신(단일 범위 치환. 0.1.7 라인은 compat/0.1.7 브랜치가 계속 지원)；dsh-* devDependencies 9건을 0.1.1-rc.2 → 0.2.0-rc.1로 재고정하고 type-only 의존성 `@deepseek-ai/dsh-compaction` 추가. 코드 측면에서 0.2.0 호스트 API 변화 대응：`agent/session-start` 이벤트를 `agent/created`로 통합(serial 계약에 맞춰 리스너를 async화)；Session 이벤트 읽기를 `session.events` → `session.snapshotEvents()`로 변경(호스트가 동기 전량 읽기를 폐기 예정. 폴백 체인 유지)；테스트 스텁 갱신(projection 커서 offset 시맨틱스).
- **릴리스 메타데이터**：버전 0.18.4 → 0.19.0；publishConfig.tag `dsh-0.1.7` → `dsh-0.2.0`；dsh.plugin.json version → `0.19.0-dsh0.2.0.1`.

## [0.18.4] — 2026-09-28

### 추가

- **크래시 복구(§A)**: 호스트가 턴 도중 크래시하면 해당 턴 대화는 메모리 버퍼와 함께 영구 유실되었습니다(resume 시 콜드스타트 보호가 전체 이력을 폐기). 이제 resume 시 호스트의 영속 이벤트 로그와 대조합니다: L0 기록 최대 turn을 워터마크로, 그 이후의 완전한 턴을 최대 2개까지 보수(크래시 고아 턴은 호스트가 `turn/end{reason:'interrupted'}`로 닫습니다 — 실기에서 98건 확인). 멱등성 = 워터마크 + 턴 단위 존재 검사. 호스트 읽기 서비스를 사용할 수 없으면 단계적 축소(`sessionQuery.readSession` → `sessionPersistence.readFrom` → 기존 동작 + 일회성 안내), 항상 fail-open으로 세션 시작을 막지 않습니다.
- **페이로드 마스킹(§C, `capture.redactSecrets`, 기본 활성)**: 캡처 쓰기 경계에서 8종의 시크릿(PEM 개인키 / Authorization 헤더 / Bearer·JWT / Cookie / 벤더 API 키 형태 / 이메일 / 9자리 이상 숫자(날짜 제외) / 고엔트로피 ID)을 `[REDACTED:<KIND>]` 타입 플레이스홀더로 치환 — L0 JSONL·L0 SQLite·증류 입력·수동 `memory_add`/`memory_import`를 단일 지점에서 커버. 안전값(`example` / `$VAR` / `${{…}}` 등)은 제외. 플레이스홀더는 카테고리 의미를 유지해 검색 가능. 주의: 활성화 후 L0 원문은 변경됩니다(재구축으로도 원문 복원 불가). `false`로 평문 복귀.
- **증류 프롬프트 내성 주입(§B)**: 6개 증류 프롬프트 파일(L1 추출 ×3 / L1 중복제거 ×3 / L2 씬 ×2 / L3 페르소나 ×2 / 그래프 투영 / 대조기) 모두에 "콘텐츠 경계(내성 주입)" 선언과 데이터 슬롯 경계를 추가 — 대화 원문·기존 기억 풀·씬 전문 등 임베디드 콘텐츠는 데이터이지 지시가 아닙니다. 판정 어휘와 출력 계약은 불변.

### 개선

- **주입 확인(§D)**: 리콜 주입은 반환 즉시 마크하지 않습니다. "pending → 로그 수신" 2단 방식 — 호스트가 주입 메시지를 실제로 세션 로그에 기록했을 때(`plugin:memory` 서명과 안정 id를 가진 `user/message`) `dedupe.mark` 합니다. 덮어쓰기·취소된 주입은 더 이상 기억을 오억제하지 않고(다음 턴 재주입 가능), 5분 수신 없으면 일반 마크로 축소(확인 경로 장애로 인한 중복제거 무효화 방지), 미확인 만료는 폐기.
- **압축 후 정밀 재주입(§E)**: `compaction/end`(error 없음) 후 해당 세션의 다음 턴에 한 번의 확장 리콜 실행 — 중복제거 억제를 건너뛰고(압축이 기존 주입을 컨텍스트에서 축출), 페르소나 즉시 재주입, 점유 원장 리셋. 사용 시 소비. 기존 compact/clear 전량 리셋은 폴백으로 유지되며 양 경로는 멱등.
- **구조화 트레이스(§F, `trace.*`)**: 리콜과 증류 이벤트를 일별 JSONL로 영속화(`<dataDir>/trace/`, 기본 보존 14일, 일별 5MB 상한에서 정지 + 마커). 리콜 이벤트는 query 지문(기본 metadata-only: 길이 + sha256, `trace.captureContent` 시 원문 ≤200자), 히트/주입 id, 스코어, 소요시간과 4가지 결과를 기록. 증류 이벤트는 runId·6값 결정 집계(`l1_receipts`와 동원으로 교차 감사 가능)·소요시간과 성패. 신규 엔드포인트 `dsh-memory/trace-tail`, 설정 페이지 "로그" 탭에 3개 데이터 소스 전환(시스템 로그 / 리콜 트레이스 / 증류 트레이스).

## [0.18.2] — 2026-09-27

### 수정

- **세션 포맷 v4 서명 대응(호스트 >= 0.1.7-rc.1)**: 기억 recall 주입 2곳(세션 간 recall `hooks/recall.ts`, 슬롯 상시 주입 `hooks/slot-recall.ts`)에서 v4 호스트가 거부하는 구형 서명 `source: { kind: 'plugin', plugin: 'memory', form: 'recall' }` 사용을 중단하고(`SessionFormatError`로 라운드 전체 실패——"기억 호출 시 오류"의 원인) producer-owned 서명 `{ kind: 'plugin:memory', form: 'recall' }`로 변경했습니다. `form`·내용·시점은 불변. 근거: `@deepseek-ai/dsh-session-format-v3-to-v4@0.1.7-rc.2`의 `source()`는 kind가 비어 있지 않고 `'plugin'`이 아닌지만 검증하며 수반 필드는 검증하지 않습니다.
- **읽기 측 이중 형상 호환**: recall 점유율 추정 서명 술어 `isOwnRecallSource`는 신규 서명과 v3 구형 행을 모두 받아들입니다——쓰기 측만 고치면 점유 패널의 "기억 recall 점유율"이 조용히 0이 됩니다. `MessageSourceMap`은 모듈 병합으로 `plugin:memory`를 등록(dsh-llm 0.1.7의 map은 `user|model|tool|'system-prompt'`으로 plugin catch-all 없음, producer별 merge-extensible).
- **tool-result v4 native 대응(N1)**: `store/evidence-source.ts`의取证 텍스트 읽기에 native 분기 추가(v4 일급 `role:'tool'` 메시지: content는 text/reasoning 블록 직접, `isError`는 message 최상위. 호스트 `assertBlock`은 구형 `tool-result` wrapper 블록을 강제 거부). 구형 블록 경로는 역사 호환으로 유지——미대응 시 v4에서取证 텍스트가 조용히 빈 값이 됩니다. `projection/slots.ts`의 isError 가드도 native화.

## [Unreleased]

### 추가

- **출처 앵커(R7) — 이제 기억을 세션 안의 실제 좌표까지 추적할 수 있습니다.** 지금까지 추적 체인은 끊겨 있었습니다: L1은 `source_message_ids`를 가지고 있지만 그것은 **L0 메시지 id**(`msg_<epoch_ms>_<hex>`)이고, L0 테이블에는 `turn`/`step` 컬럼이 없었습니다. 게다가 그 id 목록은 **검색 DB에 전혀 기록되지 않았습니다**(쓰기 측이 `metadata`만 저장하고 해당 필드는 조용히 버려졌습니다). 결과: **어떤 기억도 원문에서 위치를 찾을 수 없었습니다.**
  - `l0_conversations`에 `turn`/`step` 컬럼 추가(멱등 `ALTER TABLE`; 기존 행은 NULL 유지 = 앵커 없음, **추측으로 채우지 않습니다**)와 `(session_id, turn)` 인덱스.
  - 캡처 측에 `step/start` fold 추가: `user/message`는 커널 payload에 `step`이 없으므로 같은 턴의 `step/start`에서 유도합니다. `assistant/message`는 이벤트가 가진 `{turn, step}`을 사용합니다. **첫 `step/start` 이전 메시지는 `step`을 비워 둡니다** — 좌표가 없을 때 좌표를 만들어내지 않는 것이 기본입니다.
  - 앵커는 `metadata_json`의 예약 키 `dsh_source_anchors`에 저장됩니다(UI에는 `t12 s3`). 새 컬럼도, 디스크 계약 변경도 없습니다. **신규 저장 경로와 "병합/업데이트" 경로 모두** 앵커를 가집니다 — 한쪽만 있으면 병합 한 번에 좌표가 사라집니다.
  - 호스트 신규 API `MemoryDb.l0ByAnchor(sessionId, turn, step?)`: **좌표로**(시간순이 아니라) L0 메시지를 가져옵니다. 향후 "증거 리더"의 유일한 진입점입니다.
- **기록 패널이 출처 앵커를 표시**합니다(이전에는 항상 "-"였습니다).

- **기억 퇴장(소프트 삭제)과 정리 왕복: 삭제가 더 이상 데이터 손실이 아닙니다.** 기존의 "삭제"는 **물리 삭제**였고, 실수는 `records/*.jsonl` 사실 원본에서 손으로 건져내는 수밖에 없었습니다. 이제 두 단계이며 **되돌릴 수 있는 쪽이 기본**입니다.
  - **퇴장(소프트 삭제)**: 메인 테이블 행은 유지하고 `valid_to`를 닫은 뒤 대체 마커(`metadata` 예약 키 `dsh_superseded`: 시각 / 사유 / 판정 결과 / 충돌 페어 id)를 기록하고, `l1_fts`와 `l1_vec` 행만 제거합니다. **검색 측 SQL은 한 글자도 바꾸지 않았습니다**(쿼리 드리프트 0). 세 가지 퇴장 경로(판정 패배 / 중복 제거 대체 `update`·`merge` / 수동 삭제)는 **동일한 프리미티브를 공유**합니다.
  - **엔드포인트 33 → 38**: `records-retired` / `records-restore` / `cleanup-retired` / `snapshots-list` / `snapshot-restore`. 세 목록(`contract.ts` 맵 / `stats.ts`의 `MEMORY_ENDPOINTS` 허용 목록 / 디스패처 `case`)과 엔드포인트 총수 단언을 함께 갱신했습니다 — 하나라도 빠지면 해당 엔드포인트는 영구히 404가 되고, 클라이언트 `rpc`의 catch가 조용히 삼켜 패널 블록 전체가 사라집니다.
  - **`memory_delete`의 기본은 1건만 퇴장**(기존 3건)이며, 의미 매칭을 건너뛰는 `ids` **정확 경로**를 추가했습니다. 기존 의미 기반 top-N 일괄 삭제는 실측에서 **무관한 실제 기억 2건을 잘못 삭제**했습니다 — "정확히 지우기"는 유사도가 아니라 정확한 ID로 보장해야 합니다.
  - **물리 정리는 기본이 드라이런**(`dryRun` 생략 = `true`). 명시적으로 실행해도 먼저 **전체 라이브러리 스냅샷**을 쓰고 **내용 해시로 검증**하며, 불일치면 중단하고 한 건도 삭제하지 않습니다. 이를 우회 불가능하게 만들기 위해 `deleteL1Batch`를 **단일 호출자**(`exportThenPurge`)로 수렴시키고 소스 수준 가드 테스트로 고정했습니다.
  - **복귀 경로가 없었습니다.** `restoreL1Snapshot`은 **프로덕션 호출자가 전혀 없어서** "정리 전에 내보내기"가 절반만 성립했습니다(내보내기는 있는데 돌아오는 길이 없음). `snapshots-list` / `snapshot-restore`로 연결했습니다: 스냅샷 **디렉터리 이름만** 받고(경로와 `..`는 거부), 기본은 드라이런이며 `stillRetired`를 정직하게 보고합니다. 이 필드는 필수입니다 — 정리는 **이미 퇴장한** 기록만 지우고 스냅샷은 삭제 **전**에 찍히므로, 되찾을 수 있는 모든 기록에 퇴장 마커가 붙어 있습니다. **메인 테이블로 돌아온 것 ≠ 검색으로 돌아온 것**이며, 이를 말하지 않으면 "복구 완료"로 오해합니다. 완전한 한 번의 롤백은 `unretire: true`(기존 `restore`를 재사용, 새 쓰기 경로 없음)입니다.
  - **패널**: 기록 탭에 "퇴장됨(복구 가능)" 구획을 추가했습니다(기본 접힘, 펼칠 때만 조회). 삭제 확인 문구는 "복구 가능"으로 변경했습니다. **물리 정리는 의도적으로 패널 진입점을 만들지 않습니다** — 되돌릴 수 없는 동작은 RPC / 모델 표면에만 남깁니다.
- **§C 모순 동결: 동일 배치 내 모순도 이제 동결할 수 있습니다("모델이 유일하게 하는 말이 정확히 거부되는" 문제 수정).** 조사 결과 `validateConflictPair`의 세 번째 조건은 "상대방이 후보 풀의 기존 기록일 것"을 요구했지만, **동일 배치에서 생성된 새 기억의 id는 거기에 없습니다**(아직 저장되지 않았기 때문). 즉 가장 전형적인 "기계가 판단할 수 없는" 상황(한 배치의 모순된 두 새 기억)은 모델이 `conflict`를 올바르게 내도 **반드시 페어가 아니라고 판정되어 `store`로 폴백**했습니다. 증거: 모델 층에서는 7/7로 출력되지만 그 단계는 DB에 한 번도 도달하지 않았습니다(`conflict_pending`은 DB 생성 이래 0행, `l1_receipts`의 `conflict`는 `store 381 / merge 204 / update 172 / skip 7` 중 0건). 수정: `validateConflictPair`에 선택적 `batchIds` 추가(생략 = 기존 동작). 단 "정확히 한쪽이 본 기록"은 유지해 페어가 유일하도록 합니다. 또한 큐 만원 가드를 추가해 **패배자가 이번 배치의 새 기억이면 자동 종결하지 않습니다**(방금 추출된 산출물이 아무에게도 알려지지 않고 즉시 퇴장하는 것을 방지) — 단순히 대기시키지 않고 정상 저장합니다.

- **§C 모순 동결이 이제 "삼축 시간"을 이해합니다 — 내용은 모순이지만 시간상 선후가 있는 경우를 더 이상 일괄적으로 사람에게 넘기지 않습니다.** 기억 레코드에는 원래 서로 대체할 수 없는 세 개의 시간축(기록 시각 `createdAt/updatedAt`, 사실 유효 기간 `validFrom/validTo`, 지속성 `persistence`)이 있었지만, 모순 탐지는 기록 시각만 사용했습니다. 탐지기는 `conflict`를 판정할 때 유효 기간과 지속성을 볼 수 없어 "오래된 사실이 새 사실로 대체된" 경우를 사람이 판정할 대상으로 대기시키는 일이 흔했고, 판정 패널도 양쪽 본문만 보여주어 사람이 눈감고 판정해야 했습니다. 이번에 동결의 양 끝에 삼축을 연결했습니다:
  - **탐지 측**: 동결 **개방 시** 통합 후보 풀이 각 기억의 `valid_from_ms` / `valid_to_ms` / `persistence`를 탐지기에 전달하고, `conflict` 동작 조항에 "삼축 보조 판정"을 추가했습니다 — 내용이 모순되면 먼저 유효 기간과 지속성을 비교하고, 한쪽이 만료되었거나 명백히 더 늦으면 `update` / `merge`를 우선합니다. **세 키와 조항 모두 `conflictFreeze`로 게이트됩니다**: 폐쇄 상태의 user prompt는 변경 전과 **바이트 단위로 동일**합니다(아래 "수정" 및 [ADR-0012](./docs/adr/0012-conflict-3axis-advisory-time-axes.md) 참조).
  - **판정 측**: `ConflictPairView`에 선택적 `winner_*` / `loser_*` 삼축 필드를 추가했습니다(하위 호환). 대기 목록과 그 렌더링은 각 쌍에 "유효 기간 시작/종료, 지속성" 비교를 덧붙여 어느 쪽이 더 새로운지, 어느 쪽이 만료되었는지 한눈에 보이게 합니다.
  - 기계는 **여전히 자동 판정하지 않습니다**: 삼축은 보조 사실일 뿐이며 최종 결론은 여전히 사람(또는 안전 밸브의 타임아웃/큐 만원 자동 종결)이 씁니다 — `ConflictResolution` 값은 변하지 않습니다.

### 수정

- **폐쇄 상태 prompt에 삼축 필드가 조용히 추가되어 있었습니다(동결 OFF = 기본 배포에 영향).** 첫 버전은 `valid_from_ms` / `valid_to_ms` / `persistence`를 후보 풀에 **무조건** 주입했지만, 이 LLM 호출은 system prompt에만 스위치를 읽었습니다. 그래서 `conflictFreeze=false`(배포 기본값)에서는 모델이 후보마다 3개의 키를 더 보았고, **이를 설명하는 조항이 전혀 없었습니다** — 토큰이 늘고 입력이 바뀌었습니다. 세 키를 `conflictFreeze`로 게이트하여 폐쇄 상태의 user prompt가 변경 전과 **바이트 단위로 동일**해졌으며, 판정 기준도 "특정 부분 문자열을 포함하지 않음"에서 **sha1 golden 앵커 + 반증 검증**(게이트를 깨면 해당 케이스가 빨간색)으로 상향했습니다.
- **스위치는 분명히 켜져 있는데 패널은 "모순 동결 미개방"이라고 표시했습니다.** `conflicts` / `conflict-resolve` 엔드포인트는 **배포 시점의 정적 설정** `cfg.conflictFreeze.enabled`를 읽었지만, 패널은 **런타임 설정**(live)에 기록했습니다. 배포 기본값은 항상 `false`이므로, 스위치가 켜지고 `settings.yaml`에 `true`가 저장되어도 미개방으로 표시됩니다. `effectiveCfg(cfg, live)` 경로로 변경해 중복 제거 파이프라인과 동일한 해석으로 통일했습니다 — 진실의 원천은 **하나**이며, 읽는 쪽과 쓰는 쪽이 같은 상태를 봐야 합니다.
- **`dsh-memory/embedding-reindex`는 선언되었지만 영구히 404였습니다.** 계약에는 있으나 `MEMORY_ENDPOINTS` 허용 목록과 디스패처 `case` 양쪽에 없었고, `startReindex()`는 **죽은 코드**였습니다(설정의 "벡터 인덱스" 블록에 "시작"이 없고 "취소"만 있던 이유). 허용 목록 + `case` + 테스트를 추가했습니다.
- **`UiRecord.sourceMessageIds`는 죽은 필드였습니다.** `l1_records`에 **존재하지 않는 컬럼**을 읽어 항상 `[]`가 되었고, 패널의 출처 행은 **한 번도 렌더링되지 않았습니다**. 실제 데이터를 읽는 `sourceAnchors`로 교체했습니다.

## [0.12.0] — 2026-09-17

### 추가

- **벡터 인덱스 수동 재구축(`dsh-memory/embedding-reindex` 엔드포인트 + 설정 화면의 "벡터 인덱스" 블록)**. 지금까지 재구축 계기는 시작 시의 `db.init` 변경 감지 체인과, 누락 벡터를 채우는 주기적 backfill 두 가지뿐이었고 **수동 진입점이 없었습니다**. 설정 화면에 보이는 것은 "취소"뿐(그것도 재구축이 실행 중일 때만)이었고, "시작"도, 얼마나 임베딩되었고 얼마나 남았는지도 알 수 없었습니다.
  - **엔드포인트 면 31 → 32**. `EmbeddingReindexStartResponse`(`{accepted:true}`) 신설. **접수 후 즉시 반환하며 진행률은 여기서 반환하지 않습니다** — 클라이언트는 기존대로 `embedding-state-get`의 `reindex` 필드를 폴링합니다. 진행률 어휘가 두 벌이면 언젠가 서로 어긋나므로 의도적으로 하나만 유지합니다. 네 곳(`contract.ts` 매핑 / `MEMORY_ENDPOINTS` 허용 목록 / 디스패처 `case` / 엔드포인트 총수 단언)을 함께 갱신했습니다. **하나라도 빠지면 해당 엔드포인트는 영구 404**가 되고, 클라이언트 `rpc`의 catch가 이를 조용히 삼키므로 패널 전체가 사라집니다.
  - **`EmbeddingStateView`에 `vectors` 추가**: L1 / L0 각각의 `embedded` / `total` / `missing` / `skipped`. "X / Y 임베딩됨"이 여기서 나옵니다. db 계층의 **`-1` 센티넬은 그대로 통과**시킵니다 — "벡터 기능을 쓸 수 없음"과 "하나도 임베딩하지 않음"은 UI에서 서로 다른 문장이어야 하며, 하나의 숫자로 합치면 절대 반응하지 않는 버튼을 사용자에게 계속 누르게 만듭니다.

### 수정

- **"접수했지만 실제로는 돌지 않는" 재구축 요청을 거부**. `L1Store.reindex` / `L0Store.reindex`의 첫 줄은 벡터 기능이 준비되지 않았을 때 **조용히 `0/0/0`으로 단락**됩니다. 진입점에 게이트가 없으면 UI는 "재구축 완료, 미처리 0건"을 표시하지만 실제로는 **한 번도 시작하지 않았습니다**. 이 함정은 `src/index.ts:240`에 이미 주석이 있었으나 시작 체인만을 대상으로 했고, 수동 진입점은 새로운 구멍이었습니다. `startReindex()`는 다섯 개의 게이트를 모두 앞당기고 각각 **행동 가능한** 문구를 부여합니다: 언로드됨 / 재구축 진행 중 / 소스 전환이 잠금 보유 / **임베딩 소스 꺼짐**(`currentInfo` 비어 있음) / **서비스 미준비**. ("먼저 활성화하세요"와 "조금 기다리세요"는 서로 다른 지시이며 하나로 합쳐서는 안 됩니다.) 이를 위해 두 스토어에 `vectorsReady()` 접근자를 추가했습니다 — `helper`가 private이라 외부에서 물어볼 방법이 없었기 때문입니다.
- **`embedding-subsystem.test.ts`의 `db` 스텁이 불완전**. `swapProvider` / `markEmbeddingSynced` 두 개만 가지고 있었고 `as never`로 타입 검사를 우회했기에 누락이 드러나지 않았습니다. `snapshot()`이 벡터 개수를 포함하기 시작하자 즉시 죽습니다(`getVecSkipSet is not a function`). **`vectorCounts`를 방어적으로 만드는 대신 스텁을 보완**했습니다: 타입 시그니처는 완전한 `MemoryDb`를 선언하고 있으며, 누락된 메서드를 삼키는 것은 실제 배선 오류까지 함께 숨기는 일이기 때문입니다.

### 테스트

- 신규 5건: 꺼짐 상태 거부 / 미준비 거부 / 접수 후 L1+L0 구동 및 동시 두 번째 즉시 거부 / 언로드 후 거부 / `snapshot` 개수 기준. **모든 거부 경로에서 "예외를 던진다"와 "하위가 한 번도 호출되지 않는다"를 함께 단언**합니다 — 예외만 단언하면 "먼저 하위를 호출하고 나서 던지는" 구현도 통과합니다.
- **반증**: 준비 가드를 일시적으로 제거하면 `向量能力未就绪 → 拒绝`가 실제로 빨간색이 되고(`expected [Function] to throw an error`), 되돌리면 다시 초록색이 됩니다.
- 전체 **39 파일 / 403 케이스** 통과. `typecheck`(tsconfig 3종), `build`, `smoke` 모두 초록.

## [미출시]

### 추가

- **§E 스토리지 스코프 `scope`(가시 범위, `family`와 직교)**. 지금까지 모든 프로젝트가 하나의 기억 저장소를 공유하여 프로젝트 A에서 증류한 `work` 패밀리 기억이 프로젝트 B 대화에서도 검색되었습니다. 새 `scope` 설정(`global` 기본 / `workspace`)을 추가하고 기존 `family`와 **직교**시킵니다——`family`는 "이것이 어떤 내용인가", `scope`는 "어디까지 보여야 하는가"에 답합니다. "`workspace` 모드에서 `work` 패밀리를 워크스페이스 단위로 격리하고 `chat` 패밀리는 기본적으로 전역 유지"는 **기본값이며 유도 규칙이 아닙니다**(개인 기억은 프로젝트를 넘어야 하고, 오염 면은 프로젝트 사이에 있습니다).
  - **제로 드리프트는 비교가 아니라 구조로 보장**: `cfg.scope`가 `workspace`가 아니면 공용 `scopeFilterOf`가 항상 `undefined`(= 필터 없음)를 반환하므로 어떤 호출 지점도 실수로 워크스페이스 식별자를 넘길 수 없습니다. 기존 배포(키 미지정)의 동작은 **바이트 단위로 동일**합니다.
  - **격리는 패밀리 격리와 같은 층**에 놓입니다: 검색 출구뿐 아니라 **중복 제거 후보 회수**도 필터합니다. 후보 풀이 다음 중복 제거 판단을 결정하므로 여기가 워크스페이스를 넘으면 "프로젝트 B에서는 보이지 않는데 이미 프로젝트 A 기억의 향방을 결정한" 기억이 생겨 격리하지 않는 것보다 나쁩니다([`ADR-0008`](./docs/adr/0008-storage-scope-vs-family.md)). 그래프 경로는 **출처 레코드**의 귀속으로 같은 층에서 필터하고, 쓰기 경로(추출 파이프라인 / `memory_add` / `memory_import`)는 동일한 `resolveRecordScope`를 공유합니다.
  - **워크스페이스 식별자는 canonical cwd를 쓰고 호스트 `dsh-workspace`의 `WorkspaceId`(uuid)는 쓰지 않습니다**: §A의 `parentSession`과 같은 header 경로로 동기 획득되며, `inject`를 선언하면 해당 서비스가 없는 호스트에서 트리 전체 로드가 실패하고, 호스트 자신의 구성원 판정도 "session header의 canonical cwd == workspace path"이며, uuid는 "등록된 워크스페이스"를 요구하므로 미등록 디렉터리에서는 격리가 조용히 무효화됩니다. 알려진 경계: **심볼릭 링크는 해석하지 않습니다**——결과는 과잉 격리(안전한 방향)이며 누출이 아닙니다([`ADR-0009`](./docs/adr/0009-workspace-identity-source.md)).
  - **마이그레이션은 귀속만 표시하고 옮기지도 삭제하지도 않습니다**: `l1_records` / `l1_fts`에 `scope` + `workspace_id`를 추가하고 기존 데이터는 `ALTER` 기본값으로 `global`로 분류됩니다——행 수, id, content, created_time이 바이트 단위로 불변입니다.
  - **실행 중 발견한 실제 결함 2건**: ① FTS 재구축 재주입이 scope를 빠뜨리면 **격리가 조용히 지워집니다**(컬럼 수 불일치가 행별 `catch`에 삼켜져 `count=0`의 빈 인덱스가 됩니다). ② 쓰기 측의 **형태 정규화 누락**으로 "기억은 써졌는데 다시는 검색할 수 없는" 상태가 생깁니다(검색 측은 정규화된 소문자 경로를 넘기고 저장 측은 호출자의 대문자 문자열을 그대로 보관하여 문자열 일치가 반드시 어긋납니다). 둘 다 엔드투엔드 테스트와 변이 프로브가 잡아냈습니다.
- **§F 그래프 노드 벡터 열 `graph_node_vec`(저장과 강등의 토대)**. 그래프는 기존에 어휘 가중 점수만 있어 의미상 동등하지만 자구가 다른 실체("云深处"와 "DeepRobotics")를 상호 해소할 수 없었습니다. `l1_vec`과 **동일 패턴**의 vec0 가상 테이블을 추가하고(동일한 인코딩, 동일한 `float[N] distance_metric=cosine` 선언) 차원은 **기존 능력 탐지 결과를 재사용**하여 두 번째 탐지를 만들지 않습니다.
  - **강등은 내부 `try/catch`에서 소화**: vec0가 없으면 테이블 생성이 예외를 던지고, 그것이 `GraphStore.init`의 바깥 catch에 도달하면 그래프는 "벡터 경로 사용 불가"에서 "**그래프 영역 전체 사용 불가**"로 강등되어 어휘 검색·투영·재정을 끌고 갑니다([`ADR-0011`](./docs/adr/0011-graph-node-vector-storage-and-degradation.md)).
  - **이번 웨이브는 문만 놓았고 생산자와 소비자는 미연결**: 투영 파이프라인은 아직 임베딩을 계산하지 않습니다. 미완료로 기록합니다——§F의 출발점이며 종착점이 아닙니다.

- **§B L1 결정 증거 체인(추적 가능성 기반)**. 모든 L1 레코드는 중복 제거 판단의 **결과**지만, 판단 자체는 흔적을 남기지 않았습니다(결과는 보이지만 무엇에 근거했는지는 보이지 않음). 새 테이블 `l1_receipts`가 판단마다 증거를 남깁니다(`run_id` / `record_id` / `kind` / **후보 풀의 순서 있는 sha256 다이제스트** / `decided_at`). 새 도구 **`memory_receipts`** 와 RPC 엔드포인트 **`dsh-memory/receipts`** 로 레코드 단위·배치 단위 **2차원 소급**이 가능합니다. 증거는 이벤트 **이전**에 존재해야 합니다——입력 스냅샷은 **사후에 채워 넣을 수 없기** 때문입니다([ADR-0006](./docs/adr/0006-l1-decision-receipts.md)).
  - 보존 정책은 **run 수** 기준(`RECEIPTS_MAX_RUNS = 1000`)——시간 창으로는 행 수의 상한을 줄 수 없습니다. 또한 트리밍은 **run 단위이며 행 단위가 아닙니다**(행 단위로 자르면 "반쪽 배치"가 생겨 완전해 보이지만 실제로는 누락된 결론을 내놓습니다——"찾을 수 없음"보다 해롭습니다).
  - 레드라인: 트리밍은 **`l1_receipts`만 건드리고 `l1_records`는 절대 건드리지 않습니다**.
  - 실패 격리: 증거는 측면 인프라이므로 쓰기 실패는 `warn`만 남기고 **L1 증류를 절대 중단하지 않습니다**.

- **§C 모순 동결(선택, 기본 꺼짐)**. 기존 중복 제거 **결정 어휘**는 `store` / `update` / `merge` / `skip`뿐이어서, "충돌 감지기"가 모순을 감지해도 **LLM이 직접 재정해 기록**했고 **"멈추고 사람에게 묻는" 선택지가 없었습니다**. `conflictFreeze.enabled`를 켜면 어휘에 `conflict`가 추가되어, 양쪽 다 맞아 보여 기계가 판단할 수 없을 때 그 쌍을 `conflict_pending`에 **대기**시킵니다——**새 기억은 평소대로 저장되고 양쪽 내용 모두 바뀌지 않습니다**. 재정은 새 도구 **`memory_resolve_conflict`**(RPC: `dsh-memory/conflict-resolve`)로 하며 결론은 `winner` / `loser` / `both`입니다.
  - **동결은 "쓰기를 막는 것"이 아니라 "자동 재정하지 않는 것"**——전자는 정보를 잃어, 해결하려던 문제보다 나빠집니다.
  - **안전밸브**: `maxPending`(큐 상한) / `timeoutDays`(타임아웃 강등). 의미는 "**새것을 받지 않는다**"이지 "오래된 것을 조용히 지운다"가 아닙니다——자동 결착된 쌍도 **큐의 행으로 남고** `resolution = auto`로 사람의 결론과 구분됩니다.
  - **그래프 측**: 동결된 레코드를 소스로 가진 노드는 `disputed`가 됩니다(기존 상태. 검색 후보에는 남으므로 "평소대로 회수되지만 상태가 보이는" 중간 상태). 이 부여는 **파생 동기화**이며 단방향 플래그가 아닙니다——재정은 분쟁을 **취소**하므로, 단방향이면 해결된 노드가 영원히 `disputed`로 남아 **파생 그래프가 사실과 어긋납니다**.
  - **제로 드리프트**: 꺼져 있을 때 중복 제거 프롬프트는 변경 전과 **바이트 단위로 동일**합니다. 이는 **구조적** 보증(꺼진 경로는 base 상수를 그대로 반환)이며 수동 비교가 아닙니다([ADR-0010](./docs/adr/0010-conflict-freeze-default-off-and-timeout.md)).

### 변경

- **새 설정** `conflictFreeze.enabled`(기본 꺼짐) / `conflictFreeze.maxPending`(100) / `conflictFreeze.timeoutDays`(30, `0` = 타임아웃 강등 없음). **새 엔드포인트** `dsh-memory/receipts`와 `dsh-memory/conflict-resolve`(엔드포인트 면 26 → 28).
- **`L1ReceiptKind`에 `conflict` 추가**. 동작 어휘를 확장할 때는 **그 어휘를 소비하는 모든 지점**(증거 정규화·통계 로그·렌더 문구·schema 설명)을 함께 확인해야 합니다——실행 중 실측: 등록 누락이 있으면 "모델이 **명확히** 판단 불가라고 말한" 것이 `skip_missing`(= "모델이 **답하지 않음**")으로 기록되고, §C의 감사 가능성은 **전적으로** 증거 체인에 의존하므로 감사 결론이 사실과 **정반대**가 됩니다.

### 수정

- **미인식 액션이 폴백 분기에 조용히 흡수됨**. `pipeline/l1.ts`의 적용 루프는 `store` / `skip`만 명시 분기하고 **나머지 액션은 모두 update/merge 분기로 떨어집니다**. conflict 판단은 설계상 `target_ids`가 없어 `targets=[]`가 되고, "0건을 교체한" 병합 산물로 추가되어 `version`이 **1**로 계산되었습니다. **오류도 없고 데이터 손실도 없으며 흔적은 version 숫자 하나뿐**——즉 conflict가 조용히 merge/update로 강등되고 있었고, 이는 §C가 바로 제거하려던 동작입니다. **수정**: 명시적 `conflict` 분기를 추가하고, 검증 실패 또는 스위치 꺼짐일 때는 **`store`로 폴백**하며 폴백 분기로는 절대 떨어지지 않습니다.
- **엔드포인트 게이트가 손으로 베낀 목록이었음**. `tests/contract-keys.test.ts`는 실제 등록표를 import하지 않고 복제했기 때문에 두 단언이 복제본 자체와만 일치했습니다. §B가 `receipts`를 추가해 실제 등록표가 27이 되어도 복제본은 26이었고 개수 단언도 `toBe(26)` 그대로여서——**계속 초록**이었습니다. 이번에 `conflict-resolve`를 추가해도 **여전히 초록**이었습니다. **수정**: 로컬 목록이 `MEMORY_ENDPOINTS`와 항목 단위로 일치함을 단언합니다.

## [0.11.0] — 2026-09-13

### 호환성（DSH 플러그인 프레임워크 문서 적합화）

- **settings 등록 크로스 버전 대응（0.1.1-rc.2 ~ 0.1.5-rc.2）**. 기존 `src/settings.ts`는 `@deepseek-ai/dsh-settings`에서 `settingsNamespace()`를 **값 임포트**했는데, v0.1.3+에서는 이 익스포트가 제거되어 새 호스트에서는 모듈 로드 시점에 `Failed to load plugins`이 발생해 플러그인 트리 전체가 함께 깨집니다. 현재는:
  - 네임스페이스는 문자열 리터럴 `'dsh-memory'`（브라우저 측은 원시 문자열만 읽으므로 신구 호스트에서 동등）. 타입 임포트만 남기고（컴파일 시 소거, 로드 리스크 없음）.
  - 등록은 3분기 런타임 분기: 우선 `settings.register()`（모든 대상 버전에 존재, get/watch/update 스코프를 반환하며 라이브 토글과 UI 쓰기가 모두 이를 경유）; 폴백은 `settings.installSection()` 브리지（v0.1.2+ 서비스 표면, `register`이 없을 때만. 런타임 쓰기는 비즈니스 오류로 명시 거부）; 둘 다 없으면 상시 온으로 강등——"settings 장애가 호스트를 꺾지 않는다"는 원칙은 불변.
  - `SettingsScope`는 로컬 구조 타입으로 변경, 패키지 수준 타입 익스포트에 의존하지 않음.
- **`dsh.plugin.json` 추가**（DSH 발견 매니페스트: id / `engines.dsh` `>=0.1.1-rc.2 <0.2.0-0` / components는 `dist/` 산출물 지정）. `dsh-plugin-template` 표준 파일 구조 준수.
- **`@deepseek-ai/dsh-*` peerDependencies를 optional로 전환하고 범위 확대**（`^0.1.1-rc.2 || ^0.1.2-rc.1 || ^0.1.3-rc.1 || ^0.1.5-rc.2`）. `@deepseek-ai/cordis`는 필수 유지——awesome-dsh-plugin 제출 요건 B.3 준수.
- **`screenshots.json` 추가**（`assets/img/` 참조 8장）, 제출 카드에 표시 가능.

### 변경

- `package.json` 버전을 0.11.0으로 상향. npm `files`에 `dsh.plugin.json` 추가（`screenshots.json`은 awesome-dsh-plugin 탐색 규약에 따라 git 리포지토리 전용, npm 패키지에는 미포함）.

### 실측 대기

- v0.1.5-rc.2에서의 `conversation.input.left` / `settings.section` 슬롯과 Session V3의 `session.surface.nodes` 시맨틱스（occupancy 추정）는 미검증. README의 호환성 매트릭스 참조.
