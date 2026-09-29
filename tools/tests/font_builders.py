"""Build tiny synthetic TrueType collections with embedded bitmap strikes for tests.

A glyph is a dict: `rows` (list of "#." strings), `metrics` (height, width, bearingX,
bearingY, advance) and for composites `parts` [(glyph ID, x, y)] instead of rows.
A subtable is (index format, image format, first glyph ID, glyphs, shared metrics or None).
"""

import struct


def _bits(rows: list[str], byte_aligned: bool) -> bytes:
    bits = []
    for row in rows:
        row_bits = [1 if c == "#" else 0 for c in row]
        if byte_aligned:
            row_bits += [0] * (-len(row_bits) % 8)
        bits += row_bits
    bits += [0] * (-len(bits) % 8)
    return bytes(sum(b << (7 - i) for i, b in enumerate(bits[k:k + 8])) for k in range(0, len(bits), 8))


def _small(m) -> bytes:
    return struct.pack(">BBbbB", *m)


def _big(m) -> bytes:
    height, width, bx, by, adv = m
    return struct.pack(">BBbbBbbB", height, width, bx, by, adv, 0, 0, height)


def _image(image_format: int, glyph: dict) -> bytes:
    m = glyph["metrics"]
    if image_format == 1:
        return _small(m) + _bits(glyph["rows"], True)
    if image_format == 2:
        return _small(m) + _bits(glyph["rows"], False)
    if image_format == 5:
        return _bits(glyph["rows"], False)
    if image_format == 8:
        parts = glyph["parts"]
        return _small(m) + b"\0" + struct.pack(">H", len(parts)) + b"".join(struct.pack(">Hbb", *p) for p in parts)
    raise ValueError(image_format)


def strike(ppem: int, ascent: int, descent: int, subtables: list) -> dict:
    return {"ppem": ppem, "ascent": ascent, "descent": descent, "subtables": subtables}


def _bitmap_tables(strikes: list[dict]) -> tuple[bytes, bytes]:
    ebdt = bytearray(struct.pack(">I", 0x00020000))
    sizes = []
    arrays = []
    for s in strikes:
        entries = b""
        bodies = b""
        count = len(s["subtables"])
        for index_format, image_format, first, glyphs, shared in s["subtables"]:
            image_at = len(ebdt)
            images = [_image(image_format, g) for g in glyphs]
            if index_format in (2, 5):
                size = max(len(i) for i in images)
                images = [i + b"\0" * (size - len(i)) for i in images]
            for i in images:
                ebdt += i
            header = struct.pack(">HHI", index_format, image_format, image_at)
            if index_format in (1, 3):
                offsets = [0]
                for i in images:
                    offsets.append(offsets[-1] + len(i))
                kind = ">I" if index_format == 1 else ">H"
                body = header + b"".join(struct.pack(kind, o) for o in offsets)
                body += b"\0" * (-len(body) % 4)
            elif index_format == 2:
                body = header + struct.pack(">I", len(images[0])) + _big(shared)
            else:
                raise ValueError(index_format)
            last = first + len(glyphs) - 1
            entries += struct.pack(">HHI", first, last, 8 * count + len(bodies))
            bodies += body
        arrays.append(entries + bodies)
        sizes.append(s)
    eblc = bytearray(struct.pack(">II", 0x00020000, len(strikes)))
    array_at = 8 + 48 * len(strikes)
    for s, array in zip(sizes, arrays):
        line = struct.pack(">bbBbbbbbbbbb", s["ascent"], -s["descent"], 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
        eblc += struct.pack(">IIII", array_at, len(array), len(s["subtables"]), 0)
        eblc += line + line + struct.pack(">HHBBBb", 0, 0, s["ppem"], s["ppem"], 1, 1)
        array_at += len(array)
    for array in arrays:
        eblc += array
    return bytes(eblc), bytes(ebdt)


def _cmap(mapping: dict[int, int], ranged: int | None = None) -> bytes:
    """Format 4, one segment per code; `ranged` goes through glyphIdArray instead of idDelta."""
    codes = sorted(mapping) + [0xFFFF]
    segs = len(codes)
    ends = starts = codes
    deltas = [0 if c == ranged or c == 0xFFFF else (mapping[c] - c) & 0xFFFF for c in codes[:-1]] + [1]
    ranges = [0] * segs
    glyph_ids = []
    if ranged is not None:
        k = codes.index(ranged)
        ranges[k] = 2 * (segs - k)
        glyph_ids.append(mapping[ranged])
    body = struct.pack(">4H", 4, 0, 0, 2 * segs) + struct.pack(">3H", 0, 0, 0)
    body += struct.pack(f">{segs}H", *ends) + b"\0\0" + struct.pack(f">{segs}H", *starts)
    body += struct.pack(f">{segs}H", *deltas) + struct.pack(f">{segs}H", *ranges)
    body += b"".join(struct.pack(">H", g) for g in glyph_ids)
    body = body[:2] + struct.pack(">H", len(body)) + body[4:]
    return struct.pack(">HHHHI", 0, 1, 3, 1, 12) + body


def _name(family: str) -> bytes:
    text = family.encode("utf-16-be")
    return struct.pack(">HHH", 0, 1, 18) + struct.pack(">6H", 3, 1, 0x409, 1, len(text), 0) + text


def _post(fixed: bool) -> bytes:
    return struct.pack(">IIhhI", 0x00030000, 0, 0, 0, 1 if fixed else 0) + b"\0" * 16


def font(family: str, fixed: bool, mapping: dict[str, int], strikes: list[dict], ranged: str | None = None) -> dict:
    eblc, ebdt = _bitmap_tables(strikes)
    codes = {ord(c): g for c, g in mapping.items()}
    return {
        "EBDT": ebdt,
        "EBLC": eblc,
        "cmap": _cmap(codes, ord(ranged) if ranged else None),
        "name": _name(family),
        "post": _post(fixed),
    }


def collection(*fonts: dict) -> bytes:
    """A 'ttcf' file; each font's tables are laid out after all the table directories."""
    header = 12 + 4 * len(fonts)
    dirs = [12 + 16 * len(f) for f in fonts]
    data_at = header + sum(dirs)
    out_dirs = []
    blobs = bytearray()
    for f in fonts:
        records = b""
        for tag in sorted(f):
            blob = f[tag]
            records += struct.pack(">4sIII", tag.encode(), 0, data_at + len(blobs), len(blob))
            blobs += blob + b"\0" * (-len(blob) % 4)
        out_dirs.append(struct.pack(">IHHHH", 0x00010000, len(f), 0, 0, 0) + records)
    offsets = []
    at = header
    for d in out_dirs:
        offsets.append(at)
        at += len(d)
    return b"ttcf" + struct.pack(">II", 0x00010000, len(fonts)) + struct.pack(f">{len(fonts)}I", *offsets) + b"".join(out_dirs) + bytes(blobs)
