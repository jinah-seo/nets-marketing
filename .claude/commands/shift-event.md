---
description: 행사 날짜 변경 시 관련 일정 일괄 이동
argument-hint: "<seminar|softwave> <새 시작일 YYYY-MM-DD>"
---
행사 날짜를 바꿔줘: $ARGUMENTS

1. `data/config.json`의 events에서 해당 행사의 현재 날짜를 확인하고, 이동 일수를 계산한다 (스크립트로 계산).
2. 바꿀 목록을 먼저 보여 주고 확인을 받는다:
   - config의 events start/end
   - `data/tasks.json`에서 `event`가 같은 마일스톤의 due (단, 행사 전 준비 마일스톤 중 이미 지난 것과 '11/13 제작물 공동 마감'처럼 고정된 날짜는 그대로 두고 따로 표시)
   - `data/posts.json`에서 해당 행사 게시물(세미나: p06, p09, p11, p12 / 소프트웨이브: p13, p15, p16)의 날짜·주제·첫 문장 속 날짜 표기. 게시일은 화·목 리듬을 유지하는 가장 가까운 날로 제안
   - CLAUDE.md의 일정 표
3. 확인을 받으면 수정하고, `docs/decisions.md`에 한 줄 기록한다.
