<!-- regular-plan-v1 -->
# 쉐이크2 복원: 2~4단계

## Goal

원본 쉐이크2(2002-03 빌드) 에셋을 사용해 브라우저에서 동작하는 재구현을 만든다.
1단계(`.shk`/`.spr` 해석, `assets/extracted/`)는 완료됨.

## Scope

- 2단계: `.map` 해석기 + 맵 JSON/미리보기 PNG, 스프라이트·애니메이션 뷰어(웹 앱 골격 안)
- 3단계: 1인 연습 모드 — 이동, 기본 폭탄, 화염, 벽돌 파괴, 아이템 3종(폭탄+, 화력+, 속도+), 사망, 라운드 종료. 오브젝트 없는 맵 8개(`bella01`, `block01`, `mizar01`, `snowearth01`, `space01`, `wday01`, `year01`, `year02`)
- 4단계: 한 키보드 2인 대전 → WebSocket 서버 권위 방식 온라인 대전(방 생성/참가, 준비, 시작, 최대 6인, 메달 3개 선취, 라운드 2분 30초)

범위 밖: 점프대·워프·제너레이터 등 맵 오브젝트, 아이템 40종·폭탄 10종 전체, MIDI BGM(브라우저 기본 재생 불가), 회원/랭킹/길드/상점, 원본 프로토콜 호환.

## Approach

- 스택: TypeScript + Vite + Canvas 2D + vitest. 서버는 Node 24의 TS 타입 제거 실행(빌드 단계 없음) + `ws`(MIT, Node 내장 WebSocket은 클라이언트 전용). 화면 검증은 캐시된 Playwright chromium.
- 구조: `game/src/sim/`(DOM 없는 순수·결정적·고정 틱·입력 구동 시뮬레이션), `game/src/client/`(Canvas, 입력, 사운드), `game/src/server/`. 4단계 서버는 `sim`을 그대로 권위 로직으로 재사용.
- 에셋: `game/scripts/sync-assets.mjs`가 `assets/extracted/`와 원본 WAV에서 필요한 파일만 `game/public/assets/`로 복사하고 manifest 생성.
- 복원이 아닌 재구성 값(코드와 보고에 명시):
  - 게임 상수(이동 속도, 폭탄 시간, 화염 지속, 아이템 확률) — `game/src/sim/constants.ts`에 모음
  - 애니메이션 `unknown_u16` = 초당 프레임 수로 가정
  - 시작 위치: 맵 파일에 없음 → 빈 칸 구역(네 모서리 + 위/아래 중앙)에서 선택
  - 조작: 혼자·온라인은 방향키/WASD + Space/Z, 한 키보드 2인은 1P WASD + Space(왼쪽 Shift), 2P 방향키 + Enter(오른쪽 Shift)
  - 폭탄 색(슬롯 순서), 이벤트별 효과음 선택, `w-doomy` 초상화(`doomy_p` 사용)
- 맵 렌더링: 배경 `.shk` → 고정 블록(스프라이트 `고정` 프레임) → 벽돌 → 오브젝트. 칸 40x32, 플레이 영역 좌상단은 맵 헤더 값.

## Steps

1. `tools/shakefmt/map.py` + 테스트(먼저 작성), export에 맵 JSON/미리보기 추가, 17개 맵 검증
2. `game/` 골격(Vite/TS/vitest), 에셋 동기화 스크립트, 스프라이트·애니메이션·맵 뷰어 페이지
3. `sim`: 격자, 이동/충돌, 폭탄, 화염 전파, 벽돌 파괴, 아이템, 사망, 라운드 판정 (vitest)
4. 클라이언트: 렌더러, 입력, 효과음, 연습 모드 화면
5. 한 키보드 2인 대전, 라운드·메달
6. `server`: 방/준비/시작, 입력 수신 → sim 틱 → 상태 방송; 클라이언트 온라인 모드
7. 최종 검증과 문서 갱신

## Verification

- Python: `cd tools && python3 -m pytest`
- 게임: `cd game && npx vitest run && npx tsc --noEmit && npx vite build`
- 화면: Playwright로 실제 페이지 스크린샷(뷰어, 연습 모드, 2인, 온라인)
- 온라인 수용 기준: 브라우저 클라이언트 2개가 서버를 통해 한 라운드를 끝까지 진행

## Result (2026-09-27)

- 1~4단계 완료. 온라인 수용 기준 통과: 브라우저 컨텍스트 2개가 `npm run server` + Vite `/ws` 프록시를 거쳐 1라운드를 끝까지 진행(양쪽 모두 round-over, 승자 메달 1, 2라운드 카운트다운 진입).
- 1단계 수정: `.spr` 픽셀 행이 아래→위(BMP 순서)였음. 해석기·테스트를 고치고 `assets/extracted/`를 다시 추출함. 이전 결과의 캐릭터·폭탄·화염·아이템 PNG는 상하가 뒤집혀 있었음.
- 검증: `tools` pytest 42개, `game` vitest 76개(실제 WebSocket 서버 통합 테스트 포함), `tsc --noEmit`, `vite build`, `vite preview` + `/ws` 프록시 연결, Playwright 스크린샷(뷰어, 연습, 2인, 온라인).
