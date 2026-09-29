import struct

import numpy as np
import pytest

from builders import build_anim, build_spr, pad_name
from shakefmt.export import DEFAULT_SRC
from shakefmt.spr import Frame, SprFormatError, decode_spr

MAGENTA_BGR = (255, 0, 255)

ONE_FRAME = [build_anim("고정", 5, [(0, 0, 0, 0, 1, 1)])]


def test_converts_bottom_up_bgr_rows_to_top_down_rgb_and_skips_row_padding():
    rows = [
        [MAGENTA_BGR, (0, 255, 0), (255, 0, 0)],
        [(10, 20, 30), (40, 50, 60), (70, 80, 90)],
    ]
    data = build_spr(rows, ONE_FRAME)
    stored_first_row = data[33:36]
    sheet = decode_spr(data)

    assert stored_first_row == bytes((10, 20, 30))
    assert sheet.rgba.shape == (2, 3, 4)
    assert sheet.rgba[0, 0].tolist() == [255, 0, 255, 0]
    assert sheet.rgba[0, 2].tolist() == [0, 0, 255, 255]
    # (60, 50, 40) cut to 5-6-5 is (7, 12, 5), shown as (57, 48, 41).
    assert sheet.rgba[1, 1].tolist() == [57, 48, 41, 255]


def test_cuts_each_pixel_to_rgb565_as_the_loader_does():
    # 0x414ed0: r & 0xf8, g & 0xfc, b >> 3; nothing is rounded up.
    rows = [[MAGENTA_BGR, (7, 3, 7), (255, 255, 255), (0x9b, 0xff, 0xff)]]
    sheet = decode_spr(build_spr(rows, ONE_FRAME))

    assert sheet.rgba[0, 1].tolist() == [0, 0, 0, 255]
    assert sheet.rgba[0, 2].tolist() == [255, 255, 255, 255]
    # Blue 0x9b = 155 keeps 19 of 31 levels: 156 on screen.
    assert sheet.rgba[0, 3].tolist() == [255, 255, 156, 255]


@pytest.mark.skipif(not DEFAULT_SRC.is_dir(), reason="original Shake0311 files not extracted")
@pytest.mark.parametrize("rel", ["item/item.spr", "object/hurry.spr", "bomb/bomb_red.spr"])
def test_real_sheets_have_opaque_pixels_inside_frame_rects(rel):
    sheet = decode_spr((DEFAULT_SRC / "spr_data" / rel).read_bytes())
    inside = np.zeros(sheet.rgba.shape[:2], dtype=bool)
    for anim in sheet.animations:
        for f in anim.frames:
            inside[f.top : f.bottom, f.left : f.right] = True
    opaque = sheet.rgba[..., 3] > 0

    assert (opaque & inside).sum() / opaque.sum() > 0.99


def test_magenta_becomes_transparent():
    sheet = decode_spr(build_spr([[MAGENTA_BGR, (0, 0, 0)]], ONE_FRAME))

    assert sheet.rgba[0, 0, 3] == 0
    assert sheet.rgba[0, 1, 3] == 255


def test_key_is_the_top_left_colour_after_rgb565_quantisation():
    green = (65, 81, 0)
    rows = [[green, (0, 0, 0), (67, 83, 1)], [MAGENTA_BGR, green, (0, 0, 0)]]
    sheet = decode_spr(build_spr(rows, ONE_FRAME))

    assert sheet.rgba[..., 3].tolist() == [[0, 255, 0], [255, 0, 255]]


def test_parses_animations_with_signed_anchor_and_exclusive_rects():
    anims = [
        build_anim("앞으로걷기", 18, [(20, 45, 0, 0, 2, 1), (-3, 7, 2, 0, 4, 2)], garbage=b"xyz"),
        build_anim("고정", 5, [(0, 0, 0, 0, 4, 2)]),
    ]
    sheet = decode_spr(build_spr([[(0, 0, 0)] * 4] * 2, anims))

    assert [a.name for a in sheet.animations] == ["앞으로걷기", "고정"]
    walk = sheet.animations[0]
    assert walk.unknown_u16 == 18
    assert walk.frames == (
        Frame(index=1, anchor_x=20, anchor_y=45, left=0, top=0, right=2, bottom=1),
        Frame(index=2, anchor_x=-3, anchor_y=7, left=2, top=0, right=4, bottom=2),
    )
    assert sheet.name == "캐릭터 이름"
    assert sheet.trailing_bytes == 0


def test_trailing_bytes_after_animations_are_reported():
    sheet = decode_spr(build_spr([[(0, 0, 0)]], ONE_FRAME, trailing=bytes(7)))

    assert sheet.trailing_bytes == 7


@pytest.mark.parametrize(
    "data",
    [
        pytest.param(build_spr([[(0, 0, 0)]], ONE_FRAME, data_size=3), id="data-size-mismatch"),
        pytest.param(
            build_spr([[(0, 0, 0)]], [build_anim("x", 0, [(0, 0, 0, 0, 2, 1)])]),
            id="rect-out-of-bounds",
        ),
        pytest.param(
            build_spr([[(0, 0, 0)]], [build_anim("x", 0, [(0, 0, 1, 0, 1, 1)])]),
            id="empty-rect",
        ),
        pytest.param(
            build_spr(
                [[(0, 0, 0)]],
                [b""],
                raw_anims=pad_name("x") + struct.pack("<HHHiiiiii", 0, 1, 2, 0, 0, 0, 0, 1, 1),
            ),
            id="non-sequential-frame-index",
        ),
        pytest.param(build_spr([[(0, 0, 0)]], ONE_FRAME)[:-5], id="truncated-trailer"),
        pytest.param(build_spr([[(0, 0, 0)]], ONE_FRAME)[:30], id="truncated-header"),
    ],
)
def test_rejects_malformed_files(data):
    with pytest.raises(SprFormatError):
        decode_spr(data)
