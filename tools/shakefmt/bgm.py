"""Render the Shake2 MIDI music with a DLS collection to lossless FLAC.

Usage: python -m shakefmt.bgm [--dls GM_DLS] [SRC] [DST]

shake.exe plays these files through DirectMusic's default port, the Microsoft
Software Synthesizer with the Windows `gm.dls` collection, so rendering with that
file reproduces the original instruments (see shakefmt.synth). `gm.dls` is
Microsoft/Roland data: it is read from the local Windows install and neither it
nor the rendered audio may be redistributed.

Level: on this PC's dmsynth.dll a voice at unity reaches full scale, twice the
Mix16 >> 13 of the published sample (+5.92..+6.06 dB over velocity, CC7, CC11 and
pan, played through shake.exe's DirectMusic calls), mixed with no master gain and
clipped at 16 bits, so the loud tracks clip as the original did; no normalization.

Format: the synthesizer hands DirectSound 16-bit stereo at 22050 Hz, and the files keep
exactly that (FLAC, lossless); a lossy codec would add its own error and overshoot past
full scale where the mix clips.

Loop: DirectMusic repeats a MIDI segment at the end of the bar holding the end of
track (shakefmt.midi), up to 1.6 s after the last event here.

Reverb: the default port's synthesizer reverb is on (shakefmt.reverb). When the
response measured by shakefmt.dmreverb is present it is applied to the mix before
the output clips, as the synthesizer does, and each file carries the reverb's tail
past the loop end; the client overlaps the next repeat there.

Roles (from shake.exe): `bgm/*.mid` are the in-game tracks, listed in the order
the room menu shows them (case-insensitive name sort); `sound/tbwait11.mid`
plays on the login/lobby screens and `sound/tbwait22.mid` in the waiting room.
`sound/tb19.mid` is loaded but never played (it is a copy of Slack's thema).
"""

import argparse
import json
import math
import os
import subprocess
from pathlib import Path

import numpy as np

from shakefmt.dls import decode_dls
from shakefmt.export import DEFAULT_SRC, REPO_ROOT
from shakefmt.midi import parse_midi
from shakefmt.reverb import Reverb, apply_reverb, load_reverb
from shakefmt.synth import render

RATE = 22050  # Microsoft synthesizer mixing rate
VOICE_GAIN = 1.0
DEFAULT_DST = REPO_ROOT / "assets/extracted/bgm"
DEFAULT_REVERB = REPO_ROOT / "assets/extracted/dmsynth/reverb.npz"
MENU_TRACKS = {"tbwait11.mid": "lobby", "tbwait22.mid": "room"}
GM_DLS_CANDIDATES = (
    Path("/mnt/c/Windows/System32/drivers/gm.dls"),
    Path("C:/Windows/System32/drivers/gm.dls"),
)


def default_dls() -> Path | None:
    configured = os.environ.get("SHAKE2_GM_DLS")
    if configured:
        return Path(configured)
    return next((p for p in GM_DLS_CANDIDATES if p.is_file()), None)


def original_tracks(src: Path) -> list[tuple[Path, str]]:
    game = sorted(src.glob("bgm/*.mid"), key=lambda p: p.name.lower())
    menus = [(src / "sound" / name, role) for name, role in MENU_TRACKS.items() if (src / "sound" / name).is_file()]
    return [(p, "game") for p in game] + menus


def pcm16(audio: np.ndarray) -> np.ndarray:
    """The mix as the synthesizer's 16-bit output: full scale is 32768, clipped at the ends.

    The synthesizer mixes (reverb included) at half that scale and doubles it on output, so
    every sample below the clip is even, as in the captures.
    """
    return np.clip(2 * np.round(audio * (32768 // 2)), -32768, 32767).astype("<i2")


def _encode_flac(audio: np.ndarray, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(RATE), "-ac", "2", "-i", "-",
         "-c:a", "flac", "-compression_level", "8", str(path)],
        input=pcm16(audio).tobytes(),
        check=True,
    )


def export_bgm(tracks: list[tuple[Path, str]], dls_path: Path, dst: Path, reverb: Reverb | None = None) -> dict:
    if reverb is not None and reverb.rate != RATE:
        raise ValueError(f"reverb measured at {reverb.rate} Hz; the synthesizer mixes at {RATE} Hz")
    collection = decode_dls(dls_path.read_bytes())
    entries = []
    for midi, role in tracks:
        song = parse_midi(midi.read_bytes())
        audio = render(song, collection, RATE) * VOICE_GAIN
        if reverb is not None:
            audio = apply_reverb(audio, reverb)
        file = midi.with_suffix(".flac").name
        _encode_flac(audio, dst / file)
        peak = float(np.abs(audio).max())
        entries.append({
            "name": midi.stem,
            "role": role,
            "source": f"{midi.parent.name}/{midi.name}",
            "file": file,
            "seconds": round(len(audio) / RATE, 3),
            "loop_end": round(song.segment_length, 3),
            "peak_dbfs": round(20 * math.log10(peak), 2) if peak > 0 else None,
            "clipped_samples": int(np.count_nonzero(np.abs(audio) >= 1.0)),
        })

    index = {
        "note": "Rendered from AOZORA Shake2 MIDI with the local Windows gm.dls. Do not redistribute.",
        "dls": dls_path.name,
        "rate": RATE,
        "gain_db": round(20 * math.log10(VOICE_GAIN), 2),
        "reverb": None if reverb is None else {
            "dry_gain": round(reverb.dry_gain, 5),
            "response_seconds": round(len(reverb.response) / reverb.rate, 3),
        },
        "tracks": entries,
    }
    dst.mkdir(parents=True, exist_ok=True)
    (dst / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return index


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("src", nargs="?", type=Path, default=DEFAULT_SRC)
    parser.add_argument("dst", nargs="?", type=Path, default=DEFAULT_DST)
    parser.add_argument("--dls", type=Path, default=default_dls())
    parser.add_argument("--reverb", type=Path, default=DEFAULT_REVERB, help="measured synthesizer reverb")
    parser.add_argument("--no-reverb", action="store_true", help="render the dry mix")
    args = parser.parse_args(argv)
    if args.dls is None or not args.dls.is_file():
        parser.error("gm.dls not found; pass --dls or set SHAKE2_GM_DLS")
    reverb = None
    if not args.no_reverb:
        if args.reverb.is_file():
            reverb = load_reverb(args.reverb)
        else:
            print(f"no measured reverb at {args.reverb} (python -m shakefmt.dmreverb); rendering dry")
    index = export_bgm(original_tracks(args.src), args.dls, args.dst, reverb)
    clipped = sum(t["clipped_samples"] for t in index["tracks"])
    print(f"rendered {len(index['tracks'])} tracks -> {args.dst} ({clipped} clipped samples, "
          f"reverb {'on' if reverb else 'off'})")


if __name__ == "__main__":
    main()
