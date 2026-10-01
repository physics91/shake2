"""Standard MIDI File reader for the Shake2 `bgm/*.mid` tracks.

All 14 tracks are format 0 with 120 ticks per quarter note; format 1 is merged
with a shared tempo map so other files work too. Events are returned in seconds.

DirectMusic loads the file into music time of 768 ticks per quarter, rounding each event's
tick down (tick * 768 // division, measured on this PC), so events are timed from that grid.
Its segment for a MIDI file ends on the bar holding the end of track (GetLength of all 16
tracks on this PC, 4/4 throughout); a repeat starts there, so that is the loop.
"""

import math
import struct
from dataclasses import dataclass

DEFAULT_TEMPO = 500_000  # microseconds per quarter note
MUSIC_PPQ = 768  # DMUS_PPQ
DEFAULT_METER = (4, 2)  # 4/4: numerator, log2 of the denominator


class MidiFormatError(ValueError):
    pass


@dataclass(frozen=True)
class Event:
    time: float
    kind: str  # on, off, cc, program, bend
    channel: int
    data: tuple[int, ...]


@dataclass(frozen=True)
class Song:
    events: tuple[Event, ...]
    length: float  # the end of track
    segment_length: float | None = None  # to the end of that bar: the loop period


def _varlen(data: bytes, pos: int) -> tuple[int, int]:
    """SMF 1.0: at most four bytes, so at most 0x0FFFFFFF."""
    value = 0
    for _ in range(4):
        if pos >= len(data):
            raise MidiFormatError("truncated variable-length value")
        byte = data[pos]
        pos += 1
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            return value, pos
    raise MidiFormatError("variable-length value longer than 4 bytes")


def _track_events(data: bytes):
    """Yield (tick, status, payload) with running status resolved; meta uses status 0xFF."""
    pos, tick, status = 0, 0, 0
    while pos < len(data):
        delta, pos = _varlen(data, pos)
        tick += delta
        if pos >= len(data):
            raise MidiFormatError("track ends inside an event")
        if data[pos] & 0x80:
            status = data[pos]
            pos += 1
        elif not status:
            raise MidiFormatError("running status without a previous status byte")
        if status == 0xFF:
            if pos >= len(data):
                raise MidiFormatError("track ends inside a meta event")
            meta = data[pos]
            size, pos = _varlen(data, pos + 1)
            if pos + size > len(data):
                raise MidiFormatError("track ends inside a meta event")
            yield tick, 0xFF, (meta, data[pos : pos + size])
            pos += size
            status = 0
            if meta == 0x2F:
                return
        elif status in (0xF0, 0xF7):
            size, pos = _varlen(data, pos)
            if pos + size > len(data):
                raise MidiFormatError("track ends inside a sysex event")
            pos += size
            status = 0
        else:
            size = 1 if status & 0xF0 in (0xC0, 0xD0) else 2
            if pos + size > len(data):
                raise MidiFormatError("track ends inside a channel event")
            if any(byte & 0x80 for byte in data[pos : pos + size]):
                raise MidiFormatError("status byte inside a channel event")
            yield tick, status, data[pos : pos + size]
            pos += size


def _chunks(data: bytes):
    pos = 0
    while pos + 8 <= len(data):
        cid, size = data[pos : pos + 4], struct.unpack_from(">I", data, pos + 4)[0]
        if pos + 8 + size > len(data):
            raise MidiFormatError(f"chunk {cid!r} at {pos} runs past the end of the file")
        yield cid, data[pos + 8 : pos + 8 + size]
        pos += 8 + size


def _channel_event(status: int, payload: bytes):
    kind, channel = status & 0xF0, status & 0x0F
    if kind == 0x90 and payload[1] > 0:
        return "on", channel, (payload[0], payload[1])
    if kind in (0x80, 0x90):
        return "off", channel, (payload[0], payload[1] if kind == 0x80 else 0)
    if kind == 0xB0:
        return "cc", channel, (payload[0], payload[1])
    if kind == 0xC0:
        return "program", channel, (payload[0],)
    if kind == 0xE0:
        return "bend", channel, (((payload[1] << 7) | payload[0]) - 8192,)
    return None  # key/channel pressure: not used by DLS Level 1 defaults


def parse_midi(data: bytes) -> Song:
    chunks = list(_chunks(data))
    if not chunks or chunks[0][0] != b"MThd":
        raise MidiFormatError("missing MThd header")
    if len(chunks[0][1]) < 6:
        raise MidiFormatError("short MThd header")
    _, _, division = struct.unpack_from(">HHH", chunks[0][1])
    if division & 0x8000:
        raise MidiFormatError("SMPTE time division is not supported")
    if division == 0:
        raise MidiFormatError("no ticks a beat")

    raw = []  # (tick, order, status, payload)
    for track_no, (cid, body) in enumerate(c for c in chunks[1:] if c[0] == b"MTrk"):
        for order, (tick, status, payload) in enumerate(_track_events(body)):
            raw.append((tick, track_no, order, status, payload))
    raw.sort(key=lambda r: (r[0], r[1], r[2]))

    def music_time(tick):
        return tick * MUSIC_PPQ // division

    events, seconds, last_tick, tempo = [], 0.0, 0, DEFAULT_TEMPO
    meter_tick, meter = 0, DEFAULT_METER
    for tick, _, _, status, payload in raw:
        seconds += (music_time(tick) - music_time(last_tick)) * tempo / 1e6 / MUSIC_PPQ
        last_tick = tick
        if status == 0xFF:
            meta, body = payload
            if meta == 0x51 and len(body) == 3:
                tempo = int.from_bytes(body, "big")
            elif meta == 0x58 and len(body) >= 2:
                if body[0] == 0:
                    raise MidiFormatError("time signature of no beats a bar")
                meter_tick, meter = tick, (body[0], body[1])
            continue
        decoded = _channel_event(status, payload)
        if decoded:
            events.append(Event(seconds, *decoded))
    bar = meter[0] * 4 * division / (1 << meter[1])
    bar_end = meter_tick + math.ceil((last_tick - meter_tick) / bar) * bar
    segment = seconds + (music_time(bar_end) - music_time(last_tick)) * tempo / 1e6 / MUSIC_PPQ
    return Song(events=tuple(events), length=seconds, segment_length=segment)
