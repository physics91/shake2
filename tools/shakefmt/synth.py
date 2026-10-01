"""Offline DLS Level 1 renderer that follows the Microsoft DirectMusic synthesizer.

shake.exe plays `bgm/*.mid` through DirectMusic's default port, the Microsoft
Software Synthesizer with the Windows `gm.dls` collection. The behaviour below
follows the DLS Level 1 model as implemented by Microsoft's published DirectMusic
synthesizer sample (WDK "DirectMusic Software Synthesizer Sample", ddksynth:
voice.cpp, control.cpp, csynth.cpp, instr.cpp, midi.cpp):

- 22050 Hz mixing, linear interpolation, forward loops.
- Velocity, CC7 and CC11 attenuate by 40*log10(v/127) (vrMIDIToVREL).
- Pan index = CC10 + articulation default pan (scale >> 12 / 125), gains
  10*log10(i/127) dB per side with a -25 dB floor (svrPanToVREL).
- EG1 levels are 0..1000 over a 96 dB range: attack along a log curve,
  decay linear in level for decay * (1000 - sustain) / 1000, release from the
  current level over release * level / 1000. Key/velocity scaling uses n/127.
  A released voice ends below -80 dB (PERCEIVED_MIN_VOLUME).
- EG2 (pitch) is the same shape without the attack curve, times its scale.
- LFO is a sine starting after its delay, feeding pitch (cents) and volume.
- Voices mix at the synthesizer's control rate in its own integer arithmetic
  (shakefmt.dmvoice): volume and pitch are evaluated at the end of spans of up
  to 50 ms and approached in a staircase.
- 32 voices plus 8 kept in reserve: before each mix, voices beyond 32 are
  quick-stopped by priority and age (StealNotes); a note-on with no free voice
  steals one (StealVoice). Quick stop releases within 1/70 s.
- A note-on quick-stops the same key on its channel unless the region allows
  overlap, and every voice of the same key group, channel and program.
- Note-off releases only the first matching voice in the queue.
- Controllers as control.cpp takes them: any CC64 value but 0 holds; CC121 resets
  expression and bend (volume and pan too when it has a value) and lets the pedal go;
  RPN 0's data entry MSB sets the bend range in semitones (LSB ignored, NRPN deselects),
  and a bend already held takes a new range at once (midi.cpp keeps no time-stamped range).
- Regions are chosen by key alone, and an instrument without a region for the key is
  passed over (instr.cpp).
- Bank select is ignored: shake.exe sets GUID_StandardMIDIFile (the same GUID as
  GUID_IgnoreBankSelectForGM) on every segment, and a variation bank that gm.dls
  has still plays bank 0 on the real synthesizer. A drum kit gm.dls lacks, or one
  without the key, plays the standard kit, which the lobby tracks shake.exe downloads
  at start keep on the port (alone, kit 1 is silent).

Measured on this PC's dmsynth.dll against the published sample (shakefmt.bgm,
shakefmt.dmvoice and original/FIDELITY.md): a voice at unity reaches full scale, twice
the sample's Mix16 >> 13; a zero attack still rises over 1 ms; the render buffer, which
also ends control spans, is 441 samples.

The default port's reverb is applied after mixing, from a response measured on the
real synthesizer (shakefmt.dmreverb, shakefmt.reverb, applied in shakefmt.bgm); the
port has no chorus (its effect caps are reverb only).

The float envelopes here only rank voices for stealing and retire finished ones;
the audio comes from the integer envelopes in shakefmt.dmvoice.

Not modelled: the mod wheel (CC1 is not used by the tracks), the render buffer's phase
(it changes between runs; fixed at the song start).
"""

import math
from dataclasses import dataclass, field

import numpy as np

from .dls import Collection, Instrument, Region, Sample, find_instrument, find_region
from .dmvoice import ABSOLUTE_ZERO, FULL_SCALE, MIN_ATTACK_SECONDS, ChannelControls, cents_to_fixed, mix
from .midi import Song

RANGE_DB = 96.0
DRUM_CHANNEL = 9
VOICES = 32
EXTRA_VOICES = 8
QUICK_STOP_SECONDS = 1 / 70
END_LEVEL = 1000 * (RANGE_DB - 80) / RANGE_DB  # -80 dB on the 0..1000 EG scale
MAX_EG_SECONDS = 1_764_000 / 22050

SRC_NONE, SRC_VELOCITY, SRC_KEY = 0, 2, 3
EG1 = {"attack": 0x206, "decay": 0x207, "release": 0x209, "sustain": 0x20A}
EG2 = {"attack": 0x30A, "decay": 0x30B, "release": 0x30D, "sustain": 0x30E}
RGN_SELF_NON_EXCLUSIVE = 1

# dmusicc.h DAUD_CHANn_VOICE_PRIORITY_OFFSET: channel 10 first, then 1-9, then 11-16; the
# default port reports the same (GetChannelPriority).
CHANNEL_PRIORITY = {9: 15, **{ch: 14 - ch for ch in range(9)}, **{ch: 15 - ch for ch in range(10, 16)}}


def _base_step(base_cents: int, wave_rate: int, rate: int) -> int:
    return cents_to_fixed(base_cents) * wave_rate // rate


def pitch_step(base_cents: int, cents: int, wave_rate: int, rate: int) -> float:
    """Samples of the wave per output sample: the note's base rate times the modulation."""
    return (_base_step(base_cents, wave_rate, rate) * cents_to_fixed(cents) >> 12) / 4096


def time_cents_seconds(scale: int) -> float:
    if scale <= ABSOLUTE_ZERO:
        return 0.0
    return min(2.0 ** (scale / 65536 / 1200), MAX_EG_SECONDS)


def _clamp(value, low, high):
    return min(max(value, low), high)


@dataclass(frozen=True)
class EgSpec:
    attack: float = 0.0
    decay: float = 0.0
    sustain: float = 1000.0
    release: float = 0.0
    velocity_attack_tc: float = 0.0
    key_decay_tc: float = 0.0


@dataclass(frozen=True)
class Articulation:
    eg1: EgSpec
    eg2: EgSpec


def parse_articulation(connections) -> Articulation:
    """The envelopes in seconds, for ranking and retiring voices."""
    eg = {"eg1": {}, "eg2": {}}
    for c in connections:
        source, control, dst, scale = c.source, c.control, c.destination, c.scale
        if control != SRC_NONE:
            continue  # mod-wheel connections: CC1 is not used by the tracks
        if source == SRC_NONE:
            for name, table in (("eg1", EG1), ("eg2", EG2)):
                for key, code in table.items():
                    if dst == code:
                        eg[name][key] = _clamp(scale >> 16, 0, 1000) if key == "sustain" else time_cents_seconds(scale)
        elif source == SRC_VELOCITY and dst in (EG1["attack"], EG2["attack"]):
            eg["eg1" if dst == EG1["attack"] else "eg2"]["velocity_attack_tc"] = scale >> 16
        elif source == SRC_KEY and dst in (EG1["decay"], EG2["decay"]):
            eg["eg1" if dst == EG1["decay"] else "eg2"]["key_decay_tc"] = scale >> 16
    return Articulation(EgSpec(**eg["eg1"]), EgSpec(**eg["eg2"]))


class Envelope:
    """One envelope generator on a single note, in seconds relative to note-on."""

    def __init__(self, spec: EgSpec, key: int, velocity: int, volume: bool):
        self.volume = volume
        self.attack = spec.attack * 2 ** (_clamp(velocity * spec.velocity_attack_tc / 127, -4800, 4800) / 1200)
        if volume:
            self.attack = max(self.attack, MIN_ATTACK_SECONDS)
        decay = spec.decay * 2 ** (_clamp(key * spec.key_decay_tc / 127, -4800, 4800) / 1200)
        self.sustain = spec.sustain
        self.decay = decay * (1000 - spec.sustain) / 1000
        self.release = spec.release
        self.stop_time = math.inf
        self.stop_level = 0.0
        self.release_time = 0.0
        self.override_from = math.inf
        self.override_release = 0.0

    def held_level(self, t):
        t = np.asarray(t, np.float64)
        level = np.full(t.shape, float(self.sustain))
        attacking = t < self.attack
        if self.attack > 0:
            linear = np.clip(t[attacking] / self.attack * 1000, 0, 1000)
            if self.volume:
                db = 20 * np.log10(np.maximum(linear, 1e-9) / 1000)
                linear = np.maximum(1000 + db * 1000 / RANGE_DB, 0)
            level[attacking] = linear
        decaying = ~attacking & (t < self.attack + self.decay)
        if self.decay > 0:
            level[decaying] = 1000 - (1000 - self.sustain) * (t[decaying] - self.attack) / self.decay
        return level

    def stop(self, t: float):
        if self.stop_time < math.inf:
            return
        self.stop_level = float(self.held_level(t))
        self.stop_time = t
        self.release_time = self.release * self.stop_level / 1000

    def quick_stop(self, t: float):
        if self.stop_time == math.inf:
            self.stop(t)
            self.release_time = min(self.release_time, QUICK_STOP_SECONDS)
        else:
            self.override_from = min(self.override_from, t)
            self.override_release = min(self.release_time * self.stop_level / 1000, QUICK_STOP_SECONDS)

    def _released(self, t, release_time):
        if release_time <= 0:
            return np.zeros(np.shape(t))
        return self.stop_level * np.maximum(release_time - (t - self.stop_time), 0) / release_time

    def level(self, t):
        t = np.asarray(t, np.float64)
        level = self.held_level(t)
        after = t > self.stop_time
        level[after] = self._released(t[after], self.release_time)
        late = t >= self.override_from
        level[late] = np.minimum(level[late], self._released(t[late], self.override_release))
        return level

    def end_time(self) -> float:
        """When a released voice falls below -80 dB (inf while held)."""
        if self.stop_time == math.inf:
            return math.inf

        def crossing(release_time):
            if self.stop_level <= END_LEVEL or release_time <= 0:
                return self.stop_time
            return self.stop_time + release_time * (1 - END_LEVEL / self.stop_level)

        end = crossing(self.release_time)
        if self.override_from < end:
            end = max(self.override_from, crossing(self.override_release))
        return end


def level_db(level):
    return np.asarray(level) * RANGE_DB / 1000 - RANGE_DB


@dataclass
class Channel:
    volume: list = field(default_factory=lambda: [(-math.inf, 100)])
    expression: list = field(default_factory=lambda: [(-math.inf, 127)])
    pan: list = field(default_factory=lambda: [(-math.inf, 64)])
    bend_cents: list = field(default_factory=lambda: [(-math.inf, 0)])
    program: int = 0
    bend: int = 0
    bend_range: float = 200.0
    rpn: tuple[int, int] = (127, 127)
    sustain: bool = False


def _set(timeline: list, t: float, value):
    if timeline[-1][0] == t:
        timeline[-1] = (t, value)
    else:
        timeline.append((t, value))


@dataclass
class Voice:
    channel: int
    key: int
    start: float
    priority: int
    program: tuple
    region: Region
    velocity: int
    sample: Sample
    connections: tuple
    eg1: Envelope
    eg2: Envelope
    base_cents: float
    wave_rate: int
    pcm: np.ndarray
    loop: tuple[int, int] | None
    note_on: bool = True
    sustain_on: bool = False
    tag: bool = False
    cut: float = math.inf
    events: list = field(default_factory=list)  # (seconds, "stop" | "quick") for shakefmt.dmvoice

    def sample_end(self) -> float:
        if self.loop is not None:
            return math.inf
        return self.start + len(self.pcm) / (self.wave_rate * 2 ** (self.base_cents / 1200))

    def end(self) -> float:
        return min(self.cut, self.sample_end(), self.start + self.eg1.end_time())

    def eg1_db(self, t: float) -> float:
        return float(level_db(self.eg1.level([t - self.start])[0]))


class Scheduler:
    """Voice allocation as in ddksynth CControlLogic::QueueNotes and CSynth."""

    def __init__(self, col: Collection):
        self.col = col
        self.channels = [Channel() for _ in range(16)]
        self.in_use: list[Voice] = []  # queue order: priority ascending, newer last within a priority
        self.voices: list[Voice] = []

    def retire(self, t: float):
        self.in_use = [v for v in self.in_use if v.end() > t]

    def stop(self, v: Voice, t: float):
        if v.note_on:
            v.events.append((t, "stop"))
            t = max(t, v.start + 1e-9)
            v.eg1.stop(t - v.start)
            v.eg2.stop(t - v.start)
            v.note_on = False
            v.sustain_on = False

    def quick_stop(self, v: Voice, t: float):
        v.tag = True
        v.events.append((t, "quick"))
        t = max(t, v.start + 1e-9)
        if v.note_on or v.sustain_on:
            v.eg2.stop(t - v.start)
            v.note_on = False
            v.sustain_on = False
        v.eg1.quick_stop(t - v.start)

    def oldest(self, t: float) -> Voice | None:
        best = self.in_use[0] if self.in_use else None
        for v in self.in_use[1:]:
            if v.tag:
                continue
            if best.tag:
                best = v
            elif v.priority <= best.priority:
                if v.note_on:
                    if best.note_on and best.start > v.start:
                        best = v
                elif best.note_on or best.eg1_db(t) > v.eg1_db(t):
                    best = v
        return None if best is None or best.tag else best

    def steal_notes(self, t: float):
        excess = len(self.in_use) - VOICES - sum(v.tag for v in self.in_use)
        for _ in range(excess):
            victim = self.oldest(t)
            if victim is None:
                break
            self.quick_stop(victim, t)

    def steal_voice(self, priority: int, t: float) -> bool:
        best = None
        for v in self.in_use:
            if v.priority > priority:
                continue
            if best is None:
                best = v
            elif not v.note_on:
                if best.note_on or best.eg1_db(t) > v.eg1_db(t):
                    best = v
            elif best.start > v.start:
                best = v
        if best is None:
            return False
        best.cut = t
        self.in_use.remove(best)
        return True

    def queue(self, voice: Voice):
        index = next((i for i, v in enumerate(self.in_use) if v.priority > voice.priority), len(self.in_use))
        self.in_use.insert(index, voice)

    def note_on(self, t: float, channel: int, key: int, velocity: int):
        ch = self.channels[channel]
        drums = channel == DRUM_CHANNEL
        inst = find_instrument(self.col, bank=0, program=ch.program, drums=drums, key=key)  # bank select ignored
        reg = find_region(inst, key) if inst else None
        if reg is None:
            return
        program = (inst.bank, inst.program, inst.drums)
        if not reg.options & RGN_SELF_NON_EXCLUSIVE:
            for v in self.in_use:
                if v.channel == channel and v.key == key:
                    self.quick_stop(v, t)
        if reg.key_group:
            for v in self.in_use:
                if v.region.key_group == reg.key_group and v.channel == channel and v.program == program:
                    self.quick_stop(v, t)
        priority = CHANNEL_PRIORITY[channel]
        if len(self.in_use) >= VOICES + EXTRA_VOICES and not self.steal_voice(priority, t):
            return

        sample = self.col.sample_for(reg)
        wave = self.col.waves[reg.wave_index]
        connections = reg.articulation or inst.articulation
        art = parse_articulation(connections)
        voice = Voice(
            channel=channel,
            key=key,
            start=t,
            priority=priority,
            program=program,
            region=reg,
            velocity=velocity,
            sample=sample,
            connections=connections,
            eg1=Envelope(art.eg1, key, velocity, volume=True),
            eg2=Envelope(art.eg2, key, velocity, volume=False),
            base_cents=_clamp((key - sample.unity_note) * 100 + _clamp(sample.fine_tune, -1200, 1200), -4800, 4800),
            wave_rate=wave.rate,
            pcm=wave.pcm,
            loop=sample.loop,
        )
        self.voices.append(voice)
        self.queue(voice)

    def note_off(self, t: float, channel: int, key: int):
        for v in self.in_use:
            if v.note_on and not v.sustain_on and v.key == key and v.channel == channel:
                if self.channels[channel].sustain:
                    v.sustain_on = True
                else:
                    self.stop(v, t)
                return

    def sustain(self, t: float, channel: int, on: bool):
        self.channels[channel].sustain = on
        if not on:
            for v in self.in_use:
                if v.sustain_on and v.channel == channel:
                    self.stop(v, t)

    def control(self, t: float, channel: int, number: int, value: int):
        ch = self.channels[channel]
        if number == 7:
            _set(ch.volume, t, value)
        elif number == 10:
            _set(ch.pan, t, value)
        elif number == 11:
            _set(ch.expression, t, value)
        elif number == 64:
            # NOTE_SUSTAIN keeps the value as a BOOL: any value but 0 holds.
            self.sustain(t, channel, value != 0)
        elif number in (101, 100):
            ch.rpn = (value, ch.rpn[1]) if number == 101 else (ch.rpn[0], value)
        elif number in (99, 98):
            ch.rpn = (127, 127)  # NOTE_CC_NRPN: no RPN selected (0x3FFF)
        elif number == 6 and ch.rpn == (0, 0):
            # Whole semitones: data entry LSB leaves the range alone ("Roland ignores lsb"). The range
            # is not time-stamped (CPitchBendIn::GetPitch), so the bend already held takes it.
            ch.bend_range = value * 100.0
            _set(ch.bend_cents, t, ch.bend * int(ch.bend_range) >> 13)
        elif number == 120:
            for v in self.in_use:
                if v.channel == channel:
                    self.stop(v, t)
        elif number == 121:
            # CC_RESETALL, then on into the sustain pedal's release.
            if value:
                _set(ch.volume, t, 100)
                _set(ch.pan, t, 64)
            _set(ch.expression, t, 127)
            ch.bend = 0
            _set(ch.bend_cents, t, 0.0)
            self.sustain(t, channel, False)
        elif number == 123:
            for v in self.in_use:
                if v.channel == channel and v.note_on and not v.sustain_on:
                    if ch.sustain:
                        v.sustain_on = True
                    else:
                        self.stop(v, t)

    def run(self, song: Song):
        mixed_until = -math.inf
        for event in song.events:
            t, channel = event.time, event.channel
            if t > mixed_until:  # StealNotes runs once per mix buffer, before its notes
                self.retire(t)
                self.steal_notes(t)
                mixed_until = t
            if event.kind == "on":
                self.note_on(t, channel, *event.data)
            elif event.kind == "off":
                self.note_off(t, channel, event.data[0])
            elif event.kind == "program":
                self.channels[channel].program = event.data[0]
            elif event.kind == "bend":
                ch = self.channels[channel]
                ch.bend = event.data[0]
                _set(ch.bend_cents, t, ch.bend * int(ch.bend_range) >> 13)  # CPitchBendIn::GetPitch
            elif event.kind == "cc":
                self.control(t, channel, *event.data)
        return self.voices, self.channels


def schedule(song: Song, col: Collection):
    return Scheduler(col).run(song)


def render(song: Song, col: Collection, rate: int = 22050, tail: float = 3.0) -> np.ndarray:
    """Render to float32 stereo at `rate`; 1.0 is a full-scale sample from a voice at unity gain.

    Voices mix in integers (shakefmt.dmvoice); held voices are cut `tail` seconds after the song.
    """
    voices, channels = schedule(song, col)
    total = int(math.ceil((song.length + tail) * rate)) + 1
    out = mix(voices, [ChannelControls.of(ch, rate) for ch in channels], total, rate)
    audible = np.flatnonzero(out.any(axis=1))
    last = max(int(math.ceil(song.length * rate)), int(audible[-1]) + 1 if len(audible) else 0)
    return (out[:last] / FULL_SCALE).astype(np.float32)
