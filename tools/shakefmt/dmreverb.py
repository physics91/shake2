"""Measure the DirectMusic synthesizer's reverb on this machine's dmsynth.dll.

Usage: python -m shakefmt.dmreverb [--dls GM_DLS] [OUT]

Runs `tools/dmsynth/capture.py` on Windows Python (from WSL through `py.exe`, or set
SHAKE2_WINDOWS_PYTHON) to play one-sample impulses through the default port, muted, with
the reverb off and on. The instrument is a one-region, unlooped `gm.dls` instrument whose
wave is replaced by the impulse; the synthesizer refuses hand-built collections
(DMUS_E_INVALIDOFFSET), so the chunks are cut from `gm.dls` as they are. The temporary
collection is deleted afterwards.

The synthesizer is bit-exact from the note on, and its fixed-point floor (a near-DC residue of a
few LSB) does not grow with the input, so the response is solved from a loud capture minus a
quiet one: hard-left and hard-right pairs give the four paths (left/right in to left/right out)
frequency by frequency. The dry gain is the quiet dry pulse over the reverb-off one. The
response is cut where its tail sinks into the measurement noise. A centre-panned pair, not used
in the solve, checks the result. The response is measured from the user's Windows install and
stays local, like gm.dls.
"""

import argparse
import json
import os
import shlex
import struct
import subprocess
import tempfile
from pathlib import Path

import numpy as np

from shakefmt.bgm import default_dls
from shakefmt.dls import decode_dls
from shakefmt.export import REPO_ROOT
from shakefmt.reverb import Reverb, apply_reverb, save_reverb

RATE = 22050
HARNESS = REPO_ROOT / "tools/dmsynth/capture.py"
DEFAULT_OUT = REPO_ROOT / "assets/extracted/dmsynth/reverb.npz"
IMPULSE_AT = 8
RESPONSE_SECONDS = 2.0
PANS = (0, 127, 64)  # hard left and right solve the four paths; the centre checks them
# The reverb takes the mix before the output clips: four hard-panned pulses (47640) still come out
# of it in proportion, eight saturate it near twice full scale. The loud capture stays below that.
REVERB_HEADROOM = 48000


def _chunks(data: bytes, start: int, end: int):
    pos = start
    while pos + 8 <= end:
        size = struct.unpack_from("<I", data, pos + 4)[0]
        yield data[pos:pos + 4], pos, pos + 8 + size + (size & 1)
        pos += 8 + size + (size & 1)


def _riff(tag: bytes, payload: bytes) -> bytes:
    return tag + struct.pack("<I", len(payload)) + payload + (b"\0" if len(payload) & 1 else b"")


def impulse_collection(gm: bytes) -> tuple[bytes, int, int]:
    """A one-instrument DLS cut from `gm`: the first bank-0 melodic instrument with one unlooped
    region, its wave silenced but for one full-scale sample. Returns (dls, program, unity note)."""
    col = decode_dls(gm)
    for index, ins in enumerate(col.instruments):
        if ins.drums or ins.bank != 0 or len(ins.regions) != 1:
            continue
        sample = col.sample_for(ins.regions[0])
        if sample.loop is None:
            break
    else:
        raise ValueError("no one-region unlooped melodic instrument")
    wave_index = ins.regions[0].wave_index

    top = {(tag, gm[pos + 8:pos + 12] if tag == b"LIST" else b""): (pos, end) for tag, pos, end in _chunks(gm, 12, len(gm))}
    lins, wvpl, ptbl = top[(b"LIST", b"lins")], top[(b"LIST", b"wvpl")], top[(b"ptbl", b"")]
    ins_pos, ins_end = [(p, e) for _, p, e in _chunks(gm, lins[0] + 12, lins[1])][index]
    blob = bytearray(gm[ins_pos:ins_end])
    at = blob.find(b"wlnk")
    while at >= 0:
        struct.pack_into("<I", blob, at + 16, 0)  # ulTableIndex: the only wave
        at = blob.find(b"wlnk", at + 4)
    cb, _ = struct.unpack_from("<II", gm, ptbl[0] + 8)
    offset = struct.unpack_from("<I", gm, ptbl[0] + 8 + cb + 4 * wave_index)[0]
    wave_pos = wvpl[0] + 12 + offset
    wave = bytearray(gm[wave_pos:wave_pos + 8 + struct.unpack_from("<I", gm, wave_pos + 4)[0]])
    data = wave.find(b"data")
    size = struct.unpack_from("<I", wave, data + 4)[0]
    wave[data + 8:data + 8 + size] = bytes(size)
    struct.pack_into("<h", wave, data + 8 + 2 * IMPULSE_AT, 32767)

    body = (b"DLS " + _riff(b"colh", struct.pack("<I", 1)) + _riff(b"LIST", b"lins" + bytes(blob))
            + _riff(b"ptbl", struct.pack("<III", 8, 1, 0)) + _riff(b"LIST", b"wvpl" + bytes(wave)))
    return _riff(b"RIFF", body), ins.program, sample.unity_note


def solve_response(dry_left: np.ndarray, wet_left: np.ndarray, dry_right: np.ndarray, wet_right: np.ndarray,
                   taps: int) -> np.ndarray:
    """The [taps, out, in] response from two captures with different left/right input mixes."""
    size = len(dry_left)
    x = np.stack([np.fft.rfft(dry_left, axis=0), np.fft.rfft(dry_right, axis=0)], axis=-1)  # [f, in, run]
    w = np.stack([np.fft.rfft(wet_left, axis=0), np.fft.rfft(wet_right, axis=0)], axis=-1)  # [f, out, run]
    h = np.fft.irfft(w @ np.linalg.inv(x), size, axis=0)
    return h[:taps]


def clean_response(h: np.ndarray, rate: int, floor_from: float, block: float = 0.01) -> np.ndarray:
    """Cut the response after the last block that carries more tail than noise, the noise being the
    mean power after `floor_from` s, and fade that block out. Past it the measurement adds more noise
    than reverb."""
    step = int(block * rate)
    power = (h[: len(h) // step * step] ** 2).reshape(-1, step, 4).mean(axis=(1, 2))
    noise = power[int(floor_from / block):].mean()
    loud = np.flatnonzero(power > 2 * noise)
    end = min(len(h), (int(loud[-1]) + 2) * step) if len(loud) else step
    cut = h[:end].copy()
    cut[-step:] *= (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, step)))[:, None, None]
    return cut


def _windows_path(path: Path) -> str:
    if os.name == "nt":
        return str(path)
    return subprocess.run(["wslpath", "-w", str(path)], check=True, capture_output=True, text=True).stdout.strip()


def _capture(workdir: Path, name: str, job: dict) -> tuple[np.ndarray, dict]:
    python = shlex.split(os.environ.get("SHAKE2_WINDOWS_PYTHON", "py.exe -3"))
    (workdir / f"{name}.json").write_text(json.dumps(job))
    run = subprocess.run([*python, _windows_path(HARNESS), _windows_path(workdir / f"{name}.json"),
                          _windows_path(workdir / f"{name}.raw")], check=True, capture_output=True, text=True)
    audio = np.fromfile(workdir / f"{name}.raw", "<i2").reshape(-1, 2).astype(np.float64)
    return audio, json.loads(run.stdout.strip().splitlines()[-1])


def _impulse_job(dls: str, program: int, unity: int, pan: int, voices: int, effects: int) -> dict:
    events = []
    for ch in range(voices):
        events += [[0.0, 0xC0 | ch | program << 8], [0.0, 0xB0 | ch | 7 << 8 | 127 << 16],
                   [0.0, 0xB0 | ch | 11 << 8 | 127 << 16], [0.0, 0xB0 | ch | 10 << 8 | pan << 16],
                   [0.2, 0x90 | ch | unity << 8 | 127 << 16], [0.3, 0x80 | ch | unity << 8]]
    return {"effects": effects, "seconds": 8, "tail": RESPONSE_SECONDS + 1, "patches": [program], "events": events,
            "dls": dls}


def _from_onset(audio: np.ndarray, length: int) -> np.ndarray:
    onset = int(np.flatnonzero(np.abs(audio).max(axis=1) > 0)[0])
    out = np.zeros((length, 2))
    part = audio[onset:onset + length]
    out[:len(part)] = part
    return out


def _average(workdir: Path, name: str, job: dict, repeats: int, length: int) -> tuple[np.ndarray, dict]:
    runs, port = [], {}
    for k in range(repeats):
        audio, port = _capture(workdir, f"{name}_{k}", job)
        runs.append(_from_onset(audio, length))
    return np.mean(runs, axis=0), port


def measure(gm_path: Path, workdir: Path, repeats: int = 4) -> tuple[Reverb, dict]:
    """Per pan: the dry pulse (reverb off, one voice) and reverb-on captures with one voice and with
    as many voices as the headroom allows. The fixed-point floor does not grow with the input, so
    the loud capture minus the quiet one is the response to the difference of their inputs."""
    blob, program, unity = impulse_collection(gm_path.read_bytes())
    dls_file = workdir / "impulse.dls"
    dls_file.write_bytes(blob)
    dls = _windows_path(dls_file)
    length = 1 << 16
    runs, port = {}, {}
    try:
        for pan in PANS:
            pulse = _from_onset(_capture(workdir, f"p{pan}_off", _impulse_job(dls, program, unity, pan, 1, 0))[0], length)
            pulse[4:] = 0.0  # the dry note is the impulse through linear interpolation: a sample or two
            voices = int(min(9, max(2, REVERB_HEADROOM // np.abs(pulse).max())))  # channel 10 is the drums
            quiet, port = _average(workdir, f"p{pan}_q", _impulse_job(dls, program, unity, pan, 1, 1), repeats, length)
            loud, _ = _average(workdir, f"p{pan}_l", _impulse_job(dls, program, unity, pan, voices, 1), repeats, length)
            runs[pan] = (pulse, voices, quiet, loud)
    finally:
        dls_file.unlink(missing_ok=True)

    ratios = []
    for pulse, _, quiet, _ in runs.values():
        taps = np.abs(pulse) > 500
        ratios += (quiet[taps] / pulse[taps]).tolist()
    dry_gain = float(np.median(ratios))
    dx = {pan: (voices - 1) * pulse for pan, (pulse, voices, _, _) in runs.items()}
    dw = {}
    for pan, (pulse, _, quiet, loud) in runs.items():
        dw[pan] = loud - quiet - dry_gain * dx[pan]
        dw[pan][np.abs(pulse).max(axis=1) > 0] = 0.0  # the loud dry sample clips; the dry gain holds it
    h = solve_response(dx[0], dw[0], dx[127], dw[127], int(RESPONSE_SECONDS * RATE))
    h = clean_response(h, RATE, floor_from=1.4)

    check = apply_reverb(dx[64], Reverb(0.0, h, RATE))[: len(h)]
    error = dw[64][: len(h)] - check
    early = int(0.3 * RATE)

    def in_proportion(pulse, voices, quiet, loud):
        """The loud wet over the quiet one per voice, while the tail is well above the floor."""
        wet_quiet, wet_loud = (quiet - dry_gain * pulse)[:early], (loud - dry_gain * voices * pulse)[:early]
        wet_quiet[0] = wet_loud[0] = 0.0
        return float((wet_loud * wet_quiet).sum() / (wet_quiet ** 2).sum() / voices)
    report = {
        "port": port,
        "instrument": {"program": program, "unity_note": unity},
        "voices": {pan: runs[pan][1] for pan in PANS},
        "dry_gain": round(dry_gain, 5),
        "dry_gain_header": round(float(np.sqrt(1 - 10 ** (-10 / 10))), 5),
        "response_seconds": round(len(h) / RATE, 3),
        "first_echo_ms": [round(float(np.flatnonzero(np.abs(h[:, side]).max(axis=1) > np.abs(h).max() * 0.05)[0])
                                / RATE * 1000, 2) for side in (0, 1)],
        "response_sum": np.round(h.sum(axis=0), 4).tolist(),
        "loud_over_quiet_wet_per_voice": {pan: round(in_proportion(*runs[pan]), 4) for pan in PANS},
        "centre_error_db": round(float(10 * np.log10((error ** 2).sum() / (dw[64][: len(h)] ** 2).sum())), 2),
        "centre_error_db_first_300ms": round(float(10 * np.log10((error[:early] ** 2).sum()
                                                                 / (dw[64][:early] ** 2).sum())), 2),
        "centre_error_rms_lsb": round(float(np.sqrt((error ** 2).mean())), 2),
    }
    note = "dmsynth.dll default port reverb, measured locally; do not redistribute. " + json.dumps(report)
    return Reverb(dry_gain=dry_gain, response=h, rate=RATE, note=note), report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("out", nargs="?", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--dls", type=Path, default=default_dls())
    parser.add_argument("--repeats", type=int, default=4)
    args = parser.parse_args(argv)
    if args.dls is None or not args.dls.is_file():
        parser.error("gm.dls not found; pass --dls or set SHAKE2_GM_DLS")
    with tempfile.TemporaryDirectory() as work:
        reverb, report = measure(args.dls, Path(work), args.repeats)
    save_reverb(args.out, reverb)
    print(json.dumps(report, indent=2))
    print(f"saved {args.out}")


if __name__ == "__main__":
    main()
