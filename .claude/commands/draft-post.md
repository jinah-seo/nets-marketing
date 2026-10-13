---
description: SNS 게시물 초안 작성 (LinkedIn + Facebook)
argument-hint: "<게시물 ID, 예: p07>"
---
게시물 $ARGUMENTS 의 초안을 써줘.

1. `data/posts.json`에서 해당 게시물을 찾는다 (주제, 포맷, CTA, liHook, fbHook, source, approval).
2. `docs/02-writing-guide.md`의 포스트 공식·채널 차이·문장 규칙을 따른다. `docs/01-content-strategy.md` 2장 근거 표도 본다.
3. `source`에 적힌 자료가 `sources/`에 있으면 읽고 숫자·사례를 거기서만 가져온다. 자료가 없거나 근거를 못 찾은 숫자는 `[확인 필요]`로 남긴다. 지어내지 않는다.
4. `approval`이 true이고 `note`에 동의 확인 기록이 없으면 고객사명을 익명으로 쓴다 ('국내 반도체 기업' 등).
5. CTA 링크는 UTM 형식으로: `?utm_source=linkedin&utm_medium=social&utm_campaign=2026q4&utm_content=<ID>` (Facebook은 source=facebook). 도착 URL이 정해지지 않았으면 `[링크]`로 둔다.
6. 결과를 `drafts/<ID>.md`에 가이드의 「초안 파일 형식」대로 저장한다. 파일이 이미 있으면 덮어쓰지 말고 `drafts/<ID>-v2.md`로 저장한다.
7. `data/posts.json`에서 그 게시물의 status가 `기획`이면 `제작중`으로 바꾼다 (다른 필드는 건드리지 않는다).
8. 마지막에 확인이 필요한 사항만 짧게 알려 준다.
