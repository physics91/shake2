import hashlib
import json
import struct
from pathlib import Path

import pytest

from font_builders import collection, font, strike
from shakefmt.font import (
    STRIKES,
    cp949_chars,
    default_ttc,
    export_fonts,
    gdi_advances,
    pack,
    read_collection,
    render,
)

# 'A' (3x2, format 2 in an index 3), '가' (a composite of two parts in an index that says
# 4 wide while the glyph says 3), 'B' (byte-aligned format 1 in an index 1).
# Parts share one index-format-2 box (2x3); the bottom part's second row falls outside the composite.
PART_TOP = {"metrics": (2, 3, 0, 3, 4), "rows": ["##.", "#.."]}
PART_BOTTOM = {"metrics": (2, 3, 0, 3, 4), "rows": ["###", "#.#"]}
GLYPH_A = {"metrics": (3, 2, 0, 3, 2), "rows": ["#.", ".#", "##"]}
GLYPH_B = {"metrics": (2, 9, 1, 2, 2), "rows": ["#.......#", ".#......."]}
HANGUL = {"metrics": (3, 3, 0, 3, 3), "parts": [(1, 0, 0), (2, 0, 2)]}


def tiny_font(family="TestChe", fixed=True, ppem=4, hangul_width=4):
    return font(
        family,
        fixed,
        {"A": 3, "가": 4, "B": 5},
        [
            strike(ppem, 3, 1, [
                (2, 5, 1, [PART_TOP, PART_BOTTOM], (2, 3, 0, 3, 4)),
                (3, 2, 3, [GLYPH_A], None),
                (2, 8, 4, [HANGUL], (3, 3, 0, 3, hangul_width)),
                (1, 1, 5, [GLYPH_B], None),
            ]),
        ],
        ranged="B",
    )


@pytest.fixture
def faces():
    return read_collection(collection(tiny_font(), tiny_font("Test", fixed=False)))


def test_collection_faces_by_family(faces):
    assert sorted(faces) == ["Test", "TestChe"]
    assert faces["TestChe"].fixed_pitch()
    assert not faces["Test"].fixed_pitch()


def test_cmap_maps_delta_and_ranged_segments(faces):
    assert faces["TestChe"].cmap() == {ord("A"): 3, ord("가"): 4, ord("B"): 5}


def test_strike_reads_small_metrics_bit_aligned(faces):
    s = faces["TestChe"].strike(4, ["A"])
    assert (s.ascent, s.descent) == (3, 1)
    g = s.glyphs["A"]
    assert (g.advance, g.left, g.top, g.width, g.height) == (2, 0, 0, 2, 3)
    assert g.ink == [[1, 0], [0, 1], [1, 1]]


def test_strike_reads_byte_aligned_rows(faces):
    g = faces["TestChe"].strike(4, ["B"]).glyphs["B"]
    assert (g.left, g.top, g.width, g.height) == (1, 1, 9, 2)
    assert g.ink == [[1, 0, 0, 0, 0, 0, 0, 0, 1], [0, 1, 0, 0, 0, 0, 0, 0, 0]]


def test_composite_ors_parts_and_index_metrics_win(faces):
    g = faces["TestChe"].strike(4, ["가"]).glyphs["가"]
    # The index says 4 wide; the glyph's own metrics say 3 (굴림 15's Hangul, where GDI steps the index's).
    assert g.advance == 4
    assert g.ink == [[1, 1, 0], [1, 0, 0], [1, 1, 1]]


def test_missing_strike_and_characters(faces):
    with pytest.raises(ValueError, match="no 9 ppem strike"):
        faces["TestChe"].strike(9, ["A"])
    assert set(faces["TestChe"].strike(4, ["A", "Z"]).glyphs) == {"A"}


def test_fixed_pitch_double_byte_is_twice_single():
    faces = read_collection(collection(tiny_font(hangul_width=3)))
    s = faces["TestChe"].strike(4, ["A", "가"])
    assert gdi_advances(s) == (2, 4)
    assert s.glyphs["가"].advance == 4


def test_fixed_pitch_needs_one_single_byte_width(faces):
    s = faces["TestChe"].strike(4, ["A", "B"])
    s.glyphs["B"].advance = 3
    with pytest.raises(ValueError, match="single-byte widths"):
        gdi_advances(s)


def test_proportional_keeps_strike_widths(faces):
    s = faces["Test"].strike(4, ["A", "가"])
    assert gdi_advances(s) == (None, None)
    assert [s.glyphs[c].advance for c in "A가"] == [2, 4]


def test_render_places_cells_like_textout(faces):
    s = faces["TestChe"].strike(4, ["A", "B"])
    # Pen from x 1, cell top at row 1; B sits one row down (top 1) and one right (left 1).
    assert render(s, "AB") == [
        [0, 0, 0, 0, 0, 0],
        [0, 1, 0, 0, 0, 0],
        [0, 0, 1, 0, 1, 0],
        [0, 1, 1, 0, 0, 1],
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
    ]


def test_pack_layout(faces):
    s = faces["TestChe"].strike(4, ["A", "가"])
    data = pack(s)
    assert data[:4] == b"SHF1"
    assert struct.unpack_from("<I", data, 4)[0] == 2
    assert struct.unpack_from("<HBbbBB", data, 8) == (ord("A"), 2, 0, 0, 2, 3)
    assert data[15:16] == bytes([0b10011100])
    assert struct.unpack_from("<HBbbBB", data, 16) == (ord("가"), 4, 0, 0, 3, 3)
    assert data[23:25] == bytes([0b11010011, 0b10000000])
    assert len(data) == 25


def test_export_writes_strikes_and_index(tmp_path):
    ttc = tmp_path / "test.ttc"
    ttc.write_bytes(collection(tiny_font()))
    index = export_fonts(ttc, tmp_path / "font", strikes=(("testche-4", "TestChe", 4),))
    written = json.loads((tmp_path / "font" / "index.json").read_text(encoding="utf-8"))
    assert written == index
    assert "Do not redistribute" in index["note"]
    entry = index["strikes"][0]
    assert entry["file"] == "testche-4.bin"
    assert (entry["glyphs"], entry["missing"]) == (3, len(cp949_chars()) - 3)
    assert (entry["ascent"], entry["descent"], entry["sbcs_advance"], entry["dbcs_advance"]) == (3, 1, 2, 4)
    assert (tmp_path / "font" / "testche-4.bin").read_bytes()[:4] == b"SHF1"


def test_cp949_chars_cover_the_code_page():
    chars = cp949_chars()
    assert len(chars) == 17143
    assert chars[:3] == [" ", "!", '"']
    assert {"가", "힣", "똠", "☞", "弘"} <= set(chars)


GULIM = default_ttc()

# sha256 of GDI's own ink (TextOutW at (1,1), CreateFontW with shake.exe's arguments, Korean
# Windows 11 26200) over (extent + 4) x (height + 2), rows of 0/1 joined by newlines. Only the
# hashes are kept here: the glyphs are Microsoft's.
GDI_HASHES = {
    ("GulimChe", 12, "미자르코벱"): (60, "07680690af29ca02644c0e0946c9a3b2175e5232600b888620643edc073ca3c8"),
    ("GulimChe", 13, "가A나B다C 라1마2 바"): (133, "4f9709581b2d69819238b2f2d1af01bce365fa558dd4d9773f65ec5383ff6c2d"),
    ("GulimChe", 14, "방 제목 Room 12"): (105, "10e20faaaae8f8cd783aee4b271470fadd5de9c3f7c166fd2dd5d9a9782c5942"),
    ("Gulim", 15, "방 제목 Room 12"): (115, "158036dfa24101c0a9f720b778cb92a920678c08cfe60e64146ba6413edfcce5"),
}


@pytest.mark.skipif(GULIM is None or not Path(GULIM).is_file(), reason="needs the local Windows gulim.ttc")
@pytest.mark.parametrize("family,ppem,text", list(GDI_HASHES))
def test_gulim_strikes_match_gdi(family, ppem, text):
    assert (family, ppem) in {(f, p) for _, f, p in STRIKES}
    s = read_collection(Path(GULIM).read_bytes())[family].strike(ppem, cp949_chars())
    gdi_advances(s)
    extent, digest = GDI_HASHES[(family, ppem, text)]
    assert sum(s.glyphs[c].advance for c in text) == extent
    ink = render(s, text)
    rows = ["".join(str(ink[y][x]) if y < len(ink) and x < len(ink[0]) else "0" for x in range(extent + 4))
            for y in range(ppem + 2)]
    assert hashlib.sha256("\n".join(rows).encode()).hexdigest() == digest
