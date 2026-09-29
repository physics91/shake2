import numpy as np
import pytest

from dls_builders import build_dls, instrument, region, sine, wave, wsmp
from shakefmt.dls import decode_dls
from shakefmt.dmreverb import clean_response, impulse_collection, solve_response
from shakefmt.reverb import Reverb, apply_reverb, load_reverb, save_reverb

RATE = 22050


def response(taps=8, **paths):
    """A response with unit taps: paths like LL=(delay, gain) route input to output."""
    h = np.zeros((taps, 2, 2))
    for name, (delay, gain) in paths.items():
        out, inp = "LR".index(name[1]), "LR".index(name[0])
        h[delay, out, inp] = gain
    return h


def test_output_is_the_scaled_dry_plus_each_input_through_its_path():
    x = np.zeros((6, 2))
    x[0] = [1.0, 0.0]
    x[2] = [0.0, 0.5]
    y = apply_reverb(x, Reverb(dry_gain=0.9, response=response(LL=(3, 0.25), RL=(1, 0.5)), rate=RATE))
    assert y.shape == (6 + 8 - 1, 2)
    expected = np.zeros_like(y)
    expected[:6] = 0.9 * x
    expected[3, 0] += 0.25  # L at 0, delayed 3 on the left
    expected[3, 0] += 0.25  # R 0.5 at 2, delayed 1, gain 0.5, onto the left
    np.testing.assert_allclose(y, expected, atol=1e-9)


def test_each_side_can_feed_the_other():
    x = np.zeros((4, 2))
    x[0, 0] = 1.0
    y = apply_reverb(x, Reverb(dry_gain=0.0, response=response(LR=(2, 1.0)), rate=RATE))
    assert y[2, 1] == pytest.approx(1.0)
    assert np.abs(y[:, 0]).max() < 1e-9


def test_a_saved_reverb_reads_back(tmp_path):
    reverb = Reverb(dry_gain=0.94868, response=np.random.default_rng(1).normal(size=(32, 2, 2)), rate=RATE, note="x")
    save_reverb(tmp_path / "r.npz", reverb)
    back = load_reverb(tmp_path / "r.npz")
    assert back.dry_gain == pytest.approx(reverb.dry_gain)
    assert back.rate == RATE and back.note == "x"
    np.testing.assert_allclose(back.response, reverb.response.astype(np.float32))


def convolve(x, h):
    n = len(x)
    y = np.zeros((n + len(h) - 1, 2))
    for out in (0, 1):
        for inp in (0, 1):
            y[:, out] += np.convolve(x[:, inp], h[:, out, inp])
    return y[:n]


def test_the_two_hard_panned_captures_give_back_all_four_paths():
    rng = np.random.default_rng(3)
    taps = 64
    h = rng.normal(size=(taps, 2, 2)) * np.exp(-np.arange(taps) / 12)[:, None, None]
    n = 512
    pulse = np.zeros((n, 2))
    pulse[10] = [1372, 76]
    pulse[11] = [5940, 330]  # the far side at the -25 dB pan floor
    left, right = pulse, pulse[:, ::-1].copy()
    solved = solve_response(left, convolve(left, h), right, convolve(right, h), taps)
    np.testing.assert_allclose(solved, h, atol=1e-6)


def test_cleaning_cuts_where_the_tail_meets_the_noise_and_fades_it_out():
    taps = RATE
    t = np.arange(taps) / RATE
    tail = np.exp(-t / 0.1) * np.sin(2 * np.pi * 300 * t) * 0.05
    noise = np.random.default_rng(5).normal(scale=1e-5, size=(taps, 2, 2))
    h = noise.copy()
    h[:, 0, 0] += tail
    h[:, 1, 1] -= tail
    cleaned = clean_response(h, RATE, floor_from=0.9)
    # Over the four paths the tail's mean power 0.05^2/4 e^(-20t) meets the noise's 1e-10 at 0.785 s.
    assert 0.77 * RATE < len(cleaned) < 0.82 * RATE
    assert abs(cleaned[-20:]).max() < 1e-5
    early = slice(0, int(0.1 * RATE))
    np.testing.assert_allclose(cleaned[early, 0, 0], h[early, 0, 0])


def test_the_impulse_instrument_is_a_one_region_unlooped_gm_instrument_with_its_wave_zeroed_but_one_sample():
    looped = instrument(0, [region(wave=0, sample=wsmp(unity=60, loop=(0, 100)))])
    two = instrument(1, [region(key=(0, 60), wave=1, sample=wsmp(unity=60)), region(key=(61, 127), wave=1)])
    single = instrument(5, [region(wave=1, sample=wsmp(unity=67))])
    gm = build_dls([looped, two, single], [wave(sine(441, 0.01)), wave(sine(882, 0.01))])
    blob, program, unity = impulse_collection(gm)
    col = decode_dls(blob)
    assert (program, unity) == (5, 67)
    assert len(col.instruments) == 1 and col.instruments[0].program == 5
    samples = col.waves[0].pcm
    assert np.count_nonzero(samples) == 1 and samples.max() > 0.99
