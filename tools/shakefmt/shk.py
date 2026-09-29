"""`.shk` image decoder.

Layout (little-endian):
    0   char[11]  magic "SHAKE V1.0\\0"
    11  u16       2 on every known file (bytes per pixel)
    13  u16       0x0240 on every known file (meaning unknown)
    15  u16       width
    17  u16       height
    19  u16       equals height on known files (meaning unknown)
    21  u16       varies per file (meaning unknown)
    23  u32       pixel count (= width * height)
    27  u16[]     RGB565 pixels, row-major, top-down

Some files carry extra bytes after the pixels: stale data left behind when a
larger image was overwritten in place. The header is authoritative.
"""

import struct
from dataclasses import dataclass

import numpy as np

MAGIC = b"SHAKE V1.0\0"
HEADER = struct.Struct("<HHHHHHI")
HEADER_SIZE = len(MAGIC) + HEADER.size
BYTES_PER_PIXEL = 2
KNOWN_HDR_13 = 0x0240
COLOR_KEY = 0xF81F
# shake.exe's loader (0x414410) keys a surface on its top-left pixel unless the caller
# sets a key (0x414b20); a key of 0 there means the surface is blitted opaque.
TOP_LEFT = "top-left"


class ShkFormatError(ValueError):
    pass


@dataclass(frozen=True)
class ShkImage:
    width: int
    height: int
    rgba: np.ndarray
    header_fields: dict
    trailing_bytes: int


def decode_shk(data: bytes, key: int | str | None = COLOR_KEY) -> ShkImage:
    """`key` is the RGB565 value drawn transparent, TOP_LEFT for the first pixel, or None for opaque."""
    if not data.startswith(MAGIC):
        raise ShkFormatError("missing SHAKE V1.0 magic")
    if len(data) < HEADER_SIZE:
        raise ShkFormatError("truncated header")

    bpp, hdr_13, width, height, hdr_19, hdr_21, pixel_count = HEADER.unpack_from(data, len(MAGIC))
    if bpp != BYTES_PER_PIXEL:
        raise ShkFormatError(f"unexpected bytes per pixel {bpp}")
    if hdr_13 != KNOWN_HDR_13:
        raise ShkFormatError(f"unexpected header field @13: {hdr_13:#06x}")
    if pixel_count != width * height:
        raise ShkFormatError(f"pixel count {pixel_count} != {width}x{height}")

    pixel_end = HEADER_SIZE + pixel_count * BYTES_PER_PIXEL
    if len(data) < pixel_end:
        raise ShkFormatError(f"truncated pixels: need {pixel_end} bytes, have {len(data)}")

    pixels = np.frombuffer(data, "<u2", count=pixel_count, offset=HEADER_SIZE)
    if key == TOP_LEFT:
        key = int(pixels[0]) if pixel_count else None
    return ShkImage(
        width=width,
        height=height,
        rgba=rgb565_to_rgba(pixels.reshape(height, width), key),
        header_fields={"hdr_11": bpp, "hdr_13": hdr_13, "hdr_19": hdr_19, "hdr_21": hdr_21},
        trailing_bytes=len(data) - pixel_end,
    )


def rgb565_to_rgba(pixels: np.ndarray, key: int | None = COLOR_KEY) -> np.ndarray:
    value = pixels.astype(np.uint16)
    r5 = value >> 11
    g6 = (value >> 5) & 0x3F
    b5 = value & 0x1F
    rgba = np.empty(pixels.shape + (4,), dtype=np.uint8)
    rgba[..., 0] = (r5 << 3) | (r5 >> 2)
    rgba[..., 1] = (g6 << 2) | (g6 >> 4)
    rgba[..., 2] = (b5 << 3) | (b5 >> 2)
    rgba[..., 3] = 255 if key is None else np.where(value == key, 0, 255)
    return rgba
