"""Compose a static level preview: background, fixed blocks, bricks, objects."""

from collections.abc import Mapping

import numpy as np
from PIL import Image

from shakefmt.map import Level
from shakefmt.spr import SprSheet


def render_level_preview(
    level: Level,
    background: np.ndarray,
    brick_sheets: Mapping[str, SprSheet],
    object_sheets: Mapping[int, SprSheet],
) -> np.ndarray:
    canvas = Image.fromarray(background)

    for block in level.fixed:
        _draw_first_frame(canvas, brick_sheets[level.sprites[block.sprite]], 0, *_cell_origin(level, block.cell))
    for brick in level.bricks:
        _draw_first_frame(canvas, brick_sheets[level.sprites[brick.sprite]], 0, *_cell_origin(level, brick.cell))
    for obj in level.objects:
        # object rects are the editor's draw positions: frame 0 goes at (left, top) on every sheet
        _draw_first_frame(canvas, object_sheets[obj.unknown_a], obj.anim, obj.left, obj.top, use_anchor=False)

    return np.asarray(canvas)


def _cell_origin(level: Level, cell: int) -> tuple[int, int]:
    row, col = divmod(cell, level.grid_width)
    return level.area[0] + col * level.cell_width, level.area[1] + row * level.cell_height


def _draw_first_frame(canvas, sheet: SprSheet, anim: int, x: int, y: int, *, use_anchor: bool = True) -> None:
    frames = sheet.animations[anim].frames
    if not frames:
        return
    frame = frames[0]
    crop = Image.fromarray(sheet.rgba[frame.top : frame.bottom, frame.left : frame.right])
    if use_anchor:
        x, y = x - frame.anchor_x, y - frame.anchor_y
    # As the game draws (0x462d92): a top-left above or left of the screen moves to 0, and a frame
    # starting past the right or bottom edge shows nothing; Pillow cannot take boxes that far out.
    x, y = max(x, 0), max(y, 0)
    if x >= canvas.width or y >= canvas.height:
        return
    canvas.alpha_composite(crop, (x, y))
