import pytest

from dls_builders import build_midi
from shakefmt.midi import MidiFormatError, parse_midi


def test_note_times_follow_the_tempo_map_and_running_status():
    song = parse_midi(
        build_midi(
            [
                (0, b"\xff\x51\x03\x07\xa1\x20"),  # 500000 us/qn
                (0, b"\x90\x3c\x64"),
                (120, b"\x3c\x00"),  # running status, velocity 0 = note off
                (0, b"\xff\x51\x03\x0f\x42\x40"),  # 1000000 us/qn
                (120, b"\x80\x3e\x40"),
            ],
            division=120,
        )
    )

    notes = [(round(e.time, 6), e.kind, e.channel, e.data) for e in song.events]
    assert notes == [
        (0.0, "on", 0, (60, 100)),
        (0.5, "off", 0, (60, 0)),
        (1.5, "off", 0, (62, 64)),
    ]
    assert song.length == pytest.approx(1.5)


def test_ticks_become_768_ppq_music_time_rounded_down_as_directmusic_loads_them():
    # Measured on this PC's 32-bit DirectMusic: notes 21 ticks apart at 120 per quarter sound
    # 134, 134, 135, 134, 135, ... music ticks apart (floor of tick * 768 / 120), not 134.4.
    song = parse_midi(
        build_midi(
            [(0, b"\xff\x51\x03\x07\xa1\x20")]  # 500000 us/qn
            + [(1, bytes([0x90, 60 + n, 100])) for n in range(5)]
            + [(0, b"\xff\x51\x03\x0f\x42\x40"), (1, b"\x80\x3c\x00")],  # 1000000 us/qn from tick 5
            division=120,
        )
    )

    times = [e.time for e in song.events]
    assert times[:5] == pytest.approx([mt * 0.5 / 768 for mt in (6, 12, 19, 25, 32)], abs=1e-12)
    assert times[5] == pytest.approx(32 * 0.5 / 768 + (38 - 32) * 1.0 / 768)


def test_decodes_controllers_programs_and_pitch_bend():
    song = parse_midi(
        build_midi(
            [
                (0, b"\xb9\x07\x50"),
                (0, b"\xc2\x30"),
                (0, b"\xe1\x00\x40"),  # centre
                (0, b"\xe1\x7f\x7f"),  # max
                (0, b"\xe1\x00\x00"),  # min
                (0, b"\xf0\x05\x7e\x7f\x09\x01\xf7"),  # sysex is skipped
                (0, b"\xd0\x10"),  # channel pressure is ignored
            ]
        )
    )

    assert [(e.kind, e.channel, e.data) for e in song.events] == [
        ("cc", 9, (7, 80)),
        ("program", 2, (48,)),
        ("bend", 1, (0,)),
        ("bend", 1, (8191,)),
        ("bend", 1, (-8192,)),
    ]


def test_merges_format_1_tracks_using_the_shared_tempo_map():
    tempo = [(0, b"\xff\x51\x03\x0f\x42\x40")]  # 1 s per quarter
    notes = [(240, b"\x91\x40\x7f")]
    song = parse_midi(build_midi(None, fmt=1, division=120, tracks=[tempo, notes]))

    assert [(e.time, e.kind, e.channel) for e in song.events] == [(2.0, "on", 1)]


def test_rejects_smpte_division_and_non_midi():
    with pytest.raises(MidiFormatError):
        parse_midi(b"RIFF")
    with pytest.raises(MidiFormatError):
        parse_midi(build_midi([], division=0xE728))


@pytest.mark.parametrize(
    "track",
    [
        pytest.param(b"\x00\x90\x3c\x64\x10", id="delta-without-event"),
        pytest.param(b"\x00\x90\x3c", id="cut-channel-event"),
        pytest.param(b"\x00\xff", id="cut-meta-event"),
    ],
)
def test_rejects_a_track_cut_mid_event(track):
    header = b"MThd" + (6).to_bytes(4, "big") + bytes([0, 0, 0, 1, 0, 120])
    with pytest.raises(MidiFormatError):
        parse_midi(header + b"MTrk" + len(track).to_bytes(4, "big") + track)


def test_the_segment_lasts_to_the_end_of_the_bar_holding_the_end_of_track():
    # DirectMusic's segment for a MIDI file (GetLength on all 16 tracks) and so the loop period.
    four_four = (0, b"\xff\x58\x04\x04\x02\x18\x08")
    short = parse_midi(build_midi([four_four, (0, b"\x90\x3c\x64"), (420, b"\x80\x3c\x00")], division=120))
    assert short.length == pytest.approx(1.75)
    assert short.segment_length == pytest.approx(2.0)

    whole = parse_midi(build_midi([four_four, (0, b"\x90\x3c\x64"), (960, b"\x80\x3c\x00")], division=120))
    assert whole.segment_length == pytest.approx(4.0)

    unmarked = parse_midi(build_midi([(0, b"\x90\x3c\x64"), (500, b"\x80\x3c\x00")], division=120))
    assert unmarked.segment_length == pytest.approx(4.0)  # 4/4 unless the file says otherwise
