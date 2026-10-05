# Shake2 · 쉐이크2 복원판

2002년 아오조라 엔터테인먼트(AOZORA)의 **쉐이크2**를 브라우저에서 다시 플레이할 수 있도록 복원하는 프로젝트입니다. `Shake0311_20020323`의 실행 파일과 데이터를 분석해 게임 규칙, 화면 배치, 입력, 소리를 TypeScript와 Canvas로 옮깁니다.

**원본 게임 파일과 추출한 에셋은 이 저장소에 포함되지 않습니다.** 실행하려면 원본 자료를 별도로 준비하고 아래 추출 과정을 거쳐야 합니다. 저장소를 클론하는 것만으로는 게임 화면이 나오지 않습니다.

- [구현된 기능](#구현된-기능)
- [실행 준비](#실행-준비)
- [플레이](#플레이)
- [실행 중 막히면](#실행-중-막히면)
- [개발과 검증](#개발과-검증)
- [복원 범위와 라이선스](#복원-범위와-라이선스)

## 구현된 기능

- 로고 → 로딩 → 로그인 → 내 정보 → 서버 목록 → 로비로 이어지는 원본 화면과 페이드. 메뉴와 대기실도 게임 캔버스에 그립니다.
- 원본 캐릭터 20명, 대전 맵 16개, 폭탄·특수 아이템·맵 오브젝트와 서든데스.
- 혼자 연습, AI 대전, 한 키보드로 하는 2인 대전, 최대 6명이 참여하는 온라인 대전.
- 온라인 계정, 채널·방·팀 선택, 비밀방, 채팅·귓말, 친구 목록과 랭킹.
- 30 Hz 고정 틱으로 진행하는 게임 규칙. 온라인에서는 WebSocket 서버가 경기를 진행하고 클라이언트에 상태를 보냅니다.

복원한 동작과 남은 추정은 [원본 재현도 기록](original/FIDELITY.md)에 구분해 두었습니다. AI 대전과 한 키보드 2인 대전은 복원판에서 추가한 기능입니다.

## 실행 준비

### 필요한 것

- **Node.js 24 이상**과 npm. 서버는 TypeScript 파일을 Node.js로 직접 실행합니다.
- **Python 3**와 pip·venv. 아래 절차는 Python 3.12에서 확인했습니다. 필요한 패키지는 [tools/requirements.txt](tools/requirements.txt)에 있습니다.
- 압축을 해제한 **Shake0311** 게임 파일과 **Shake1**의 내 정보·옵션 화면 그림.
- 설치 파일을 직접 풀 경우 **cabextract**와 **unshield**.
- Canvas와 Web Audio를 지원하는 데스크톱 브라우저, 키보드와 마우스.

아래 명령은 Linux/WSL의 Bash 기준이며, 처음에는 저장소 루트에서 실행합니다.

```bash
git clone https://github.com/physics91/shake2.git
cd shake2

# Python 가상환경은 저장소 바깥에 만듭니다.
python3 -m venv ../shake2-venv
source ../shake2-venv/bin/activate
python -m pip install -r tools/requirements.txt

npm --prefix game ci
```

### 원본 파일 배치

설치 파일의 압축을 해제한 뒤 다음 경로에 배치합니다. 설치 프로그램 `.exe`를 넣는 것만으로는 부족하며, `App_Executables/`에는 게임 데이터 전체가 있어야 합니다.

```text
original/extracted/
├── Shake0311_20020323/
│   └── files/App_Executables/
│       ├── image/
│       ├── spr_data/
│       ├── map_data/
│       ├── sound/
│       ├── bgm/
│       ├── guild.dat
│       └── …
└── Shake1_20020212/
    └── files/Data/image/
        ├── status.shk
        └── option.shk
```

기준 설치 파일의 이름·해시와 추출에 사용한 도구(`cabextract`, `unshield`)는 [원본 자료 보관 기록](original/MANIFEST.md)에 있습니다. `shakefmt.export`는 이미 압축을 해제한 게임 데이터를 변환하는 도구이며, 설치 파일을 내려받거나 풀지는 않습니다.

설치 파일부터 시작한다면 직접 준비한 `Shake0311_20020323.exe`와 `Shake1_20020212.exe`를 `original/wayback/`에 넣고, 저장소 루트에서 다음 명령을 실행합니다. `cabextract` 1.11과 `unshield` 1.5.1로 확인한 절차입니다.

```bash
# Shake0311: 바깥 CAB를 푼 뒤 Disk1의 InstallShield CAB를 풉니다.
cabextract -d original/extracted/Shake0311_20020323/_installer original/wayback/Shake0311_20020323.exe
unshield -d original/extracted/Shake0311_20020323/files x original/extracted/Shake0311_20020323/_installer/Disk1/data1.cab

# Shake1: 바깥 ZIP을 푼 뒤 InstallShield CAB를 풉니다.
python -m zipfile -e original/wayback/Shake1_20020212.exe original/extracted/Shake1_20020212/_installer
unshield -d original/extracted/Shake1_20020212/files x original/extracted/Shake1_20020212/_installer/data1.cab
```

0311판에는 내 정보·옵션 화면 코드에 대응하는 그림이 없어 Shake1의 `status.shk`와 `option.shk`를 함께 사용합니다. 두 파일도 기본 추출 과정에 필요합니다.

### 에셋 변환

가상환경을 활성화한 상태에서 실행합니다.

```bash
cd tools
python -m shakefmt.export
cd ../game
npm run sync-assets
```

첫 명령은 원본 그림·스프라이트·맵을 `assets/extracted/`의 PNG와 JSON으로 변환합니다. `sync-assets`는 변환 결과와 원본 효과음·길드 데이터를 `game/public/assets/`로 복사하고 `manifest.json`을 만듭니다.

배경음과 원본 비트맵 글꼴은 선택 사항입니다. 배경음은 원본 MIDI와 Windows의 `gm.dls`, `ffmpeg`로 렌더링하고, 글꼴은 Windows의 `gulim.ttc`에서 추출합니다. 생략하면 배경음 없이 브라우저 글꼴로 실행됩니다. 리버브 측정을 포함한 선택 단계는 [게임 실행 문서](game/README.md#준비)를 참고하세요.

## 플레이

에셋을 준비한 뒤 `game/`에서 개발 서버를 실행합니다.

```bash
npm run dev
```

브라우저에서 **http://localhost:5173**을 엽니다. 첫 화면은 원본 로고이며, 로딩을 거쳐 로그인 화면으로 이어집니다.

### 게임 서버와 로그인

개발 서버를 켜 둔 채 새 터미널의 저장소 루트에서 실행합니다.

```bash
cd game
npm run server
```

게임 서버의 기본 주소는 `127.0.0.1:8787`입니다. Vite가 브라우저의 `/ws` 요청을 이 서버로 전달합니다. 서버를 켠 뒤 페이지를 새로고침하고 다음 순서로 내 정보 화면에 들어갑니다.

1. **NEW ID**를 열고 아이디·닉네임·비밀번호·비밀번호 확인을 입력합니다. 실명·주민등록번호·지역·이메일 칸은 사용하지 않습니다.
2. **동의함**을 선택하고 **가입하기**를 누른 뒤 완료 알림을 닫습니다.
3. 로그인 화면에 아이디·비밀번호를 넣고 **OK**를 누릅니다.

현재 시작 화면에서는 서버 연결 실패 메시지가 뜨면 로그인 화면의 OK로 넘어갈 수 없습니다. 연습·AI·2인 모드를 시작할 때도 위의 서버 실행·로그인 절차를 먼저 진행하세요. 내 정보에서 **Go game**으로 서버 목록을 열면 공지창의 **X** 또는 **Esc**로 공지를 닫은 뒤 원하는 줄을 선택합니다.

계정과 친구 목록은 기본적으로 `game/data/`에 저장됩니다. 서버 재시작 후에는 다시 로그인해야 합니다. 채널 설정, LAN 접속, TLS와 프록시 구성은 [게임 실행 문서](game/README.md#실행)에 정리되어 있습니다. 인터넷에 서버를 열 때는 해당 문서의 HTTPS/WSS 설정을 함께 확인하세요.

### 혼자 연습 · AI · 2인 대전

이 세 모드의 경기는 브라우저에서 진행합니다. 위의 로그인 절차로 내 정보 화면에 들어간 뒤 다음과 같이 선택합니다.

| 모드 | 들어가는 방법 |
|---|---|
| 혼자 연습 | 내 정보 → **Practice** |
| AI 대전 | 내 정보에서 캐릭터 선택 → **Go game** → **AI 대전** 줄 두 번 클릭 → 대기실에서 **START** |
| 한 키보드 2인 대전 | **Go game** → 서버 목록 마지막 쪽의 **2인 대전** 줄 두 번 클릭 → **START** |

AI 대전은 1P와 두나 AI가 먼저 3승을 겨룹니다. 대기실에서 맵과 음악을 고를 수 있으며, 로컬 경기 결과는 온라인 전적에 반영되지 않습니다.

### 온라인 대전

내 정보 → **Go game** → 채널 줄 두 번 클릭 → 로비의 **CREATE GAME**으로 방 만들기 또는 방 목록에서 입장 순서로 진행합니다. 참가자들이 같은 서버와 채널에 접속하면 최대 6명이 함께 플레이할 수 있습니다.

대기실에서 방장이 맵·음악·게임 방식을 고르고, 팀전이면 각자 팀을 선택합니다. **방장을 제외한 참가자는 START를 눌러 준비 완료로 바꿉니다.** 최소 2명이 있고 참가자 모두가 준비하면 방장이 **START**로 경기를 시작할 수 있습니다.

### 기본 조작

| 동작 | 연습·AI·온라인 | 2인 모드 1P | 2인 모드 2P |
|---|---|---|---|
| 이동 | 방향키 | W / A / S / D | 방향키 |
| 폭탄 | Space | Space | Enter |
| 공격용 아이템 | 왼쪽 Ctrl | Q | 오른쪽 Ctrl |
| 회피용 아이템 | Z | E | 쉼표(,) |

공격용 키는 직격탄·시한폭탄 기폭 등에, 회피용 키는 점프·땅굴·순간이동 등에 사용합니다. 해당 아이템을 획득해야 사용할 수 있습니다. 일반 조작의 폭탄·공격용·회피용 키와 게임패드는 게임 안의 옵션에서 바꿀 수 있습니다. F1은 도움말이며, 연습·AI·온라인 경기에서 Enter는 채팅입니다.

## 실행 중 막히면

| 증상 | 확인할 것 |
|---|---|
| 에셋을 불러오지 못했다는 안내만 나옴 | 원본 파일 경로와 `shakefmt.export`의 오류 수를 확인한 뒤 `npm run sync-assets`를 실행합니다. `game/public/assets/manifest.json`이 있어야 합니다. |
| `인증서버 접속 실패`가 반복됨 | `game/`에서 `npm run server`가 실행 중인지 확인하고 페이지를 새로고침합니다. 기본 포트는 8787입니다. |
| 배경음이 없거나 글꼴이 원본과 다름 | 배경음·비트맵 글꼴은 별도 추출하는 선택 항목입니다. [선택 단계](game/README.md#준비)를 확인하세요. |
| 다시 추출한 에셋이 개발 화면에 반영되지 않음 | `sync-assets`로 폴더를 교체한 뒤에는 개발 서버도 다시 시작합니다. |

## 개발과 검증

게임 관련 명령은 `game/`에서 실행합니다.

| 명령 | 용도 |
|---|---|
| `npm run dev` | Vite 개발 서버 |
| `npm run server` | 온라인 게임 서버 |
| `npm test -- --maxWorkers=2` | 전체 Vitest 테스트, 병렬 실행 수 2개 |
| `npm run typecheck` | TypeScript 형식 검사 |
| `npm run build` | `game/dist/`에 빌드 |
| `npm run preview` | 빌드 결과 로컬 확인, 기본 http://localhost:4173. 로그인·온라인 기능에는 게임 서버도 필요 |
| `npm run sync-assets` | 추출한 에셋을 게임에 반영 |

`npm test`에는 실제 추출 파일을 읽는 테스트가 있으므로 에셋 변환과 `sync-assets`를 먼저 마쳐야 합니다. `npm run build`가 성공해도 원본 에셋이 준비되지 않았다면 게임은 실행되지 않습니다.

`npm test`만 실행하면 Vitest의 기본 병렬 설정을 사용합니다. AI 전체 경기 테스트에는 20초 제한이 있어 실행 부하에 따라 시간 초과가 날 수 있습니다. 위 명령은 전체 테스트를 유지하면서 병렬 실행 수를 줄이며, 새 환경에서 이 방식으로 검사를 통과했습니다.

Python 추출 도구의 테스트는 가상환경을 활성화하고 `tools/`에서 실행합니다.

```bash
python -m pytest
```

Python 테스트 중 원본 파일·Windows 글꼴·`ffmpeg`가 필요한 항목은 해당 자료나 도구가 없으면 건너뜁니다. 검사 결과의 통과 수와 함께 건너뛴 항목도 확인하세요.

에셋 뷰어는 개발 서버의 **http://localhost:5173/#/viewer**에서 직접 엽니다.

### 저장소 구조

```text
game/
├── src/client/          # Canvas 화면, 입력, 오디오, 메뉴와 로비
├── src/server/          # 계정, 채널, 방, WebSocket 서버
├── src/sim/             # 클라이언트·서버가 공유하는 게임 규칙과 AI
├── scripts/             # 에셋 동기화, AI 비교 도구
└── README.md            # 상세 실행·서버 설정·복원 범위
tools/
├── shakefmt/            # SHK·SPR·MAP 해석, 음악·글꼴 추출
└── tests/               # 추출 도구 테스트
original/
├── MANIFEST.md          # 원본 자료의 출처와 해시
└── FIDELITY.md          # 원본 분석 근거와 재현도 기록
```

### 기여하기

- 게임 동작을 바꿀 때는 재현할 수 있는 맵·모드·입력과 원본 근거를 함께 남겨 주세요. 관련 테스트와 형식 검사를 실행해 변경을 확인합니다.
- [재현도 기록](original/FIDELITY.md)의 **V**는 원본 코드·데이터로 확인한 사실, **I**는 추론, **R**은 재구성을 뜻합니다. 새로 복원한 동작이나 복원판 고유 기능도 이 구분에 따라 기록합니다.
- 게임의 보이는 화면은 원본 그림과 좌표를 사용한 캔버스 화면으로 유지합니다. 원본 파일, 추출 결과, 계정 데이터는 커밋에 포함하지 마세요.

## 복원 범위와 라이선스

원본과의 완전한 일치를 선언하는 프로젝트는 아닙니다. 원본의 P2P 통신을 서버가 경기를 진행하는 방식으로 바꿨으며, 내 정보 화면의 다른 빌드 그림 사용, AI와 로컬 2인 대전 등은 재구성한 부분입니다. 상점은 구현하지 않았습니다. 세부 차이와 확인 범위는 [FIDELITY.md](original/FIDELITY.md)에 기록합니다.

현재 저장소에는 별도의 `LICENSE` 파일이 없습니다. 원본 게임의 그래픽·효과음·음악과 Windows의 음원·글꼴 데이터는 이 프로젝트가 작성한 코드와 별개의 자료입니다. 기존 보관 방침에 따라 개인 보존·연구용으로만 사용하고 원본 파일이나 추출·렌더링 결과를 재배포하지 마세요. `original/extracted/`, `assets/`, `game/public/assets/`, `game/data/` 등은 Git에서 제외되어 있습니다.
