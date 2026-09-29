"""Build tiny synthetic DLS Level 1 collections and MIDI files for tests."""

import struct

import numpy as np


def chunk(cid: bytes, payload: bytes) -> bytes:
    pad = b"\0" if len(payload) & 1 else b""
    return cid + struct.pack("<I", len(payload)) + payload + pad


def list_chunk(kind: bytes, *children: bytes) -> bytes:
    return chunk(b"LIST", kind + b"".join(children))


def wsmp(unity=60, fine=0, atten=0, loop=None):
    body = struct.pack("<IHhiII", 20, unity, fine, atten, 0, 1 if loop else 0)
    if loop:
        body += struct.pack("<IIII", 16, 0, loop[0], loop[1])
    return chunk(b"wsmp", body)


def art1(*connections):
    body = struct.pack("<II", 8, len(connections))
    for source, control, destination, transform, scale in connections:
        body += struct.pack("<HHHHi", source, control, destination, transform, scale)
    return list_chunk(b"lart", chunk(b"art1", body))


def region(key=(0, 127), vel=(0, 127), wave=0, sample=None, articulation=None, key_group=0, options=0):
    parts = [chunk(b"rgnh", struct.pack("<HHHHHH", key[0], key[1], vel[0], vel[1], options, key_group))]
    if sample is not None:
        parts.append(sample)
    parts.append(chunk(b"wlnk", struct.pack("<HHII", 0, 0, 1, wave)))
    if articulation is not None:
        parts.append(articulation)
    return list_chunk(b"rgn ", *parts)


def instrument(program, regions, bank_msb=0, bank_lsb=0, drums=False, name="Test", articulation=None):
    bank = (bank_msb << 8) | bank_lsb | (0x80000000 if drums else 0)
    parts = [chunk(b"insh", struct.pack("<III", len(regions), bank, program)), list_chunk(b"lrgn", *regions)]
    if articulation is not None:
        parts.append(articulation)
    parts.append(list_chunk(b"INFO", chunk(b"INAM", name.encode() + b"\0")))
    return list_chunk(b"ins ", *parts)


def wave(samples: np.ndarray, rate=22050, bits=16, sample=None):
    if bits == 16:
        pcm = np.clip(np.round(samples * 32767), -32768, 32767).astype("<i2").tobytes()
    else:
        pcm = np.clip(np.round(samples * 127) + 128, 0, 255).astype(np.uint8).tobytes()
    block = bits // 8
    fmt = struct.pack("<HHIIHH", 1, 1, rate, rate * block, block, bits)
    parts = [chunk(b"fmt ", fmt)]
    if sample is not None:
        parts.append(sample)
    parts.append(chunk(b"data", pcm))
    return list_chunk(b"wave", *parts)


def build_dls(instruments, waves):
    wvpl_children = list(waves)
    offsets, pos = [], 0
    for w in wvpl_children:
        offsets.append(pos)
        pos += len(w)
    ptbl = chunk(b"ptbl", struct.pack("<II", 8, len(offsets)) + b"".join(struct.pack("<I", o) for o in offsets))
    body = (
        b"DLS "
        + chunk(b"colh", struct.pack("<I", len(instruments)))
        + list_chunk(b"lins", *instruments)
        + ptbl
        + list_chunk(b"wvpl", *wvpl_children)
    )
    return b"RIFF" + struct.pack("<I", len(body)) + body


def sine(freq, seconds, rate=22050):
    t = np.arange(int(seconds * rate)) / rate
    return (0.5 * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def varlen(value: int) -> bytes:
    out = [value & 0x7F]
    value >>= 7
    while value:
        out.append(0x80 | (value & 0x7F))
        value >>= 7
    return bytes(reversed(out))


def build_midi(events, division=120, fmt=0, tracks=None):
    """events: list of (delta_ticks, bytes) for a single track, or pass tracks=[events, ...]."""
    tracks = tracks if tracks is not None else [events]
    out = b"MThd" + struct.pack(">IHHH", 6, fmt, len(tracks), division)
    for track in tracks:
        data = b"".join(varlen(delta) + msg for delta, msg in track) + b"\x00\xff\x2f\x00"
        out += b"MTrk" + struct.pack(">I", len(data)) + data
    return out
