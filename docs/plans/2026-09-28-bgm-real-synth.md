<!-- regular-plan-v1 -->
# 쉐이크2 복원: 배경음을 실제 DirectMusic 합성기와 곡 단위로 대조

## Goal

복원판 렌더러(`tools/shakefmt/synth.py`)가 원본이 쓰던 DirectMusic 재생 경로와 같은 소리를 내는지 곡 단위로 확인한다. 다르면 근거가 있는 부분만 고친다. FIDELITY §2.1의 V*(공개 샘플 기준)와 I(채널 우선순위·없는 뱅크)를 이 PC의 실제 합성기로 정리한다.

## Scope

근거(원본 `0x43f850`–`0x43fd37`):

| 호출 | 내용 |
|---|---|
| 시작 | `CoCreateInstance(Performance, IID v1)` → `Init(NULL, NULL, NULL)`(vtable 3) → `AddPort(NULL)`(24) → 로더 생성 |
| 곡 읽기(`0x43fa00`) | 현재 폴더 + `\sound` 또는 `\bgm`을 `SetSearchDirectory(GUID_DirectMusicAllTypes, …, FALSE)`(5) → `GetObject`(3): 크기 `0x350`, 유효 `0x12`(CLASS·FILENAME), `CLSID_DirectMusicSegment`, `IID_IDirectMusicSegment` |
| 곡 설정 | 곡마다 `SetParam(GUID_StandardMIDIFile, 0xFFFFFFFF, 0, 0, perf)`(19), `SetParam(GUID_Download, …, perf)`, `SetRepeats`(6): 대기곡 10000, 셋째 곡 100, 게임 곡 10 |
| 재생 | `PlaySegment(seg, 0, 0, &state)`(4), 정지 `Stop(seg, 0, 0, 0)`(5), `IsPlaying`(14), 끝 `Stop(0,0,0,0)` → `CloseDown`(38) |

`GUID_StandardMIDIFile`은 헤더에서 `GUID_IgnoreBankSelectForGM`과 같은 값이다. 곡 16개의 프로그램 변경은 모두 bank select가 0이 아니다(MSB 5/LSB 87 등).

범위:
- 이 PC의 32비트 DirectMusic(`SysWOW64`의 `dmime`·`dmband`·`dmloader`·`dmsynth`)으로 위 호출을 그대로 하는 하네스를 만든다. 64비트에는 `dmime.dll`이 없다.
- 포트는 원본이 만든 기본 포트를 그대로 쓰되, DirectSound 버퍼만 음량 최소(−10000) 버퍼로 바꿔 소리를 내지 않고 받는다.
- 채널 우선순위(`GetChannelPriority`)와 bank select 처리(같은 음을 bank select 유무로 비교)를 먼저 잰다.
- 짧은 곡(`tbwait22.mid`, `tbwait11.mid`)과 게임 곡 하나를 리버브 없이 받아 복원판의 float 렌더와 비교한다(정렬 → 끝 정렬 확인 → 100 ms 창별 dB 차이·스펙트럼 차이 → 차이 큰 창의 이벤트).
- 차이의 원인이 확인되면 `synth.py`를 고치고 다시 비교한다.

범위 밖:
- 2002년 당시 런타임(DirectX 8.1)과 이 PC의 동일성: 확인할 방법이 없어 I로 남는다.
- 새 의존성: 없음. 하네스(`tools/dmsynth/segment32.cs`)는 Windows에 들어 있는 .NET Framework `csc.exe`(x86)로 빌드한다(앞 단계 32비트 프로브와 같은 방법). 파이프라인은 하네스를 부르지 않는다.

보안·저작권:
- 하네스는 로컬 COM·DirectSound만 쓰고 네트워크를 쓰지 않는다. 소리는 음량 최소 버퍼로만 나간다.
- 캡처한 오디오와 비교 자료는 스크래치에만 둔다(재배포 금지, `gm.dls`와 같은 취급).

## Steps

- [x] 1. 32비트 하네스(`tools/dmsynth/segment32.cs`): 원본 호출 순서 + 포트 버퍼 교체 + 우선순위·세그먼트 길이·포트 정보 출력
- [x] 2. 판별 실험: 채널 우선순위 16개, bank select 유무(선율·드럼 킷), 대기곡 선행 로드
- [x] 3. 곡 비교: `tbwait22`(리버브 끔, 1회 반복 포함), mission to mizar(원본 설정, 리버브 켬) ↔ `render()`
- [x] 4. 근거가 있는 차이만 반영(`bgm.py`, `midi.py`, `synth.py`, `dls.py` 설명) + 테스트, 16곡 다시 렌더·동기화
- [x] 5. FIDELITY §2·§2.1, README, 이 계획, 검증

## Results

- **원본 호출**:
  - 곡 설정 `SetParam`(vtable 19)은 `GUID_StandardMIDIFile`(`0x467120`, 헤더에서 `GUID_IgnoreBankSelectForGM`과 같은 값)과 `GUID_Download`(`0x467130`)로, 두 번째 인자는 perf다.
  - `SetRepeats`는 TBWAIT11·TBWAIT22에 10000, TB19에 100을 준다.
  - 시작 때 읽은 세 곡은 끝날 때(`0x43fb50`)까지 놓지 않는다.
- **판별 실험**(32비트 재생 경로, 음량 최소):
  - 채널 우선순위: `0x80000000` + {1–9번 14…6, 10번 15, 11–16번 5…0}으로 복원판 표와 같다.
  - bank select: 무시된다. `gm.dls`에 있는 뱅크(MSB 1, 프로그램 38)도 bank 0과 같은 소리가 나며, 차이는 실행마다 생기는 차이(최대 약 100 LSB) 안이다.
  - 드럼 킷 1: 혼자 재생하면 무음이다. 대기곡 3개를 먼저 읽으면 킷 0과 비트 단위로 같다.
- **출력 레벨**: 실제 합성기는 복원판의 2배다.
  - 64비트 포트 하네스로 벨로시티 20–127, CC7 20–127, CC11 64, 팬 0–127의 12조합이 모두 +5.92–6.06 dB로, 곡선은 같고 배율만 다르다.
  - 드럼 정상부는 원본 샘플 × 0.5620과 −70.7 dB까지 같다.
  - `VOICE_GAIN` 4095/8192를 1.0으로 바꿨다.
- **공격**: 공격 0인 음도 22샘플에 걸쳐 4샘플마다 2/11씩 오른다. 1.119 ms 공격은 그대로이므로 규칙은 max(공격, 1 ms)다. 드럼 첫 6 ms 오차가 −20.6에서 −34.0 dB로 줄었다.
- **피치**: floor(4096·2^x) 센트·반음 표와 12비트 소수를 쓴다. 한 음 5개의 첫 0.3초 오차가 실수 계산의 −9 ~ −27 dB에서 −32 ~ −37 dB로 줄었다. 두 표는 공개 샘플 표와 모두 같다.
- **반복 주기**:
  - 세그먼트 길이는 마지막 이벤트가 든 마디의 끝이다(16곡 `GetLength`).
  - `tbwait22`를 1회 반복해 받으니 둘째 회차가 28.657초 뒤에 시작했다(마지막 이벤트는 28.545초).
  - `loop_end`를 여기에 맞췄다. 4곡은 약 1.4–1.6초 쉬고 다시 시작한다.
- **첫 재생**: 첫 재생에서만 0틱 음이 10–20 ms 늦는다(실행마다 다름). 반복 회차에는 없어 재현하지 않았다.
- **768 PPQ 양자화**: `tbwait22`에서 효과가 없었다. 틱이 모두 768 단위로 나누어떨어져 모델에 넣지 않았다.
- **곡 단위**(1/3옥타브, 100 ms):
  - 고치기 전 복원판은 모든 대역에서 6.1–6.3 dB 작았다.
  - 고친 뒤 `tbwait22`(리버브 끔)는 중앙값 0.24 dB, 90% 1.92 dB, 평균 +0.30 dB다. 배율만 고쳤을 때는 중앙값 0.30 dB였다.
  - mission to mizar(원본 설정, 리버브 켬)는 중앙값 0.33 dB, 90% 1.25 dB, 평균 +0.08 dB이고, 가장 큰 구간 8개는 ±0.24 dB다.
  - 잘린 샘플은 캡처 19,676개, 렌더 17,888개다.
- **리버브 입력 포화**: 제 크기 믹스의 최고는 +6.3 dBFS이고 2배를 넘는 샘플은 3개뿐이라 넣지 않았다.
- **렌더와 브라우저**:
  - 16곡을 다시 렌더했다. 게임 곡은 모두 잘린다(26–17,888샘플). `tbwait11`은 9샘플이 잘리고 `tbwait22`는 잘리지 않는다.
  - `sync-assets`를 돌린 뒤 Chromium에서 `tbwait11.ogg`(65.60초)가 로드되고, 둘째 회차가 정확히 61.935초 뒤에 예약된다.
  - 확인 방법: `AudioBufferSourceNode.start`를 가로챘다. 테스트 프로필의 음악 설정은 잠시 켰다가 되돌렸다.
- **검증**: `pytest` 105개 통과, `tsc` 오류 0, `vitest` 584개 통과(47파일), `vite build` 성공.

## Residual risks

- **2002년 런타임**: 모든 실측은 Windows 11 26200의 `dmime`·`dmsynth`로 했다. 2002년 DirectX 8.1 런타임과 같다는 것은 추론(I)이다.
- **제어 주기(R)**: 합성기는 음량·피치를 최대 50 ms 간격의 점 사이에서 직선으로 옮긴다. 이를 재현하지 않아, LFO·디케이가 걸린 1초 창의 한 음 오차는 −17 ~ −29 dB다. 파형 단위 일치는 1초 창 상관 0.65–0.82에 그친다.
- **Vorbis 넘침**: 잘린 믹스를 Vorbis로 부호화하면 디코드 값이 1을 조금 넘는다(`tbwait11` 1.057). Web Audio 출력단에서 다시 잘린다. 파일이 로컬 전용이라 무손실 형식으로 바꾸면 없앨 수 있는, 남은 렌더링 차이다(이번에는 바꾸지 않음).
- **실행마다 다른 캡처**: 같은 입력도 최대 약 100 LSB 다르다. 대조 수치는 캡처 한 번 기준이다.
