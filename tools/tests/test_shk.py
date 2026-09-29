import numpy as np
import pytest

from builders import build_shk
from shakefmt.shk import TOP_LEFT, ShkFormatError, decode_shk


def test_expands_rgb565_channels_with_bit_replication():
    image = decode_shk(build_shk(5, 1, [0xF800, 0x07E0, 0x001F, 0x0000, 0xFFFF]))

    assert image.rgba[0].tolist() == [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [0, 0, 0, 255],
        [255, 255, 255, 255],
    ]


def test_color_key_becomes_transparent():
    image = decode_shk(build_shk(2, 1, [0xF81F, 0x0000]))

    assert image.rgba[0, 0, 3] == 0
    assert image.rgba[0, 1, 3] == 255


def test_key_can_be_the_top_left_pixel_or_none():
    top_left = decode_shk(build_shk(3, 1, [0x0583, 0xF81F, 0x0583]), key=TOP_LEFT)
    opaque = decode_shk(build_shk(2, 1, [0xF81F, 0x0000]), key=None)

    assert top_left.rgba[0, :, 3].tolist() == [0, 255, 0]
    assert opaque.rgba[0, :, 3].tolist() == [255, 255]


def test_pixels_are_row_major_top_down():
    image = decode_shk(build_shk(2, 2, [0xF800, 0x07E0, 0x001F, 0xFFFF]))

    assert image.rgba.shape == (2, 2, 4)
    assert image.rgba[0, 1, :3].tolist() == [0, 255, 0]
    assert image.rgba[1, 0, :3].tolist() == [0, 0, 255]


def test_trailing_bytes_are_reported_and_ignored():
    image = decode_shk(build_shk(1, 1, [0x0000], trailing=b"\x12\x34" * 5))

    assert image.trailing_bytes == 10
    assert image.rgba.shape == (1, 1, 4)


def test_unknown_header_fields_are_kept_raw():
    image = decode_shk(build_shk(1, 1, [0x0000]))

    assert image.header_fields == {"hdr_11": 2, "hdr_13": 0x0240, "hdr_19": 1, "hdr_21": 0x1FE0}


@pytest.mark.parametrize(
    "data",
    [
        pytest.param(b"NOT A SHAKE" + bytes(16) + b"\0\0", id="bad-magic"),
        pytest.param(build_shk(1, 1, [0], bpp=3), id="unexpected-bpp"),
        pytest.param(build_shk(1, 1, [0], hdr_13=0x0241), id="unexpected-hdr13"),
        pytest.param(build_shk(2, 2, [0, 0, 0, 0], pixel_count=3), id="pixel-count-mismatch"),
        pytest.param(build_shk(2, 2, [0, 0, 0]), id="truncated-pixels"),
        pytest.param(b"SHAKE V1.0\0" + bytes(4), id="truncated-header"),
    ],
)
def test_rejects_malformed_files(data):
    with pytest.raises(ShkFormatError):
        decode_shk(data)


def test_rgba_is_uint8():
    assert decode_shk(build_shk(1, 1, [0x0000])).rgba.dtype == np.uint8
