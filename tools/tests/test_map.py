import pytest

from builders import build_map
from shakefmt.map import CellKind, MapFormatError, MapObject, decode_map

OBJECT = (3, 1, 0, 90, 81, 130, 112, 1, 13, 0)


def test_parses_header_and_geometry():
    level = decode_map(build_map())

    assert level.background == "mizar"
    assert level.title == "01미자르"
    assert level.max_players == 6
    assert level.sprites == ("b1.spr", "b2.spr")
    assert level.screen == (800, 600)
    assert level.area == (50, 49, 130, 113)
    assert (level.grid_width, level.grid_height) == (2, 2)
    assert (level.cell_width, level.cell_height) == (40, 32)


def test_parses_fixed_blocks_bricks_and_objects():
    level = decode_map(build_map(fixed=[(0, 0)], bricks=[(1, 7, 1), (0, 0, 2)], objects=[OBJECT]))

    assert [(f.sprite, f.cell) for f in level.fixed] == [(0, 0)]
    assert [(b.sprite, b.unknown_u16, b.cell) for b in level.bricks] == [(1, 7, 1), (0, 0, 2)]
    assert level.objects == (
        MapObject(
            cell=3, kind_flag=1, unknown_u32=0, left=90, top=81, right=130, bottom=112,
            unknown_a=1, anim=13, unknown_b=0,
        ),
    )
    assert [c.kind for c in level.cells] == [CellKind.FIXED, CellKind.BRICK, CellKind.BRICK, CellKind.EMPTY]
    assert level.cells[1].brick_index == 0
    assert level.cells[3].object_index == 0
    assert level.cells[0].raw == (0, -1, -1, 0, 1, 0, 0, 0, 0, 0)


def test_reports_trailing_bytes():
    assert decode_map(build_map(trailing=b"\0\0\0")).trailing_bytes == 3


def cells_with(kind_of_cell0):
    cells = [[0, -1, -1, 0, 0, 0, 0, 0, 0, 0] for _ in range(4)]
    cells[0][4] = kind_of_cell0
    return cells


@pytest.mark.parametrize(
    "data",
    [
        pytest.param(b"ver 1.0\0" + bytes(200), id="bad-magic"),
        pytest.param(build_map()[:-5], id="truncated-cells"),
        pytest.param(build_map()[:60], id="truncated-header"),
        pytest.param(build_map(fixed=[(0, 0)], cells=cells_with(0)), id="fixed-cell-not-marked"),
        pytest.param(build_map(bricks=[(0, 0, 0)], cells=cells_with(2)), id="brick-index-mismatch"),
        pytest.param(build_map(fixed=[(5, 0)]), id="unknown-sprite"),
        pytest.param(build_map(fixed=[(0, 9)], cells=cells_with(0)), id="cell-out-of-grid"),
        pytest.param(build_map(area=(50, 49, 131, 113)), id="area-not-divisible"),
        pytest.param(build_map(grid=(0, 0), cells=[]), id="empty-grid"),
    ],
)
def test_rejects_malformed_or_inconsistent_maps(data):
    with pytest.raises(MapFormatError):
        decode_map(data)
