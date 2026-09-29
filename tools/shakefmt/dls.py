"""DLS Level 1 (Downloadable Sounds) collection reader.

Shake2 plays its `bgm/*.mid` through DirectMusic, whose default synthesizer uses
the Windows GS sound set `gm.dls`. Reading that collection lets the tools render
the tracks with the same instruments instead of a generic General MIDI bank.

RIFF 'DLS ' layout used here:
    colh                      instrument count
    LIST lins / LIST ins      insh (regions, bank, program), LIST lrgn, LIST lart, LIST INFO
    LIST rgn                  rgnh (key/velocity range, key group), wsmp?, wlnk, LIST lart?
    ptbl                      cue table: offsets of each wave inside wvpl
    LIST wvpl / LIST wave     fmt, wsmp?, data (PCM 8-bit unsigned or 16-bit signed)

wsmp attenuation is in 1/655360 dB units; articulation scales are kept raw.
"""

import struct
from dataclasses import dataclass

import numpy as np

DRUM_FLAG = 0x80000000
INFO_ENCODING = "cp1252"


class DlsFormatError(ValueError):
    pass


@dataclass(frozen=True)
class Sample:
    unity_note: int
    fine_tune: int
    attenuation: int
    options: int
    loop: tuple[int, int] | None


@dataclass(frozen=True)
class Connection:
    source: int
    control: int
    destination: int
    transform: int
    scale: int


@dataclass(frozen=True)
class Region:
    key_lo: int
    key_hi: int
    vel_lo: int
    vel_hi: int
    options: int
    key_group: int
    wave_index: int
    sample: Sample | None
    articulation: tuple[Connection, ...]


@dataclass(frozen=True)
class Instrument:
    name: str
    bank: int
    program: int
    drums: bool
    regions: tuple[Region, ...]
    articulation: tuple[Connection, ...]


@dataclass(frozen=True)
class Wave:
    rate: int
    pcm: np.ndarray
    sample: Sample | None


@dataclass(frozen=True)
class Collection:
    instruments: tuple[Instrument, ...]
    waves: tuple[Wave, ...]

    def sample_for(self, region: Region) -> Sample:
        sample = region.sample or self.waves[region.wave_index].sample
        return sample or Sample(unity_note=60, fine_tune=0, attenuation=0, options=0, loop=None)


def _chunks(data: bytes, start: int, end: int):
    pos = start
    while pos + 8 <= end:
        cid, size = data[pos : pos + 4], struct.unpack_from("<I", data, pos + 4)[0]
        body = pos + 8
        if body + size > end:
            raise DlsFormatError(f"chunk {cid!r} at {pos} overruns its parent")
        yield cid, body, body + size
        pos = body + size + (size & 1)


def _children(data: bytes, start: int, end: int) -> dict:
    """Map chunk id (or LIST type) to the first (body_start, body_end) found."""
    found: dict[bytes, tuple[int, int]] = {}
    for cid, body, stop in _chunks(data, start, end):
        key = data[body : body + 4] if cid == b"LIST" else cid
        span = (body + 4, stop) if cid == b"LIST" else (body, stop)
        found.setdefault(key, span)
    return found


def _lists(data: bytes, start: int, end: int, kind: bytes):
    for cid, body, stop in _chunks(data, start, end):
        if cid == b"LIST" and data[body : body + 4] == kind:
            yield body + 4, stop


def _sample(data: bytes, span) -> Sample | None:
    if span is None:
        return None
    start, _ = span
    cb, unity, fine, atten, options, loops = struct.unpack_from("<IHhiII", data, start)
    loop = None
    if loops:
        _, _, loop_start, loop_length = struct.unpack_from("<IIII", data, start + cb)
        loop = (loop_start, loop_length)
    return Sample(unity_note=unity, fine_tune=fine, attenuation=atten, options=options, loop=loop)


def _articulation(data: bytes, span) -> tuple[Connection, ...]:
    if span is None:
        return ()
    art = _children(data, *span).get(b"art1")
    if art is None:
        return ()
    cb, count = struct.unpack_from("<II", data, art[0])
    return tuple(
        Connection(*struct.unpack_from("<HHHHi", data, art[0] + cb + 12 * i)) for i in range(count)
    )


def _region(data: bytes, start: int, end: int) -> Region:
    parts = _children(data, start, end)
    if b"rgnh" not in parts or b"wlnk" not in parts:
        raise DlsFormatError(f"region at {start} lacks rgnh or wlnk")
    key_lo, key_hi, vel_lo, vel_hi, options, key_group = struct.unpack_from("<HHHHHH", data, parts[b"rgnh"][0])
    wave_index = struct.unpack_from("<HHII", data, parts[b"wlnk"][0])[3]
    return Region(
        key_lo=key_lo,
        key_hi=key_hi,
        vel_lo=vel_lo,
        vel_hi=vel_hi,
        options=options,
        key_group=key_group,
        wave_index=wave_index,
        sample=_sample(data, parts.get(b"wsmp")),
        articulation=_articulation(data, parts.get(b"lart")),
    )


def _info_name(data: bytes, span) -> str:
    if span is None:
        return ""
    name = _children(data, *span).get(b"INAM")
    if name is None:
        return ""
    return data[name[0] : name[1]].split(b"\0", 1)[0].decode(INFO_ENCODING)


def _instrument(data: bytes, start: int, end: int) -> Instrument:
    parts = _children(data, start, end)
    if b"insh" not in parts:
        raise DlsFormatError(f"instrument at {start} lacks insh")
    _, bank, program = struct.unpack_from("<III", data, parts[b"insh"][0])
    lrgn = parts.get(b"lrgn")
    regions = tuple(_region(data, *span) for span in _lists(data, *lrgn, b"rgn ")) if lrgn else ()
    return Instrument(
        name=_info_name(data, parts.get(b"INFO")),
        bank=((bank >> 8) & 0x7F) << 7 | (bank & 0x7F),
        program=program & 0x7F,
        drums=bool(bank & DRUM_FLAG),
        regions=regions,
        articulation=_articulation(data, parts.get(b"lart")),
    )


def _pcm(data: bytes, fmt_span, data_span) -> tuple[int, np.ndarray]:
    tag, channels, rate, _, _, bits = struct.unpack_from("<HHIIHH", data, fmt_span[0])
    if tag != 1 or channels != 1 or bits not in (8, 16):
        raise DlsFormatError(f"unsupported wave format tag={tag} channels={channels} bits={bits}")
    raw = data[data_span[0] : data_span[1]]
    if bits == 16:
        pcm = np.frombuffer(raw[: len(raw) // 2 * 2], "<i2").astype(np.float32) / 32768.0
    else:
        pcm = (np.frombuffer(raw, np.uint8).astype(np.float32) - 128.0) / 128.0
    return rate, pcm


def _wave(data: bytes, start: int, end: int) -> Wave:
    parts = _children(data, start, end)
    if b"fmt " not in parts or b"data" not in parts:
        raise DlsFormatError(f"wave at {start} lacks fmt or data")
    rate, pcm = _pcm(data, parts[b"fmt "], parts[b"data"])
    return Wave(rate=rate, pcm=pcm, sample=_sample(data, parts.get(b"wsmp")))


def decode_dls(data: bytes) -> Collection:
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"DLS ":
        raise DlsFormatError("not a RIFF 'DLS ' file")
    end = min(len(data), 8 + struct.unpack_from("<I", data, 4)[0])
    top = _children(data, 12, end)
    for required in (b"lins", b"ptbl", b"wvpl"):
        if required not in top:
            raise DlsFormatError(f"missing {required!r}")

    instruments = tuple(_instrument(data, *span) for span in _lists(data, *top[b"lins"], b"ins "))

    ptbl_start = top[b"ptbl"][0]
    cb, cues = struct.unpack_from("<II", data, ptbl_start)
    pool_start, pool_end = top[b"wvpl"]
    waves = []
    for i in range(cues):
        offset = struct.unpack_from("<I", data, ptbl_start + cb + 4 * i)[0]
        spans = list(_chunks(data, pool_start + offset, pool_end))
        if not spans or spans[0][0] != b"LIST" or data[spans[0][1] : spans[0][1] + 4] != b"wave":
            raise DlsFormatError(f"cue {i} does not point at a wave list")
        waves.append(_wave(data, spans[0][1] + 4, spans[0][2]))
    return Collection(instruments=instruments, waves=tuple(waves))


def find_instrument(col: Collection, bank: int, program: int, drums: bool) -> Instrument | None:
    """Exact bank/program first, then a fallback.

    Drum kits fall back to the standard kit, bank 0 program 0: the Microsoft synth
    retries with F_INSTRUMENT_DRUMS alone, and shake.exe's lobby tracks keep that kit
    downloaded (measured: kit 1 alone is silent). Melodic programs fall back to bank 0.
    The synthesizer model asks for bank 0 anyway, as shake.exe's segments ignore bank
    select (shakefmt.synth).
    """
    candidates = [(bank, program), (0, 0) if drums else (0, program)]
    for want_bank, want_program in candidates:
        for inst in col.instruments:
            if inst.drums == drums and inst.bank == want_bank and inst.program == want_program:
                return inst
    return None


def find_region(inst: Instrument, key: int, velocity: int) -> Region | None:
    for region in inst.regions:
        if region.key_lo <= key <= region.key_hi and region.vel_lo <= velocity <= region.vel_hi:
            return region
    return None
