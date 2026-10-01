import numpy as np
import pytest

from dls_builders import art1, build_dls, instrument, region, sine, wave, wsmp
from shakefmt.dls import decode_dls
from shakefmt.midi import Event, Song
from shakefmt.dmvoice import FULL_SCALE, MIDI_VREL, PAN_VREL, volume_fraction
from shakefmt.synth import ABSOLUTE_ZERO, QUICK_STOP_SECONDS, pitch_step, render, schedule, time_cents_seconds

RATE = 22050
PERIOD_SAMPLES = 50  # 441 Hz at 22050 Hz: loops close on whole periods
TC_ZERO = ABSOLUTE_ZERO


def tc(seconds: float) -> int:
    return int(round(1200 * np.log2(seconds) * 65536))


def envelope(attack=TC_ZERO, decay=TC_ZERO, sustain=1000, release=None):
    connections = [(0, 0, 0x206, 0, attack), (0, 0, 0x207, 0, decay), (0, 0, 0x20A, 0, sustain * 65536)]
    if release is not None:
        connections.append((0, 0, 0x209, 0, release))
    return art1(*connections)


def collection(looped=True, articulation=None, drums=False, extra_regions=()):
    samples = 2200
    loop = (0, samples) if looped else None
    regions = [region(key=(0, 127), wave=0, sample=wsmp(unity=69, loop=loop))] if not drums else list(extra_regions)
    inst = instrument(0, regions, drums=drums, articulation=articulation or envelope(release=tc(0.01)))
    waves = [wave(sine(441, samples / RATE)), wave(sine(882, samples / RATE))]
    return decode_dls(build_dls([inst], waves))


def song(*events, length=None):
    events = tuple(Event(*e) for e in events)
    return Song(events=events, length=length if length is not None else max(e.time for e in events))


def rms_db(x):
    return 20 * np.log10(np.sqrt(np.mean(np.square(x))) + 1e-12)


def window(out, start, end, channel=0):
    return out[int(start * RATE) : int(end * RATE), channel]


def peak_hz(x):
    spectrum = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    return np.fft.rfftfreq(len(x), 1 / RATE)[np.argmax(spectrum)]


def test_time_cents():
    assert time_cents_seconds(0) == 1.0
    assert time_cents_seconds(1200 * 65536) == pytest.approx(2.0)
    assert time_cents_seconds(ABSOLUTE_ZERO) == 0.0


def test_plays_at_the_key_pitch_relative_to_the_unity_note():
    out = render(song((0.0, "on", 0, (81, 127)), (0.5, "off", 0, (81, 0))), collection(), RATE)

    assert out.shape[1] == 2
    assert peak_hz(window(out, 0.05, 0.45)) == pytest.approx(882, rel=0.01)


def test_pitch_bend_uses_the_default_two_semitone_range():
    out = render(
        song((0.0, "bend", 0, (8191,)), (0.0, "on", 0, (69, 127)), (0.5, "off", 0, (69, 0))),
        collection(),
        RATE,
    )

    assert peak_hz(window(out, 0.05, 0.45)) == pytest.approx(441 * 2 ** (2 / 12), rel=0.01)


@pytest.mark.parametrize(
    "controls, semitones",
    [
        pytest.param([(6, 12)], 12, id="data-entry-msb"),
        pytest.param([(6, 2), (38, 50)], 2, id="lsb-ignored"),  # "Roland ignores lsb" (control.cpp)
        pytest.param([(99, 1), (98, 8), (6, 12)], 2, id="nrpn-deselects-the-rpn"),  # NOTE_CC_NRPN: 0x3FFF
    ],
)
def test_rpn_0_sets_the_bend_range_in_whole_semitones(controls, semitones):
    rpn = [(0.0, "cc", 0, (101, 0)), (0.0, "cc", 0, (100, 0))] + [(0.0, "cc", 0, c) for c in controls]
    out = render(
        song(*rpn, (0.0, "bend", 0, (8191,)), (0.0, "on", 0, (69, 127)), (0.5, "off", 0, (69, 0))),
        collection(),
        RATE,
    )

    assert peak_hz(window(out, 0.05, 0.45)) == pytest.approx(441 * 2 ** (semitones / 12), rel=0.01)


def test_a_new_bend_range_bends_the_note_already_bent():
    # CPitchBendIn::GetPitch keeps no time-stamped range: the held bend times the range now.
    rpn = [(0.3, "cc", 0, (101, 0)), (0.3, "cc", 0, (100, 0)), (0.3, "cc", 0, (6, 12))]
    out = render(
        song((0.0, "bend", 0, (8191,)), (0.0, "on", 0, (69, 127)), *rpn, (0.9, "off", 0, (69, 0))),
        collection(),
        RATE,
    )

    assert peak_hz(window(out, 0.05, 0.25)) == pytest.approx(441 * 2 ** (2 / 12), rel=0.01)
    assert peak_hz(window(out, 0.45, 0.85)) == pytest.approx(882, rel=0.01)


def test_looped_sample_sustains_while_unlooped_sample_stops_at_its_end():
    held = song((0.0, "on", 0, (69, 127)), (1.0, "off", 0, (69, 0)))

    looped = render(held, collection(looped=True), RATE)
    unlooped = render(held, collection(looped=False), RATE)

    assert rms_db(window(looped, 0.5, 0.9)) > -20
    assert np.abs(window(unlooped, 0.2, 0.9)).max() == 0


def test_velocity_and_volume_follow_the_40log_concave_curve():
    def level(velocity, volume):
        out = render(
            song((0.0, "cc", 0, (7, volume)), (0.0, "on", 0, (69, velocity)), (0.5, "off", 0, (69, 0))),
            collection(),
            RATE,
        )
        return rms_db(window(out, 0.1, 0.4))

    assert level(64, 127) - level(127, 127) == pytest.approx(40 * np.log10(64 / 127), abs=0.2)
    assert level(127, 100) - level(127, 127) == pytest.approx(40 * np.log10(100 / 127), abs=0.2)


def test_sustain_level_is_a_fraction_of_the_96_db_range():
    held = song((0.0, "on", 0, (69, 127)), (1.0, "off", 0, (69, 0)))
    full = render(held, collection(articulation=envelope(sustain=1000, release=tc(0.01))), RATE)
    half = render(held, collection(articulation=envelope(decay=tc(0.2), sustain=550, release=tc(0.01))), RATE)

    assert rms_db(window(half, 0.5, 0.9)) - rms_db(window(full, 0.5, 0.9)) == pytest.approx(-96 * 0.45, abs=0.5)


def test_release_falls_linearly_in_db_over_the_release_time():
    out = render(
        song((0.0, "on", 0, (69, 127)), (0.5, "off", 0, (69, 0)), length=2.0),
        collection(articulation=envelope(release=tc(1.0))),
        RATE,
    )

    before = rms_db(window(out, 0.4, 0.5))
    assert rms_db(window(out, 0.99, 1.01)) - before == pytest.approx(-48, abs=1.5)
    assert np.abs(window(out, 1.51, 2.0)).max() == 0


def test_pan_uses_the_square_root_law_with_a_25_db_floor():
    def sides(pan):
        out = render(
            song((0.0, "cc", 0, (10, pan)), (0.0, "on", 0, (69, 127)), (0.5, "off", 0, (69, 0))),
            collection(),
            RATE,
        )
        return rms_db(window(out, 0.1, 0.4, channel=0)), rms_db(window(out, 0.1, 0.4, channel=1))

    left, right = sides(0)
    assert right - left == pytest.approx(-25, abs=0.2)
    centre_left, centre_right = sides(64)
    assert centre_left - left == pytest.approx(10 * np.log10(63 / 127), abs=0.2)
    assert centre_right - left == pytest.approx(10 * np.log10(64 / 127), abs=0.2)


def test_sustain_pedal_defers_note_off():
    out = render(
        song(
            (0.0, "cc", 0, (64, 127)),
            (0.0, "on", 0, (69, 127)),
            (0.2, "off", 0, (69, 0)),
            (0.6, "cc", 0, (64, 0)),
            length=1.0,
        ),
        collection(),
        RATE,
    )

    assert rms_db(window(out, 0.3, 0.5)) > -20
    assert np.abs(window(out, 0.7, 1.0)).max() == 0


def test_any_sustain_value_but_0_holds():
    # control.cpp NOTE_SUSTAIN keeps the value as a BOOL (m_fSustain = (BOOL) bData).
    out = render(
        song((0.0, "cc", 0, (64, 1)), (0.0, "on", 0, (69, 127)), (0.2, "off", 0, (69, 0)), length=1.0),
        collection(),
        RATE,
    )

    assert rms_db(window(out, 0.3, 0.5)) > -20


def test_reset_all_controllers_lets_go_of_what_the_pedal_holds():
    # control.cpp CC_RESETALL falls through into the pedal's release.
    out = render(
        song(
            (0.0, "cc", 0, (64, 127)),
            (0.0, "on", 0, (69, 127)),
            (0.2, "off", 0, (69, 0)),
            (0.6, "cc", 0, (121, 0)),
            length=1.0,
        ),
        collection(),
        RATE,
    )

    assert rms_db(window(out, 0.3, 0.5)) > -20
    assert np.abs(window(out, 0.7, 1.0)).max() == 0


def test_reset_all_controllers_with_a_value_also_resets_the_volume():
    out = render(
        song((0.0, "cc", 0, (7, 20)), (0.0, "on", 0, (69, 127)), (0.4, "cc", 0, (121, 1)), (0.8, "off", 0, (69, 0))),
        collection(),
        RATE,
    )

    louder = rms_db(window(out, 0.5, 0.7)) - rms_db(window(out, 0.1, 0.3))
    assert louder == pytest.approx(40 * np.log10(100 / 20), abs=0.5)


def test_channel_10_uses_the_drum_kit_and_key_groups_choke_each_other():
    long_release = envelope(release=tc(10.0))
    kit = collection(
        drums=True,
        articulation=long_release,
        extra_regions=[
            region(key=(42, 42), wave=0, sample=wsmp(unity=42, loop=(0, 2200)), key_group=1),
            region(key=(46, 46), wave=1, sample=wsmp(unity=46, loop=(0, 2200)), key_group=1),
        ],
    )
    out = render(
        song((0.0, "on", 9, (42, 127)), (0.2, "on", 9, (46, 127)), (0.3, "off", 9, (42, 0)), length=0.6),
        kit,
        RATE,
    )

    assert peak_hz(window(out, 0.02, 0.18)) == pytest.approx(441, rel=0.01)
    late = window(out, 0.25, 0.55)
    spectrum = np.abs(np.fft.rfft(late * np.hanning(len(late))))
    freqs = np.fft.rfftfreq(len(late), 1 / RATE)
    at = lambda hz: spectrum[np.argmin(np.abs(freqs - hz))]
    assert at(882) > 100 * at(441)


def test_bank_select_is_ignored_even_when_the_bank_exists():
    # shake.exe sets GUID_StandardMIDIFile (= GUID_IgnoreBankSelectForGM) on every segment (0x43f92c).
    looped = wsmp(unity=69, loop=(0, 2200))
    capital = instrument(0, [region(wave=0, sample=looped)], articulation=envelope(release=tc(0.01)))
    variation = instrument(0, [region(wave=1, sample=looped)], bank_msb=1, articulation=envelope(release=tc(0.01)))
    col = decode_dls(build_dls([capital, variation], [wave(sine(441, 0.1)), wave(sine(882, 0.1))]))
    out = render(
        song(
            (0.0, "cc", 0, (0, 1)),
            (0.0, "cc", 0, (32, 0)),
            (0.0, "program", 0, (0,)),
            (0.0, "on", 0, (69, 127)),
            (0.5, "off", 0, (69, 0)),
        ),
        col,
        RATE,
    )

    assert peak_hz(window(out, 0.05, 0.45)) == pytest.approx(441, rel=0.01)


def test_missing_bank_falls_back_to_the_general_midi_instrument():
    out = render(
        song(
            (0.0, "cc", 0, (0, 5)),
            (0.0, "cc", 0, (32, 87)),
            (0.0, "program", 0, (0,)),
            (0.0, "on", 0, (69, 127)),
            (0.5, "off", 0, (69, 0)),
        ),
        collection(),
        RATE,
    )

    assert rms_db(window(out, 0.1, 0.4)) > -20


def test_key_group_chokes_a_drum_that_is_still_ringing_after_its_note_off():
    kit = collection(
        drums=True,
        articulation=envelope(release=tc(10.0)),
        extra_regions=[
            region(key=(42, 42), wave=0, sample=wsmp(unity=42, loop=(0, 2200)), key_group=1),
            region(key=(46, 46), wave=1, sample=wsmp(unity=46, loop=(0, 2200)), key_group=1),
        ],
    )
    out = render(
        song((0.0, "on", 9, (42, 127)), (0.05, "off", 9, (42, 0)), (0.2, "on", 9, (46, 127)), length=0.6),
        kit,
        RATE,
    )

    late = window(out, 0.25, 0.55)
    spectrum = np.abs(np.fft.rfft(late * np.hanning(len(late))))
    freqs = np.fft.rfftfreq(len(late), 1 / RATE)
    assert spectrum[np.argmin(np.abs(freqs - 882))] > 100 * spectrum[np.argmin(np.abs(freqs - 441))]


def zero_crossing_hz(x):
    signs = np.signbit(x)
    idx = np.flatnonzero(signs[:-1] & ~signs[1:])
    exact = idx + x[idx] / (x[idx] - x[idx + 1])
    return RATE / np.mean(np.diff(exact))


def test_retriggering_the_same_key_quick_stops_the_previous_voice():
    held = song((0.0, "on", 0, (69, 127)), (0.3, "on", 0, (69, 100)), (0.6, "off", 0, (69, 0)))
    first, second = schedule(held, collection())[0]

    assert first.end() <= 0.3 + QUICK_STOP_SECONDS + 1e-9
    assert second.note_on is False and second.eg1.stop_time == pytest.approx(0.3)


def held_notes(channel, count, start=0.0, key0=20):
    return [(start + i * 0.01, "on", channel, (key0 + i, 127)) for i in range(count)]


def test_voices_beyond_32_are_quick_stopped_oldest_first():
    voices, _ = schedule(song(*held_notes(0, 41)), collection())

    assert voices[0].tag and voices[0].eg1.stop_time == pytest.approx(0.33)
    assert voices[0].eg1.release_time <= QUICK_STOP_SECONDS
    assert all(v.note_on for v in voices[9:])


def test_drum_channel_outranks_melodic_channels_when_voices_run_out():
    melody = decode_dls(build_dls(
        [
            instrument(0, [region(wave=0, sample=wsmp(unity=69, loop=(0, 2200)))], articulation=envelope()),
            instrument(0, [region(key=(20, 90), wave=0, sample=wsmp(unity=69, loop=(0, 2200)))], drums=True,
                       articulation=envelope()),
        ],
        [wave(sine(441, 0.1))],
    ))
    drums_first = song(*[(0.0, "on", 9, (20 + i, 127)) for i in range(40)], (0.001, "on", 0, (69, 127)))
    voices, _ = schedule(drums_first, melody)
    assert len(voices) == 40  # the melodic note found no voice it may steal

    melody_first = song(*[(0.0, "on", 0, (20 + i, 127)) for i in range(40)], (0.001, "on", 9, (69, 127)))
    voices, _ = schedule(melody_first, melody)
    assert len(voices) == 41 and voices[0].cut == pytest.approx(0.001)


def test_pitch_envelope_bends_from_its_scale_back_to_the_key():
    art = art1(
        (0, 0, 0x206, 0, TC_ZERO), (0, 0, 0x207, 0, TC_ZERO), (0, 0, 0x20A, 0, 1000 * 65536),
        (0, 0, 0x209, 0, tc(0.01)),
        (0, 0, 0x30A, 0, TC_ZERO), (0, 0, 0x30B, 0, tc(0.5)), (0, 0, 0x30E, 0, 0),
        (5, 0, 0x003, 0, 1200 * 65536),
    )
    out = render(song((0.0, "on", 0, (69, 127)), (1.0, "off", 0, (69, 0))), collection(articulation=art), RATE)

    assert zero_crossing_hz(window(out, 0.0, 0.03)) == pytest.approx(441 * 2 ** (1164 / 1200), rel=0.03)
    assert zero_crossing_hz(window(out, 0.6, 0.9)) == pytest.approx(441, rel=0.01)


def test_lfo_vibrato_swings_the_pitch_by_its_depth():
    five_hz = int(round((1200 * np.log2(5 / 440) + 6900) * 65536))
    art = art1(
        (0, 0, 0x206, 0, TC_ZERO), (0, 0, 0x207, 0, TC_ZERO), (0, 0, 0x20A, 0, 1000 * 65536),
        (0, 0, 0x209, 0, tc(0.01)),
        (0, 0, 0x104, 0, five_hz), (0, 0, 0x105, 0, TC_ZERO),
        (1, 0, 0x003, 0, 100 * 65536),
    )
    out = render(song((0.0, "on", 0, (93, 127)), (0.5, "off", 0, (93, 0))), collection(articulation=art), RATE)

    high = zero_crossing_hz(window(out, 0.03, 0.07))
    low = zero_crossing_hz(window(out, 0.13, 0.17))
    assert high / low == pytest.approx(2 ** (190 / 1200), rel=0.02)


def flat(level=0.5, seconds=0.1):
    return np.full(int(seconds * RATE), level)


def flat_collection(articulation):
    return decode_dls(build_dls(
        [instrument(0, [region(wave=0, sample=wsmp(unity=69, loop=(0, 2205)))], articulation=articulation)],
        [wave(flat())],
    ))


@pytest.mark.parametrize("start", [0.0, 0.01])
def test_an_instant_attack_still_rises_over_one_millisecond_in_four_sample_stairs(start):
    # Measured on dmsynth.dll: a zero attack is one 22-sample span; the gain steps every 4 samples
    # from sample 2 (pairwise mixing) by 4/22 and lands on full level at sample 22.
    col = flat_collection(envelope(release=tc(0.01)))
    out = render(song((start, "on", 0, (69, 127)), (0.2, "off", 0, (69, 0))), col, RATE)[:, 0]
    out = out[int(round(start * RATE)):]

    full = out[100]
    assert out[0] == out[1] == 0
    for step in range(1, 6):
        stair = out[4 * step - 2 : 4 * step + 2]
        assert stair == pytest.approx(np.full(4, full * 4 * step / 22), rel=0.01)
    assert (out[22:100] == full).all()


def test_an_attack_longer_than_a_millisecond_is_one_straight_span():
    # The attack curve only applies at control points; a 44-sample attack has none inside it.
    out = render(
        song((0.0, "on", 0, (69, 127)), (0.2, "off", 0, (69, 0))),
        flat_collection(envelope(attack=tc(0.002), release=tc(0.01))),
        RATE,
    )[:, 0]

    full = out[100]
    assert out[22] == pytest.approx(full * 24 / 44, rel=0.01)
    assert (out[44:100] == full).all()


def test_pitch_steps_through_the_sample_in_twelve_bit_fixed_point():
    # Pitch goes through floor(4096 * 2^(x)) cent and semitone tables and a 12-bit fraction, and the
    # interpolation and gain are the synthesizer's integers.
    assert pitch_step(0, 0, 22050, 22050) == 1.0
    assert pitch_step(100, 0, 22050, 22050) == 4339 / 4096
    assert pitch_step(1200, 0, 22050, 22050) == 2.0
    assert pitch_step(-100, 0, 22050, 22050) == 3866 / 4096
    assert pitch_step(0, 0, 44100, 22050) == 2.0
    assert pitch_step(100, 100, 22050, 22050) == (4339 * 4339 >> 12) / 4096

    ramp = np.arange(4000) * 8 / 32767  # whole 16-bit steps, so interpolation reads the position back
    col = decode_dls(build_dls(
        [instrument(0, [region(wave=0, sample=wsmp(unity=69))], articulation=envelope(release=tc(0.01)))],
        [wave(ramp)],
    ))
    out = render(song((0.0, "on", 0, (70, 127)), (0.2, "off", 0, (70, 0))), col, RATE)[900:1100, 0]
    position = np.arange(900, 1100) * 4339
    ramp_at = 8 * (position >> 12) + ((8 * (position & 0xFFF)) >> 12)
    gain = volume_fraction(MIDI_VREL[100] + PAN_VREL[63])  # default CC7 100, centre pan, left side
    assert (out * FULL_SCALE).astype(np.int64).tolist() == ((ramp_at * gain) >> 13).tolist()


@pytest.mark.parametrize(("mixed_first", "mixed_last", "level"), [
    (((15, 14, 13), 0), ((1, 0), 1), 3283),  # 3 * 14741 saturates at 32767 before the two -14742
    (((15, 14), 1), ((2, 1, 0), 0), 14739),  # no partial sum leaves 16 bits
])
def test_voices_saturate_the_16_bit_mix_one_at_a_time_lowest_priority_first(mixed_first, mixed_last, level):
    # Measured on dmsynth.dll: each voice adds into the half-scale 16-bit mix with saturation, in
    # the voice queue's order (channel priority ascending: 16 ... 11, 9 ... 1, then 10).
    col = decode_dls(build_dls(
        [instrument(p, [region(wave=p, sample=wsmp(unity=69, loop=(0, 2205)))], articulation=envelope(release=tc(0.01)))
         for p in (0, 1)],
        [wave(flat(0.9)), wave(flat(-0.9))],  # 14741 and -14742 at full gain
    ))
    events = []
    for channels, program in (mixed_first, mixed_last):
        for ch in channels:
            events += [(0.0, "cc", ch, (7, 127)), (0.0, "cc", ch, (11, 127)), (0.0, "cc", ch, (10, 0)),
                       (0.0, "program", ch, (program,)), (0.0, "on", ch, (69, 127)), (0.2, "off", ch, (69, 0))]
    out = render(song(*events), col, RATE)

    assert round(out[1000, 0] * FULL_SCALE) == level
