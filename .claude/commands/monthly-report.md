---
description: 월간 마케팅 보고 초안 (KP-1)
argument-hint: "<YYYY-MM>"
---
$ARGUMENTS 월간 마케팅 보고 초안을 만들어줘. 대표 보고용 1페이지 분량.

데이터: `data/tasks.json`, `data/posts.json`, `data/metrics.json`, `data/config.json`, `docs/decisions.md`.

구성:
1. 한 줄 요약
2. 이번 달 완료한 업무 (P0·P1 위주, ID 포함)
3. 행사 준비 상태 (마일스톤 완료율, 다음 마일스톤, 리스크)
4. SNS: 게시 이행률, 게시 건수, 필러별 평균 참여율(입력된 것만), 팔로워 추이, 행사 경유 수
5. 결정이 필요한 사항 (미완료 확인·결정 항목 중 마감 임박·초과)
6. 다음 달 계획 (P0 먼저)

숫자는 데이터에서 계산한 것만 쓰고, 계산은 스크립트로 한다. `reports/<YYYY-MM>-monthly.md`로 저장한다.
