# 쉐이크(Shake) 원본 자료 보관 기록

수집일: 2026-09-27
출처: Internet Archive Wayback Machine (`https://web.archive.org/web/<timestamp>id_/<url>`)
검증: 모든 파일의 SHA-1이 Wayback CDX 인덱스의 digest와 일치함

## wayback/ — 원본 설치 파일

| 파일 | Wayback timestamp | 원래 URL | 크기(byte) | SHA-256 |
|---|---|---|---|---|
| `Shake0311_20020323.exe` | 20020323095625 | `http://download.hanpanthe.net/shakedown/Shake0311.exe` | 24674931 | `a57f3c058d035d5165aee79255c7f4cf28d60cc8d1a70ea8e89754148df9b763` |
| `Shake2nd_20020612.exe` | 20020612224200 | `http://download.hanpanthe.net/shakedown/Shake2nd.exe` | 22171136 | `4ea94ec2a3f0190493d1d24258089caa30729ca860f336924ffd1b3aaae34557` |
| `Shake1_20020212.exe` | 20020212050913 | `http://download.hanpanthe.net/Shake1.exe` | 17645056 | `deecee5eef035185d38614b947d09ab7ef217602992698c0afeb1831cf4777ab` |
| `shake1_mp3_20011003.exe` | 20011003192454 | `http://www.hanpanthe.net/mp3/shake.exe` | 16998400 | `4659285feea0eaac3a1928d63eede1e0486fcdff5aefa48fce76fce4a6652adc` |
| `shakebeta22_20010907.exe` | 20010907115738 | `http://www.hanpanthe.net/mp3/shakebeta22.exe` | 16797696 | `8f825ba9ad262de1637eada5556d71d2e4b71fe7fcebff1cae19d5b953caf3b5` |
| `shakebeta47_20010819.exe` | 20010819002828 | `http://www.hanpanthe.net/mp3/shakebeta47.exe` | 16913920 | `aa58c10d21e1db6715979f9db8afb9c0d1266f755beb39ccb11362907d31a9b4` |
| `shake1_exe_fast_20010915.exe` | 20010915230438 | `http://www.hanpanthe.net/mp3/shake.exe-ver/shake.exe-fast/shake.exe` | 315392 | `849eab03bb6f2cadbf147a09cff2abfc6b11826314c9eaee3b31d89f694e9862` |
| `shake1_exe_fast_20011004.exe` | 20011004152124 | `http://www.hanpanthe.net/mp3/shake.exe-ver/shake.exe-fast/shake.exe` | 327680 | `7ea2aa0b6cd26d97175f24d88e59fac5c665bb46fea201f2d9cd6b8dde3cd112` |
| `shake1_exe_normal_20011104.exe` | 20011104000703 | `http://www.hanpanthe.net/mp3/shake.exe-ver/shake.exe-normal/shake.exe` | 344064 | `b35f749e0eff9b07ecc6ce024dee4bb658a72c269f8b94c27953a306174a03fe` |

제외: `download.hanpanthe.net/win2k_xp_2311.exe`, `win9x_me_2311.exe` — NVIDIA Detonator 23.11 그래픽 드라이버로 게임 자료가 아님.

## extracted/ — 추출 결과

| 폴더 | 원본 | 빌드 날짜(파일 내부) | 결과 |
|---|---|---|---|
| `Shake0311_20020323/files/App_Executables` | `Shake0311_20020323.exe` (InstallShield 6, MS-CAB) | 2002-03-08 | 265개 게임 파일 전부 정상. **쉐이크2 기준 자료로 사용** |
| `Shake2nd_20020612/files` | `Shake2nd_20020612.exe` (InstallShield 5, ZIP SFX) | 2002-02-06 | 내부 `data1.cab` CRC 불일치. 235/236 추출, `doomy.spr` 실패. 이름과 달리 0311보다 **오래된** 빌드 |
| `Shake1_20020212/files` | `Shake1_20020212.exe` (InstallShield 5, ZIP SFX) | — | 214개 파일 전부 정상. 쉐이크1 |

`Shake2nd`와 `Shake0311`의 공통 파일 235개 중 224개는 동일하고 11개가 다름(`shake.exe`, `item.spr`, `new_button2.shk` 등). 크기가 같은데 내용이 다른 파일은 `Shake2nd`의 cab 손상일 가능성이 있으므로 `Shake0311`을 우선한다.

추출 도구: `unshield` 1.5.1, `cabextract` 1.11 (Ubuntu 패키지를 설치하지 않고 로컬로 풀어서 사용).

## 쉐이크2 클라이언트(`Shake0311`)에서 확인한 사항

- 그래픽/입력/사운드: DirectDraw 7(`DirectDrawCreateEx`), DirectInput, DirectSound. 네트워크: Winsock2(TCP)
- 게임 서버 IP 하드코딩: `211.202.3.129`
- 자동 업데이트 서버: `211.202.3.67` (`/update/update.asp?version=%d`) — Wayback에 업데이트 파일은 없음
- 랭킹: `http://%s:8080/ranklist_2.asp`, 회원가입: `www.hanpanthe.net/Regist/Regist_UP_shake2.asp`
- 레지스트리 키: `Software\AOZORA Entertainment\Shake2`
- 파일 형식 (해석기: `tools/shakefmt/`, 상세 구조는 각 모듈 docstring)
  - `.shk`: 매직 `SHAKE V1.0\0` + 16B 헤더(너비, 높이, 픽셀 수 등) + 무압축 RGB565 픽셀(위→아래), 투명색 `F81F`. 69개 모두 해석됨. 맵 배경은 모두 800x600. 헤더 값이 기준이며, 7개 파일(`new_listwindow.shk` 등) 뒤에 붙은 데이터는 예전의 더 큰 이미지 위에 작은 이미지를 덮어쓸 때 파일이 잘리지 않아 남은 찌꺼기임(예: `new_listwindow` 뒷부분은 예전 800x600 창 이미지의 일부). 헤더의 offset 13(`0x0240`), 21 값의 의미는 미해석
  - `.spr`: 이름(21B, EUC-KR) + 너비·높이·픽셀 크기(u32) + BGR 24비트 픽셀(**BMP처럼 아래→위 행 순서**, 행 4바이트 정렬), 투명색 마젠타(`FF00FF`). 프레임 사각형과 기준점은 바로 세운(위→아래) 좌표 기준이다. 처음에는 위→아래로 잘못 해석했으나, 프레임 사각형이 불투명 픽셀과 맞는 방향과 `hurry.spr`("Hurry up!" 글자)로 확인해 바로잡았다(2026-09-27). `.shk`는 위→아래가 맞다. 그 뒤에 애니메이션 표: 애니메이션 수, 애니메이션별 이름(예: `앞으로걷기`, `왼쪽걷기`), 미상 u16(프레임 지연으로 추정), 프레임별 기준점(anchor)과 시트 내 사각형(오른쪽·아래 경계 제외). 기준점은 프레임 왼쪽 위에서 발밑까지의 거리로 추정(점프 프레임에서 포물선을 그리며 프레임 밖으로 나감, exe로는 미확인). 120개 모두 해석됨. `rooster_g.spr`, `tofi_g.spr` 뒤의 데이터는 두 번째 이미지가 아니라 `.shk`와 같은 덮어쓰기 찌꺼기
  - `.map`: 매직 `ver 2.0` + 배경 이름(`<이름>.shk`) + EUC-KR 맵 이름 + 최대 인원(6) + 벽돌 스프라이트 목록 + 화면·플레이 영역(u32×6) + 고정 블록 목록(스프라이트, 칸) + 벽돌 목록(스프라이트, 미상 u16, 칸) + 오브젝트 목록(30B: 칸, 종류 플래그, 편집기 그리기 사각형, `object_b.spr` 애니메이션 번호 등) + 격자 너비·높이 + 칸마다 i16×10(종류 0 빈칸/1 고정/2 벽돌, 벽돌·오브젝트 번호, 나머지는 원시값 보관). 17개 모두 파일 끝까지 해석되고 칸 정보와 목록이 서로 일치한다. 칸은 40x32, 격자 15x15, 플레이 영역은 맵 헤더 값. 시작 위치는 파일에 없다. 오브젝트가 없는 맵은 8개(`bella01`, `block01`, `mizar01`, `snowearth01`, `space01`, `wday01`, `year01`, `year02`)
- 추출 결과: `assets/extracted/` (`python3 -m shakefmt.export`, `tools/`에서 실행). `index.json`에 전체 파일 목록, 크기, 경고 기록
- 빌드 시점 (PE 링크 시각, UTC): `Shake2nd`의 `shake.exe` 2002-02-06, `Shake0311`의 `shake.exe` 2002-02-28, 쉐이크1 `shake.exe` 2002-02-05
- 오프라인 모드는 확인되지 않음. `practice.map`이 있으나 실제 실행으로 확인하지 않았고, 2002-03-28 추가된 2인 플레이도 서버 접속 방식이었음(게임동아 기사)
- 맵: mizar, desert, snowearth, space, bella, block, wday, year 각 01/02 + `practice.map`

## wayback/letsgame/ — 참고 영상 (letsgame 기술 동영상, 2004)

운영이 letsgame(`letsgame.chol.com`)으로 넘어간 뒤 올린 쉐이크2 기술 동영상. 공지 seq=357 "[신규] 쉐이크2 기술동영상 추가 안내"(2004-02-09, Wayback 20040229163922)는 "기존에 제공되고 있는 기술동영상 9개에서 현재 많이 사용하고 있는 기술 7개를 새로 추가"했고 "이중에서 가장 많이 이용되고 있는 0칸계열과 미던계열이 소개"되었다고 알림. 그 무렵의 게임 실행 파일은 남아 있지 않다. 두 영상은 뒤의 판이 던지기 중 행동 키를 읽었다는 근거로 쓴다(`FIDELITY.md` §8, §23). SHA-1은 Wayback CDX digest와 일치함.

| 파일 | Wayback timestamp | 원래 URL | 크기(byte) | SHA-256 |
|---|---|---|---|---|
| `vod_16.zip` (0칸 계열정리, 안의 `vod_16.avi` 2004-02-04, 39670342 byte, SHA-256 `16e45ac7fa68e2bf78c678f98d9f99485811ec2dbd4d23e89f9a427b42e4da34`) | 20060211043346 | `http://file.letsgame.chol.com/LETSGAME/GAME/Shake2/vod_16.zip` | 28015590 | `bff224c981d65d58cb5cb5386399e49844cc7b438c3610bf29edbacdd3c17153` |
| `vod_15.avi` (미던 계열 정리. 20060211042919의 `vod_15.zip` 19066817 byte 안의 `vod_15.avi` 2004-02-04와 같은 파일) | 20060211042751 | `http://file.letsgame.chol.com/LETSGAME/GAME/Shake2/vod_15.avi` | 25754828 | `c5a17b3ae2f6d4545f041e29e1cbb9f870b3beca31df982291979d1aa2c4fbab` |

## 참고 문헌 (배경 정보)

- 경향게임스, "[쉐이크2] 회원 1백60만, 동시접속자수 5만 돌파 서바이벌 게임" (2002-07-02): https://www.khgames.co.kr/news/articleView.html?idxno=4002
- 게임조선, "쉐이크2" (2002-03-23): https://m.gamechosun.co.kr/news/view.php?no=11010
- 게임동아, "'쉐이크 2' 2인 플레이 가능.." (2002-03-27): https://game.donga.com/12862/
- 나무위키, "셰이크": https://namu.wiki/w/%EC%85%B0%EC%9D%B4%ED%81%AC
- 블로그, "온라인 게임 쉐이크 이야기": https://amila.tistory.com/245
- Wayback 보존 사이트: `hanpanthe.net`(약 9,600개 URL), `aozora.co.kr`(약 2,400개 URL). 게임 매뉴얼(`shake.hanpanthe.net/game_manual/`), 캐릭터 갤러리 등 포함
