"""The DirectMusic synthesizer's built-in reverb, applied from a measured response.

shake.exe opens DirectMusic through the DirectX 7 interfaces and never touches the
port's effects, so its music plays with the DLS Level 1 synthesizer's default
reverb (SimpleVerb, Waves TrueVerb; fInGain 0 dB, fReverbMix -10 dB, fReverbTime
1000 ms, fHighFreqRTRatio 0.001). Measured on dmsynth.dll (shakefmt.dmreverb) it
is linear and time-invariant down to its fixed-point floor, and takes the mix
before the output clips (it saturates itself only near twice full scale): each
output side is the dry signal times `dry_gain` plus both input sides through
their own impulse responses.
"""

from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass(frozen=True)
class Reverb:
    dry_gain: float
    response: np.ndarray  # [taps, out side, in side]
    rate: int
    note: str = ""


def apply_reverb(audio: np.ndarray, reverb: Reverb) -> np.ndarray:
    """Stereo float audio through the reverb; the result is longer by the response's tail."""
    n, taps = len(audio), len(reverb.response)
    total = n + taps - 1
    size = 1 << max(1, (total - 1).bit_length())
    inputs = np.fft.rfft(audio.astype(np.float64), size, axis=0)
    paths = np.fft.rfft(reverb.response.astype(np.float64), size, axis=0)
    out = np.zeros((total, 2))
    out[:n] = reverb.dry_gain * audio
    for side in (0, 1):
        wet = paths[:, side, 0] * inputs[:, 0] + paths[:, side, 1] * inputs[:, 1]
        out[:, side] += np.fft.irfft(wet, size)[:total]
    return out


def save_reverb(path: Path, reverb: Reverb):
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, dry_gain=reverb.dry_gain, response=reverb.response.astype(np.float32),
                        rate=reverb.rate, note=np.array(reverb.note))


def load_reverb(path: Path) -> Reverb:
    with np.load(path) as data:
        return Reverb(dry_gain=float(data["dry_gain"]), response=data["response"], rate=int(data["rate"]),
                      note=str(data["note"]))
