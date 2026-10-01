import json
import os
from pathlib import Path

import pytest
from PIL import Image

from builders import build_anim, build_map, build_shk, build_spr
from shakefmt import export
from shakefmt.export import BORROWED, DEFAULT_SRC, export_borrowed, export_tree, main

RED_BGR = (0, 0, 255)
MAGENTA_BGR = (255, 0, 255)


@pytest.fixture
def synthetic_tree(tmp_path):
    src = tmp_path / "src"
    (src / "image").mkdir(parents=True)
    (src / "spr_data" / "brick").mkdir(parents=True)
    (src / "sound").mkdir()
    (src / "map_data").mkdir()
    (src / "map_data" / "stage.shk").write_bytes(build_shk(140, 120, [0x0000] * (140 * 120)))
    (src / "map_data" / "stage01.map").write_bytes(
        build_map(background="stage", title="01테스트", sprites=("b1.spr",), bricks=[(0, 0, 1)])
    )
    (src / "spr_data" / "brick" / "b1.spr").write_bytes(
        build_spr([[MAGENTA_BGR] + [RED_BGR] * 40] * 32, [build_anim("고정", 5, [(0, 0, 1, 0, 41, 32)])])
    )
    (src / "image" / "Logo.shk").write_bytes(build_shk(2, 1, [0xF81F, 0xF800], trailing=bytes(4)))
    (src / "spr_data" / "hero.spr").write_bytes(
        build_spr(
            [[(0, 0, 255)] * 4] * 2,
            [build_anim("앞으로걷기", 18, [(20, 45, 0, 0, 2, 2), (-1, 3, 2, 0, 4, 2)])],
        )
    )
    (src / "sound" / "bomb1.wav").write_bytes(b"RIFF....")
    return src


def entry_for(index, source):
    return next(e for e in index["entries"] if e["source"] == source)


def test_exports_shk_as_rgba_png_keeping_name_case(synthetic_tree, tmp_path):
    dst = tmp_path / "out"
    index = export_tree(synthetic_tree, dst)

    png = Image.open(dst / "image" / "Logo.png")
    assert png.mode == "RGBA"
    assert list(png.getdata()) == [(255, 0, 255, 0), (255, 0, 0, 255)]
    entry = entry_for(index, "image/Logo.shk")
    assert entry["width"] == 2 and entry["height"] == 1
    assert entry["trailing_bytes"] == 4
    assert entry["warnings"]


def test_exports_spr_sheet_and_animation_metadata(synthetic_tree, tmp_path):
    dst = tmp_path / "out"
    export_tree(synthetic_tree, dst)

    assert Image.open(dst / "spr_data" / "hero.png").size == (4, 2)
    meta = json.loads((dst / "spr_data" / "hero.json").read_text(encoding="utf-8"))
    assert meta["sheet"] == "hero.png"
    assert "exclusive" in meta["rect_convention"]
    assert "frame top-left" in meta["anchor_convention"]
    assert meta["animations"] == [
        {
            "name": "앞으로걷기",
            "unknown_u16": 18,
            "frames": [
                {"index": 1, "anchor": [20, 45], "rect": [0, 0, 2, 2]},
                {"index": 2, "anchor": [-1, 3], "rect": [2, 0, 4, 2]},
            ],
        }
    ]


def test_exports_the_8_bit_colours_of_the_sheets_a_tint_turns(synthetic_tree, tmp_path):
    # Characters (in play, _p portraits) and w_character panel faces are tinted as they are read.
    for folder in ("character", "w_character"):
        (synthetic_tree / "spr_data" / folder).mkdir()
        (synthetic_tree / "spr_data" / folder / "boy.spr").write_bytes(
            build_spr([[MAGENTA_BGR, (7, 3, 9)]], [build_anim("a", 5, [(0, 0, 1, 0, 2, 1)])])
        )
    dst = tmp_path / "out"
    index = export_tree(synthetic_tree, dst)

    for folder in ("character", "w_character"):
        rgb = Image.open(dst / "spr_data" / folder / "boy.rgb.png")
        assert rgb.mode == "RGB"
        assert list(rgb.getdata()) == [(255, 0, 255), (9, 3, 7)]
        assert entry_for(index, f"spr_data/{folder}/boy.spr")["rgb"] == f"spr_data/{folder}/boy.rgb.png"
    assert not (dst / "spr_data" / "hero.rgb.png").exists()
    assert "rgb" not in entry_for(index, "spr_data/hero.spr")


def test_exports_map_json_and_preview(synthetic_tree, tmp_path):
    dst = tmp_path / "out"
    index = export_tree(synthetic_tree, dst)

    level = json.loads((dst / "map_data" / "stage01.json").read_text(encoding="utf-8"))
    assert level["title"] == "01테스트"
    assert level["background_image"] == "stage.png"
    assert level["grid"] == {"width": 2, "height": 2, "cell_width": 40, "cell_height": 32}
    assert level["bricks"] == [{"sprite": 0, "cell": 1, "unknown_u16": 0}]
    assert level["cells"]["kind"] == [[0, 2], [0, 0]]
    assert entry_for(index, "map_data/stage01.map")["kind"] == "map"

    preview = Image.open(dst / "map_data" / "stage01.preview.png").convert("RGBA")
    assert preview.size == (140, 120)
    assert preview.getpixel((95, 60)) == (255, 0, 0, 255)
    assert preview.getpixel((60, 60)) == (0, 0, 0, 255)


def test_map_objects_draw_from_the_sheet_their_unknown_a_names(synthetic_tree, tmp_path):
    object_dir = synthetic_tree / "spr_data" / "object"
    object_dir.mkdir()
    for name, bgr in (("object_a.spr", (0, 255, 0)), ("object_b.spr", (255, 0, 0))):
        rows = [[MAGENTA_BGR] + [bgr] * 4] * 4
        (object_dir / name).write_bytes(build_spr(rows, [build_anim("o", 5, [(1, 1, 1, 0, 5, 4)])]))
    # (cell, kind_flag, unknown_u32, left, top, right, bottom, unknown_a, anim, unknown_b)
    objects = [(0, 1, 0, 10, 10, 14, 14, 0, 0, 0), (3, 1, 0, 30, 10, 34, 14, 1, 0, 0)]
    (synthetic_tree / "map_data" / "stage02.map").write_bytes(
        build_map(background="stage", title="02오브젝트", sprites=("b1.spr",), objects=objects)
    )
    dst = tmp_path / "out"
    export_tree(synthetic_tree, dst)

    level = json.loads((dst / "map_data" / "stage02.json").read_text(encoding="utf-8"))
    assert level["object_sheets"] == ["object_a.spr", "object_b.spr", "object_c.spr"]
    preview = Image.open(dst / "map_data" / "stage02.preview.png").convert("RGBA")
    assert preview.getpixel((11, 11)) == (0, 255, 0, 255)
    assert preview.getpixel((31, 11)) == (0, 0, 255, 255)


def test_map_objects_off_the_screen_draw_as_the_game_draws_them(synthetic_tree, tmp_path):
    # 0x462d92: a top-left left of the screen moves to 0; one far past the right edge shows nothing
    # and does not stop the export (Pillow cannot take a box out there).
    object_dir = synthetic_tree / "spr_data" / "object"
    object_dir.mkdir()
    rows = [[MAGENTA_BGR] + [(0, 255, 0)] * 4] * 4
    (object_dir / "object_a.spr").write_bytes(build_spr(rows, [build_anim("o", 5, [(1, 1, 1, 0, 5, 4)])]))
    objects = [(0, 1, 0, -5, 10, -1, 14, 0, 0, 0), (3, 1, 0, 2**31 - 1, 10, 2**31 - 1, 14, 0, 0, 0)]
    (synthetic_tree / "map_data" / "stage02.map").write_bytes(
        build_map(background="stage", title="02오브젝트", sprites=("b1.spr",), objects=objects)
    )
    dst = tmp_path / "out"
    index = export_tree(synthetic_tree, dst)

    assert index["summary"]["errors"] == 0
    preview = Image.open(dst / "map_data" / "stage02.preview.png").convert("RGBA")
    assert preview.getpixel((1, 11)) == (0, 255, 0, 255)


def test_guild_is_keyed_on_its_top_left_pixel(synthetic_tree, tmp_path):
    # 0x441782 loads [0x496c88] with 0x414410 (key = first pixel) and nothing rekeys it (no 0x414b20).
    (synthetic_tree / "image" / "guild.shk").write_bytes(build_shk(2, 1, [0x0000, 0xF81F]))
    export_tree(synthetic_tree, tmp_path / "out")

    png = Image.open(tmp_path / "out" / "image" / "guild.png")
    assert list(png.getdata()) == [(0, 0, 0, 0), (255, 0, 255, 255)]


def test_records_a_map_object_naming_a_missing_sheet(synthetic_tree, tmp_path):
    objects = [(0, 1, 0, 10, 10, 14, 14, len(export.OBJECT_SHEETS), 0, 0)]
    (synthetic_tree / "map_data" / "stage02.map").write_bytes(
        build_map(background="stage", title="02오브젝트", sprites=("b1.spr",), objects=objects)
    )
    index = export_tree(synthetic_tree, tmp_path / "out")

    assert entry_for(index, "map_data/stage02.map")["error"]
    assert index["summary"]["errors"] == 1


def test_records_a_map_drawing_an_animation_its_sheet_lacks(synthetic_tree, tmp_path):
    object_dir = synthetic_tree / "spr_data" / "object"
    object_dir.mkdir()
    for name in export.OBJECT_SHEETS:
        rows = [[MAGENTA_BGR] + [RED_BGR] * 4] * 4
        (object_dir / name).write_bytes(build_spr(rows, [build_anim("o", 5, [(1, 1, 1, 0, 5, 4)])]))
    objects = [(0, 1, 0, 10, 10, 14, 14, 1, 5, 0)]
    (synthetic_tree / "map_data" / "stage02.map").write_bytes(
        build_map(background="stage", title="02오브젝트", sprites=("b1.spr",), objects=objects)
    )
    (synthetic_tree / "spr_data" / "brick" / "b2.spr").write_bytes(build_spr([[MAGENTA_BGR] + [RED_BGR] * 40] * 32, []))
    (synthetic_tree / "map_data" / "stage03.map").write_bytes(
        build_map(background="stage", title="03벽돌", sprites=("b2.spr",), bricks=[(0, 0, 1)])
    )
    index = export_tree(synthetic_tree, tmp_path / "out")

    assert entry_for(index, "map_data/stage02.map")["error"]
    assert entry_for(index, "map_data/stage03.map")["error"]
    assert not (tmp_path / "out" / "map_data" / "stage02.json").exists()
    assert index["summary"]["errors"] == 2


def test_the_default_src_spelled_relatively_still_exports_the_borrowed_pictures(
    synthetic_tree, tmp_path, monkeypatch
):
    monkeypatch.setattr(export, "DEFAULT_SRC", synthetic_tree)
    borrowed = []
    monkeypatch.setattr(export, "export_borrowed", lambda root, dst: borrowed.append(dst) or [])
    monkeypatch.chdir(synthetic_tree.parent)

    main(["export", os.path.relpath(synthetic_tree), str(tmp_path / "out")])

    assert borrowed == [tmp_path / "out"]


def test_lists_other_files_without_converting(synthetic_tree, tmp_path):
    dst = tmp_path / "out"
    index = export_tree(synthetic_tree, dst)

    assert entry_for(index, "sound/bomb1.wav")["kind"] == "unconverted"
    assert not (dst / "sound").exists()
    assert json.loads((dst / "index.json").read_text(encoding="utf-8")) == index


def test_records_decode_failures_instead_of_stopping(synthetic_tree, tmp_path):
    (synthetic_tree / "image" / "broken.shk").write_bytes(b"garbage")
    index = export_tree(synthetic_tree, tmp_path / "out")

    assert entry_for(index, "image/broken.shk")["error"]
    assert index["summary"]["errors"] == 1
    assert Path(tmp_path / "out" / "image" / "Logo.png").exists()


def test_records_an_empty_picture_instead_of_stopping(synthetic_tree, tmp_path):
    (synthetic_tree / "image" / "empty.shk").write_bytes(build_shk(0, 5, []))
    (synthetic_tree / "spr_data" / "empty.spr").write_bytes(build_spr([[]] * 3, []))
    index = export_tree(synthetic_tree, tmp_path / "out")

    assert entry_for(index, "image/empty.shk")["error"]
    assert entry_for(index, "spr_data/empty.spr")["error"]
    assert index["summary"]["errors"] == 2
    assert Path(tmp_path / "out" / "image" / "Logo.png").exists()


@pytest.mark.skipif(not DEFAULT_SRC.is_dir(), reason="original Shake0311 files not extracted")
def test_real_shake0311_tree_exports_without_errors(tmp_path):
    index = export_tree(DEFAULT_SRC, tmp_path)

    summary = index["summary"]
    assert (summary["shk"], summary["spr"], summary["map"], summary["errors"]) == (69, 120, 17, 0)
    with_trailing = {e["source"] for e in index["entries"] if e.get("trailing_bytes")}
    assert with_trailing == {
        "image/new_listwindow.shk",
        "image/new_pReadyobject1.shk",
        "image/new_pReadyobject2.shk",
        "image/new_serverob.shk",
        "image/new_userinfo.shk",
        "image/new_roombutton.shk",
        "image/new_charchange.shk",
        "spr_data/character/rooster_g.spr",
        "spr_data/character/tofi_g.spr",
    }

    portrait = json.loads((tmp_path / "spr_data/character/rookie_p.json").read_text(encoding="utf-8"))
    assert [f["rect"] for f in portrait["animations"][0]["frames"][:3]] == [
        [0, 0, 70, 70],
        [70, 0, 140, 70],
        [140, 0, 210, 70],
    ]


def test_exports_a_borrowed_image_from_another_build_opaque(tmp_path):
    root = tmp_path / "extracted"
    (root / "Other" / "image").mkdir(parents=True)
    (root / "Other" / "image" / "status.shk").write_bytes(build_shk(2, 1, [0xF81F, 0xF800]))
    dst = tmp_path / "out"

    entries = export_borrowed(root, dst, [("Other/image/status.shk", "image/other_status.png")])

    png = Image.open(dst / "image" / "other_status.png")
    assert list(png.getdata()) == [(255, 0, 255, 255), (255, 0, 0, 255)]
    assert entries == [
        {"source": "Other/image/status.shk", "kind": "shk", "output": "image/other_status.png", "width": 2, "height": 1}
    ]


def test_borrowed_images_come_from_the_extracted_builds():
    assert ("Shake1_20020212/files/Data/image/status.shk", "image/shake1_status.png") in BORROWED
    assert ("Shake1_20020212/files/Data/image/option.shk", "image/shake1_option.png") in BORROWED
