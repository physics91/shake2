"""Build synthetic `.shk` / `.spr` files for tests."""

import struct


def build_shk(width, height, pixels, *, trailing=b"", bpp=2, hdr_13=0x0240, pixel_count=None):
    if pixel_count is None:
        pixel_count = width * height
    header = b"SHAKE V1.0\0" + struct.pack(
        "<HHHHHHI", bpp, hdr_13, width, height, height, 0x1FE0, pixel_count
    )
    return header + struct.pack(f"<{len(pixels)}H", *pixels) + trailing


def pad_name(text, garbage=b""):
    raw = text.encode("cp949") + b"\0" + garbage
    return raw.ljust(21, b"\0")[:21]


def build_pixels(rows):
    """rows: display rows (top first), each a list of (b, g, r) tuples.

    Stored bottom-up like a BMP, each row padded to 4 bytes."""
    width = len(rows[0])
    stride = (width * 3 + 3) & ~3
    out = b""
    for row in reversed(rows):
        line = b"".join(bytes(px) for px in row)
        out += line.ljust(stride, b"\xee")
    return out


def build_anim(name, unknown, frames, garbage=b""):
    out = pad_name(name, garbage) + struct.pack("<HH", unknown, len(frames))
    for i, (ax, ay, left, top, right, bottom) in enumerate(frames, start=1):
        out += struct.pack("<Hiiiiii", i, ax, ay, left, top, right, bottom)
    return out


def build_spr(rows, anims, *, trailing=b"", data_size=None, raw_anims=None):
    height, width = len(rows), len(rows[0])
    pixels = build_pixels(rows)
    if data_size is None:
        data_size = len(pixels)
    body = raw_anims if raw_anims is not None else b"".join(anims)
    return (
        pad_name("캐릭터 이름")
        + struct.pack("<III", width, height, data_size)
        + pixels
        + struct.pack("<H", len(anims))
        + body
        + trailing
    )


def build_map(
    *,
    background="mizar",
    title="01미자르",
    sprites=("b1.spr", "b2.spr"),
    area=(50, 49, 130, 113),
    grid=(2, 2),
    fixed=(),
    bricks=(),
    objects=(),
    cells=None,
    trailing=b"",
):
    """fixed: (sprite, cell); bricks: (sprite, unknown, cell);
    objects: (cell, kind_flag, unknown_u32, left, top, right, bottom, unknown_a, anim, unknown_b);
    cells: list of 10-int tuples (defaults derived from fixed/bricks/objects)."""
    width, height = grid
    if cells is None:
        cells = [[0, -1, -1, 0, 0, 0, 0, 0, 0, 0] for _ in range(width * height)]
        for _, cell in fixed:
            cells[cell][4] = 1
        for index, (_, _, cell) in enumerate(bricks):
            cells[cell][1] = index
            cells[cell][4] = 2
        for index, obj in enumerate(objects):
            cells[obj[0]][2] = index
    title_raw = title.encode("cp949")
    out = b"ver 2.0\0" + struct.pack("<H", 0x398B) + background.encode().ljust(31, b"\0")
    out += struct.pack("<H", len(title_raw)) + title_raw
    out += struct.pack("<HIH", 6, 0, len(sprites))
    out += b"".join(name.encode().ljust(31, b"\0") for name in sprites)
    out += struct.pack("<6I", 800, 600, *area)
    out += struct.pack("<H", len(fixed)) + b"".join(struct.pack("<HH", *f) for f in fixed)
    out += struct.pack("<H", len(bricks)) + b"".join(struct.pack("<HHH", *b) for b in bricks)
    out += struct.pack("<H", len(objects)) + b"".join(struct.pack("<HHIiiiiHHH", *o) for o in objects)
    out += struct.pack("<HH", width, height)
    out += b"".join(struct.pack("<10h", *c) for c in cells)
    return out + trailing
