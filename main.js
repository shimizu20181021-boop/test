import { DEFAULT_SETTINGS, MACRO_CONFIG, SETTINGS_PRESETS } from "./core/config.js";
import { MicroWorld } from "./world/world.js";
import { MacroWorld } from "./world/macro_world.js";
import { dietTypeForEntity } from "./world/macro/diet.js";
import { bindSettingsUI } from "./systems/ui.js";
import { Renderer } from "./render/render.js";
import { Camera2D, CameraInput } from "./systems/camera.js";

const canvas = document.getElementById("game-canvas");
const hudLine1 = document.getElementById("hud-line-1");
const hudLine2 = document.getElementById("hud-line-2");
const reincarnationLog = document.getElementById("reincarnation-log");
const inspectContent = document.getElementById("inspect-content");
const settingsOpenButton = document.getElementById("settings-open");
const macroEnvSettingsButton = document.getElementById("settings-open-env");
const macroLifeSettingsButton = document.getElementById("settings-open-life");
const macroLearningSettingsButton = document.getElementById("settings-open-learning");
const viewMicroButton = document.getElementById("view-micro");
const viewMacroButton = document.getElementById("view-macro");
const autoObserveButton = document.getElementById("auto-observe");
const autoObserveTargets = document.getElementById("auto-observe-targets");
const macroTimer = document.getElementById("macro-timer");
const macroTimerText = document.getElementById("macro-timer-text");
const weatherIndicator = document.getElementById("weather-indicator");
const weatherIcon = document.getElementById("weather-icon");
const weatherText = document.getElementById("weather-text");
const calendarIndicator = document.getElementById("calendar-indicator");
const seasonIcon = document.getElementById("season-icon");
const calendarText = document.getElementById("calendar-text");
const ambientTempText = document.getElementById("ambient-temp-text");
const nnVizInlinePanel = document.getElementById("nn-viz-inline");
const nnVizInlineBody = document.getElementById("nn-viz-inline-body");

const world = new MicroWorld();
const macroWorld = new MacroWorld();
const renderer = new Renderer(canvas);
const macroCamera = new Camera2D();
const macroCameraInput = new CameraInput(canvas);

const MACRO_MAP_SIZE_TILES = {
  small: { width: 60, height: 60 },
  medium: { width: 120, height: 120 },
  large: { width: 200, height: 200 },
  giant: { width: 400, height: 400 },
};

const MACRO_COUPLE_REPRO_PRESET = {
  few: { min: 1, max: 2 },
  normal: { min: 2, max: 3 },
  many: { min: 3, max: 5 },
};

const MACRO_BIRTH_PRESET = {
  few: { min: 2, max: 3 },
  normal: { min: 3, max: 5 },
  many: { min: 4, max: 6 },
};

function macroPresetKey(value, fallbackKey) {
  const k = String(value || "").toLowerCase();
  if (k === "few" || k === "normal" || k === "many") return k;
  const fb = String(fallbackKey || "").toLowerCase();
  if (fb === "few" || fb === "normal" || fb === "many") return fb;
  return "normal";
}

function macroWorldSizeFromPreset(preset) {
  const key = String(preset || "").toLowerCase();
  const tiles = MACRO_MAP_SIZE_TILES[key] ?? MACRO_MAP_SIZE_TILES.small;
  const tile = MACRO_CONFIG.tileSize;
  return { width: tiles.width * tile, height: tiles.height * tile };
}

let paused = false;
let settings = { ...DEFAULT_SETTINGS };
let viewMode = "micro";
let lastReincarnationId = 0;
const settingsModal = document.getElementById("settings-modal");
let reincarnationLocked = false;
const pointer = { x: 0, y: 0, inside: false, moved: false };
let inspectedEntityId = null;
let autoObserveEnabled = false;
let autoObserveTargetId = null;
let autoObserveTargetDiet = "herbivore";
let nnVizWindow = null;
let nnVizReady = false;
let nnVizTargetId = null;
let nnVizInlineFrame = null;
let nnVizInlineEnabled = false;
let nnVizLastSendMs = 0;
const NN_VIZ_SEND_INTERVAL_MS = 60;
let clickCandidate = null;
let minimapDrag = null;

let macroWorldSize = macroWorldSizeFromPreset(settings.macroMapSize);

const MACRO_ZOOM = { min: 0.35, max: 3.0 };
let macroZoomMin = MACRO_ZOOM.min;
const macroZoomMax = MACRO_ZOOM.max;

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function clampMacroZoom(z) {
  return clampNumber(z, macroZoomMin, macroZoomMax);
}

function updatePointerFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = e.clientX - rect.left;
  pointer.y = e.clientY - rect.top;
  pointer.inside = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= rect.width && pointer.y <= rect.height;
  pointer.moved = true;
}

canvas.addEventListener("pointermove", updatePointerFromEvent);
canvas.addEventListener("pointerenter", updatePointerFromEvent);
canvas.addEventListener("pointerleave", () => {
  pointer.inside = false;
});

function getMacroMinimapRect(viewportW, viewportH) {
  const ms = MACRO_CONFIG?.minimapSize;
  if (!ms) return null;
  const w = Math.max(1, Math.floor(Number(ms.width) || 1));
  const h = Math.max(1, Math.floor(Number(ms.height) || 1));
  const pad = 14;
  const bottomUiOffset = 52; // keep in sync with render.js drawMinimap
  const x0 = viewportW - w - pad;
  const y0 = viewportH - h - pad - bottomUiOffset;
  return { x0, y0, w, h };
}

function isInsideRect(x, y, rect) {
  if (!rect) return false;
  return x >= rect.x0 && x <= rect.x0 + rect.w && y >= rect.y0 && y <= rect.y0 + rect.h;
}

function centerMacroCameraFromMinimapScreen(sx, sy, mmRect, { clampToMinimap = true } = {}) {
  if (!mmRect) return;
  const ww = macroWorld?._world?.width ?? macroWorldSize?.width ?? 1;
  const wh = macroWorld?._world?.height ?? macroWorldSize?.height ?? 1;
  const scaleX = mmRect.w / Math.max(1, ww);
  const scaleY = mmRect.h / Math.max(1, wh);
  const mx = clampToMinimap ? clampNumber(sx - mmRect.x0, 0, mmRect.w) : sx - mmRect.x0;
  const my = clampToMinimap ? clampNumber(sy - mmRect.y0, 0, mmRect.h) : sy - mmRect.y0;
  const wx = mx / Math.max(1e-6, scaleX);
  const wy = my / Math.max(1e-6, scaleY);
  macroCamera.centerOn(wx, wy);
}

// Minimap tap/drag to move camera (mouse + iPad touch). Use capture phase so CameraInput doesn't steal the gesture.
canvas.addEventListener(
  "pointerdown",
  (e) => {
    if (viewMode !== "macro") return;
    if (e.pointerType === "touch" && !e.isPrimary) return;

    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const mm = getMacroMinimapRect(rect.width, rect.height);
    if (!isInsideRect(sx, sy, mm)) return;

    if (autoObserveEnabled) {
      autoObserveEnabled = false;
      autoObserveTargetId = null;
    }

    minimapDrag = { id: e.pointerId };
    centerMacroCameraFromMinimapScreen(sx, sy, mm);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  },
  { capture: true },
);

canvas.addEventListener(
  "pointermove",
  (e) => {
    if (viewMode !== "macro") return;
    if (!minimapDrag || minimapDrag.id !== e.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const mm = getMacroMinimapRect(rect.width, rect.height);
    centerMacroCameraFromMinimapScreen(sx, sy, mm);
    e.preventDefault();
    e.stopImmediatePropagation();
  },
  { capture: true },
);

canvas.addEventListener(
  "pointerup",
  (e) => {
    if (!minimapDrag || minimapDrag.id !== e.pointerId) return;
    minimapDrag = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  },
  { capture: true },
);

canvas.addEventListener(
  "pointercancel",
  (e) => {
    if (!minimapDrag || minimapDrag.id !== e.pointerId) return;
    minimapDrag = null;
    e.preventDefault();
    e.stopImmediatePropagation();
  },
  { capture: true },
);

function isNnVizEligibleEntity(e) {
  if (!e || e._dead) return false;
  if (e.kind === "plant" || e.kind === "meat" || e.kind === "egg" || e.kind === "nest") return false;
  if (e.kind === "rock" || e.kind === "tree") return false;
  return true;
}

function setNnVizTargetId(nextId) {
  const n = Number(nextId);
  nnVizTargetId = Number.isFinite(n) ? n : null;
  if (typeof macroWorld.setNnVizFocusId === "function") macroWorld.setNnVizFocusId(nnVizTargetId);
}

function syncNnVizConfig() {
  if (!nnVizWindow || nnVizWindow.closed) return;
  nnVizWindow.postMessage(
    {
      type: "nn_viz_config",
      blinkMode: settings.macroNnVizBlinkMode,
      outputsMode: settings.macroNnVizOutputsMode,
    },
    "*",
  );
}

function ensureInlineNnVizWindow() {
  if (!nnVizInlinePanel || !nnVizInlineBody) return null;
  nnVizInlineEnabled = true;
  nnVizInlinePanel.classList.remove("hidden");

  if (!nnVizInlineFrame) {
    nnVizReady = false;
    nnVizInlineBody.textContent = "";
    const frame = document.createElement("iframe");
    frame.title = "NN可視化";
    frame.loading = "lazy";
    frame.src = "./nn_viz.html";
    nnVizInlineBody.appendChild(frame);
    nnVizInlineFrame = frame;
  }

  const w = nnVizInlineFrame.contentWindow;
  if (w) nnVizWindow = w;
  return w;
}

function openNnVizForEntity(entity, { inline = false } = {}) {
  const e = entity;
  if (!isNnVizEligibleEntity(e)) return;

  setNnVizTargetId(e.id);

  if (inline) {
    ensureInlineNnVizWindow();
    syncNnVizConfig();
    return;
  }

  nnVizInlineEnabled = false;
  if (nnVizInlinePanel) nnVizInlinePanel.classList.add("hidden");

  if (!nnVizWindow || nnVizWindow.closed) {
    nnVizReady = false;
    nnVizWindow = window.open("./nn_viz.html", "nn_viz", "width=760,height=560");
  }
  if (!nnVizWindow) return;
  try {
    nnVizWindow.focus();
  } catch {
    // ignore
  }

  syncNnVizConfig();
}

function stepNnViz(nowMs) {
  if (!nnVizWindow || nnVizWindow.closed) {
    nnVizWindow = null;
    nnVizReady = false;
    if (nnVizTargetId != null) setNnVizTargetId(null);
    return;
  }
  if (!nnVizReady) return;
  if (nnVizTargetId == null) return;
  if (nowMs - nnVizLastSendMs < NN_VIZ_SEND_INTERVAL_MS) return;
  nnVizLastSendMs = nowMs;

  const selected = macroWorld.entities.find((m) => m && !m._dead && m.id === nnVizTargetId) || null;
  const label = selected
    ? `${dietTypeLabel(selected.dietType)} / ${sexLabel(selected.sex)} / ${lifeStageLabel(selected.lifeStage)}`
    : "（不在/死亡）";

  nnVizWindow.postMessage(
    {
      type: "nn_viz_state",
      entity: { id: nnVizTargetId, label },
      inputs: selected?._nnInputs ? Array.from(selected._nnInputs) : null,
      hidden: selected?._nnHidden ? Array.from(selected._nnHidden) : null,
      outputs: selected?._nnOutputs ? Array.from(selected._nnOutputs) : null,
      rl: {
        updateCounter: Number(selected?._rlUpdateCounter) || 0,
        lastUpdateAction: selected?._rlLastUpdateAction ?? null,
        lastUpdateReward: Number.isFinite(Number(selected?._rlLastUpdateReward)) ? Number(selected._rlLastUpdateReward) : null,
        lastUpdateBaseline: Number.isFinite(Number(selected?._rlLastUpdateBaseline)) ? Number(selected._rlLastUpdateBaseline) : null,
        lastUpdateAdvantage: Number(selected?._rlLastUpdateAdvantage) || 0,
        lastUpdateModeStep: Array.isArray(selected?._rlLastUpdateModeStep) ? selected._rlLastUpdateModeStep : null,
        lastUpdateHeadStep: Array.isArray(selected?._rlLastUpdateHeadStep) ? selected._rlLastUpdateHeadStep : null,
        learnAbsMode: Array.isArray(selected?._rlLearnAbsMode) ? selected._rlLearnAbsMode : null,
        learnAbsHead: Array.isArray(selected?._rlLearnAbsHead) ? selected._rlLearnAbsHead : null,
      },
    },
    "*",
  );
}

window.addEventListener("message", (ev) => {
  const msg = ev?.data;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "nn_viz_ready") {
    nnVizReady = true;
    syncNnVizConfig();
  }
});

canvas.addEventListener("pointerdown", (e) => {
  if (viewMode !== "macro") return;
  if (e.pointerType === "touch" && !e.isPrimary) return;
  clickCandidate = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
});

canvas.addEventListener("pointercancel", () => {
  clickCandidate = null;
});

canvas.addEventListener("pointerup", (e) => {
  if (viewMode !== "macro") return;
  if (!clickCandidate || clickCandidate.id !== e.pointerId) return;
  if (typeof macroCameraInput?.wasPinchingRecently === "function" && macroCameraInput.wasPinchingRecently(300)) {
    clickCandidate = null;
    return;
  }

  const dx = e.clientX - clickCandidate.x;
  const dy = e.clientY - clickCandidate.y;
  const dist2 = dx * dx + dy * dy;
  const dtMs = performance.now() - clickCandidate.t;
  clickCandidate = null;

  // Ignore drags / long presses.
  const dragThreshold2 = e.pointerType === "touch" ? 144 : 36;
  if (dist2 > dragThreshold2) return;
  if (dtMs > 500) return;

  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const z = macroCamera.getZoom();
  const wx = macroCamera.x + sx / z;
  const wy = macroCamera.y + sy / z;
  const picked = pickMacroEntityAt(wx, wy);
  if (!picked) return;
  openNnVizForEntity(picked, { inline: e.pointerType === "touch" });
});

canvas.addEventListener(
  "wheel",
  (e) => {
    if (viewMode !== "macro") return;
    if (paused) return;
    e.preventDefault();
    updatePointerFromEvent(e);

    const scale = Math.exp(-e.deltaY * 0.0015);
    const nextZoom = clampMacroZoom(macroCamera.getZoom() * scale);

    const sx = pointer.inside ? pointer.x : canvas.clientWidth / 2;
    const sy = pointer.inside ? pointer.y : canvas.clientHeight / 2;
    macroCamera.zoomAt(nextZoom, sx, sy);
  },
  { passive: false },
);

macroCameraInput.onPinch = (scale, sx, sy) => {
  if (viewMode !== "macro") return;
  if (paused) return;
  const s = Number(scale);
  if (!Number.isFinite(s) || s <= 0) return;
  const nextZoom = clampMacroZoom(macroCamera.getZoom() * s);
  macroCamera.zoomAt(nextZoom, sx, sy);
};

function macroKindLabel(kind) {
  switch (kind) {
    case "smallHerbivore":
      return "草食（小）";
    case "largeHerbivore":
      return "草食（大）";
    case "predator":
      return "肉食";
    case "plant":
      return "植物";
    case "meat":
      return "肉";
    default:
      return String(kind || "不明");
  }
}

function dietTypeLabel(type) {
  switch (type) {
    case "herbivore":
      return "草食";
    case "omnivore":
      return "雑食";
    case "carnivore":
      return "肉食";
    case "plant":
      return "植物";
    case "meat":
      return "肉";
    default:
      return "不明";
  }
}

function bodySizeLabel(entity) {
  if (!entity || entity.kind === "plant" || entity.kind === "meat") return "-";
  const code = entity.reincarnation?.traits?.bodyTrait?.code;
  if (code === "B4" || code === "B5") return "大";
  return "小";
}

function sexLabel(sex) {
  if (sex === "male") return "雄";
  if (sex === "female") return "雌";
  return "-";
}

function lifeStageLabel(stage) {
  if (stage === "adult") return "大人";
  if (stage === "youngAdult") return "若大人";
  if (stage === "child") return "子供";
  if (stage === "baby") return "赤ちゃん";
  return "-";
}

function plantStageLabel(stage) {
  const s = Number(stage);
  if (s === 0) return "芽";
  if (s === 1) return "茎";
  if (s === 2) return "植物";
  return "-";
}

function fmtPct(n) {
  if (!Number.isFinite(n)) return "0%";
  return `${Math.round(n * 100)}%`;
}

function fmtHms(totalSeconds) {
  const t = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function macroRatioText() {
  // Show composition by current existing entities (not reincarnation group count).
  const counts = { plant: 0, herbivore: 0, omnivore: 0, carnivore: 0, meat: 0 };
  for (const e of macroWorld.entities) {
    if (!e || e._dead) continue;
    if (e.kind === "plant") {
      counts.plant++;
      continue;
    }
    if (e.kind === "meat") {
      counts.meat++;
      continue;
    }
    if (e.kind === "rock" || e.kind === "tree") {
      continue;
    }
    const d = String(e.dietType || "");
    if (d === "herbivore") counts.herbivore++;
    else if (d === "omnivore") counts.omnivore++;
    else if (d === "carnivore") counts.carnivore++;
    else if (e.kind === "predator") counts.carnivore++;
    else counts.herbivore++;
  }

  const total = counts.plant + counts.herbivore + counts.omnivore + counts.carnivore + counts.meat;
  if (total <= 0) return "比率(存在): -";

  const pct = (n) => Math.round((n / total) * 100);
  return `比率(存在): 植物${counts.plant}(${pct(counts.plant)}%) 草食${counts.herbivore}(${pct(counts.herbivore)}%) 雑食${counts.omnivore}(${pct(counts.omnivore)}%) 肉食${counts.carnivore}(${pct(counts.carnivore)}%) 肉${counts.meat}(${pct(counts.meat)}%)（n=${total}）`;
}

function fmtBar(current, max) {
  const m = Math.max(1e-6, Number(max) || 0);
  const c = Math.max(0, Number(current) || 0);
  const pct = m > 0 ? Math.min(1, c / m) : 0;
  return `${Math.round(c)}/${Math.round(m)}（${fmtPct(pct)}）`;
}

function pickMacroEntityAt(worldX, worldY) {
  let best = null;
  let bestD2 = Infinity;

  for (const e of macroWorld.entities) {
    if (!e || e._dead) continue;
    if (e.kind === "meat" || e.kind === "rock" || e.kind === "tree") continue;
    const r = (e.radius ?? 0) + 6;
    const dx = worldX - e.x;
    const dy = worldY - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= r * r && d2 < bestD2) {
      best = e;
      bestD2 = d2;
    }
  }

  return best;
}

function computeGeneWeightsFromMacro() {
  const c = macroWorld.getEntityCounts();
  const plant = Number(c.plant) || 0;
  const herbivore = (Number(c.smallHerbivore) || 0) + (Number(c.largeHerbivore) || 0);
  const carnivore = Number(c.predator) || 0;
  const total = plant + herbivore + carnivore;

  // Target ratio for macro ecosystem: plant > herbivore > carnivore.
  // Adjust these 3 numbers if you want a different balance.
  const TARGET = { plant: 0.55, herbivore: 0.3, carnivore: 0.15 };

  const base = 1;
  const random = 0.1;

  // At the very beginning (macro is empty), bias strongly toward stamina(□) so plants appear first.
  if (total <= 0) {
    return { stamina: 12, health: 3, attack: 1, random };
  }

  const ratioPlant = plant / total;
  const ratioHerbivore = herbivore / total;
  const ratioCarnivore = carnivore / total;

  const scarcityPlant = Math.max(0, (TARGET.plant - ratioPlant) / TARGET.plant);
  const scarcityHerbivore = Math.max(0, (TARGET.herbivore - ratioHerbivore) / TARGET.herbivore);
  const scarcityCarnivore = Math.max(0, (TARGET.carnivore - ratioCarnivore) / TARGET.carnivore);

  return {
    stamina: base + scarcityPlant * 10.0,
    health: base + scarcityHerbivore * 8.0,
    attack: base + scarcityCarnivore * 6.0,
    random,
  };
}

function computeMicroDynamicsFromMacro() {
  const cap = macroWorld.getAnimalCap();
  const used = macroWorld.getAnimalHerdCount();
  const ratio = cap > 0 ? used / cap : 1;
  if (ratio < 0.3) return { tickRate: 60, mergeChance: 0.8, label: "高" };
  if (ratio < 0.5) return { tickRate: 30, mergeChance: 0.5, label: "普" };
  return { tickRate: 15, mergeChance: 0.3, label: "低" };
}

function applySettings(next) {
  const prevMapSize = settings.macroMapSize;
  settings = { ...settings, ...next };
  syncNnVizConfig();
  if (settings.macroMapSize !== prevMapSize) {
    macroWorldSize = macroWorldSizeFromPreset(settings.macroMapSize);
    resizeCanvasToDisplaySize();
    if (typeof macroWorld.reset === "function") macroWorld.reset();
    else macroWorld.entities = [];
    macroCamera.centerOn(macroWorldSize.width / 2, macroWorldSize.height / 2);
    reincarnationLocked = false;
    inspectedEntityId = null;
    autoObserveEnabled = false;
    autoObserveTargetId = null;
  }
  const population = SETTINGS_PRESETS.population[settings.populationPreset];
  world.setPopulationTarget(population.target, population.spawnPerSecond);
  world.setReincarnationIndividuals(settings.reincarnationIndividuals);
  if (typeof world.setMergeCooldownSeconds === "function")
    world.setMergeCooldownSeconds(settings.microMergeCooldownSeconds ?? DEFAULT_SETTINGS.microMergeCooldownSeconds);
  if (typeof world.setMergeRitualSeconds === "function")
    world.setMergeRitualSeconds(settings.microMergeRitualSeconds ?? DEFAULT_SETTINGS.microMergeRitualSeconds);
  if (typeof world.setVisualRadiusSmoothing === "function")
    world.setVisualRadiusSmoothing(settings.microVisualRadiusSmoothing ?? DEFAULT_SETTINGS.microVisualRadiusSmoothing);
  macroWorld.setAnimalCap(settings.macroAnimalCap);
  if (typeof macroWorld.setPopulationCaps === "function") {
    macroWorld.setPopulationCaps({
      plant: settings.macroPopCapPlant,
      herbivore: settings.macroPopCapHerbivore,
      omnivore: settings.macroPopCapOmnivore,
      carnivore: settings.macroPopCapCarnivore,
    });
  }
  if (typeof macroWorld.setGroupMaxSize === "function") macroWorld.setGroupMaxSize(settings.macroGroupMaxSize);

  if (typeof macroWorld.setDietReproductionConfig === "function") {
    const herbReproKey = macroPresetKey(settings.macroHerbReproPreset, DEFAULT_SETTINGS.macroHerbReproPreset);
    const herbBirthKey = macroPresetKey(settings.macroHerbBirthPreset, DEFAULT_SETTINGS.macroHerbBirthPreset);
    const omniReproKey = macroPresetKey(settings.macroOmniReproPreset, DEFAULT_SETTINGS.macroOmniReproPreset);
    const omniBirthKey = macroPresetKey(settings.macroOmniBirthPreset, DEFAULT_SETTINGS.macroOmniBirthPreset);
    const carnReproKey = macroPresetKey(settings.macroCarnReproPreset, DEFAULT_SETTINGS.macroCarnReproPreset);
    const carnBirthKey = macroPresetKey(settings.macroCarnBirthPreset, DEFAULT_SETTINGS.macroCarnBirthPreset);

    const herbRepro = MACRO_COUPLE_REPRO_PRESET[herbReproKey] ?? MACRO_COUPLE_REPRO_PRESET.normal;
    const herbBirth = MACRO_BIRTH_PRESET[herbBirthKey] ?? MACRO_BIRTH_PRESET.normal;
    const omniRepro = MACRO_COUPLE_REPRO_PRESET[omniReproKey] ?? MACRO_COUPLE_REPRO_PRESET.normal;
    const omniBirth = MACRO_BIRTH_PRESET[omniBirthKey] ?? MACRO_BIRTH_PRESET.normal;
    const carnRepro = MACRO_COUPLE_REPRO_PRESET[carnReproKey] ?? MACRO_COUPLE_REPRO_PRESET.normal;
    const carnBirth = MACRO_BIRTH_PRESET[carnBirthKey] ?? MACRO_BIRTH_PRESET.normal;

    macroWorld.setDietReproductionConfig({
      herbivore: {
        birthMin: herbBirth.min,
        birthMax: herbBirth.max,
        reproMin: herbRepro.min,
        reproMax: herbRepro.max,
      },
      omnivore: {
        birthMin: omniBirth.min,
        birthMax: omniBirth.max,
        reproMin: omniRepro.min,
        reproMax: omniRepro.max,
      },
      carnivore: {
        birthMin: carnBirth.min,
        birthMax: carnBirth.max,
        reproMin: carnRepro.min,
        reproMax: carnRepro.max,
      },
    });
  }
  if (typeof macroWorld.setPlantReproMax === "function") macroWorld.setPlantReproMax(settings.macroPlantReproMax);
  if (typeof macroWorld.setMeatHungerRecoverPct === "function")
    macroWorld.setMeatHungerRecoverPct(settings.macroMeatHungerRecoverPct);
  if (typeof macroWorld.setMeatRotEnabled === "function") macroWorld.setMeatRotEnabled(settings.macroMeatRotEnabled);
  if (typeof macroWorld.setPlantHungerRecoverMul === "function")
    macroWorld.setPlantHungerRecoverMul(settings.macroPlantHungerRecoverMul);
  if (typeof macroWorld.setPlantStaminaMul === "function") macroWorld.setPlantStaminaMul(settings.macroPlantStaminaMul);
  if (typeof macroWorld.setPlantLifeMinutes === "function") macroWorld.setPlantLifeMinutes(settings.macroPlantLifeMinutes);
  if (typeof macroWorld.setHerbStaminaMul === "function") macroWorld.setHerbStaminaMul(settings.macroHerbStaminaMul);
  if (typeof macroWorld.setHerbLifeMinutes === "function") macroWorld.setHerbLifeMinutes(settings.macroHerbLifeMinutes);
  if (typeof macroWorld.setHerbHungerDecayMul === "function")
    macroWorld.setHerbHungerDecayMul(settings.macroHerbHungerDecayMul);
  if (typeof macroWorld.setOmniStaminaMul === "function") macroWorld.setOmniStaminaMul(settings.macroOmniStaminaMul);
  if (typeof macroWorld.setOmniLifeMinutes === "function") macroWorld.setOmniLifeMinutes(settings.macroOmniLifeMinutes);
  if (typeof macroWorld.setOmniHungerDecayMul === "function")
    macroWorld.setOmniHungerDecayMul(settings.macroOmniHungerDecayMul);
  if (typeof macroWorld.setCarnStaminaMul === "function") macroWorld.setCarnStaminaMul(settings.macroCarnStaminaMul);
  if (typeof macroWorld.setCarnLifeMinutes === "function") macroWorld.setCarnLifeMinutes(settings.macroCarnLifeMinutes);
  if (typeof macroWorld.setCarnHungerDecayMul === "function")
    macroWorld.setCarnHungerDecayMul(settings.macroCarnHungerDecayMul);
  if (typeof macroWorld.setCarnAttackMul === "function") macroWorld.setCarnAttackMul(settings.macroCarnAttackMul);
  if (typeof macroWorld.setEvolutionMode === "function") macroWorld.setEvolutionMode(settings.macroEvolutionMode);
  if (typeof macroWorld.setFitnessChildWeight === "function") macroWorld.setFitnessChildWeight(settings.fitnessChildWeight);
}

applySettings(settings);
bindSettingsUI({
  getSettings: () => ({ ...settings }),
  getViewMode: () => viewMode,
  setPaused: (v) => {
    paused = v;
  },
  applySettings: (next) => {
    applySettings(next);
  },
});

function setViewMode(next) {
  viewMode = next;
  const isMicro = viewMode === "micro";
  viewMicroButton.classList.toggle("active", isMicro);
  viewMacroButton.classList.toggle("active", !isMicro);
  if (settingsOpenButton) settingsOpenButton.classList.toggle("hidden", !isMicro);
  if (macroEnvSettingsButton) macroEnvSettingsButton.classList.toggle("hidden", isMicro);
  if (macroLifeSettingsButton) macroLifeSettingsButton.classList.toggle("hidden", isMicro);
  if (macroLearningSettingsButton) macroLearningSettingsButton.classList.toggle("hidden", isMicro);
  if (autoObserveButton) autoObserveButton.classList.toggle("hidden", isMicro);
  if (autoObserveTargets) autoObserveTargets.classList.toggle("hidden", isMicro);
  if (settingsModal && !settingsModal.classList.contains("hidden")) {
    settingsModal.classList.add("hidden");
    paused = false;
  }
}

viewMicroButton.addEventListener("click", () => setViewMode("micro"));
viewMacroButton.addEventListener("click", () => setViewMode("macro"));

if (autoObserveButton) {
  autoObserveButton.addEventListener("click", () => {
    if (autoObserveButton.disabled) return;
    autoObserveEnabled = !autoObserveEnabled;
    autoObserveTargetId = null;
    autoObserveButton.textContent = autoObserveEnabled ? "自動観察 ON" : "自動観察 OFF";
  });
}

function normalizeObserveDiet(value) {
  const k = String(value || "").toLowerCase();
  if (k === "omnivore" || k === "carnivore") return k;
  return "herbivore";
}

if (autoObserveTargets) {
  autoObserveTargets.addEventListener("change", (e) => {
    const el = e?.target;
    if (!el || el.name !== "auto-observe-target") return;
    autoObserveTargetDiet = normalizeObserveDiet(el.value);
    autoObserveTargetId = null;
  });
}

function updateMacroZoomBounds() {
  const vw = Math.max(1, canvas.clientWidth);
  const vh = Math.max(1, canvas.clientHeight);
  const ww = Math.max(1, macroWorldSize?.width ?? 1);
  const wh = Math.max(1, macroWorldSize?.height ?? 1);
  const fit = Math.max(vw / ww, vh / wh);
  macroZoomMin = Math.max(MACRO_ZOOM.min, fit);
  if (macroZoomMin > macroZoomMax) macroZoomMin = macroZoomMax;
  macroCamera.setZoom(clampMacroZoom(macroCamera.getZoom()));
}

function resizeCanvasToDisplaySize() {
  renderer.resizeToDisplaySize();
  world.setBounds({ width: canvas.clientWidth, height: canvas.clientHeight });
  macroWorld.setWorldSize(macroWorldSize);
  macroCamera.setWorldSize(macroWorldSize);
  macroCamera.setViewportSize({ width: canvas.clientWidth, height: canvas.clientHeight });
  updateMacroZoomBounds();
}

window.addEventListener("resize", resizeCanvasToDisplaySize);
resizeCanvasToDisplaySize();

let lastTimestamp = performance.now();
function loop(now) {
  const dt = Math.min(0.25, (now - lastTimestamp) / 1000);
  lastTimestamp = now;

  const dynamics = computeMicroDynamicsFromMacro();
  world.setTickRate(dynamics.tickRate);
  world.setMergeChance(dynamics.mergeChance);
  world.setGeneSpawnWeights(computeGeneWeightsFromMacro());

  const macroCapReached = macroWorld.getReincarnationGroupCount() >= macroWorld.getAnimalCap();
  const noMacroAnimals = macroWorld.getAnimalEntityCount() === 0;
  if (!reincarnationLocked && macroCapReached) reincarnationLocked = true;
  if (reincarnationLocked && noMacroAnimals) reincarnationLocked = false;
  world.setMergeEnabled(true);

  const microFrozenByMacroCap = reincarnationLocked && !noMacroAnimals;
  if (!paused && !microFrozenByMacroCap) world.update(dt);

  const recents = world.getRecentReincarnations(50);
  for (let i = recents.length - 1; i >= 0; i--) {
    const r = recents[i];
    if (r.id <= lastReincarnationId) continue;
    if (!reincarnationLocked) macroWorld.addFromReincarnation(r);
    lastReincarnationId = r.id;
  }

  if (!paused) macroWorld.update(dt);

  const aliveAnimals = [];
  for (const e of macroWorld.entities) {
    if (!e || e._dead) continue;
    if (e.kind === "plant" || e.kind === "meat" || e.kind === "egg" || e.kind === "nest" || e.kind === "rock" || e.kind === "tree") continue;
    aliveAnimals.push(e);
  }
  const hasAnimals = aliveAnimals.length > 0;
  const observeCandidates =
    autoObserveTargetDiet === "herbivore" || autoObserveTargetDiet === "omnivore" || autoObserveTargetDiet === "carnivore"
      ? aliveAnimals.filter((a) => dietTypeForEntity(a) === autoObserveTargetDiet)
      : aliveAnimals;
  const hasObserveCandidates = observeCandidates.length > 0;

  if (!hasAnimals) {
    autoObserveEnabled = false;
    autoObserveTargetId = null;
  } else if (!hasObserveCandidates) {
    // Selected target type is not present: stop auto-observe until the user switches target.
    autoObserveEnabled = false;
    autoObserveTargetId = null;
  }

  if (autoObserveButton) {
    autoObserveButton.classList.toggle("hidden", viewMode !== "macro");
    autoObserveButton.disabled = !hasObserveCandidates;
    autoObserveButton.textContent = autoObserveEnabled ? "自動観察 ON" : "自動観察 OFF";
  }
  if (autoObserveTargets) {
    autoObserveTargets.classList.toggle("hidden", viewMode !== "macro");
  }

  if (nnVizInlinePanel) {
    nnVizInlinePanel.classList.toggle("hidden", viewMode !== "macro" || !nnVizInlineEnabled);
  }

  if (autoObserveEnabled && hasObserveCandidates && viewMode === "macro" && !paused) {
    let target = null;
    if (autoObserveTargetId != null) {
      target = observeCandidates.find((a) => a.id === autoObserveTargetId) ?? null;
    }
    if (!target) {
      target = observeCandidates[Math.floor(Math.random() * observeCandidates.length)] ?? null;
      autoObserveTargetId = target?.id ?? null;
    }
    if (target) {
      const { width: vw, height: vh } = macroCamera.getViewportWorldSize();
      const desiredX = target.x - vw / 2;
      const desiredY = target.y - vh / 2;
      const t = 1 - Math.exp(-6 * dt);
      macroCamera.x += (desiredX - macroCamera.x) * t;
      macroCamera.y += (desiredY - macroCamera.y) * t;
      macroCamera.clampToWorld();
    }
  }

  const z = macroCamera.getZoom();
  macroCameraInput.enabled = viewMode === "macro" && !paused && !autoObserveEnabled;
  macroCameraInput.onDrag = (dx, dy) => {
    const zz = macroCamera.getZoom();
    macroCamera.moveBy((-dx * MACRO_CONFIG.cameraDragSpeed) / zz, (-dy * MACRO_CONFIG.cameraDragSpeed) / zz);
  };
  macroCameraInput.update(dt, macroCamera, MACRO_CONFIG.cameraSpeedPxPerSecond / z);

  renderer.render(
    {
      viewMode,
      microWorld: world,
      macroWorld,
      macroCamera,
      macroConfig: MACRO_CONFIG,
      microDebug: settings.microDebug,
      microStarScale: settings.microStarScale ?? DEFAULT_SETTINGS.microStarScale,
      microGalaxyStrength: settings.microGalaxyStrength ?? DEFAULT_SETTINGS.microGalaxyStrength,
      microGalaxyStartPct: settings.microGalaxyStartPct ?? DEFAULT_SETTINGS.microGalaxyStartPct,
    },
    { paused },
  );

  if (macroTimer) {
    macroTimer.classList.toggle("hidden", viewMode !== "macro");
    if (macroTimerText) {
      const seconds = typeof macroWorld.getElapsedSeconds === "function" ? macroWorld.getElapsedSeconds() : 0;
      macroTimerText.textContent = fmtHms(seconds);
    }
  }

  if (weatherIndicator) {
    weatherIndicator.classList.toggle("hidden", viewMode !== "macro");
    const kind = typeof macroWorld.getWeatherKind === "function" ? macroWorld.getWeatherKind() : "sunny";
    const mapping =
      kind === "rainy"
        ? { icon: "🌧️", text: "雨" }
        : kind === "snowy"
          ? { icon: "❄️", text: "雪" }
        : kind === "cloudy"
          ? { icon: "☁️", text: "曇り" }
          : kind === "drought"
            ? { icon: "🔥", text: "日照り" }
          : { icon: "☀️", text: "晴れ" };
    if (weatherIcon) weatherIcon.textContent = mapping.icon;
    if (weatherText) weatherText.textContent = mapping.text;
  }

  if (calendarIndicator) {
    calendarIndicator.classList.toggle("hidden", viewMode !== "macro");
    if (viewMode === "macro") {
      const cal = typeof macroWorld.getCalendar === "function" ? macroWorld.getCalendar() : null;
      const icon = cal?.seasonIcon ?? "🌸";
      const seasonLabel = cal?.seasonLabel ?? "-";
      const year = Number(cal?.year) || 1;
      const dayInSeason = Number(cal?.dayInSeason) || 1;

      if (seasonIcon) seasonIcon.textContent = icon;
      if (calendarText) calendarText.textContent = `年${year} ${seasonLabel} ${dayInSeason}日目`;

      if (ambientTempText) {
        const { width: vw, height: vh } = macroCamera.getViewportWorldSize();
        const cx = macroCamera.x + vw / 2;
        const cy = macroCamera.y + vh / 2;
        const t =
          typeof macroWorld.getEnvironmentTempAtWorld === "function" ? macroWorld.getEnvironmentTempAtWorld(cx, cy) : NaN;
        ambientTempText.textContent = Number.isFinite(Number(t)) ? `外気 ${Math.round(t)}℃` : "外気 -℃";
      }
    }
  }

  hudLine1.textContent =
    viewMode === "macro"
      ? (() => {
          const recCount = macroWorld.getReincarnationGroupCount();
          const recCap = macroWorld.getAnimalCap();
          const stopped = reincarnationLocked || recCount >= recCap;
          return `マクロ: ${macroWorld.entities.length}  転生: ${recCount}/${recCap}${stopped ? "（停止）" : ""}  |  （ミクロ更新頻度: ${world.getTickRate()}fps）`;
        })()
      : `個体(画面): ${world.getEntityCount()} / 目標: ${world.getPopulationTarget()}  |  更新頻度: ${world.getTickRate()}fps  |  合体: ${Math.round(
          world.getMergeChance() * 100,
        )}%  |  転生個体数: ${world.getReincarnationIndividuals()}`;
  hudLine2.textContent =
    viewMode === "macro"
      ? macroRatioText()
      : paused
        ? "状態: 一時停止（設定メニュー表示中）"
        : microFrozenByMacroCap
          ? "状態: マクロ転生が停止中のため停止（マクロ生物が全滅すると再開）"
          : "状態: 実行中";

  const logLines = world.getRecentReincarnations(6).map((r) => r.summary);
  reincarnationLog.textContent = logLines.length ? logLines.join("\n\n") : "転生ログ: まだありません";

  if (inspectContent) {
    if (viewMode !== "macro") {
      inspectContent.textContent = "マクロ視点で生物にマウスを合わせると表示します";
    } else if (autoObserveEnabled && autoObserveTargetId != null) {
      inspectedEntityId = autoObserveTargetId;
    } else if (!pointer.inside) {
      // Keep last inspected entity until another is hovered.
    } else if (!pointer.moved) {
      // Hover selection updates only when the pointer actually moves.
    } else {
      const z = macroCamera.getZoom();
      const wx = macroCamera.x + pointer.x / z;
      const wy = macroCamera.y + pointer.y / z;
      const e = pickMacroEntityAt(wx, wy);
      if (e) inspectedEntityId = e.id;
    }

    if (viewMode === "macro") {
      const selected = inspectedEntityId ? macroWorld.entities.find((m) => m.id === inspectedEntityId) : null;
      if (!selected) {
        inspectedEntityId = null;
        inspectContent.textContent = "生物にマウスを合わせてください";
      } else {
        const kind = macroKindLabel(selected.kind);
        const diet = dietTypeLabel(selected.dietType);
        const sex = sexLabel(selected.sex);
        const stage = selected.kind === "plant" ? plantStageLabel(selected.plantStage) : lifeStageLabel(selected.lifeStage);
        const generation = (() => {
          const g = Number(selected.generation);
          if (!Number.isFinite(g)) return 1;
          return Math.max(1, Math.round(g));
        })();
        const action = selected.aiState ? String(selected.aiState) : "-";
        const socialMode =
          selected.kind === "plant" || selected.kind === "meat"
            ? "-"
            : selected.socialMode === "group"
              ? "集団"
              : selected.socialMode === "lone"
                ? "一匹狼"
                : "-";

        const hp = fmtBar(selected.hp, selected.hpMax);
        const hunger = selected.kind === "plant" ? "-" : fmtBar(selected.hunger, selected.hungerMax);
        const stamina =
          selected.kind === "plant" || selected.kind === "meat" || !(Number(selected.staminaMax) > 0)
            ? "-"
            : fmtBar(selected.stamina, selected.staminaMax);
        const life = (Number(selected.lifeMaxSeconds) || 0) > 0 ? fmtBar(selected.lifeSeconds, selected.lifeMaxSeconds) : "-";
        const bodyTemp =
          selected.kind === "plant" || selected.kind === "meat"
            ? "-"
            : Number.isFinite(Number(selected.bodyTempC))
              ? `${Math.round(Number(selected.bodyTempC))}℃`
              : "-";
        const fur =
          selected.kind === "plant" || selected.kind === "meat"
            ? "-"
            : Number.isFinite(Number(selected.fur01))
              ? `${Math.round(Math.max(0, Math.min(1, Number(selected.fur01))) * 100)}%`
              : "-";
        const plantEaten = Number(selected.foodPlantEaten) || 0;
        const meatEaten = Number(selected.foodMeatEaten) || 0;
        const offspringCount = Number(selected.offspringCount) || 0;
        const reproCount = Number(selected.reproSuccessCount) || 0;
        const reproMaxRaw = Number(selected.reproSuccessMax);
        const reproMax = Number.isFinite(reproMaxRaw) && reproMaxRaw > 0 ? Math.round(reproMaxRaw) : null;
        const reproText = reproMax ? `${reproCount}/${reproMax}` : String(reproCount);
        let offspringText = String(offspringCount);
        if (reproMax) {
          const perSuccess = reproCount > 0 ? Math.max(2, Math.round(offspringCount / reproCount)) : null;
          if (perSuccess) {
            const totalMax = Math.max(offspringCount, perSuccess * reproMax);
            offspringText = `${offspringCount}/${totalMax}`;
          }
        }

        const lines = [`種別: ${diet}`];
        const groupColor =
          typeof macroWorld.getGroupColorNameJa === "function"
            ? macroWorld.getGroupColorNameJa(selected.groupId)
            : typeof macroWorld.getGroupColorHex === "function"
              ? macroWorld.getGroupColorHex(selected.groupId)
              : null;
        if (groupColor) lines.push(`グループ色: ${groupColor}`);
        if (selected.kind !== "plant" && selected.kind !== "meat" && selected.kind !== "egg" && selected.kind !== "nest") {
          lines.push(`食事回数: 植物:${plantEaten} / 肉:${meatEaten}`);
          lines.push(`社会性: ${socialMode}`);
          lines.push(`出産数: ${offspringText}`);
          lines.push(`交配数: ${reproText}`);
          lines.push(`妊娠: ${selected.pregnant ? "YES" : "NO"}`);
          /* const learningText = (() => {
            const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
            const pct = (v) => Math.round(clamp01(v) * 100);
            const horn = clamp01(selected.hornDev);
            const tail = clamp01(selected.tailDev);
            const wing = clamp01(selected.wingDev);

            const list = [
              { label: "攻撃", v: horn },
              { label: "移動", v: tail },
              { label: "探索", v: wing },
            ].sort((a, b) => b.v - a.v);

            const sum = horn + tail + wing;
            const top = list[0];
            const second = list[1];
            const spec = sum < 0.06 ? "未学習" : top.v >= 0.6 && top.v - second.v >= 0.12 ? `${top.label}特化` : "バランス";
            return `${spec} (攻:${pct(horn)}% 移:${pct(tail)}% 探:${pct(wing)}%)`;
          })();
          lines.push(`学習: ${learningText}`); */
        }
        lines.push(`性別: ${sex}`);
        lines.push(`ステージ: ${stage}`);
        lines.push(`世代: ${generation}`);
        lines.push(`行動: ${action}`);
        lines.push(`体力: ${hp}`);
        lines.push(`空腹: ${hunger}`);
        lines.push(`スタミナ: ${stamina}`);
        lines.push(`体温: ${bodyTemp}`);
        lines.push(`毛皮: ${fur}`);
        lines.push(`寿命: ${life}`);
        inspectContent.textContent = lines.join("\n");
      }
    }
  }

  stepNnViz(now);
  pointer.moved = false;
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
