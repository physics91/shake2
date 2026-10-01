import json
import shutil
import subprocess

import numpy as np
import pytest

from dls_builders import build_dls, build_midi, instrument, region, sine, wave, wsmp
from shakefmt.bgm import RATE, export_bgm, original_tracks, pcm16
from shakefmt.dls import decode_dls
from shakefmt.midi import parse_midi
from shakefmt.reverb import Reverb
from shakefmt.synth import render

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is required to encode FLAC")


def note(velocity):
    return build_midi([(0, b"\x90\x45" + bytes([velocity])), (240, b"\x80\x45\x00")], division=120)


@pytest.fixture
def game_tree(tmp_path):
    dls = tmp_path / "gm.dls"
    dls.write_bytes(
        build_dls([instrument(0, [region(wave=0, sample=wsmp(unity=69, loop=(0, 2200)))])], [wave(sine(441, 0.1))])
    )
    src = tmp_path / "App"
    (src / "bgm").mkdir(parents=True)
    (src / "sound").mkdir()
    (src / "bgm" / "Loud one.mid").write_bytes(note(127))
    (src / "bgm" / "quiet.mid").write_bytes(note(64))
    (src / "bgm" / "notes.txt").write_text("ignored")
    (src / "sound" / "tbwait22.mid").write_bytes(note(127))
    (src / "sound" / "tb19.mid").write_bytes(note(127))
    return src, dls, tmp_path / "out"


def decode(path):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-"], check=True, capture_output=True
    ).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2)


def test_lists_game_tracks_case_insensitively_then_the_menu_tracks(game_tree):
    src, _, _ = game_tree
    (src / "bgm" / "mission.mid").write_bytes(note(1))

    roles = [(p.name, role) for p, role in original_tracks(src)]
    assert roles == [("Loud one.mid", "game"), ("mission.mid", "game"), ("quiet.mid", "game"), ("tbwait22.mid", "room")]


def decode_pcm(path):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "s16le", "-ac", "2", "-"], check=True, capture_output=True
    ).stdout
    return np.frombuffer(raw, "<i2").reshape(-1, 2)


def stream_format(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels,bits_per_raw_sample",
         "-of", "json", str(path)],
        check=True, capture_output=True, text=True,
    ).stdout
    return json.loads(out)["streams"][0]


def test_keeps_the_synthesizer_output_bit_for_bit(game_tree):
    src, dls, dst = game_tree
    track = export_bgm(original_tracks(src)[:1], dls, dst)["tracks"][0]

    assert track["file"] == "Loud one.flac"
    # The synthesizer hands DirectSound 16-bit stereo at 22050 Hz; the file is that, losslessly.
    assert stream_format(dst / track["file"]) == {
        "codec_name": "flac", "sample_rate": "22050", "channels": 2, "bits_per_raw_sample": "16",
    }
    song = parse_midi((src / "bgm" / "Loud one.mid").read_bytes())
    expected = pcm16(render(song, decode_dls(dls.read_bytes()), RATE))
    assert np.array_equal(decode_pcm(dst / track["file"]), expected)


def test_output_is_the_doubled_half_scale_mix():
    assert pcm16(np.array([[0.30001, -0.5], [1.2, -1.2]])).tolist() == [[9830, -16384], [32767, -32768]]


def test_renders_every_track_with_an_index(game_tree):
    src, dls, dst = game_tree
    index = export_bgm(original_tracks(src), dls, dst)

    assert [t["name"] for t in index["tracks"]] == ["Loud one", "quiet", "tbwait22"]
    assert index["tracks"][2]["source"] == "sound/tbwait22.mid"
    for track in index["tracks"]:
        assert (dst / track["file"]).is_file()
        # The note ends at 1 s and the repeat waits for the end of its bar, silent until then.
        assert track["loop_end"] == pytest.approx(2.0)
        assert track["seconds"] < track["loop_end"]
    assert json.loads((dst / "index.json").read_text(encoding="utf-8")) == index


def test_renders_a_song_with_no_events_to_an_empty_track(game_tree):
    src, dls, dst = game_tree
    (src / "bgm" / "silent.mid").write_bytes(build_midi([]))
    index = export_bgm([(src / "bgm" / "silent.mid", "game")], dls, dst)

    assert index["tracks"][0]["seconds"] == 0
    assert index["tracks"][0]["peak_dbfs"] is None


def test_uses_the_synthesizer_mix_level_instead_of_normalizing(game_tree):
    src, dls, dst = game_tree
    index = export_bgm(original_tracks(src), dls, dst)

    loud, quiet = (decode(dst / t["file"]) for t in index["tracks"][:2])
    # 0.5 sine, default CC7 100, centre pan, at unity: a voice at full level reaches full scale.
    expected = 0.5 * 10 ** (40 * np.log10(100 / 127) / 20) * np.sqrt(64 / 127)
    assert np.abs(loud[:, 1]).max() == pytest.approx(expected, rel=0.05)
    assert index["gain_db"] == 0.0
    ratio_db = 20 * np.log10(np.abs(quiet).max() / np.abs(loud).max())
    assert ratio_db == pytest.approx(40 * np.log10(64 / 127), abs=1.0)


def echo(delay, gain, taps=2205, rate=22050):
    h = np.zeros((taps, 2, 2))
    h[delay, 0, 0] = h[delay, 1, 1] = gain
    return Reverb(dry_gain=0.5, response=h, rate=rate)


def test_a_measured_reverb_follows_the_dry_mix_and_rings_past_it(game_tree):
    src, dls, dst = game_tree
    track = original_tracks(src)[:1]
    dry = export_bgm(track, dls, dst / "dry")
    wet = export_bgm(track, dls, dst / "wet", echo(1000, 0.5))

    assert dry["reverb"] is None
    assert wet["reverb"] == {"dry_gain": 0.5, "response_seconds": 0.1}
    before, after = (index["tracks"][0] for index in (dry, wet))
    assert after["seconds"] == pytest.approx(before["seconds"] + 2204 / 22050, abs=1e-3)
    assert after["loop_end"] == before["loop_end"]
    plain, reverberant = decode(dst / "dry" / before["file"]), decode(dst / "wet" / after["file"])
    # Until the echo arrives the output is the dry mix at the dry gain; past the dry end the echo rings.
    assert np.abs(reverberant[:900]).max() == pytest.approx(0.5 * np.abs(plain[:900]).max(), rel=0.05)
    end = len(plain)
    assert np.abs(reverberant[end + 100 : end + 900]).max() > 0.01


def test_a_reverb_measured_at_another_rate_is_refused(game_tree):
    src, dls, dst = game_tree
    with pytest.raises(ValueError, match="mixes at 22050 Hz"):
        export_bgm(original_tracks(src)[:1], dls, dst, echo(10, 0.5, rate=44100))
