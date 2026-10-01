"""Export decoded Shake2 assets as PNG + JSON.

Usage: python -m shakefmt.export [SRC] [DST]

Mirrors SRC under DST: `.shk` -> `.png`, `.spr` -> `.png` + `.json`,
`.map` -> `.json` + `.preview.png`. Other files are only listed in DST/index.json.
From the default SRC it also exports BORROWED, pictures from other Shake builds.
"""

import json
import os
import sys
from pathlib import Path

from PIL import Image

from shakefmt.map import Level, MapFormatError, decode_map
from shakefmt.preview import render_level_preview
from shakefmt.shk import TOP_LEFT, decode_shk
from shakefmt.spr import SprSheet, decode_spr

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SRC = REPO_ROOT / "original/extracted/Shake0311_20020323/files/App_Executables"
DEFAULT_DST = REPO_ROOT / "assets/extracted"
EXTRACTED_ROOT = REPO_ROOT / "original/extracted"
RECT_CONVENTION = "rect = [left, top, right, bottom] in sheet pixels, right/bottom exclusive"
ANCHOR_CONVENTION = (
    "anchor = [x, y] offset from the frame top-left to the reference point (character feet); "
    "may lie outside the frame, e.g. jump frames. Inferred from data, not confirmed in shake.exe"
)


# Colour keys shake.exe gives in-game .shk surfaces (0x414410 / 0x414b20). Files not listed keep
# the magenta key 0xF81F, which the others set explicitly.
SHK_KEYS: dict[str, int | str | None] = {
    "wg_char": TOP_LEFT,
    "images": TOP_LEFT,
    "mark": TOP_LEFT,
    "item": TOP_LEFT,
    "new_icon": TOP_LEFT,
    "new_teambar": TOP_LEFT,
    "sd": TOP_LEFT,
    "guild": TOP_LEFT,
    "new_round_e": None,
    "new_game_e": None,
    "new_load": None,
}


# Pictures the 0311 code draws but its data lacks, taken from another extracted Shake build
# (AGENTS.md; graded R in FIDELITY). Paths are under EXTRACTED_ROOT and DST. Drawn opaque.
BORROWED: tuple[tuple[str, str], ...] = (
    # Scene 5, the "My Status" menu (0x41cc30 / 0x41cf30): Shake1's background, whose buttons
    # sit where the 0311 code hit-tests them.
    ("Shake1_20020212/files/Data/image/status.shk", "image/shake1_status.png"),
    # Its option page (0x41d062): 0311 never makes the panel, so the code would draw from NULL.
    ("Shake1_20020212/files/Data/image/option.shk", "image/shake1_option.png"),
)


def export_tree(src: Path, dst: Path) -> dict:
    entries = []
    for path in sorted(p for p in src.rglob("*") if p.is_file()):
        rel = path.relative_to(src)
        exporter = EXPORTERS.get(path.suffix.lower())
        if exporter is None:
            entries.append({"source": rel.as_posix(), "kind": "unconverted", "bytes": path.stat().st_size})
            continue
        try:
            entries.append(exporter(src, rel, dst))
        except (ValueError, OSError) as error:
            entries.append({"source": rel.as_posix(), "kind": path.suffix.lower()[1:], "error": str(error)})

    index = {
        "source_root": os.path.relpath(src, dst),
        "summary": _summarize(entries),
        "entries": entries,
    }
    _write_json(dst / "index.json", index)
    return index


def export_borrowed(root: Path, dst: Path, borrowed=BORROWED) -> list[dict]:
    entries = []
    for source, output in borrowed:
        image = decode_shk((root / source).read_bytes(), None)
        _save_png(image.rgba, dst / output)
        entries.append({"source": source, "kind": "shk", "output": output, "width": image.width, "height": image.height})
    return entries


def _export_shk(src: Path, rel: Path, dst: Path) -> dict:
    image = decode_shk((src / rel).read_bytes(), SHK_KEYS.get(rel.stem.lower(), 0xF81F))
    output = rel.with_suffix(".png")
    _save_png(image.rgba, dst / output)
    return {
        "source": rel.as_posix(),
        "kind": "shk",
        "output": output.as_posix(),
        "width": image.width,
        "height": image.height,
        "header_fields": image.header_fields,
        "trailing_bytes": image.trailing_bytes,
        "warnings": _trailing_warning(image.trailing_bytes),
    }


def _export_spr(src: Path, rel: Path, dst: Path) -> dict:
    sheet = decode_spr((src / rel).read_bytes())
    output = rel.with_suffix(".png")
    metadata = rel.with_suffix(".json")
    _save_png(sheet.rgba, dst / output)
    _write_json(dst / metadata, _sheet_metadata(sheet, rel, output))
    tinted = {}
    if rel.parent.as_posix() in TINTED_SHEET_DIRS:
        rgb = rel.with_suffix(".rgb.png")
        _save_png(sheet.rgb, dst / rgb)
        tinted = {"rgb": rgb.as_posix()}
    return {
        "source": rel.as_posix(),
        "kind": "spr",
        "output": output.as_posix(),
        "metadata": metadata.as_posix(),
        **tinted,
        "width": sheet.width,
        "height": sheet.height,
        "animations": len(sheet.animations),
        "frames": sum(len(a.frames) for a in sheet.animations),
        "trailing_bytes": sheet.trailing_bytes,
        "warnings": _trailing_warning(sheet.trailing_bytes),
    }


def _export_map(src: Path, rel: Path, dst: Path) -> dict:
    level = decode_map((src / rel).read_bytes())
    if any(o.unknown_a >= len(OBJECT_SHEETS) for o in level.objects):
        raise MapFormatError(f"object sheet beyond the {len(OBJECT_SHEETS)} shake.exe loads")
    background = decode_shk((src / rel.parent / f"{level.background}.shk").read_bytes())
    brick_sheets = {
        name: decode_spr((src / "spr_data" / "brick" / name).read_bytes()) for name in set(level.sprites)
    }
    object_sheets = {
        sheet: decode_spr((src / "spr_data" / "object" / OBJECT_SHEETS[sheet]).read_bytes())
        for sheet in {o.unknown_a for o in level.objects}
    }
    metadata = rel.with_suffix(".json")
    preview = rel.with_suffix(".preview.png")
    _write_json(dst / metadata, _level_metadata(level, rel, preview))
    _save_png(render_level_preview(level, background.rgba, brick_sheets, object_sheets), dst / preview)
    return {
        "source": rel.as_posix(),
        "kind": "map",
        "metadata": metadata.as_posix(),
        "preview": preview.as_posix(),
        "title": level.title,
        "objects": len(level.objects),
        "trailing_bytes": level.trailing_bytes,
        "warnings": _trailing_warning(level.trailing_bytes),
    }


# Sheets a character's tint turns as they are read (0x462140 → 0x414d50): the players in play,
# the _p portraits and the w_character panel faces. Their 8-bit colours go to `<name>.rgb.png`.
TINTED_SHEET_DIRS = ("spr_data/character", "spr_data/w_character")

EXPORTERS = {".shk": _export_shk, ".spr": _export_spr, ".map": _export_map}
# shake.exe loads all three for every map; an object's unknown_a picks one (0x411530, 0x41176a).
OBJECT_SHEETS = ("object_a.spr", "object_b.spr", "object_c.spr")


def _level_metadata(level: Level, rel: Path, preview: Path) -> dict:
    return {
        "source": rel.as_posix(),
        "title": level.title,
        "background_image": f"{level.background}.png",
        "preview": preview.name,
        "max_players": level.max_players,
        "sprites": list(level.sprites),
        "object_sheets": list(OBJECT_SHEETS),
        "screen": list(level.screen),
        "area": list(level.area),
        "grid": {
            "width": level.grid_width,
            "height": level.grid_height,
            "cell_width": level.cell_width,
            "cell_height": level.cell_height,
        },
        "fixed": [{"sprite": f.sprite, "cell": f.cell} for f in level.fixed],
        "bricks": [{"sprite": b.sprite, "cell": b.cell, "unknown_u16": b.unknown_u16} for b in level.bricks],
        "objects": [
            {
                "cell": o.cell,
                "anim": o.anim,
                "rect": [o.left, o.top, o.right, o.bottom],
                "kind_flag": o.kind_flag,
                "unknown_u32": o.unknown_u32,
                "unknown_a": o.unknown_a,
                "unknown_b": o.unknown_b,
            }
            for o in level.objects
        ],
        "cells": {
            "kind": [
                [int(level.cells[row * level.grid_width + col].kind) for col in range(level.grid_width)]
                for row in range(level.grid_height)
            ],
            "raw": [list(cell.raw) for cell in level.cells],
        },
        "header_unknowns": level.header_unknowns,
    }


def _sheet_metadata(sheet: SprSheet, rel: Path, output: Path) -> dict:
    return {
        "source": rel.as_posix(),
        "sheet": output.name,
        "name": sheet.name,
        "width": sheet.width,
        "height": sheet.height,
        "rect_convention": RECT_CONVENTION,
        "anchor_convention": ANCHOR_CONVENTION,
        "animations": [
            {
                "name": anim.name,
                "unknown_u16": anim.unknown_u16,
                "frames": [
                    {
                        "index": f.index,
                        "anchor": [f.anchor_x, f.anchor_y],
                        "rect": [f.left, f.top, f.right, f.bottom],
                    }
                    for f in anim.frames
                ],
            }
            for anim in sheet.animations
        ],
    }


def _trailing_warning(trailing_bytes: int) -> list[str]:
    if not trailing_bytes:
        return []
    return [f"{trailing_bytes} trailing bytes ignored (stale data from an earlier, larger file)"]


def _summarize(entries: list[dict]) -> dict:
    def count(kind):
        return sum(1 for e in entries if e["kind"] == kind and "error" not in e)

    return {
        "shk": count("shk"),
        "spr": count("spr"),
        "map": count("map"),
        "unconverted": count("unconverted"),
        "errors": sum(1 for e in entries if "error" in e),
    }


def _save_png(rgba, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba).save(path)


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str]) -> int:
    src = Path(argv[1]) if len(argv) > 1 else DEFAULT_SRC
    dst = Path(argv[2]) if len(argv) > 2 else DEFAULT_DST
    index = export_tree(src, dst)
    if src == DEFAULT_SRC:
        index["borrowed"] = export_borrowed(EXTRACTED_ROOT, dst)
        _write_json(dst / "index.json", index)
    summary = index["summary"]
    print(
        f"shk {summary['shk']}, spr {summary['spr']}, map {summary['map']}, "
        f"unconverted {summary['unconverted']}, errors {summary['errors']} -> {dst}"
    )
    for entry in index["entries"]:
        if "error" in entry:
            print(f"  ERROR {entry['source']}: {entry['error']}", file=sys.stderr)
    return 1 if summary["errors"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
