"""`.map` level decoder.

Layout (little-endian):
    0   char[8]   magic "ver 2.0\\0"
    8   u16       unknown (0x398B on every known file)
    10  char[31]  background image name (without extension, file is <name>.shk)
    41  u16       title length, then title bytes (EUC-KR)
    ..  u16       max players (6)
        u32       unknown (0 or 1)
        u16       sprite count, then char[31] per brick sprite file name
        u32[6]    screen width, screen height, play area left, top, right, bottom
        u16       fixed block count, then (u16 sprite, u16 cell) each
        u16       brick count, then (u16 sprite, u16 unknown, u16 cell) each
        u16       object count, then 30 bytes each:
                      u16 cell, u16 kind flag, u32 unknown, i32 left, top, right, bottom,
                      u16 unknown, u16 animation index in object_b.spr, u16 unknown
        u16       grid width, u16 grid height
        i16[10]   per cell: [1] brick index, [2] object index, [4] kind (0 empty, 1 fixed,
                  2 brick); other fields kept raw (flags for jump/warp cells, garbage)

Cells are numbered row-major (cell = row * grid_width + col). Fixed blocks are drawn
with the first frame of their sprite; some backgrounds do not paint them.
"""

import struct
from dataclasses import dataclass
from enum import IntEnum

MAGIC = b"ver 2.0\0"
NAME_SIZE = 31
TEXT_ENCODING = "cp949"


class MapFormatError(ValueError):
    pass


class CellKind(IntEnum):
    EMPTY = 0
    FIXED = 1
    BRICK = 2


@dataclass(frozen=True)
class FixedBlock:
    sprite: int
    cell: int


@dataclass(frozen=True)
class Brick:
    sprite: int
    unknown_u16: int
    cell: int


@dataclass(frozen=True)
class MapObject:
    cell: int
    kind_flag: int
    unknown_u32: int
    left: int
    top: int
    right: int
    bottom: int
    unknown_a: int
    anim: int
    unknown_b: int


@dataclass(frozen=True)
class Cell:
    raw: tuple[int, ...]

    @property
    def kind(self) -> CellKind:
        return CellKind(self.raw[4])

    @property
    def brick_index(self) -> int:
        return self.raw[1]

    @property
    def object_index(self) -> int:
        return self.raw[2]


@dataclass(frozen=True)
class Level:
    background: str
    title: str
    max_players: int
    sprites: tuple[str, ...]
    screen: tuple[int, int]
    area: tuple[int, int, int, int]
    grid_width: int
    grid_height: int
    fixed: tuple[FixedBlock, ...]
    bricks: tuple[Brick, ...]
    objects: tuple[MapObject, ...]
    cells: tuple[Cell, ...]
    header_unknowns: dict
    trailing_bytes: int

    @property
    def cell_width(self) -> int:
        return (self.area[2] - self.area[0]) // self.grid_width

    @property
    def cell_height(self) -> int:
        return (self.area[3] - self.area[1]) // self.grid_height


def decode_map(data: bytes) -> Level:
    if not data.startswith(MAGIC):
        raise MapFormatError("missing 'ver 2.0' magic")
    reader = _Reader(data, len(MAGIC))

    (unknown_header_u16,) = reader.unpack("<H")
    background = _decode_name(reader.take(NAME_SIZE))
    (title_length,) = reader.unpack("<H")
    title = reader.take(title_length).decode(TEXT_ENCODING, errors="replace")
    max_players, unknown_header_u32, sprite_count = reader.unpack("<HIH")
    sprites = tuple(_decode_name(reader.take(NAME_SIZE)) for _ in range(sprite_count))
    screen_w, screen_h, *area = reader.unpack("<6I")

    fixed = tuple(FixedBlock(*reader.unpack("<HH")) for _ in range(reader.unpack("<H")[0]))
    bricks = tuple(Brick(*reader.unpack("<HHH")) for _ in range(reader.unpack("<H")[0]))
    objects = tuple(MapObject(*reader.unpack("<HHIiiiiHHH")) for _ in range(reader.unpack("<H")[0]))
    grid_width, grid_height = reader.unpack("<HH")
    cells = tuple(Cell(reader.unpack("<10h")) for _ in range(grid_width * grid_height))

    level = Level(
        background=background,
        title=title,
        max_players=max_players,
        sprites=sprites,
        screen=(screen_w, screen_h),
        area=tuple(area),
        grid_width=grid_width,
        grid_height=grid_height,
        fixed=fixed,
        bricks=bricks,
        objects=objects,
        cells=cells,
        header_unknowns={"u16_at_8": unknown_header_u16, "u32_after_max_players": unknown_header_u32},
        trailing_bytes=len(data) - reader.offset,
    )
    _validate(level)
    return level


def _validate(level: Level) -> None:
    left, top, right, bottom = level.area
    if not level.grid_width or not level.grid_height:
        raise MapFormatError(f"empty grid {level.grid_width}x{level.grid_height}")
    if (right - left) % level.grid_width or (bottom - top) % level.grid_height:
        raise MapFormatError(f"play area {level.area} not divisible by grid {level.grid_width}x{level.grid_height}")

    cell_count = len(level.cells)
    kinds = {kind.value for kind in CellKind}
    for index, cell in enumerate(level.cells):
        if cell.raw[4] not in kinds:
            raise MapFormatError(f"cell {index} has unknown kind {cell.raw[4]}")
    for block in level.fixed:
        _check_ref(level, block.sprite, block.cell, "fixed block")
        if level.cells[block.cell].kind != CellKind.FIXED:
            raise MapFormatError(f"fixed block at cell {block.cell} not marked fixed")
    for index, brick in enumerate(level.bricks):
        _check_ref(level, brick.sprite, brick.cell, "brick")
        cell = level.cells[brick.cell]
        if cell.kind != CellKind.BRICK or cell.brick_index != index:
            raise MapFormatError(f"brick {index} at cell {brick.cell} not marked in grid")
    for index, obj in enumerate(level.objects):
        if not 0 <= obj.cell < cell_count or level.cells[obj.cell].object_index != index:
            raise MapFormatError(f"object {index} at cell {obj.cell} not marked in grid")
    # And the other way: a cell names only a record that sits in it.
    for index, cell in enumerate(level.cells):
        obj = cell.object_index
        if obj >= 0 and (obj >= len(level.objects) or level.objects[obj].cell != index):
            raise MapFormatError(f"cell {index} names object {obj}, which is not there")
        brick = cell.brick_index
        if cell.kind == CellKind.BRICK and not (0 <= brick < len(level.bricks) and level.bricks[brick].cell == index):
            raise MapFormatError(f"brick cell {index} names brick {brick}, which is not there")


def _check_ref(level: Level, sprite: int, cell: int, what: str) -> None:
    if not 0 <= sprite < len(level.sprites):
        raise MapFormatError(f"{what} uses sprite {sprite}, map has {len(level.sprites)}")
    if not 0 <= cell < len(level.cells):
        raise MapFormatError(f"{what} cell {cell} outside {level.grid_width}x{level.grid_height} grid")


def _decode_name(raw: bytes) -> str:
    return raw.split(b"\0", 1)[0].decode(TEXT_ENCODING, errors="replace")


class _Reader:
    def __init__(self, data: bytes, offset: int):
        self.data = data
        self.offset = offset

    def take(self, size: int) -> bytes:
        end = self.offset + size
        if end > len(self.data):
            raise MapFormatError("truncated map data")
        chunk = self.data[self.offset : end]
        self.offset = end
        return chunk

    def unpack(self, layout: str) -> tuple:
        return struct.unpack(layout, self.take(struct.calcsize(layout)))
