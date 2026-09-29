"""Integer voice engine of the Microsoft Software Synthesizer, as published in ddksynth.

Follows the WDK "DirectMusic Software Synthesizer Sample" (voice.cpp, mix.cpp, instr.cpp,
midi.cpp) in its own fixed-point arithmetic, which this PC's dmsynth.dll reproduces bit for
bit wherever the control points agree (original/FIDELITY.md §2.1):

- Control rate: a voice mixes in spans that end at the next point of its envelopes or LFO,
  50 ms at most (m_stMaxSpan) and never past the end of the render buffer. Volume and pitch
  are evaluated at the END of each span and approached in a staircase: every `period`
  samples the gain and the pitch step by MulDiv(new - last, period << 8, length), and at the
  span's end they land on the new values.
- Envelope points: attack end; 1/4, 1/2 and end of decay and release (100 samples of slack);
  sustain re-checked every 44100 samples. The LFO asks for a point every 2097152 / pf samples
  once any of its depths is set.
- Tables: vfDbToVolume, vrMIDIToVREL, svrPanToVREL, snAttackTable and snSineTable are the
  published values (their generating formulas reproduce them exactly); pitch goes through
  floor(4096 * 2^x) cent and semitone tables with a 12-bit position fraction.

Measured on this PC's dmsynth.dll, where it differs from the sample:
- The render buffer is 441 samples (20 ms); its phase against the song changes between runs
  and jumps by about half a buffer within one, so it is fixed here at the song start.
- A span longer than 8 samples steps at period - 2, 2 * period - 2, ... (samples mixed in
  pairs), one sample earlier than the sample's C loop; shorter spans step at period - 1.
- The gain multiplies as a 16-bit value, (gain << 3 with 3 bits of the staircase's fraction)
  * sample >> 16, so a gain on the move is finer than the sample's Mix16; at rest the two agree.
- A zero attack still takes 1 ms (22 samples).
- Each voice adds into the 16-bit mix with saturation (the sample's Mix16 does too), in queue
  order: a partial sum can clip even when the whole would not.
- The mix is twice Mix16 >> 13 (applied by the caller: FULL_SCALE).

The pairwise stepping and the 16-bit gain are the 32-bit dmsynth.dll's, which the game loads; the
64-bit build on the same PC runs the sample's C loop (period - 1, 12-bit gain) instead.
"""

import math
from dataclasses import dataclass

import numpy as np

FOREVER = 0x7FFF_FFFF_FFFF_FFFF
MIN_VOLUME = -9600  # VREL of silence (1/100 dB)
PERCEIVED_MIN_VOLUME = -8000  # a released voice ends once its envelope is below this
MAX_PITCH_CENTS = 4800
MIN_ATTACK_SECONDS = 0.001  # measured: a zero attack reaches full level 22 samples in
BUFFER_SECONDS = 0.02  # measured: the synthesizer renders 441 samples at a time
FULL_SCALE = 16384  # a voice at unity mixes to Mix16 >> 13, doubled on output: 1.0 at 16384
PAIR_MIXING_ABOVE = 8  # longer spans take the pairwise mixer
MIX_MIN, MIX_MAX = -32768, 32767  # the mix buffer is 16-bit, half of the output scale
ABSOLUTE_ZERO = -0x80000000

CENT_STEPS = [math.floor(4096 * 2 ** ((i - 100) / 1200)) for i in range(201)]
SEMITONE_STEPS = [math.floor(4096 * 2 ** ((i - 48) / 12)) for i in range(97)]
VOLUME_STEPS = [math.floor(10 ** ((i - 1000) / 200) * 4095) for i in range(1001)]  # vfDbToVolume
MIDI_VREL = [MIN_VOLUME] + [max(int(4000 * math.log10(i / 127)), MIN_VOLUME) for i in range(1, 128)]
PAN_VREL = [-2500] + [max(int(1000 * math.log10(i / 127)), -2500) for i in range(1, 128)]
ATTACK_CURVE = [0] + [int(math.log10((i / 200) ** 2) * 10000 / 96 + 1000) for i in range(1, 201)]
SINE = [int(math.sin(2 * math.pi * i / 256) * 100) for i in range(256)]

SRC_NONE, SRC_LFO, SRC_VELOCITY, SRC_KEY, SRC_EG2, SRC_CC1 = 0, 1, 2, 3, 5, 0x81
DST_ATTENUATION, DST_PITCH, DST_PAN = 0x001, 0x003, 0x004
DST_LFO_FREQUENCY, DST_LFO_DELAY = 0x104, 0x105
EG_TIMES = {0x206: ("eg1", "attack"), 0x207: ("eg1", "decay"), 0x209: ("eg1", "release"),
            0x30A: ("eg2", "attack"), 0x30B: ("eg2", "decay"), 0x30D: ("eg2", "release")}
EG_SUSTAIN = {0x20A: "eg1", 0x30E: "eg2"}


def _clamp(value, low, high):
    return min(max(value, low), high)


def cdiv(a: int, b: int) -> int:
    """C integer division (truncates toward zero)."""
    q = abs(a) // abs(b)
    return q if (a < 0) == (b < 0) else -q


def muldiv(a: int, b: int, c: int) -> int:
    """Win32 MulDiv: a * b / c rounded half away from zero."""
    if c == 0:
        return -1
    if c < 0:
        a, c = -a, -c
    product = a * b
    return cdiv(product + c // 2, c) if product >= 0 else cdiv(product - c // 2, c)


def cents_to_fixed(cents: int) -> int:
    """PRELToPFRACT: a pitch offset in cents as a 12-bit fixed-point rate."""
    cents = _clamp(int(cents), -MAX_PITCH_CENTS, MAX_PITCH_CENTS)
    if -100 <= cents <= 100:
        return CENT_STEPS[cents + 100]
    semitones, rest = divmod(abs(cents), 100)
    if cents > 0:
        rate = CENT_STEPS[rest + 100] << (semitones // 12)
        return rate * SEMITONE_STEPS[semitones % 12 + 48] >> 12
    rate = CENT_STEPS[100 - rest] >> (semitones // 12)
    return rate * SEMITONE_STEPS[48 - semitones % 12] >> 12


def volume_fraction(vrel: int) -> int:
    """VRELToVFRACT: 1/100 dB to a 12-bit gain, in 0.1 dB steps from -100 dB to 0 dB."""
    return VOLUME_STEPS[_clamp(cdiv(vrel, 10), -1000, 0) + 1000]


def time_cents_samples(scale: int, rate: int) -> int:
    if scale == ABSOLUTE_ZERO:
        return 0
    return _clamp(int(2.0 ** (scale / 65536 / 1200) * rate), 0, 1_764_000)


def lfo_step(scale: int, rate: int) -> int:
    """PitchCents2PitchFract: the LFO's phase step, 1/65536 of a sine-table entry per sample."""
    return _clamp(int(2.0 ** ((scale / 65536 - 6900) / 1200) * 7381975040.0 / rate), 64, 7600)


@dataclass
class EgSource:
    attack: int = 0
    decay: int = 0
    sustain: int = 1000
    release: int = 0
    velocity_attack: int = 0
    key_decay: int = 0
    pitch_scale: int = 0


@dataclass
class LfoSource:
    step: int
    delay: int = 0
    volume: int = 0
    pitch: int = 0
    wheel_volume: int = 0
    wheel_pitch: int = 0


@dataclass
class VoiceArticulation:
    eg1: EgSource
    eg2: EgSource
    lfo: LfoSource
    default_pan: int = 0


def parse_articulation(connections, rate: int) -> VoiceArticulation:
    """CSourceArticulation::Download (DX7 connection list) and the Verify bounds."""
    eg = {"eg1": EgSource(), "eg2": EgSource()}
    lfo = LfoSource(step=(256 * 4096 * 16 * 5) // rate)
    default_pan = 0
    for c in connections:
        source, control, dst, scale = c.source, c.control, c.destination, c.scale
        if source == SRC_NONE:
            if dst in EG_TIMES:
                name, key = EG_TIMES[dst]
                setattr(eg[name], key, time_cents_samples(scale, rate))
            elif dst in EG_SUSTAIN:
                eg[EG_SUSTAIN[dst]].sustain = _clamp(scale >> 16, 0, 1000)
            elif dst == DST_LFO_FREQUENCY:
                lfo.step = lfo_step(scale, rate)
            elif dst == DST_LFO_DELAY:
                lfo.delay = _clamp(time_cents_samples(scale, rate), 0, 441_000)
            elif dst == DST_PAN:
                default_pan = cdiv(scale >> 12, 125)
        elif source == SRC_LFO and dst in (DST_ATTENUATION, DST_PITCH):
            depth = _clamp((scale * 10) >> 16 if dst == DST_ATTENUATION else scale >> 16, -1200, 1200)
            prefix = "wheel_" if control == SRC_CC1 else ""
            if control in (SRC_NONE, SRC_CC1):
                setattr(lfo, prefix + ("volume" if dst == DST_ATTENUATION else "pitch"), depth)
        elif source == SRC_VELOCITY and dst in (0x206, 0x30A):
            eg["eg1" if dst == 0x206 else "eg2"].velocity_attack = _clamp(scale >> 16, -12000, 12000)
        elif source == SRC_KEY and dst in (0x207, 0x30B):
            eg["eg1" if dst == 0x207 else "eg2"].key_decay = _clamp(scale >> 16, -12000, 12000)
        elif source == SRC_EG2 and dst == DST_PITCH:
            eg["eg2"].pitch_scale = _clamp(scale >> 16, -1200, 1200)
    return VoiceArticulation(eg["eg1"], eg["eg2"], lfo, default_pan)


class Envelope:
    """CVoiceEG: levels 0..1000, times in samples."""

    def __init__(self, source: EgSource, start: int, key: int, velocity: int, min_attack: int = 0):
        self.start = start
        self.stop = FOREVER
        attack = source.attack * cents_to_fixed(cdiv(velocity * source.velocity_attack, 127)) // 4096
        self.attack = max(attack, min_attack)
        decay = source.decay * cents_to_fixed(cdiv(key * source.key_decay, 127)) // 4096
        self.sustain = source.sustain
        self.decay = decay * (1000 - source.sustain) // 1000
        self.release = source.release
        self.pitch_scale = source.pitch_scale

    def held_level(self, t: int, volume: bool) -> tuple[int, int]:
        t -= self.start
        if t < self.attack:
            level = _clamp(1000 * t // self.attack, 0, 1000) if self.attack else 0
            return (ATTACK_CURVE[level // 5] if volume else level), self.attack - t
        t -= self.attack
        if t < self.decay:
            return 1000 - (1000 - self.sustain) * t // self.decay, _next_point(t, self.decay)
        return self.sustain, 44100

    def level(self, t: int, volume: bool) -> tuple[int, int]:
        """The level at t and the samples until the envelope's next point."""
        if t <= self.stop:
            return self.held_level(t, volume)
        t -= self.stop
        if t < self.release:
            held = self.held_level(self.stop, volume)[0]
            return held * (self.release - t) // self.release, _next_point(t, self.release)
        return 0, FOREVER

    def stop_at(self, t: int):
        """StopVoice: the release shortens in proportion to the level it starts from."""
        self.release = self.release * self.level(t, True)[0] // 1000
        self.stop = t

    def quick_stop_at(self, t: int, rate: int):
        """QuickStopVoice: as StopVoice, but over 1/70 s at most."""
        self.stop_at(t)
        self.release = min(self.release, rate // 70)

    def volume(self, t: int) -> tuple[int, int]:
        level, nxt = self.level(t, True)
        return level * 96 // 10 - 9600, nxt

    def pitch(self, t: int) -> tuple[int, int]:
        if self.pitch_scale == 0:
            return 0, 44100
        level, nxt = self.level(t, False)
        return cdiv(level * self.pitch_scale, 1000), nxt


def _next_point(t: int, length: int) -> int:
    for point in (length >> 2, length >> 1):
        if t < point - 100:
            return point - t
    return length - t


class Lfo:
    """CVoiceLFO. The mod wheel stays at 0 in these tracks, but a wheel depth still sets the repeat."""

    def __init__(self, source: LfoSource, start: int):
        self.source = source
        self.start = start + source.delay
        depths = (source.volume, source.pitch, source.wheel_volume, source.wheel_pitch)
        self.repeat = 2097152 // source.step if any(depths) else 44100

    def _level(self, t: int) -> tuple[int, int]:
        t -= self.start
        if t < 0:
            return 0, -t
        return SINE[(t * self.source.step >> 16) & 0xFF], self.repeat

    def volume(self, t: int) -> tuple[int, int]:
        level, nxt = self._level(t)
        return cdiv(self.source.volume * level, 100), nxt

    def pitch(self, t: int) -> tuple[int, int]:
        level, nxt = self._level(t)
        return cdiv(self.source.pitch * level, 100), nxt


class Timeline:
    """A channel control's value over time (CMIDIRecorder::GetData: the last value at or before t)."""

    def __init__(self, points, rate: int):
        self.times = np.array([-FOREVER if t == -math.inf else int(round(t * rate)) for t, _ in points], np.int64)
        self.values = [int(v) for _, v in points]

    def at(self, t: int) -> int:
        return self.values[int(np.searchsorted(self.times, t, side="right")) - 1]


@dataclass
class ChannelControls:
    volume: Timeline
    expression: Timeline
    pan: Timeline
    bend: Timeline  # cents

    @classmethod
    def of(cls, channel, rate: int) -> "ChannelControls":
        return cls(*(Timeline(points, rate) for points in (channel.volume, channel.expression, channel.pan, channel.bend_cents)))


class MixVoice:
    """CVoice with its CDigitalAudio: one note from its start to the end of its release.

    `voice` is a scheduled note (shakefmt.synth.Voice): start/cut in seconds, key, velocity,
    connections, sample, wave_rate, pcm, and events [(seconds, "stop" | "quick")] in the order
    the scheduler issued them.
    """

    def __init__(self, voice, controls: ChannelControls, rate: int):
        self.rate = rate
        self.max_span = (rate + 19) // 20
        art = parse_articulation(voice.connections, rate)
        self.default_pan = art.default_pan
        self.start = int(round(voice.start * rate))
        self.cut = FOREVER if voice.cut == math.inf else int(round(voice.cut * rate))
        self.eg1 = Envelope(art.eg1, self.start, voice.key, voice.velocity, int(MIN_ATTACK_SECONDS * rate))
        self.eg2 = Envelope(art.eg2, self.start, voice.key, voice.velocity)
        self.lfo = Lfo(art.lfo, self.start)
        self.controls = controls
        self.events = [(int(round(t * rate)), kind) for t, kind in voice.events]
        self.stop = FOREVER
        self.note_on = True
        self.in_use = True

        sample = voice.sample
        self.base = MIDI_VREL[voice.velocity] + _clamp((sample.attenuation * 10) >> 16, -9600, 0)
        tuning = _clamp(sample.fine_tune, -1200, 1200) + (voice.key - sample.unity_note) * 100
        self.base_pitch = cents_to_fixed(tuning) * voice.wave_rate // rate
        self._load_wave(np.rint(np.asarray(voice.pcm, np.float64) * 32768).astype(np.int64), sample.loop)

        self.last_gain = [volume_fraction(MIN_VOLUME)] * 2
        self.last_vrel = [0, 0]
        self.last_prel = 0
        self.last_pitch = self.base_pitch
        self.position = 0
        self.mix_time = min(self.lfo.repeat, self.eg2.attack, self.eg1.attack, self.max_span)
        self.last_mix = self.start - 1
        if self.mix_time == 0:  # an instant envelope: take the start values without mixing
            pitch = self._new_pitch(self.start)
            self._mix(None, self.start, 0, self._new_volume(self.start), pitch)

    def _load_wave(self, data: np.ndarray, loop):
        """CWave adds one sample for interpolation; CopyFromWave sets it to the loop start or 0."""
        n = len(data)
        self.wave = np.concatenate([data, [0]])
        if loop is not None and loop[1] >= 6:
            start = loop[0] if loop[0] < n + 1 else 0
            end = min(loop[0] + loop[1], n + 1)
            self.wave[n] = self.wave[start]
            self.loop = (start << 12, (end - start) << 12)
            self.length = (n + 1) << 12
        else:
            self.loop = None
            self.length = n << 12

    def mix_into(self, out: np.ndarray, buffer: int):
        """Mix the voice into `out` (int64, stereo) in render buffers of `buffer` samples."""
        first = self.start // buffer * buffer
        for begin in range(first, len(out), buffer):
            self._mix_buffer(out, begin, min(begin + buffer, len(out)))
            if not self.in_use:
                break

    def _apply_events(self, before: int):
        """QueueNotes: stops that fall inside the buffer act before it is mixed."""
        while self.events and self.events[0][0] < before:
            t, kind = self.events.pop(0)
            t = max(t, self.start + 1)
            if self.note_on:
                self.eg2.stop_at(t)
                if kind == "quick":
                    self.eg1.quick_stop_at(t, self.rate)
                else:
                    self.eg1.stop_at(t)
                self.note_on = False
                self.stop = t
            elif kind == "quick":
                self.eg1.quick_stop_at(self.stop, self.rate)

    def _mix_buffer(self, out, begin: int, end: int):
        if self.cut < end:  # stolen by a note in this buffer: cleared before it is mixed
            self.in_use = False
            return
        self._apply_events(end)
        span_start = max(self.start, begin, self.last_mix)
        in_use, full = True, True
        span_end = span_start
        while span_start < end and in_use:
            span_end = min(span_start + self.mix_time, end)
            self.mix_time = self.max_span
            if self.last_mix < self.stop < end:
                self.mix_time = min(self.mix_time, self.stop - self.last_mix)
            pitch = self._new_pitch(span_end)
            volume = self._new_volume(span_end)
            if span_end > self.eg1.stop and self.envelope_vrel < PERCEIVED_MIN_VOLUME:
                in_use = False
            full = self._mix(out, span_start, span_end - span_start, volume, pitch)
            span_start = span_end
        self.in_use = in_use and full
        self.last_mix = span_end

    def _next_point(self, nxt: int):
        self.mix_time = min(self.mix_time, nxt)

    def _new_pitch(self, t: int) -> int:
        lfo, nxt = self.lfo.pitch(t)
        self._next_point(nxt)
        eg, nxt = self.eg2.pitch(t)
        self._next_point(nxt)
        return lfo + eg + self.controls.bend.at(t)

    def _new_volume(self, t: int) -> tuple[int, int]:
        vrel, nxt = self.eg1.volume(t)
        self._next_point(nxt)
        self.envelope_vrel = vrel
        lfo, nxt = self.lfo.volume(t)
        self._next_point(nxt)
        c = self.controls
        vrel += lfo + MIDI_VREL[c.expression.at(t)] + MIDI_VREL[c.volume.at(t)]
        pan = _clamp(c.pan.at(t) + self.default_pan, 0, 127)
        return vrel + PAN_VREL[127 - pan], vrel + PAN_VREL[pan]

    def _mix(self, out, first: int, length: int, vrel: tuple[int, int], prel: int) -> bool:
        """CDigitalAudio::Mix and Mix16: one span, the gains and pitch stepping toward the new values."""
        pitch = self.base_pitch * cents_to_fixed(prel) >> 12
        gains = [volume_fraction(self.base + v) for v in vrel]
        if length == 0:
            self.last_pitch, self.last_gain, self.last_vrel, self.last_prel = pitch, gains, list(vrel), prel
            return True
        change = max(abs(vrel[0] - self.last_vrel[0]), abs(vrel[1] - self.last_vrel[1]), abs(prel - self.last_prel) << 1) >> 1
        self.last_vrel, self.last_prel = list(vrel), prel
        period = _clamp((length << 3) // change, 1, 512) if change > 0 else 512
        period = (period + 3) & ~3
        if self.loop is not None and self.loop[1] <= pitch:
            return False

        k = np.arange(length, dtype=np.int64)
        steps = (k + (2 if length > PAIR_MIXING_ABOVE else 1)) // period
        step_pitch = muldiv(pitch - self.last_pitch, period << 8, length)
        pitches = ((self.last_pitch << 8) + steps * step_pitch) >> 8
        positions = self.position + np.concatenate(([0], np.cumsum(pitches[:-1])))
        after = int(positions[-1] + pitches[-1])
        complete = True
        if self.loop is not None:
            start, size = self.loop
            wrap = positions >= start + size
            positions[wrap] = start + (positions[wrap] - start) % size
            if after >= start + size:
                after = start + (after - start) % size
        else:
            past = np.flatnonzero(positions >= self.length)
            if len(past):
                positions, steps, complete = positions[: past[0]], steps[: past[0]], False
        index = positions >> 12
        a = self.wave[index]
        signal = (((self.wave[index + 1] - a) * (positions & 0xFFF)) >> 12) + a
        for side in (0, 1):
            step_gain = muldiv(gains[side] - self.last_gain[side], period << 8, length)
            gain = ((self.last_gain[side] << 8) + steps * step_gain) >> 5  # 16 bits: gain << 3 and 3 bits of its fraction
            if out is not None:
                mixed = out[first: first + len(signal), side]
                np.clip(mixed + ((signal * gain) >> 16), MIX_MIN, MIX_MAX, out=mixed)  # the 16-bit mix saturates
        self.position = after
        if not complete:
            return False
        self.last_gain, self.last_pitch = gains, pitch
        return True


def mix(voices, controls, total: int, rate: int) -> np.ndarray:
    """Mix scheduled voices into `total` stereo samples (int64, FULL_SCALE = 1.0).

    Voices mix in the synthesizer's queue order, priority ascending and older first within a
    priority (CSynth::QueueVoice), since each one saturates the 16-bit mix as it adds.
    """
    out = np.zeros((total, 2), np.int64)
    buffer = int(round(BUFFER_SECONDS * rate))
    for voice in sorted(voices, key=lambda v: v.priority):
        MixVoice(voice, controls[voice.channel], rate).mix_into(out, buffer)
    return out
