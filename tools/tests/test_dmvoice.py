import numpy as np
import pytest

from dls_builders import art1, build_dls, instrument, region, wave, wsmp
from shakefmt.dls import Connection, decode_dls
from shakefmt.dmvoice import (
    ATTACK_CURVE,
    FOREVER,
    FULL_SCALE,
    MIDI_VREL,
    PAN_VREL,
    SINE,
    VOLUME_STEPS,
    ChannelControls,
    EgSource,
    Envelope,
    Lfo,
    LfoSource,
    MixVoice,
    muldiv,
    parse_articulation,
    volume_fraction,
)
from shakefmt.midi import Event, Song
from shakefmt.synth import render, schedule

RATE = 22050
TC_ZERO = -0x80000000


def test_tables_match_the_published_sample():
    # Spot values from ddksynth voice.cpp / midi.cpp; the formulas reproduce every entry.
    assert [VOLUME_STEPS[i] for i in (0, 500, 970, 1000)] == [0, 12, 2899, 4095]
    assert [MIDI_VREL[i] for i in (0, 1, 64, 100)] == [-9600, -8415, -1190, -415]
    assert [PAN_VREL[i] for i in (0, 1, 63, 64)] == [-2500, -2103, -304, -297]
    assert [ATTACK_CURVE[i] for i in (1, 100, 199, 200)] == [520, 937, 999, 1000]
    assert [SINE[i] for i in (32, 64, 192)] == [70, 100, -100]


def test_muldiv_rounds_half_away_from_zero():
    assert muldiv(5, 1, 2) == 3
    assert muldiv(-5, 1, 2) == -3
    assert muldiv(7, 3, 0) == -1


def test_decay_asks_for_points_at_a_quarter_a_half_and_its_end():
    eg = Envelope(EgSource(decay=4000, sustain=0, release=2000), start=0, key=0, velocity=0, min_attack=22)

    assert eg.level(22, True) == (1000, 1000)
    assert eg.level(22 + 950, True) == (763, 1050)  # within 100 samples of the quarter: aim at the half
    assert eg.level(22 + 1950, True) == (513, 2050)
    assert eg.volume(22 + 2000) == (500 * 96 // 10 - 9600, 2000)


def test_release_starts_from_the_level_at_the_stop():
    eg = Envelope(EgSource(decay=4000, sustain=0, release=2000), start=0, key=0, velocity=0, min_attack=22)
    eg.stop_at(22 + 2000)

    assert eg.release == 1000  # 2000 * 500 / 1000
    assert eg.level(22 + 2000 + 250, True) == (375, 250)
    assert eg.level(22 + 2000 + 1000, True) == (0, FOREVER)


def test_a_quick_stop_after_the_release_rescales_it_from_the_original_stop():
    eg = Envelope(EgSource(sustain=500, release=1000), start=0, key=0, velocity=0, min_attack=22)
    eg.stop_at(100)
    eg.quick_stop_at(eg.stop, RATE)

    assert (eg.stop, eg.release) == (100, 250)  # 1000 * 500 / 1000, then again: below 1/70 s


def test_lfo_asks_for_points_only_when_it_has_a_depth():
    assert Lfo(LfoSource(step=3804), start=0).repeat == 44100
    assert Lfo(LfoSource(step=3804, pitch=50), start=0).repeat == 2097152 // 3804
    assert Lfo(LfoSource(step=3804, wheel_pitch=47), start=0).repeat == 2097152 // 3804  # wheel at 0

    lfo = Lfo(LfoSource(step=3804, delay=100, pitch=100), start=0)
    assert lfo.pitch(40) == (0, 60)
    assert lfo.pitch(100 + 1102) == (99, 551)


def test_articulation_keeps_mod_wheel_depths_apart():
    art = parse_articulation(
        [Connection(1, 0x81, 0x003, 0, 47 << 16), Connection(1, 0, 0x001, 0, -65536),
         Connection(0, 0, 0x206, 0, TC_ZERO), Connection(0, 0, 0x004, 0, -(700 << 12))],
        RATE,
    )

    assert (art.lfo.wheel_pitch, art.lfo.pitch, art.lfo.volume) == (47, 0, -10)
    assert art.eg1.attack == 0
    assert art.default_pan == -5  # -700 / 125, truncated toward zero as in C


def test_a_volume_change_moves_in_a_staircase_over_the_span_that_ends_after_it():
    # The render buffer ends spans every 441 samples; the span holding the change is evaluated at
    # its end, so the gain starts moving at the buffer start, before the change itself.
    col = decode_dls(build_dls(
        [instrument(0, [region(wave=0, sample=wsmp(unity=69, loop=(0, 2205)))],
                    articulation=art1((0, 0, 0x206, 0, TC_ZERO), (0, 0, 0x209, 0, TC_ZERO)))],
        [wave(np.full(2205, 0.5))],
    ))
    events = [(0.0, "cc", 0, (7, 127)), (0.0, "on", 0, (69, 127)), (0.105, "cc", 0, (7, 64)), (0.3, "off", 0, (69, 0))]
    out = render(Song(events=tuple(Event(*e) for e in events), length=0.3), col, RATE)[:, 0]

    before = (16384 * volume_fraction(PAN_VREL[63])) >> 13
    after = (16384 * volume_fraction(MIDI_VREL[64] + PAN_VREL[63])) >> 13
    level = (out * FULL_SCALE).astype(np.int64)
    assert (level[2000:2211] == before).all()  # the change is at sample 2315
    assert level[2211] < before  # period 8: first step at 6 samples into the span
    for stair in range(2211, 2211 + 8 * 50, 8):
        assert len(set(level[stair: stair + 8].tolist())) == 1
    assert (level[2646:2700] == after).all()


def mixed_alone(cut=None, events=()):
    """One held note (1 s release) mixed by itself in 441-sample buffers, cut or stopped at sample times."""
    col = decode_dls(build_dls(
        [instrument(0, [region(wave=0, sample=wsmp(unity=69, loop=(0, 2205)))],
                    articulation=art1((0, 0, 0x206, 0, TC_ZERO), (0, 0, 0x209, 0, 0)))],
        [wave(np.full(2205, 0.5))],
    ))
    voices, channels = schedule(Song(events=(Event(0.0, "on", 0, (69, 127)),), length=0.5), col)
    voice = voices[0]
    if cut is not None:
        voice.cut = cut / RATE
    voice.events = [(t / RATE, kind) for t, kind in events]
    out = np.zeros((RATE, 2), np.int64)
    MixVoice(voice, ChannelControls.of(channels[0], RATE), RATE).mix_into(out, 441)
    return out


# ddksynth CSynth::Mix: QueueNotes(stEndTime = llPosition + dwLength) takes the notes at or before
# the buffer's end (CNoteIn::GetNote), and StealVoice clears its victim before the voices mix.
@pytest.mark.parametrize("cut", [2205 - 100, 2205, 2205 + 1])
def test_a_stolen_voice_is_silent_from_the_start_of_the_buffer_whose_queue_takes_the_note(cut):
    out = mixed_alone(cut=cut)
    silent_from = (cut - 1) // 441 * 441
    assert out[silent_from - 10: silent_from].any()
    assert not out[silent_from:].any()


def test_a_quick_stop_at_the_buffer_end_acts_before_that_buffer_mixes():
    released = [(1000, "stop")]
    at_end = mixed_alone(events=released + [(2205, "quick")])
    inside = mixed_alone(events=released + [(1800, "quick")])
    assert (at_end[1764:2205] == inside[1764:2205]).all()
    assert (at_end[1764:2205] != mixed_alone(events=released)[1764:2205]).any()
