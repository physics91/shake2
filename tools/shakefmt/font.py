"""Extract the bitmap strikes shake.exe's text is drawn with from Windows' gulim.ttc.

Usage: python -m shakefmt.font [--ttc GULIM_TTC] [DST]

shake.exe makes its fonts with CreateFontA (0x418370): 굴림체 at heights 12, 13 and
14 (and 11, which nothing selects) and "Courier New" 15 with HANGEUL_CHARSET,
which the Korean font mapper answers with 굴림. GDI draws those sizes from the
TrueType file's embedded 1-bit bitmaps (EBLC/EBDT) at ppem = height, so these
strikes are the original's text pixel for pixel. Two GDI rules are applied on
top: a fixed-pitch face (…체) sets every double-byte character to
twice the single-byte width (GulimChe 13's bitmaps are 12-13 wide, GDI steps 14),
and an index subtable's metrics outrank a glyph's own (see _GlyphReader._read).
Checked against GDI on Korean Windows 11 for every cp949 character at each size.

The glyphs are Microsoft font data: they are read from the local Windows install
and neither the font nor the extracted strikes may be redistributed.

Output: one `<id>.bin` per strike and `index.json`. A .bin is "SHF1", a u32 glyph
count, then per glyph (by code point) u16 code, u8 advance, i8 left, i8 top (from
the cell top), u8 width, u8 height and width*height ink bits, MSB first, rows run
together (little-endian).
"""

import argparse
import json
import os
import struct
from dataclasses import dataclass
from pathlib import Path

from shakefmt.export import REPO_ROOT

DEFAULT_DST = REPO_ROOT / "assets/extracted/font"
GULIM_CANDIDATES = (
    Path("/mnt/c/Windows/Fonts/gulim.ttc"),
    Path("C:/Windows/Fonts/gulim.ttc"),
)
# (id, family, ppem): the sizes FONT_sel (0x418dd0) hands out, 11 aside (no caller selects it).
STRIKES = (
    ("gulimche-12", "GulimChe", 12),
    ("gulimche-13", "GulimChe", 13),
    ("gulimche-14", "GulimChe", 14),
    ("gulim-15", "Gulim", 15),
)
MAGIC = b"SHF1"


def default_ttc() -> Path | None:
    configured = os.environ.get("SHAKE2_GULIM_TTC")
    if configured:
        return Path(configured)
    return next((p for p in GULIM_CANDIDATES if p.is_file()), None)


def cp949_chars() -> list[str]:
    """Every character a cp949 string can hold: printable ASCII and the double-byte set."""
    chars = [chr(c) for c in range(0x20, 0x7F)]
    for lead in range(0x81, 0xFF):
        for trail in range(0x41, 0xFF):
            try:
                char = bytes([lead, trail]).decode("cp949")
            except UnicodeDecodeError:
                continue
            if len(char) == 1:
                chars.append(char)
    return sorted(set(chars))


def double_byte(char: str) -> bool:
    return len(char.encode("cp949")) == 2


@dataclass
class Glyph:
    advance: int
    left: int
    top: int
    width: int
    height: int
    ink: list[list[int]]


@dataclass
class Strike:
    family: str
    ppem: int
    ascent: int
    descent: int
    fixed_pitch: bool
    glyphs: dict[str, Glyph]


def _bits(data: bytes, offset: int, width: int, height: int, byte_aligned: bool) -> list[list[int]]:
    rows = []
    stride = (width + 7) // 8 if byte_aligned else None
    for r in range(height):
        row = []
        for c in range(width):
            bit = r * stride * 8 + c if byte_aligned else r * width + c
            row.append((data[offset + bit // 8] >> (7 - bit % 8)) & 1)
        rows.append(row)
    return rows


class Face:
    """One font of a TrueType collection, just the tables the strikes need."""

    def __init__(self, data: bytes, offset: int):
        self.data = data
        count = struct.unpack_from(">H", data, offset + 4)[0]
        self.tables = {}
        for i in range(count):
            tag, _, where, length = struct.unpack_from(">4sIII", data, offset + 12 + 16 * i)
            self.tables[tag.decode("latin-1")] = (where, length)

    def table(self, tag: str) -> int:
        if tag not in self.tables:
            raise ValueError(f"font has no {tag} table")
        return self.tables[tag][0]

    def family(self) -> str:
        """The English family name (name ID 1, Windows platform)."""
        base = self.table("name")
        _, count, strings = struct.unpack_from(">HHH", self.data, base)
        for i in range(count):
            platform, _, language, name_id, length, where = struct.unpack_from(">6H", self.data, base + 6 + 12 * i)
            if platform == 3 and language == 0x409 and name_id == 1:
                start = base + strings + where
                return self.data[start:start + length].decode("utf-16-be")
        raise ValueError("font has no English family name")

    def fixed_pitch(self) -> bool:
        return struct.unpack_from(">I", self.data, self.table("post") + 12)[0] != 0

    def cmap(self) -> dict[int, int]:
        """Code point -> glyph ID from the Windows Unicode BMP subtable (format 4)."""
        base = self.table("cmap")
        count = struct.unpack_from(">H", self.data, base + 2)[0]
        for i in range(count):
            platform, encoding, where = struct.unpack_from(">HHI", self.data, base + 4 + 8 * i)
            if (platform, encoding) == (3, 1):
                return self._cmap4(base + where)
        raise ValueError("font has no Windows Unicode cmap")

    def _cmap4(self, at: int) -> dict[int, int]:
        fmt, _, _, seg_x2 = struct.unpack_from(">4H", self.data, at)
        if fmt != 4:
            raise ValueError(f"cmap format {fmt} is not supported")
        segs = seg_x2 // 2
        ends = struct.unpack_from(f">{segs}H", self.data, at + 14)
        starts = struct.unpack_from(f">{segs}H", self.data, at + 16 + seg_x2)
        deltas = struct.unpack_from(f">{segs}h", self.data, at + 16 + 2 * seg_x2)
        range_at = at + 16 + 3 * seg_x2
        ranges = struct.unpack_from(f">{segs}H", self.data, range_at)
        mapping = {}
        for i in range(segs):
            for code in range(starts[i], ends[i] + 1):
                if code == 0xFFFF:
                    continue
                if ranges[i] == 0:
                    gid = (code + deltas[i]) & 0xFFFF
                else:
                    gid = struct.unpack_from(">H", self.data, range_at + 2 * i + ranges[i] + 2 * (code - starts[i]))[0]
                    if gid:
                        gid = (gid + deltas[i]) & 0xFFFF
                if gid:
                    mapping[code] = gid
        return mapping

    def strike(self, ppem: int, chars: list[str]) -> Strike:
        eblc, ebdt = self.table("EBLC"), self.table("EBDT")
        sizes = struct.unpack_from(">I", self.data, eblc + 4)[0]
        for i in range(sizes):
            record = eblc + 8 + 48 * i
            array, _, subtables = struct.unpack_from(">III", self.data, record)
            ascent, descent = struct.unpack_from(">bb", self.data, record + 16)
            ppem_y, depth = struct.unpack_from(">BB", self.data, record + 45)
            if ppem_y == ppem:
                if depth != 1:
                    raise ValueError(f"{ppem} ppem strike is {depth}-bit")
                places = _locate(self.data, eblc + array, subtables, ebdt)
                reader = _GlyphReader(self.data, places)
                glyphs = {}
                cmap = self.cmap()
                for char in chars:
                    gid = cmap.get(ord(char))
                    if gid is None or gid not in places:
                        continue
                    ink, (height, width, bearing_x, bearing_y, advance) = reader.read(gid)
                    glyphs[char] = Glyph(advance, bearing_x, ascent - bearing_y, width, height, ink)
                return Strike(self.family(), ppem, ascent, -descent, self.fixed_pitch(), glyphs)
        raise ValueError(f"no {ppem} ppem strike")


def _big_metrics(data: bytes, at: int) -> tuple[int, int, int, int, int]:
    height, width, bearing_x, bearing_y, advance = struct.unpack_from(">BBbbB", data, at)
    return height, width, bearing_x, bearing_y, advance


def _locate(data: bytes, array: int, count: int, ebdt: int) -> dict[int, tuple]:
    """Glyph ID -> (image format, EBDT offset, metrics from the index or None) for one strike."""
    places = {}
    for i in range(count):
        first, last, extra = struct.unpack_from(">HHI", data, array + 8 * i)
        at = array + extra
        index_format, image_format, image_at = struct.unpack_from(">HHI", data, at)
        image_at += ebdt
        at += 8
        n = last - first + 1
        if index_format in (1, 3):
            kind = ">I" if index_format == 1 else ">H"
            step = 4 if index_format == 1 else 2
            offsets = [struct.unpack_from(kind, data, at + step * k)[0] for k in range(n + 1)]
            for k in range(n):
                if offsets[k + 1] > offsets[k]:
                    places[first + k] = (image_format, image_at + offsets[k], None)
        elif index_format == 2:
            size = struct.unpack_from(">I", data, at)[0]
            metrics = _big_metrics(data, at + 4)
            for k in range(n):
                places[first + k] = (image_format, image_at + size * k, metrics)
        elif index_format == 4:
            glyphs = struct.unpack_from(">I", data, at)[0]
            pairs = [struct.unpack_from(">HH", data, at + 4 + 4 * k) for k in range(glyphs + 1)]
            for k in range(glyphs):
                places[pairs[k][0]] = (image_format, image_at + pairs[k][1], None)
        elif index_format == 5:
            size = struct.unpack_from(">I", data, at)[0]
            metrics = _big_metrics(data, at + 4)
            glyphs = struct.unpack_from(">I", data, at + 12)[0]
            for k in range(glyphs):
                gid = struct.unpack_from(">H", data, at + 16 + 2 * k)[0]
                places[gid] = (image_format, image_at + size * k, metrics)
        else:
            raise ValueError(f"EBLC index format {index_format} is not supported")
    return places


class _GlyphReader:
    def __init__(self, data: bytes, places: dict[int, tuple]):
        self.data = data
        self.places = places
        self.memo = {}

    def read(self, gid: int):
        """(ink rows over the glyph's box, (height, width, bearingX, bearingY, advance))."""
        if gid not in self.memo:
            self.memo[gid] = self._read(gid)
        return self.memo[gid]

    def _read(self, gid: int):
        image_format, at, metrics = self.places[gid]
        data = self.data
        # An index that gives every glyph's metrics (formats 2 and 5) outranks the glyph's own, as
        # in GDI: 굴림 15's Hangul composites say 14 wide inside an index that says 15, and GDI steps 15.
        if image_format in (1, 2, 8):
            metrics = metrics or struct.unpack_from(">BBbbB", data, at)
            at += 5
        elif image_format in (6, 7, 9):
            metrics = metrics or _big_metrics(data, at)
            at += 8
        elif image_format != 5:
            raise ValueError(f"EBDT image format {image_format} is not supported")
        height, width = metrics[0], metrics[1]
        if image_format in (8, 9):
            if image_format == 8:
                at += 1  # pad
            count = struct.unpack_from(">H", data, at)[0]
            ink = [[0] * width for _ in range(height)]
            for k in range(count):
                part, x, y = struct.unpack_from(">Hbb", data, at + 2 + 4 * k)
                part_ink, _ = self.read(part)
                for r, row in enumerate(part_ink):
                    for c, bit in enumerate(row):
                        if bit and 0 <= y + r < height and 0 <= x + c < width:
                            ink[y + r][x + c] = 1
            return ink, metrics
        return _bits(data, at, width, height, byte_aligned=image_format in (1, 6)), metrics


def read_collection(data: bytes) -> dict[str, Face]:
    """Family name -> face for a .ttc (or a single .ttf)."""
    if data[:4] == b"ttcf":
        count = struct.unpack_from(">I", data, 8)[0]
        offsets = struct.unpack_from(f">{count}I", data, 12)
    else:
        offsets = (0,)
    faces = [Face(data, offset) for offset in offsets]
    return {face.family(): face for face in faces}


def gdi_advances(strike: Strike) -> tuple[int | None, int | None]:
    """GDI's widths for a fixed-pitch face: every single-byte glyph's, and twice that for double-byte."""
    if not strike.fixed_pitch:
        return None, None
    single = {g.advance for char, g in strike.glyphs.items() if not double_byte(char)}
    if len(single) != 1:
        raise ValueError(f"{strike.family} {strike.ppem}: fixed pitch but single-byte widths {sorted(single)}")
    half = single.pop()
    for char, glyph in strike.glyphs.items():
        if double_byte(char):
            glyph.advance = 2 * half
    return half, 2 * half


def pack(strike: Strike) -> bytes:
    out = bytearray(MAGIC)
    out += struct.pack("<I", len(strike.glyphs))
    for char in sorted(strike.glyphs, key=ord):
        g = strike.glyphs[char]
        out += struct.pack("<HBbbBB", ord(char), g.advance, g.left, g.top, g.width, g.height)
        bits = [bit for row in g.ink for bit in row]
        packed = bytearray((len(bits) + 7) // 8)
        for i, bit in enumerate(bits):
            if bit:
                packed[i // 8] |= 0x80 >> (i % 8)
        out += packed
    return bytes(out)


def render(strike: Strike, text: str) -> list[list[int]]:
    """Ink as TextOut draws `text` at (1,1) with TA_TOP, over the cell height plus a row each side."""
    width = 2 + sum(strike.glyphs[c].advance for c in text)
    height = strike.ascent + strike.descent + 2
    ink = [[0] * width for _ in range(height)]
    x = 1
    for char in text:
        g = strike.glyphs[char]
        for r, row in enumerate(g.ink):
            for c, bit in enumerate(row):
                y, px = 1 + g.top + r, x + g.left + c
                if bit and 0 <= y < height and 0 <= px < width:
                    ink[y][px] = 1
        x += g.advance
    return ink


def export_fonts(ttc: Path, dst: Path, strikes=STRIKES) -> dict:
    faces = read_collection(ttc.read_bytes())
    chars = cp949_chars()
    entries = []
    dst.mkdir(parents=True, exist_ok=True)
    for strike_id, family, ppem in strikes:
        if family not in faces:
            raise ValueError(f"{ttc.name} has no {family}")
        strike = faces[family].strike(ppem, chars)
        half, full = gdi_advances(strike)
        file = f"{strike_id}.bin"
        (dst / file).write_bytes(pack(strike))
        entries.append({
            "id": strike_id,
            "family": family,
            "ppem": ppem,
            "ascent": strike.ascent,
            "descent": strike.descent,
            "file": file,
            "glyphs": len(strike.glyphs),
            "missing": len(chars) - len(strike.glyphs),
            "fixed_pitch": strike.fixed_pitch,
            "sbcs_advance": half,
            "dbcs_advance": full,
        })
    index = {
        "note": "Bitmap strikes from the local Windows gulim.ttc (Microsoft font data). Do not redistribute.",
        "source": ttc.name,
        "strikes": entries,
    }
    (dst / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return index


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("dst", nargs="?", type=Path, default=DEFAULT_DST)
    parser.add_argument("--ttc", type=Path, default=default_ttc())
    args = parser.parse_args(argv)
    if args.ttc is None or not args.ttc.is_file():
        parser.error("gulim.ttc not found; pass --ttc or set SHAKE2_GULIM_TTC")
    index = export_fonts(args.ttc, args.dst)
    for s in index["strikes"]:
        print(f"{s['id']}: {s['glyphs']} glyphs ({s['missing']} missing)")
    print(f"-> {args.dst}")


if __name__ == "__main__":
    main()
