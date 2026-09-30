"""`.spr` sprite sheet decoder.

Layout (little-endian):
    0   char[21]  sheet name, EUC-KR, NUL-terminated (bytes after NUL are garbage)
    21  u32       width
    25  u32       height
    29  u32       pixel data size (= height * stride, stride = width*3 padded to 4)
    33  u8[]      BGR24 pixels, bottom-up rows like a BMP; the top-left pixel's colour is transparent
    ..  u16       animation count
        per animation:
            char[21]  name, EUC-KR, NUL-terminated
            u16       unknown (maybe frame delay)
            u16       frame count
            per frame:
                u16   index, 1-based and sequential
                i32   anchor x, anchor y
                i32   left, top, right, bottom (right/bottom exclusive, top-down sheet pixels)

Two known files carry stale bytes after the animation table; they are reported
as trailing bytes.
"""

import struct
from dataclasses import dataclass

import numpy as np
from shakefmt.shk import rgb565_to_rgba

NAME_SIZE = 21
SHEET_HEADER = struct.Struct("<III")
HEADER_SIZE = NAME_SIZE + SHEET_HEADER.size
ANIM_COUNT = struct.Struct("<H")
ANIM_HEADER = struct.Struct("<HH")
FRAME = struct.Struct("<Hiiiiii")
TEXT_ENCODING = "cp949"


class SprFormatError(ValueError):
    pass


@dataclass(frozen=True)
class Frame:
    index: int
    anchor_x: int
    anchor_y: int
    left: int
    top: int
    right: int
    bottom: int


@dataclass(frozen=True)
class Animation:
    name: str
    unknown_u16: int
    frames: tuple[Frame, ...]


@dataclass(frozen=True)
class SprSheet:
    name: str
    width: int
    height: int
    rgba: np.ndarray
    # The file's 8-bit colours, top-down RGB: what a tint turns before the 16-bit cut (0x414ed0).
    rgb: np.ndarray
    animations: tuple[Animation, ...]
    trailing_bytes: int


def decode_spr(data: bytes) -> SprSheet:
    if len(data) < HEADER_SIZE:
        raise SprFormatError("truncated header")

    width, height, data_size = SHEET_HEADER.unpack_from(data, NAME_SIZE)
    stride = (width * 3 + 3) & ~3
    if data_size != height * stride:
        raise SprFormatError(f"pixel data size {data_size} != {height} rows x {stride} stride")

    pixel_end = HEADER_SIZE + data_size
    if len(data) < pixel_end:
        raise SprFormatError("truncated pixels")

    rows = np.frombuffer(data, np.uint8, count=data_size, offset=HEADER_SIZE).reshape(height, stride)[::-1]
    bgr = rows[:, : width * 3].reshape(height, width, 3)
    rgba = bgr24_to_rgba(bgr)

    reader = _Reader(data, pixel_end)
    (anim_count,) = reader.unpack(ANIM_COUNT)
    animations = tuple(_read_animation(reader, width, height) for _ in range(anim_count))

    return SprSheet(
        name=_decode_name(data[:NAME_SIZE]),
        width=width,
        height=height,
        rgba=rgba,
        rgb=np.ascontiguousarray(bgr[..., ::-1]),
        animations=animations,
        trailing_bytes=len(data) - reader.offset,
    )


def bgr24_to_rgba(bgr: np.ndarray) -> np.ndarray:
    """`bgr` is top-down. shake.exe reads the rows into a top-down buffer (0x414d50) and cuts each
    pixel to 16 bits (0x414ed0: `(r & 0xf8) << 8 | (g & 0xfc) << 3 | b >> 3` on a 5-6-5 screen), so
    the colours are what the game showed, widened like `.shk`'s. It keys every pixel equal to the
    first one (0x462140 -> 0x412830), compared after that cut. The hue an account could give a
    character (the rows' HSV turn before the cut) is not applied: this is hue 0."""
    b, g, r = (bgr[..., i].astype(np.uint16) for i in range(3))
    rgb565 = (r >> 3) << 11 | (g >> 2) << 5 | (b >> 3)
    return rgb565_to_rgba(rgb565, int(rgb565[0, 0]) if rgb565.size else None)


def _read_animation(reader: "_Reader", width: int, height: int) -> Animation:
    name = _decode_name(reader.take(NAME_SIZE))
    unknown, frame_count = reader.unpack(ANIM_HEADER)
    frames = []
    for expected_index in range(1, frame_count + 1):
        frame = Frame(*reader.unpack(FRAME))
        if frame.index != expected_index:
            raise SprFormatError(f"{name}: frame index {frame.index}, expected {expected_index}")
        if not (0 <= frame.left < frame.right <= width and 0 <= frame.top < frame.bottom <= height):
            raise SprFormatError(f"{name}: frame {frame.index} rect outside {width}x{height} sheet")
        frames.append(frame)
    return Animation(name=name, unknown_u16=unknown, frames=tuple(frames))


def _decode_name(raw: bytes) -> str:
    return raw.split(b"\0", 1)[0].decode(TEXT_ENCODING, errors="replace")


class _Reader:
    def __init__(self, data: bytes, offset: int):
        self.data = data
        self.offset = offset

    def take(self, size: int) -> bytes:
        end = self.offset + size
        if end > len(self.data):
            raise SprFormatError("truncated animation table")
        chunk = self.data[self.offset : end]
        self.offset = end
        return chunk

    def unpack(self, layout: struct.Struct) -> tuple:
        return layout.unpack(self.take(layout.size))
