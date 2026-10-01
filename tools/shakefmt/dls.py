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


def _record(fmt: str, data: bytes, offset: int, end: int, what: str) -> tuple:
    """One fixed-size record that must lie inside its chunk, which ends at `end`."""
    if offset + struct.calcsize(fmt) > end:
        raise DlsFormatError(f"{what} at {offset} runs past its chunk")
    return struct.unpack_from(fmt, data, offset)


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
    start, end = span
    cb, unity, fine, atten, options, loops = _record("<IHhiII", data, start, end, "wsmp")
    loop = None
    if loops:
        _, _, loop_start, loop_length = _record("<IIII", data, start + cb, end, "wsmp loop")
        loop = (loop_start, loop_length)
    return Sample(unity_note=unity, fine_tune=fine, attenuation=atten, options=options, loop=loop)


def _articulation(data: bytes, span) -> tuple[Connection, ...]:
    if span is None:
        return ()
    art = _children(data, *span).get(b"art1")
    if art is None:
        return ()
    cb, count = _record("<II", data, art[0], art[1], "art1")
    return tuple(
        Connection(*_record("<HHHHi", data, art[0] + cb + 12 * i, art[1], "art1 connection")) for i in range(count)
    )


def _region(data: bytes, start: int, end: int) -> Region:
    parts = _children(data, start, end)
    if b"rgnh" not in parts or b"wlnk" not in parts:
        raise DlsFormatError(f"region at {start} lacks rgnh or wlnk")
    key_lo, key_hi, vel_lo, vel_hi, options, key_group = _record("<HHHHHH", data, *parts[b"rgnh"], "rgnh")
    wave_index = _record("<HHII", data, *parts[b"wlnk"], "wlnk")[3]
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
    # A name is only shown; one outside the code page does not make the collection unusable.
    return data[name[0] : name[1]].split(b"\0", 1)[0].decode(INFO_ENCODING, errors="replace")


def _instrument(data: bytes, start: int, end: int) -> Instrument:
    parts = _children(data, start, end)
    if b"insh" not in parts:
        raise DlsFormatError(f"instrument at {start} lacks insh")
    _, bank, program = _record("<III", data, *parts[b"insh"], "insh")
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
    tag, channels, rate, _, _, bits = _record("<HHIIHH", data, *fmt_span, "fmt")
    if tag != 1 or channels != 1 or bits not in (8, 16) or rate == 0:
        raise DlsFormatError(f"unsupported wave format tag={tag} channels={channels} rate={rate} bits={bits}")
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

    ptbl_start, ptbl_end = top[b"ptbl"]
    cb, cues = _record("<II", data, ptbl_start, ptbl_end, "ptbl")
    pool_start, pool_end = top[b"wvpl"]
    waves = []
    for i in range(cues):
        offset = _record("<I", data, ptbl_start + cb + 4 * i, ptbl_end, "ptbl cue")[0]
        spans = list(_chunks(data, pool_start + offset, pool_end))
        if not spans or spans[0][0] != b"LIST" or data[spans[0][1] : spans[0][1] + 4] != b"wave":
            raise DlsFormatError(f"cue {i} does not point at a wave list")
        waves.append(_wave(data, spans[0][1] + 4, spans[0][2]))
    collection = Collection(instruments=instruments, waves=tuple(waves))
    _check_references(collection)
    return collection


def _check_references(col: Collection) -> None:
    """Every region names a wave, and every loop lies inside the wave it plays."""
    for wave in col.waves:
        _check_loop(wave.sample, wave)
    for inst in col.instruments:
        for region in inst.regions:
            if region.wave_index >= len(col.waves):
                raise DlsFormatError(f"{inst.name!r} links wave {region.wave_index} of {len(col.waves)}")
            _check_loop(col.sample_for(region), col.waves[region.wave_index])


def _check_loop(sample: Sample | None, wave: Wave) -> None:
    if sample is not None and sample.loop is not None and sum(sample.loop) > len(wave.pcm):
        raise DlsFormatError(f"loop {sample.loop} runs past a wave of {len(wave.pcm)} samples")


def find_instrument(col: Collection, bank: int, program: int, drums: bool, key: int) -> Instrument | None:
    """Exact bank/program first, then a fallback; only an instrument with a region for the key counts.

    The Microsoft synth passes over an instrument whose regions miss the key
    (CInstManager::GetInstrument). Drum kits then fall back to the standard kit, bank 0
    program 0: the synth retries with F_INSTRUMENT_DRUMS alone, a kit that lacks the key
    included, and shake.exe's lobby tracks keep that kit downloaded (measured: kit 1
    alone is silent). Melodic programs fall back to bank 0. The synthesizer model asks
    for bank 0 anyway, as shake.exe's segments ignore bank select (shakefmt.synth).
    """
    candidates = [(bank, program), (0, 0) if drums else (0, program)]
    for want_bank, want_program in candidates:
        for inst in col.instruments:
            if (
                inst.drums == drums
                and inst.bank == want_bank
                and inst.program == want_program
                and find_region(inst, key) is not None
            ):
                return inst
    return None


def find_region(inst: Instrument, key: int) -> Region | None:
    """The first region holding the key: DLS Level 1 regions are chosen by key alone (CInstrument::ScanForRegion)."""
    for region in inst.regions:
        if region.key_lo <= key <= region.key_hi:
            return region
    return None
