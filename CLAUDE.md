# NETS 마케팅 운영 — Claude Code 작업 기준

이 폴더는 넷츠(NETS) 1인 마케팅 운영의 작업 공간이다. 업무(TASK), SNS 게시 계획, 행사 일정, 지표를 JSON 데이터로 관리하고, 로컬 대시보드로 본다. 사용자는 Megan(서연교), 넷츠 마케팅 1인 총괄이다. 답변과 문서는 한국어로 쓴다.

## 회사와 시장

- 넷츠: 1998년 설립, 계정·권한·인증(IAM·SSO) 전문 국내 기업. 공식 대외 숫자는 **업력 28년, 고객사 250+, 프로젝트 480+** (인력 수는 쓰지 않는다. 155명/180+ 불일치 미해결).
- 한 줄 포지셔닝: "제로트러스트는 계정·권한·인증에서 시작한다 — 28년간 그 시작점을 만들어온 넷츠."
- 범위는 **국내 시장만**. 글로벌·영문 콘텐츠는 하지 않는다.
- 제품: NETS*Identity Manager(IAM), NETS*Single Sign On(SSO), NETS*PASS(패스워드리스), NETS*SaaS Manager, NETS*EntraLinker, NETS*Document Protection Manager(NDPM), O365M(M365 라이선스 관리). **SNS 제품 홍보는 IAM·SSO만**. 나머지는 소프트웨이브 부스 게시물에서만 언급.
- 제품명 표기는 `NETS*제품명` (별표 포함).

## 이번 분기 일정 (2026 Q4)

| 항목 | 날짜 | 비고 |
|---|---|---|
| 고객 세미나 | **11/24(화)** | 자체 주최 **초청형**. 문서마다 날짜가 달랐음(11/19 가정, 11/26) → `data/config.json`의 events 한 곳만 기준으로 삼는다 |
| 소프트웨이브 2026 | 12/2(수)~12/4(금) | 대한민국 소프트웨어대전. 12/1 설치 |
| 행사 제작물 공동 마감 | 11/13(금) | 세미나·전시 사이가 4영업일뿐이라 함께 확정 |
| 2027 마케팅 계획 보고 | 12/23 | ST-2 |

세미나 날짜가 바뀌면: `config.json` events 수정 → `tasks.json`에서 `parent: "EV-1"` 마일스톤 날짜를 같은 일수만큼 이동 → `posts.json`의 세미나 게시물(p06, p09, p11, p12) 날짜와 문구 확인.

## SNS 운영 규칙 (바꾸려면 Megan 확인)

- 채널: LinkedIn, Facebook 회사 페이지. 인스타그램·유튜브·블로그는 2027 Q1 홈페이지 개편 이후.
- **주 2회 화·목 09:00**, 행사 주간만 +1건. 10/20~12/31 총 23건.
- 제작·승인 요청 마감: 화요일 게시물은 직전 금요일, 목요일 게시물은 그 주 월요일 (승인 대기 24시간 확보).
- 같은 콘텐츠를 **LinkedIn 버전 먼저 완성 → Facebook으로 줄이고 풀어 쓰기**. 이미지는 1080×1350 공용.
- 이벤트 홍보는 행사마다 사전·사후 위주 (현장 1건 포함).
- 수치 KPI 목표는 아직 정하지 않는다. 첫 12주는 게시 이행률 + 기준값 기록 + 행사 경유 수만 본다.
- 고객사 실명 게시물(p05, p10, p17)은 **게시 14일 전까지 공개 동의**가 없으면 같은 날 인사이트 게시물로 대체.
- '국내 IAM 1위'는 근거 확인 전까지 쓰지 않는다 (표시광고법). 대신 "250개 고객사가 선택한".
- 공포 마케팅(대형 유출 사고 나열) 금지. 담당자가 겪는 장면(퇴사자 계정, 감사 자료, 라이선스 누수)으로 말한다.
- 상세: `docs/01-content-strategy.md`, 톤·문장 규칙: `docs/02-writing-guide.md`

## 폴더 구조

```
CLAUDE.md            이 파일 (작업 기준)
README.md            윈도우에서 처음 실행하는 방법
start.bat            대시보드 실행 (더블클릭)
server.js            로컬 서버. data/*.json 읽기·쓰기, 저장 시 data/.backup/에 백업
dashboard/           화면 (index.html, style.css, app.js, xlsx.js = Excel·CSV 생성)
data/
  config.json        행사 일정, 필러, 상태값, 영역, 담당, UTM 규칙
  posts.json         SNS 게시 계획 23건 (상태·성과 포함)
  tasks.json         Q4 업무 18개 + 행사 마일스톤 + 확인·결정 사항
  metrics.json       주간 기록 (팔로워, 행사 경유 수)
  budget.json        연도별 예산(2026 행사·2027 예산안): 항목별 계획·실집행·업체·지급일, 승인액, 예비비 비율
docs/                전략·가이드·계획 문서
drafts/              게시물 초안 (p01.md …)
reports/             주간·월간 보고
sources/             회사소개서·제품소개서 등 원천 자료 (직접 넣음)
.claude/commands/    자주 쓰는 작업 명령 (/weekly-plan 등)
```

## 데이터 규칙 (JSON을 고칠 때 반드시 지킬 것)

- JSON은 UTF-8, 2칸 들여쓰기. 고친 뒤 `node -e "JSON.parse(require('fs').readFileSync('data/tasks.json','utf8'))"`로 문법을 확인한다.
- 날짜는 `YYYY-MM-DD`. 요일 계산은 직접 하지 말고 스크립트로 확인한다.
- 기존 항목의 `id`는 바꾸지 않는다. 새 ID 규칙:
  - 상위 업무: 영역 약어 + 번호 (`EV-4`, `SE-2`) 또는 `T-01`부터
  - 행사 마일스톤: `상위ID-번호` (`EV-1-15`)
  - 확인·결정: `D-15`부터
  - 게시물: `p24`부터
  - 예산 항목: `B-11`부터
- 값은 `config.json`에 정의된 것만 쓴다: 게시 상태(`postStatuses`), 업무 상태(`taskStatuses`), 영역(`areas`), 담당(`owners`), 필러(`pillars`).
- 사용자가 대시보드에서 바꾼 상태·메모·성과 수치를 덮어쓰지 않는다. 파일 전체를 다시 생성하지 말고 필요한 항목만 수정한다.
- 대시보드가 켜져 있어도 파일을 고쳐도 된다. 화면은 새로고침(또는 창 전환) 시 다시 읽는다. 대시보드는 저장할 때 파일 버전을 확인하므로, 밖에서 고친 파일을 덮어쓰지 않고 다시 불러온 뒤 다시 입력하라고 안내한다.

### tasks.json 항목 형태

```json
{
  "id": "EV-1-03", "kind": "업무 | 마일스톤 | 확인",
  "title": "…", "area": "행사", "priority": "P0", "owner": "Marketing",
  "start": "2026-10-08", "due": "2026-10-23", "status": "대기",
  "parent": "EV-1", "event": "seminar",
  "deliverable": "…", "doneWhen": "…", "deps": ["ST-1"], "posts": ["p06"],
  "steps": [{"text": "…", "done": false}], "note": ""
}
```
`parent`, `event`, `deliverable`, `doneWhen`, `deps`, `posts`, `steps`는 필요할 때만 넣는다.
- 상위 업무의 세부 할 일은 `steps`(체크리스트)가 아니라 **하위 항목**(`parent`가 있는 `kind: "마일스톤"`, ID `상위ID-번호`)으로 넣는다 — 대시보드 표에 줄로 보이게 (2026-10-13 Megan). 날짜를 모르면 `start`·`due`는 `null`로 두고 지어내지 않는다. `steps`는 하위 항목 안의 작은 단계에만 쓴다.
- `doneAt`: 완료한 날 (`YYYY-MM-DD`). **status를 `완료`로 바꿀 때 반드시 함께 기록**하고, 완료를 풀면 지운다. 대시보드 「보고서」의 활동 내역·기간별 집계가 이 값을 쓴다 (없으면 마감일로 대신 계산).
- `order`: 업무 표에서 끌어서(하위는 ↑↓로도) 정한 순서. 상위 업무는 같은 영역끼리, 하위 항목(마일스톤)은 같은 상위 안에서 10, 20, … 하위 항목은 **날짜로 자동 정렬하지 않고 이 순서를 따른다** (Megan이 직접 정함). 새 항목을 넣을 때는 형제 중 가장 큰 `order` + 10으로 넣는다 (빼면 맨 아래에 마감순으로 붙음). 기존 항목의 `order`는 바꾸지 않는다.

### posts.json 항목 형태

`id, no, date, time, phase, pillar, topic, format, cta, liHook, fbHook, source, approval, status, draft, li{on,done,url,impr,eng,clicks}, fb{on,done,url,reach,eng,clicks}, note` (+ 동의 필요 시 `fallback`).
- 채널별(LinkedIn `li` · Facebook `fb`): `on` 이 채널에 올리는지(기본 true), `done` 게시 완료, `url` 게시 링크. 쓰는 채널이 모두 `done`이면 `status`는 `게시완료`, 하나라도 아니면 `게시완료`가 아니다 — 둘을 함께 맞춘다.

### budget.json 형태

연도별: `{ updated, currency, years: [{ year, label, task, approved, approvedAt, reserveRate, groups[{id,label}], items[] }] }`. 현재 2026(Q4 행사 예산, `task: "BG-1"`)과 2027(마케팅 예산안, `task: "BG-2"`). 항목은 `{ id, group, title, plan, actual, vendor, paidAt, note }` (+ 필요 시 `tasks: ["EV-2"]` 연결 업무). 항목 ID는 연도와 상관없이 전체에서 하나씩 (`B-11`부터). 금액은 원 단위 정수, 모르면 `null` (지어내지 않는다). `group`은 그 연도 `groups`의 id. 예비비 = 계획 합계 × `reserveRate`, 항목별 초과 집행(계획 없는 항목은 실집행 전액)이 예비비에서 빠진다.

## 우선순위 원칙

- P0: 안 하면 행사가 실패하거나 2027 계획을 못 세우는 일. P1: 행사 품질·2027 출발점에 직접 영향. P2: 여유 있을 때만, 11/13까지 밀리면 1월로 이월.
- 가용 시간이 P0·P1로 이미 찼다. **새 업무를 추가할 때는 빼거나 미룰 업무를 함께 제안**한다.
- 2027로 이월한 업무와 보류한 업무는 `docs/03-q4-plan.md` B·C 표에 있다. 새 요청이 그 목록에 있으면 그 사실을 먼저 알린다.

## 작업 방식

- 게시물 초안: `/draft-post p07` → `drafts/p07.md`에 LinkedIn·Facebook 두 버전. 포스트 공식은 **현업 장면 → 왜 생기나 → 넷츠의 방식 → 숫자·사례 → 한 가지 행동**.
- 숫자·고객사명·제품 기능은 `sources/` 자료나 `docs/`에 있는 것만 쓴다. 근거를 못 찾으면 `[확인 필요]`로 남기고 지어내지 않는다.
- 문장: 짧고 직접적으로. "~합니다" 체. 이모지는 LinkedIn 0개, Facebook 1개 이하.
- 결정이 생기면 `docs/decisions.md`에 날짜와 함께 한 줄 남긴다.
- 대시보드 코드를 고칠 때는 외부 패키지 없이 유지한다 (Node 기본 모듈 + 브라우저 기본 기능). 디자인 토큰은 `dashboard/style.css` 맨 위 `:root`에 있다.

## 아직 정해지지 않은 것 (답이 나오면 이 목록과 데이터를 같이 고친다)

- 세미나 장소·연사·참가 문의 폼 URL (D-09)
- 소프트웨이브 부스 번호, 데모 시나리오 (D-13)
- 고객사 공개 동의: SK하이닉스(p05), KB국민은행(p10), Win-back 고객(p17) (D-07)
- 리드 저장소: SFDC 사용 가능 여부 (LD-1)
- 소프트프릭 인수 소식의 대외 사용 여부 (D-14)
