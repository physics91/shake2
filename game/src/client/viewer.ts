import type { AnimationMeta, Manifest } from "../assets/types.ts";
import { ROUND_SECONDS, TICK_RATE } from "../sim/constants.ts";
import { layoutFromLevel, PRACTICE_MAP } from "../sim/level.ts";
import { createMatch } from "../sim/match.ts";
import type { MatchState } from "../sim/types.ts";
import type { Sheet } from "./assets.ts";
import { loadSheet } from "./assets.ts";
import type { SoundBank } from "./audio.ts";
import { mapTitle } from "./menu.ts";
import { BadStateAnimation, MarkerAnimations, PanelFaces, renderField, SCREEN_H, SCREEN_W } from "./renderer.ts";
import type { SceneAssets } from "./scene.ts";
import { loadSceneAssets } from "./scene.ts";
import { drawFrame, loopingFrame } from "./sprite.ts";
import { mount } from "./shell.ts";
import { h, readPreference, writePreference } from "./ui.ts";

type Painter = (tick: number) => void;

/** Asset viewer: every sprite animation, every map as the game draws it, and the sound effects. */
export function mountViewer(manifest: Manifest, sounds: SoundBank): () => void {
  const painters = new Set<Painter>();
  let sheetRequest = 0;
  let mapRequest = 0;
  let disposed = false;

  const status = h("p", { class: "viewer-status", role: "status" });
  const spritePanel = h("section", { class: "viewer-panel", "aria-label": "스프라이트" });
  const mapPanel = h("section", { class: "viewer-panel", "aria-label": "맵" });
  const soundPanel = h("section", { class: "viewer-panel", "aria-label": "효과음" });
  const panels = { sprite: spritePanel, map: mapPanel, sound: soundPanel } as const;
  type Tab = keyof typeof panels;
  let currentTab: Tab = "sprite";
  const statuses: Record<Tab, string> = { sprite: "", map: "", sound: "" };
  const tabButtons = (Object.keys(panels) as Tab[]).map((tab) =>
    h(
      "button",
      { class: "btn tab", type: "button", "aria-pressed": "false", onclick: () => showTab(tab) },
      { sprite: "스프라이트", map: "맵", sound: "효과음" }[tab],
    ),
  );

  function showTab(tab: Tab): void {
    currentTab = tab;
    status.textContent = statuses[tab];
    writePreference("viewer.tab", tab);
    (Object.keys(panels) as Tab[]).forEach((key, i) => {
      panels[key].hidden = key !== tab;
      tabButtons[i].setAttribute("aria-pressed", String(key === tab));
    });
  }

  function showStatus(tab: Tab, text: string): void {
    statuses[tab] = text;
    if (currentTab === tab) status.textContent = text;
  }

  // Sprites
  const sheetPainters = new Set<Painter>();
  const dirSelect = h("select", { id: "viewer-dir" });
  const sheetSelect = h("select", { id: "viewer-sheet" });
  const sheetInfo = h("p", { class: "viewer-info" });
  const animGrid = h("div", { class: "anim-grid" });
  const sheetImage = h("div", { class: "sheet-image" });
  for (const dir of Object.keys(manifest.sheets)) dirSelect.append(h("option", { value: dir }, dir));
  dirSelect.value = readPreference("viewer.dir") ?? "character";
  const fillSheets = () => {
    sheetSelect.replaceChildren(
      ...(manifest.sheets[dirSelect.value] ?? []).map((name) => h("option", { value: name }, name)),
    );
  };
  fillSheets();
  const savedSheet = readPreference("viewer.sheet");
  if (savedSheet && [...sheetSelect.options].some((o) => o.value === savedSheet)) sheetSelect.value = savedSheet;
  dirSelect.addEventListener("change", () => {
    writePreference("viewer.dir", dirSelect.value);
    fillSheets();
    void showSheet();
  });
  sheetSelect.addEventListener("change", () => void showSheet());
  spritePanel.append(
    h(
      "div",
      { class: "viewer-controls" },
      h("label", { for: "viewer-dir" }, "폴더"),
      dirSelect,
      h("label", { for: "viewer-sheet" }, "시트"),
      sheetSelect,
    ),
    sheetInfo,
    animGrid,
    h("h3", {}, "전체 시트"),
    sheetImage,
  );

  async function showSheet(): Promise<void> {
    const request = ++sheetRequest;
    const dir = dirSelect.value;
    const name = sheetSelect.value;
    writePreference("viewer.sheet", name);
    for (const paint of sheetPainters) painters.delete(paint);
    sheetPainters.clear();
    animGrid.replaceChildren();
    showStatus("sprite", `${dir}/${name} 불러오는 중…`);
    try {
      const sheet = await loadSheet(dir, name);
      if (disposed || request !== sheetRequest) return;
      showStatus("sprite", "");
      const meta = sheet.meta;
      sheetInfo.textContent = `${meta.source} · ${meta.width}×${meta.height} · 애니메이션 ${meta.animations.length}개 · 시트 이름 "${meta.name}"`;
      meta.animations.forEach((anim, index) => animGrid.append(animationCard(sheet, anim, index)));
      const image = sheet.image.cloneNode() as HTMLImageElement;
      image.alt = `${name} 스프라이트 시트 원본`;
      sheetImage.replaceChildren(image);
    } catch (error) {
      if (disposed || request !== sheetRequest) return;
      showStatus("sprite", `불러오기 실패: ${(error as Error).message}`);
    }
  }

  function animationCard(sheet: Sheet, anim: AnimationMeta, index: number): HTMLElement {
    const caption = `#${index} ${anim.name} · ${anim.frames.length}프레임 · ${anim.unknown_u16}fps`;
    if (anim.frames.length === 0) {
      return h("figure", { class: "anim-card empty" }, h("figcaption", {}, `${caption} (프레임 없음)`));
    }
    let minX = 0;
    let minY = 0;
    let maxX = 1;
    let maxY = 1;
    for (const f of anim.frames) {
      const [left, top, right, bottom] = f.rect;
      minX = Math.min(minX, -f.anchor[0]);
      minY = Math.min(minY, -f.anchor[1]);
      maxX = Math.max(maxX, right - left - f.anchor[0]);
      maxY = Math.max(maxY, bottom - top - f.anchor[1]);
    }
    const canvas = h("canvas", {
      width: maxX - minX,
      height: maxY - minY,
      role: "img",
      "aria-label": `${anim.name} 애니메이션`,
    });
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const paint: Painter = (tick) => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawFrame(ctx, sheet, anim, loopingFrame(anim, tick), -minX, -minY);
      };
      sheetPainters.add(paint);
      painters.add(paint);
    }
    return h("figure", { class: "anim-card" }, canvas, h("figcaption", {}, caption));
  }

  // Maps
  const mapSelect = h("select", { id: "viewer-map" });
  for (const m of manifest.maps) {
    const note = m.objects > 0 ? ` (오브젝트 ${m.objects})` : "";
    mapSelect.append(h("option", { value: m.id }, `${m.id} · ${mapTitle(m.title)}${note}`));
  }
  mapSelect.value = readPreference("viewer.map") ?? manifest.maps[0]?.id ?? "";
  mapSelect.addEventListener("change", () => void showMap());
  const mapCanvas = h("canvas", {
    width: SCREEN_W,
    height: SCREEN_H,
    class: "game-canvas",
    role: "img",
    "aria-label": "선택한 맵",
  });
  const mapInfo = h("p", { class: "viewer-info" });
  mapPanel.append(
    h("div", { class: "viewer-controls" }, h("label", { for: "viewer-map" }, "맵"), mapSelect),
    mapInfo,
    h("div", { class: "stage" }, mapCanvas),
  );
  let mapPainter: Painter | null = null;

  async function showMap(): Promise<void> {
    const request = ++mapRequest;
    const id = mapSelect.value;
    writePreference("viewer.map", id);
    if (mapPainter) painters.delete(mapPainter);
    showStatus("map", `${id} 불러오는 중…`);
    try {
      const assets = await loadSceneAssets(id, []);
      if (disposed || request !== mapRequest) return;
      showStatus("map", "");
      const meta = assets.level.meta;
      const { grid } = meta;
      mapInfo.textContent = `${meta.title} · 격자 ${grid.width}×${grid.height} (칸 ${grid.cell_width}×${grid.cell_height}) · 최대 ${meta.max_players}인 · 배경 ${meta.background_image} · 오브젝트 ${meta.objects.length}개`;
      const rules = { practice: id === PRACTICE_MAP, roundSeconds: ROUND_SECONDS, medalsToWin: 1, mode: 0 as const };
      const state = createMatch(layoutFromLevel(id, meta), [], rules, 1);
      const view = { localPlayerIds: [], hostId: null, hurryTick: null, lastRoundDraw: false, faces: new PanelFaces(), markers: new MarkerAnimations(), badState: new BadStateAnimation() };
      const ctx = mapCanvas.getContext("2d");
      if (!ctx) return;
      mapPainter = (tick) => {
        state.tick = tick;
        loopObjects(assets, state, tick);
        renderField(ctx, assets, state, view);
      };
      painters.add(mapPainter);
    } catch (error) {
      if (disposed || request !== mapRequest) return;
      showStatus("map", `불러오기 실패: ${(error as Error).message}`);
    }
  }

  // Sounds
  soundPanel.append(
    h("p", { class: "viewer-info" }, "원본 효과음 38개입니다. 게임에서 쓰는 상황은 original/FIDELITY.md 1절에 정리했습니다."),
    h(
      "div",
      { class: "sound-grid" },
      ...manifest.sounds.map((name) =>
        h(
          "button",
          {
            class: "btn small",
            type: "button",
            onclick: () => {
              sounds.unlock();
              sounds.play(name);
            },
          },
          `▶ ${name}`,
        ),
      ),
    ),
  );

  mount(
    h(
      "main",
      { class: "screen viewer" },
      h(
        "header",
        { class: "toolbar" },
        h("a", { class: "btn small", href: "#/" }, "← 메뉴"),
        h("h1", { tabindex: "-1" }, "에셋 뷰어"),
      ),
      h("nav", { class: "tabs", "aria-label": "뷰어 종류" }, ...tabButtons),
      status,
      spritePanel,
      mapPanel,
      soundPanel,
    ),
  );
  const savedTab = readPreference("viewer.tab");
  showTab(savedTab === "map" || savedTab === "sound" ? savedTab : "sprite");
  void showSheet();
  void showMap();

  const started = performance.now();
  let handle = requestAnimationFrame(function frame(now) {
    const tick = Math.floor(((now - started) * TICK_RATE) / 1000);
    for (const paint of painters) paint(tick);
    handle = requestAnimationFrame(frame);
  });
  return () => {
    disposed = true;
    cancelAnimationFrame(handle);
    painters.clear();
  };
}

/** In the viewer every map object loops on its sheet; in play the pads' arrows move only when they fire. */
function loopObjects(assets: SceneAssets, state: MatchState, tick: number): void {
  state.layout.objects.forEach((object, i) => {
    const anim = assets.objectSheets[object.sheet]?.meta.animations[object.anim];
    state.objects[i].frame = anim && anim.frames.length > 0 ? loopingFrame(anim, tick) : 0;
  });
}
