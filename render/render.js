import { clamp } from "../core/utils.js";
import { TERRITORY_ALPHA_BY_LEVEL } from "../world/macro/constants.js";
import { WeatherFx } from "./weather_fx.js";

const MACRO_TILE_ASSETS = {
  grass: [
    "./assets/tiles/macro/草地_1.png",
    "./assets/tiles/macro/草地_2.png",
    "./assets/tiles/macro/草地_3.png",
    "./assets/tiles/macro/草地_4.png",
  ],
  soil: [
    "./assets/tiles/macro/土_1.png",
    "./assets/tiles/macro/土_2.png",
    "./assets/tiles/macro/土_3.png",
    "./assets/tiles/macro/土_4.png",
  ],
  sand: [
    "./assets/tiles/macro/砂_1.png",
    "./assets/tiles/macro/砂_2.png",
    "./assets/tiles/macro/砂_3.png",
    "./assets/tiles/macro/砂_4.png",
  ],
  mountain: {
    low: "./assets/tiles/macro/山_低.png",
    mid: "./assets/tiles/macro/山_中.png",
    high: "./assets/tiles/macro/山_高.png",
    peak: "./assets/tiles/macro/山頂.png",
  },
  mountainStamp: {
    low: "./assets/tiles/macro/山全体_低.png",
    mid: "./assets/tiles/macro/山全体_中.png",
    high: "./assets/tiles/macro/山全体_高.png",
    peak: "./assets/tiles/macro/山全体_山頂.png",
  },
  plantOverlay: ["./assets/tiles/macro/緑_1.png", "./assets/tiles/macro/緑_2.png"],
  territoryMask: "./assets/tiles/macro/mask_territory.png",
};

const STORYBOOK_CREATURE_ASSET_BASE = "./assets/storybook/creatures_png";
const MACRO_ANIM_ASSET_BASE = "./assets/アニメーション";
const SAMPLE_ASSET_BASE = "./assets/sample";
const SAMPLE_PLANT_DIR = `${SAMPLE_ASSET_BASE}/植物`;

const MOVE_ANIM_FRAME_COUNT = 7;
const MOVE_ANIM_TARGET_SIZE = 256;
const MOVE_ANIM_BY_DESIGN = {
  herb_pig: { dietDir: "草食", species: "豚" },
  herb_horse: { dietDir: "草食", species: "馬" },
  herb_zebra: { dietDir: "草食", species: "シマウマ" },
  herb_pigeon: { dietDir: "草食", species: "ハト" },

  omn_mouse: { dietDir: "雑食", species: "ネズミ" },
  omn_boar: { dietDir: "雑食", species: "イノシシ" },
  omn_crow: { dietDir: "雑食", species: "カラス" },
  pred_raccoon: { dietDir: "雑食", species: "アライグマ" },

  pred_wolf: { dietDir: "肉食", species: "オオカミ" },
  omn_bear: { dietDir: "肉食", species: "クマ" },
  pred_owl: { dietDir: "肉食", species: "フクロウ" },
  pred_lion: { dietDir: "肉食", species: "ライオン" },

  // NOTE: フォルダ上の分類に合わせています（現状：草食/猫）
  pred_cat: { dietDir: "草食", species: "猫" },
};

const MOVE_ANIM_STAGE_JP = {
  baby: "赤ちゃん",
  child: "子供",
  young: "若大人",
  adult: "大人",
};

function moveAnimSheetUrl(designId, sex, stage) {
  const id = String(designId || "");
  const spec = MOVE_ANIM_BY_DESIGN[id];
  if (!spec) return "";
  const sexJp = String(sex || "male") === "female" ? "雌" : "雄";
  const stageKey = String(stage || "adult");
  const stageJp = MOVE_ANIM_STAGE_JP[stageKey] || MOVE_ANIM_STAGE_JP.adult;
  const sp = String(spec.species || "");
  const dd = String(spec.dietDir || "");
  if (!sp || !dd) return "";
  return `${MACRO_ANIM_ASSET_BASE}/${dd}/${sp}/移動/${sp}${sexJp}_${stageJp}.png`;
}

const _imageAssetCache = new Map();
function getImageAsset(url) {
  const u = String(url || "");
  if (!u) return null;

  const existing = _imageAssetCache.get(u);
  if (existing) {
    if (existing.loaded) return existing.img;
    if (existing.error) return null;
    return null;
  }

  if (typeof Image === "undefined") return null;

  const img = new Image();
  img.decoding = "async";
  const entry = { img, loaded: false, error: false };
  _imageAssetCache.set(u, entry);

  img.onload = () => {
    entry.loaded = true;
  };
  img.onerror = () => {
    entry.error = true;
  };
  img.src = u;

  return null;
}

function clampInt(value, min, max) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function wrapDeltaScalar(from, to, span) {
  const s = Number(span) || 0;
  if (s <= 0) return (Number(to) || 0) - (Number(from) || 0);
  const half = s / 2;
  const raw = (Number(to) || 0) - (Number(from) || 0);
  return ((((raw + half) % s) + s) % s) - half;
}

const _macroMotionCache = new Map(); // id -> { x, y, facing, phase, seenAt }
function getMacroMotionState(macro, timeSeconds, dtSeconds, macroWorld, tileSize) {
  const id = macro?.id;
  if (id == null) return { moving: false, facing: -1, phase01: 0 };
  const key = Number(id);
  const nowX = Number(macro?.x) || 0;
  const nowY = Number(macro?.y) || 0;
  const nowT = Number(timeSeconds) || 0;
  const dt = Math.max(0, Number(dtSeconds) || 0);
  const tile = Math.max(1, Number(tileSize) || 64);

  let st = _macroMotionCache.get(key);
  if (!st) {
    st = {
      x: nowX,
      y: nowY,
      facing: -1,
      phase: (((key * 0.61803398875) % 1) * Math.PI * 2) % (Math.PI * 2),
      seenAt: nowT,
    };
    _macroMotionCache.set(key, st);
    return { moving: false, facing: st.facing, phase01: (st.phase / (Math.PI * 2)) % 1 };
  }

  const w = Number(macroWorld?._world?.width) || 0;
  const h = Number(macroWorld?._world?.height) || 0;
  const dx = wrapDeltaScalar(st.x, nowX, w);
  const dy = wrapDeltaScalar(st.y, nowY, h);
  st.x = nowX;
  st.y = nowY;
  st.seenAt = nowT;

  const dist = Math.hypot(dx, dy);
  const speed = dist / Math.max(0.0001, dt);
  const moveSpeedEps = tile * 0.12; // ignore tiny jitter so "rest" uses the idle sprite
  const faceEps = Math.max(0.25, tile * 0.003);
  const moving = dt > 0 && speed > moveSpeedEps;
  if (moving) {
    if (dx > faceEps) st.facing = 1;
    else if (dx < -faceEps) st.facing = -1;

    const baseSpeed = tile * 0.7;
    const rate = clamp(speed / Math.max(1, baseSpeed), 0.65, 2.6);
    st.phase = (st.phase + dt * rate * Math.PI * 2) % (Math.PI * 2);
  }

  return {
    moving,
    facing: Number(st.facing) > 0 ? 1 : -1,
    phase01: (Number(st.phase) / (Math.PI * 2)) % 1,
  };
}

function cleanupMacroMotionCache(timeSeconds, keepSeconds = 15) {
  const nowT = Number(timeSeconds) || 0;
  const keep = Math.max(1, Number(keepSeconds) || 15);
  for (const [id, st] of _macroMotionCache) {
    const seenAt = Number(st?.seenAt) || 0;
    if (nowT - seenAt > keep) _macroMotionCache.delete(id);
  }
}

const _keyedDrawableCache = new Map();
function getKeyedDrawableAsset(url, { bgThreshold = 210, chromaThreshold = 18 } = {}) {
  const u = String(url || "");
  if (!u) return null;
  const key = `${u}|bg=${bgThreshold}|ch=${chromaThreshold}`;
  const cached = _keyedDrawableCache.get(key);
  if (cached) return cached;

  const img = getImageAsset(u);
  if (!img) return null;
  if (typeof document === "undefined") return img;

  const w = img.naturalWidth || img.width || 0;
  const h = img.naturalHeight || img.height || 0;
  if (!(w > 0 && h > 0)) return null;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const im = ctx.getImageData(0, 0, w, h);
  const d = im.data;
  const pxCount = w * h;
  const seen = new Uint8Array(pxCount);
  const queue = [];

  const isCandidate = (p) => {
    const i = p * 4;
    const a = d[i + 3];
    if (a <= 0) return false;
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const max = r > g ? (r > b ? r : b) : g > b ? g : b;
    if (max < bgThreshold) return false;
    const min = r < g ? (r < b ? r : b) : g < b ? g : b;
    const chroma = max - min;
    return chroma <= chromaThreshold;
  };

  const pushIf = (p) => {
    if (p < 0 || p >= pxCount) return;
    if (seen[p]) return;
    if (!isCandidate(p)) return;
    seen[p] = 1;
    d[p * 4 + 3] = 0;
    queue.push(p);
  };

  // Seed: edge pixels only (prevents eating into bright/neutral highlights inside the object).
  for (let x = 0; x < w; x++) {
    pushIf(x);
    pushIf((h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    pushIf(y * w);
    pushIf(y * w + (w - 1));
  }

  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) pushIf(p - 1);
    if (x < w - 1) pushIf(p + 1);
    if (y > 0) pushIf(p - w);
    if (y < h - 1) pushIf(p + w);
  }

  ctx.putImageData(im, 0, 0);
  _keyedDrawableCache.set(key, canvas);
  return canvas;
}

const _spriteSheetFramesCache = new Map();
function getSpriteSheetFramesAsset(
  url,
  {
    frameCount = MOVE_ANIM_FRAME_COUNT,
    targetSize = MOVE_ANIM_TARGET_SIZE,
    alphaThreshold = 8,
    paddingPct = 0.12,
    bgMaxThreshold = 12,
    chromaThreshold = 18,
    searchRadiusPx = 260,
    splitMode = "auto", // "auto" | "equal"
  } = {},
) {
  const u = String(url || "");
  if (!u) return null;

  const fc = clampInt(frameCount, 1, 16);
  const ts = clampInt(targetSize, 0, 1024);
  const aThr = clampInt(alphaThreshold, 0, 255);
  const padPct = clamp(Number(paddingPct) || 0, 0, 0.5);
  const bgMax = clampInt(bgMaxThreshold, 0, 255);
  const chroma = clampInt(chromaThreshold, 0, 255);
  const sr = clampInt(searchRadiusPx, 40, 2000);
  const mode = String(splitMode) === "equal" ? "equal" : "auto";

  const key = `${u}|fc=${fc}|ts=${ts}|a=${aThr}|pad=${padPct}|bgMax=${bgMax}|ch=${chroma}|sr=${sr}|m=${mode}`;
  const existing = _spriteSheetFramesCache.get(key);
  if (existing) {
    if (existing.ready) return existing.value;
    if (existing.error) return null;
  } else {
    _spriteSheetFramesCache.set(key, { ready: false, error: false, processing: false, value: null });
  }
  const entry = _spriteSheetFramesCache.get(key);
  if (!entry || entry.processing) return null;

  const img = getImageAsset(u);
  if (!img) return null;
  if (typeof document === "undefined") return null;

  const sw = img.naturalWidth || img.width || 0;
  const sh = img.naturalHeight || img.height || 0;
  if (!(sw > 0 && sh > 0)) return null;

  entry.processing = true;
  try {
    const tmp = document.createElement("canvas");
    tmp.width = sw;
    tmp.height = sh;
    const tctx = tmp.getContext("2d", { willReadFrequently: true });
    if (!tctx) throw new Error("no 2d ctx");

    tctx.clearRect(0, 0, sw, sh);
    tctx.drawImage(img, 0, 0, sw, sh);

    const im = tctx.getImageData(0, 0, sw, sh);
    const d = im.data;
    const pxCount = sw * sh;

    const darkKey = () => {
      const seen = new Uint8Array(pxCount);
      const queue = [];
      queue.length = 0;

      const isCandidate = (p0) => {
        const i = p0 * 4;
        const a = d[i + 3];
        if (a <= 0) return false;
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const max = r > g ? (r > b ? r : b) : g > b ? g : b;
        if (max > bgMax) return false;
        const min = r < g ? (r < b ? r : b) : g < b ? g : b;
        const c = max - min;
        return c <= chroma;
      };

      const pushIf = (p0) => {
        if (p0 < 0 || p0 >= pxCount) return;
        if (seen[p0]) return;
        if (!isCandidate(p0)) return;
        seen[p0] = 1;
        d[p0 * 4 + 3] = 0;
        queue.push(p0);
      };

      // seed edges only
      for (let x = 0; x < sw; x++) {
        pushIf(x);
        pushIf((sh - 1) * sw + x);
      }
      for (let y = 1; y < sh - 1; y++) {
        pushIf(y * sw);
        pushIf(y * sw + (sw - 1));
      }

      for (let qi = 0; qi < queue.length; qi++) {
        const p0 = queue[qi];
        const x = p0 % sw;
        const y = (p0 / sw) | 0;
        if (x > 0) pushIf(p0 - 1);
        if (x < sw - 1) pushIf(p0 + 1);
        if (y > 0) pushIf(p0 - sw);
        if (y < sh - 1) pushIf(p0 + sw);
      }
    };

    darkKey();

    // If the background is not dark (gray gradients etc), also key out "bright neutral" background.
    const shouldBrightKey = (() => {
      const step = 4;
      let total = 0;
      let opaque = 0;
      const count = (x, y) => {
        total++;
        const a = d[(y * sw + x) * 4 + 3];
        if (a > aThr) opaque++;
      };
      for (let x = 0; x < sw; x += step) {
        count(x, 0);
        count(x, sh - 1);
      }
      for (let y = step; y < sh - step; y += step) {
        count(0, y);
        count(sw - 1, y);
      }
      const ratio = total > 0 ? opaque / total : 0;
      return ratio > 0.12;
    })();

    if (shouldBrightKey) {
      const bgThreshold = 40;
      const seen = new Uint8Array(pxCount);
      const queue = [];
      queue.length = 0;

      const isCandidate = (p0) => {
        const i = p0 * 4;
        const a = d[i + 3];
        if (a <= 0) return false;
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const max = r > g ? (r > b ? r : b) : g > b ? g : b;
        if (max < bgThreshold) return false;
        const min = r < g ? (r < b ? r : b) : g < b ? g : b;
        const c = max - min;
        return c <= chroma;
      };

      const pushIf = (p0) => {
        if (p0 < 0 || p0 >= pxCount) return;
        if (seen[p0]) return;
        if (!isCandidate(p0)) return;
        seen[p0] = 1;
        d[p0 * 4 + 3] = 0;
        queue.push(p0);
      };

      // seed edges
      for (let x = 0; x < sw; x++) {
        pushIf(x);
        pushIf((sh - 1) * sw + x);
      }
      for (let y = 1; y < sh - 1; y++) {
        pushIf(y * sw);
        pushIf(y * sw + (sw - 1));
      }

      for (let qi = 0; qi < queue.length; qi++) {
        const p0 = queue[qi];
        const x = p0 % sw;
        const y = (p0 / sw) | 0;
        if (x > 0) pushIf(p0 - 1);
        if (x < sw - 1) pushIf(p0 + 1);
        if (y > 0) pushIf(p0 - sw);
        if (y < sh - 1) pushIf(p0 + sw);
      }
    }

    // Apply keyed alpha to the canvas.
    tctx.putImageData(im, 0, 0);

    const countColumnAlpha = (x) => {
      const xx = clampInt(x, 0, sw - 1);
      let c = 0;
      for (let y = 0; y < sh; y += 2) {
        const a = d[(y * sw + xx) * 4 + 3];
        if (a > aThr) c++;
      }
      return c;
    };

    const counts = new Int32Array(sw);
    for (let x = 0; x < sw; x++) counts[x] = countColumnAlpha(x);

    const smoothRadius = 2;
    const smooth = new Int32Array(sw);
    for (let x = 0; x < sw; x++) {
      let sum = 0;
      const start = Math.max(0, x - smoothRadius);
      const end = Math.min(sw - 1, x + smoothRadius);
      for (let i = start; i <= end; i++) sum += counts[i];
      smooth[x] = sum;
    }

    const findMinIdx = (start, end) => {
      let best = start;
      let bestV = 2147483647;
      for (let x = start; x <= end; x++) {
        const v = smooth[x];
        if (v < bestV) {
          bestV = v;
          best = x;
        }
      }
      return best;
    };

    const findBestValley = (start, end, center) => {
      let best = -1;
      let bestV = 2147483647;
      let bestDist = 2147483647;
      for (let x = start + 1; x <= end - 1; x++) {
        const v = smooth[x];
        if (v <= smooth[x - 1] && v <= smooth[x + 1]) {
          const dist = Math.abs(x - center) | 0;
          if (v < bestV || (v === bestV && dist < bestDist)) {
            best = x;
            bestV = v;
            bestDist = dist;
          }
        }
      }
      if (best >= 0) return best;
      return findMinIdx(start, end);
    };

    const getCutsEqual = () => {
      const cuts = [];
      for (let i = 1; i < fc; i++) {
        const boundary = Math.round((sw * i) / fc);
        cuts.push(boundary - 1);
      }
      for (let i = 0; i < cuts.length; i++) {
        const min = i === 0 ? 5 : cuts[i - 1] + 10;
        const max = sw - 6;
        cuts[i] = clampInt(cuts[i], min, max);
      }
      return cuts.map((x) => clampInt(x, 0, sw - 2));
    };

    const getCutsAuto = () => {
      if (!(fc >= 2)) return [];
      const cuts = [];
      let prev = 0;
      for (let i = 1; i < fc; i++) {
        const center = Math.round((sw * i) / fc);
        const start = clampInt(center - sr, prev + 10, sw - 2);
        const end = clampInt(center + sr, start + 10, sw - 2);
        const cut = findBestValley(start, end, center);
        cuts.push(cut);
        prev = cut;
      }
      for (let i = 0; i < cuts.length; i++) {
        const min = i === 0 ? 5 : cuts[i - 1] + 10;
        const max = sw - 6;
        cuts[i] = clampInt(cuts[i], min, max);
      }
      return cuts;
    };

    const cuts = mode === "equal" ? getCutsEqual() : getCutsAuto();
    const useCuts = Array.isArray(cuts) && cuts.length === fc - 1 ? cuts : getCutsEqual();

    const segments = [];
    let segX0 = 0;
    for (let i = 0; i < fc; i++) {
      const segX1 = i === fc - 1 ? sw - 1 : clampInt(useCuts[i], segX0, sw - 2);
      segments.push({ x0: segX0, x1: segX1 });
      segX0 = segX1 + 1;
    }

    const bounds = [];
    for (let fi = 0; fi < fc; fi++) {
      const seg = segments[fi];
      if (!seg) {
        bounds.push(null);
        continue;
      }

      const scanX0 = seg.x0;
      const scanX1 = seg.x1;
      let minX = scanX1;
      let minY = sh - 1;
      let maxX = scanX0;
      let maxY = 0;
      let found = false;

      for (let y = 0; y < sh; y++) {
        let row = (y * sw + scanX0) * 4;
        for (let x = scanX0; x <= scanX1; x++) {
          const a = d[row + 3];
          if (a > aThr) {
            found = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
          row += 4;
        }
      }

      if (!found) bounds.push(null);
      else bounds.push({ minX, maxX, minY, maxY });
    }

    const valid = bounds.filter(Boolean);
    if (!valid.length) {
      entry.ready = true;
      entry.value = { frames: new Array(fc).fill(null), frameCount: fc, url: u };
      return entry.value;
    }

    const frames = new Array(fc);
    for (let fi = 0; fi < fc; fi++) {
      const seg = segments[fi];
      const b = bounds[fi];
      if (!seg || !b) {
        frames[fi] = null;
        continue;
      }

      const bw = Math.max(1, b.maxX - b.minX + 1);
      const bh = Math.max(1, b.maxY - b.minY + 1);
      const pad = Math.max(0, Math.round(Math.max(bw, bh) * padPct));

      const srcX0 = clampInt(b.minX - pad, seg.x0, seg.x1);
      const srcX1 = clampInt(b.maxX + pad, seg.x0, seg.x1);
      const srcY0 = clampInt(b.minY - pad, 0, sh - 1);
      const srcY1 = clampInt(b.maxY + pad, 0, sh - 1);

      const cropW = Math.max(1, srcX1 - srcX0 + 1);
      const cropH = Math.max(1, srcY1 - srcY0 + 1);

      const c = document.createElement("canvas");
      const dstSize = ts > 0 ? ts : cropW;
      c.width = dstSize;
      c.height = ts > 0 ? ts : cropH;
      const cctx = c.getContext("2d");
      if (!cctx) {
        frames[fi] = c;
        continue;
      }
      cctx.clearRect(0, 0, c.width, c.height);

      if (ts > 0) {
        const outerPad = Math.round(dstSize * 0.04);
        const availW = Math.max(1, dstSize - 2 * outerPad);
        const availH = Math.max(1, dstSize - 2 * outerPad);
        const scale = Math.max(0.0001, Math.min(availW / cropW, availH / cropH));
        const dw = Math.max(1, Math.round(cropW * scale));
        const dh = Math.max(1, Math.round(cropH * scale));
        const dx = Math.round((dstSize - dw) / 2);
        const dy = Math.round((dstSize - dh) / 2);
        cctx.drawImage(tmp, srcX0, srcY0, cropW, cropH, dx, dy, dw, dh);
      } else {
        cctx.drawImage(tmp, srcX0, srcY0, cropW, cropH, 0, 0, cropW, cropH);
      }

      frames[fi] = c;
    }

    entry.ready = true;
    entry.value = { frames, frameCount: fc, url: u };
    return entry.value;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    entry.error = true;
    entry.ready = true;
    entry.value = null;
    return null;
  } finally {
    entry.processing = false;
  }
}

const _trimmedSpriteCache = new Map();
function getTrimmedSquareSpriteAsset(
  url,
  { targetSize = MOVE_ANIM_TARGET_SIZE, alphaThreshold = 8, paddingPct = 0.12 } = {},
) {
  const u = String(url || "");
  if (!u) return null;
  const ts = clampInt(targetSize, 32, 2048);
  const aThr = clampInt(alphaThreshold, 0, 255);
  const padPct = clamp(Number(paddingPct) || 0, 0, 0.5);
  const key = `${u}|ts=${ts}|a=${aThr}|pad=${padPct}`;
  const cached = _trimmedSpriteCache.get(key);
  if (cached) return cached;

  const img = getImageAsset(u);
  if (!img) return null;
  if (typeof document === "undefined") return img;

  const w = img.naturalWidth || img.width || 0;
  const h = img.naturalHeight || img.height || 0;
  if (!(w > 0 && h > 0)) return null;

  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext("2d", { willReadFrequently: true });
  if (!tctx) return img;

  tctx.clearRect(0, 0, w, h);
  tctx.drawImage(img, 0, 0, w, h);

  const im = tctx.getImageData(0, 0, w, h);
  const d = im.data;

  let minX = w - 1;
  let minY = h - 1;
  let maxX = 0;
  let maxY = 0;
  let found = false;

  const step = 2;
  for (let y = 0; y < h; y += step) {
    let row = (y * w) * 4;
    for (let x = 0; x < w; x += step) {
      const a = d[row + x * 4 + 3];
      if (a > aThr) {
        found = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!found) {
    _trimmedSpriteCache.set(key, img);
    return img;
  }

  minX = clampInt(minX - step, 0, w - 1);
  minY = clampInt(minY - step, 0, h - 1);
  maxX = clampInt(maxX + step, 0, w - 1);
  maxY = clampInt(maxY + step, 0, h - 1);

  const bw = Math.max(1, maxX - minX + 1);
  const bh = Math.max(1, maxY - minY + 1);
  const pad = Math.max(0, Math.round(Math.max(bw, bh) * padPct));

  const srcX = clampInt(minX - pad, 0, w - 1);
  const srcY = clampInt(minY - pad, 0, h - 1);
  const srcX2 = clampInt(maxX + pad, 0, w - 1);
  const srcY2 = clampInt(maxY + pad, 0, h - 1);
  const cropW = Math.max(1, srcX2 - srcX + 1);
  const cropH = Math.max(1, srcY2 - srcY + 1);

  const out = document.createElement("canvas");
  out.width = ts;
  out.height = ts;
  const octx = out.getContext("2d");
  if (!octx) {
    _trimmedSpriteCache.set(key, img);
    return img;
  }
  octx.clearRect(0, 0, ts, ts);

  const outerPad = Math.round(ts * 0.04);
  const availW = Math.max(1, ts - 2 * outerPad);
  const availH = Math.max(1, ts - 2 * outerPad);
  const scale = Math.max(0.0001, Math.min(availW / cropW, availH / cropH));
  const dw = Math.max(1, Math.round(cropW * scale));
  const dh = Math.max(1, Math.round(cropH * scale));
  const dx = Math.round((ts - dw) / 2);
  const dy = Math.round((ts - dh) / 2);
  octx.drawImage(tmp, srcX, srcY, cropW, cropH, dx, dy, dw, dh);

  _trimmedSpriteCache.set(key, out);
  return out;
}

const _mountainStampDrawableCache = new Map();
function getMountainStampDrawableAsset(url, { tolerance = 56 } = {}) {
  const u = String(url || "");
  if (!u) return null;
  const key = `${u}|tol=${Math.round(Number(tolerance) || 56)}`;
  const cached = _mountainStampDrawableCache.get(key);
  if (cached) return cached;

  const img = getImageAsset(u);
  if (!img) return null;
  if (typeof document === "undefined") return img;

  const w = img.naturalWidth || img.width || 0;
  const h = img.naturalHeight || img.height || 0;
  if (!(w > 0 && h > 0)) return null;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return img;

  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const im = ctx.getImageData(0, 0, w, h);
  const d = im.data;

  const cs = clamp(Math.round(Math.min(w, h) * 0.04), 4, 32) | 0;
  const corners = [
    [0, 0],
    [w - cs, 0],
    [0, h - cs],
    [w - cs, h - cs],
  ];
  let br = 0;
  let bg = 0;
  let bb = 0;
  let bn = 0;
  for (const [x0, y0] of corners) {
    for (let yy = y0; yy < y0 + cs; yy++) {
      for (let xx = x0; xx < x0 + cs; xx++) {
        const i = (yy * w + xx) * 4;
        const a = d[i + 3];
        if (a <= 0) continue;
        br += d[i];
        bg += d[i + 1];
        bb += d[i + 2];
        bn++;
      }
    }
  }

  if (bn <= 0) {
    _mountainStampDrawableCache.set(key, canvas);
    return canvas;
  }
  br /= bn;
  bg /= bn;
  bb /= bn;

  const tol = clamp(Number(tolerance) || 56, 1, 140);
  const tol2 = tol * tol;
  const isBg = (idx) => {
    const p = idx * 4;
    const a = d[p + 3];
    if (a <= 0) return false;
    const dr = d[p] - br;
    const dg = d[p + 1] - bg;
    const db = d[p + 2] - bb;
    return dr * dr + dg * dg + db * db <= tol2;
  };

  const n = w * h;
  const visited = new Uint8Array(n);
  const q = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  const push = (idx) => {
    if (visited[idx]) return;
    visited[idx] = 1;
    q[qt++] = idx;
  };

  for (let x = 0; x < w; x++) {
    const t = x;
    const b = (h - 1) * w + x;
    if (isBg(t)) push(t);
    if (isBg(b)) push(b);
  }
  for (let y = 0; y < h; y++) {
    const l = y * w;
    const r = y * w + (w - 1);
    if (isBg(l)) push(l);
    if (isBg(r)) push(r);
  }

  while (qh < qt) {
    const idx = q[qh++];
    const p = idx * 4;
    d[p] = 0;
    d[p + 1] = 0;
    d[p + 2] = 0;
    d[p + 3] = 0;

    const x = idx % w;
    const y = (idx / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        const ni = ny * w + nx;
        if (visited[ni]) continue;
        if (!isBg(ni)) continue;
        push(ni);
      }
    }
  }

  ctx.putImageData(im, 0, 0);
  _mountainStampDrawableCache.set(key, canvas);
  return canvas;
}

function drawableSize(drawable) {
  if (!drawable) return { w: 1, h: 1 };
  const w = Math.max(1, Number(drawable.naturalWidth || drawable.width || 1));
  const h = Math.max(1, Number(drawable.naturalHeight || drawable.height || 1));
  return { w, h };
}

function drawOverlayPart2d(ctx, drawable, { cx = 0, cy = 0, width = 0, alpha = 1 } = {}) {
  if (!ctx || !drawable) return;
  const w = Math.max(0, Number(width) || 0);
  if (w <= 0) return;
  const sz = drawableSize(drawable);
  const h = (w * sz.h) / Math.max(1, sz.w);
  ctx.save();
  ctx.globalAlpha *= clamp(Number(alpha) || 0, 0, 1);
  ctx.drawImage(drawable, cx - w * 0.5, cy - h * 0.5, w, h);
  ctx.restore();
}

const _territoryTintCache = new Map();
function getTerritoryTintCanvas(r, g, b, maskImg) {
  const rr = Math.max(0, Math.min(255, Math.round(Number(r) || 0)));
  const gg = Math.max(0, Math.min(255, Math.round(Number(g) || 0)));
  const bb = Math.max(0, Math.min(255, Math.round(Number(b) || 0)));

  const key = `${rr},${gg},${bb}`;
  const cached = _territoryTintCache.get(key);
  if (cached) return cached;

  if (!maskImg) return null;
  if (typeof document === "undefined") return null;

  const w = maskImg.naturalWidth || maskImg.width || 0;
  const h = maskImg.naturalHeight || maskImg.height || 0;
  if (!(w > 0 && h > 0)) return null;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(maskImg, 0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";

  _territoryTintCache.set(key, canvas);
  return canvas;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function maturityFromMacro(macro) {
  const direct = Number(macro?.visualMaturity);
  if (Number.isFinite(direct)) return clamp(direct, 0, 1);

  switch (macro?.lifeStage) {
    case "baby":
      return 0;
    case "child":
      return 0.35;
    case "youngAdult":
      return 0.75;
    case "adult":
    default:
      return 1;
  }
}

function colorForKind(kind) {
  switch (kind) {
    case "health":
      return "#2e8b57";
    case "attack":
      return "#c0392b";
    case "random":
      return "#f1c40f";
    case "stamina":
    default:
      return "#2980b9";
  }
}

const KIND_ORDER = ["attack", "stamina", "health", "random"];

function kindRank(kind) {
  const idx = KIND_ORDER.indexOf(kind);
  return idx === -1 ? 999 : idx;
}

function drawShape(ctx, kind, x, y, r) {
  ctx.beginPath();
  if (kind === "attack") {
    const a0 = -Math.PI / 2;
    ctx.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
    ctx.lineTo(x + Math.cos(a0 + (2 * Math.PI) / 3) * r, y + Math.sin(a0 + (2 * Math.PI) / 3) * r);
    ctx.lineTo(x + Math.cos(a0 + (4 * Math.PI) / 3) * r, y + Math.sin(a0 + (4 * Math.PI) / 3) * r);
    ctx.closePath();
    return;
  }

  if (kind === "stamina") {
    ctx.rect(x - r, y - r, r * 2, r * 2);
    return;
  }

  if (kind === "random") {
    const spikes = 5;
    const inner = r * 0.5;
    const outer = r;
    let rot = -Math.PI / 2;
    const step = Math.PI / spikes;
    ctx.moveTo(x + Math.cos(rot) * outer, y + Math.sin(rot) * outer);
    for (let i = 0; i < spikes; i++) {
      ctx.lineTo(x + Math.cos(rot + step) * inner, y + Math.sin(rot + step) * inner);
      rot += step;
      ctx.lineTo(x + Math.cos(rot + step) * outer, y + Math.sin(rot + step) * outer);
      rot += step;
    }
    ctx.closePath();
    return;
  }

  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function getComponentsForEntity(entity) {
  const genes = Array.isArray(entity.genes) ? entity.genes : [];
  const maxDrawGenes = 6;

  if (genes.length <= maxDrawGenes) {
    return genes
      .map((g) => ({ kind: g.kind, value: g.value, label: String(g.value) }))
      .sort((a, b) => kindRank(a.kind) - kindRank(b.kind));
  }

  const totals = { stamina: 0, health: 0, attack: 0, random: 0 };
  for (const g of genes) {
    if (totals[g.kind] == null) continue;
    totals[g.kind] += g.value;
  }

  const components = [];
  for (const kind of KIND_ORDER) {
    const v = totals[kind];
    if (v > 0) components.push({ kind, value: v, label: String(v) });
  }

  return components.length ? components : [{ kind: "stamina", value: 0, label: "0" }];
}

function radiusForComponentValue(value) {
  const v = Math.max(0, value);
  return clamp(10 + Math.sqrt(v) * 3.2, 12, 34);
}

function drawCompositeEntity(ctx, entity) {
  const components = getComponentsForEntity(entity);
  const radii = components.map((c) => radiusForComponentValue(c.value));
  const overlap = -4;

  const totalHeight =
    radii.reduce((sum, r) => sum + r * 2, 0) + (components.length - 1) * overlap;

  let y = -totalHeight / 2;
  for (let i = 0; i < components.length; i++) {
    const c = components[i];
    const r = radii[i];
    y += r;

    ctx.fillStyle = colorForKind(c.kind);
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 1;
    drawShape(ctx, c.kind, 0, y, r);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "12px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 3;
    ctx.strokeText(c.label, 0, y);
    ctx.fillText(c.label, 0, y);

    y += r + overlap;
  }
}

function fillBackground(ctx, w, h, viewMode) {
  if (viewMode === "macro") {
    ctx.fillStyle = "#9a9a9a";
    ctx.fillRect(0, 0, w, h);
    return;
  }

  // Micro world: space / constellation mood.
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#050616");
  g.addColorStop(1, "#0a1230");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const rr = Math.max(w, h) * 0.95;
  const nebula = ctx.createRadialGradient(w * 0.65, h * 0.3, 0, w * 0.65, h * 0.3, rr);
  nebula.addColorStop(0, "rgba(120, 90, 255, 0.12)");
  nebula.addColorStop(0.45, "rgba(70, 150, 255, 0.07)");
  nebula.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = nebula;
  ctx.fillRect(0, 0, w, h);
}

function hexToRgb(hex) {
  const h = String(hex || "").replace("#", "").trim();
  if (h.length === 3) {
    const r = Number.parseInt(h[0] + h[0], 16);
    const g = Number.parseInt(h[1] + h[1], 16);
    const b = Number.parseInt(h[2] + h[2], 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r, g, b };
    return null;
  }
  if (h.length === 6) {
    const r = Number.parseInt(h.slice(0, 2), 16);
    const g = Number.parseInt(h.slice(2, 4), 16);
    const b = Number.parseInt(h.slice(4, 6), 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r, g, b };
    return null;
  }
  return null;
}

function rgbaFromHex(hex, a) {
  const rgb = hexToRgb(hex);
  const aa = clamp(Number(a) || 0, 0, 1);
  if (!rgb) return `rgba(255,255,255,${aa})`;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${aa})`;
}

const _microStarSpriteCache = new Map();
const MICRO_STAR_SPRITE_BASE_SIZE = 8;
const MICRO_STAR_SPRITE_HALO_MULT = 10.2;

function getMicroStarSprite(baseHex) {
  const key = String(baseHex || "");
  const cached = _microStarSpriteCache.get(key);
  if (cached) return cached;
  if (typeof document === "undefined") return null;

  const baseSize = MICRO_STAR_SPRITE_BASE_SIZE;
  const haloR = baseSize * MICRO_STAR_SPRITE_HALO_MULT;
  const pad = 6;
  const size = Math.ceil(haloR * 2 + pad * 2);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.translate(size / 2, size / 2);
  ctx.globalCompositeOperation = "lighter";

  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, haloR);
  halo.addColorStop(0, rgbaFromHex(key, 0.55));
  halo.addColorStop(0.25, rgbaFromHex(key, 0.16));
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, haloR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = rgbaFromHex(key, 0.92);
  ctx.beginPath();
  ctx.arc(0, 0, baseSize, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.beginPath();
  ctx.arc(-baseSize * 0.22, -baseSize * 0.22, Math.max(0.8, baseSize * 0.5), 0, Math.PI * 2);
  ctx.fill();

  const sprite = { canvas, baseSize };
  _microStarSpriteCache.set(key, sprite);
  return sprite;
}

function easeOutQuad(t) {
  const x = clamp(Number(t) || 0, 0, 1);
  return 1 - (1 - x) * (1 - x);
}

function easeInOutCubic(t) {
  const x = clamp(Number(t) || 0, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function buildMicroBgStars(w, h) {
  const ww = Math.max(1, w | 0);
  const hh = Math.max(1, h | 0);
  const area = ww * hh;
  const count = Math.max(120, Math.min(450, Math.floor(area / 4000)));
  const stars = [];
  for (let i = 0; i < count; i++) {
    const x = Math.random() * ww;
    const y = Math.random() * hh;
    const r = 0.35 + Math.random() * 1.4;
    const a = 0.18 + Math.random() * 0.55;
    const tint = Math.random();
    const color =
      tint < 0.6
        ? "rgba(255,255,255,1)"
        : tint < 0.82
          ? "rgba(185,210,255,1)"
          : "rgba(215,190,255,1)";
    stars.push({ x, y, r, a, color });
  }
  return stars;
}

function drawMicroBgStars(ctx, stars) {
  if (!stars || !stars.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const s of stars) {
    ctx.globalAlpha = clamp(Number(s.a) || 0, 0, 1);
    ctx.fillStyle = s.color || "rgba(255,255,255,1)";
    ctx.beginPath();
    ctx.arc(Number(s.x) || 0, Number(s.y) || 0, Math.max(0.1, Number(s.r) || 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function computeMicroMutualNearestPairs(entities, linkRadiusPx) {
  const list = Array.isArray(entities) ? entities : [];
  const n = list.length;
  const pairs = [];
  if (n < 2) return pairs;

  const maxDist = Math.max(0, Number(linkRadiusPx) || 0);
  const maxD2 = maxDist * maxDist;
  if (!(maxD2 > 0)) return pairs;

  const nearestId = new Array(n).fill(null);
  const nearestD2 = new Array(n).fill(maxD2);
  const idToIndex = new Map();
  for (let i = 0; i < n; i++) {
    const e = list[i];
    if (!e) continue;
    idToIndex.set(e.id, i);
  }

  const isOnCooldown = (e) => {
    if (!e) return false;
    if (typeof e.isOnCooldown === "function") return e.isOnCooldown();
    return (Number(e.cooldownSeconds) || 0) > 0;
  };

  for (let i = 0; i < n; i++) {
    const a = list[i];
    if (!a) continue;
    if (isOnCooldown(a)) continue;
    const ax = Number(a.x) || 0;
    const ay = Number(a.y) || 0;
    let bestJ = -1;
    let bestD = maxD2;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const b = list[j];
      if (!b) continue;
      if (isOnCooldown(b)) continue;
      const dx = (Number(b.x) || 0) - ax;
      const dy = (Number(b.y) || 0) - ay;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) {
        bestD = d2;
        bestJ = j;
      }
    }
    if (bestJ >= 0) {
      nearestId[i] = list[bestJ]?.id ?? null;
      nearestD2[i] = bestD;
    }
  }

  for (let i = 0; i < n; i++) {
    const a = list[i];
    const bId = nearestId[i];
    if (!a || bId == null) continue;
    const j = idToIndex.get(bId);
    if (j == null) continue;
    if (nearestId[j] !== a.id) continue;
    if (a.id >= bId) continue; // avoid duplicates
    pairs.push({ a, b: list[j], d2: nearestD2[i] });
  }

  return pairs;
}

function drawMicroConstellationPairs(ctx, pairs, linkRadiusPx) {
  const maxDist = Math.max(1e-6, Number(linkRadiusPx) || 0);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const p of pairs) {
    const a = p?.a;
    const b = p?.b;
    if (!a || !b) continue;
    const ax = Number(a.x) || 0;
    const ay = Number(a.y) || 0;
    const bx = Number(b.x) || 0;
    const by = Number(b.y) || 0;
    const d = Math.sqrt(Math.max(0, Number(p.d2) || 0));
    const t = clamp(1 - d / maxDist, 0, 1);
    const alpha = 0.08 + t * 0.18;
    ctx.strokeStyle = `rgba(180, 215, 255, ${alpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMicroMergeRituals(ctx, rituals, byId) {
  const list = Array.isArray(rituals) ? rituals : [];
  if (!list.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const r of list) {
    const a = byId?.get?.(r?.aId);
    const b = byId?.get?.(r?.bId);
    if (!a || !b) continue;

    const dur = Math.max(0.05, Number(r?.duration) || 1.0);
    const tt = clamp((Number(r.t) || 0) / dur, 0, 1);
    const pulse = 0.75 + 0.25 * Math.sin(tt * Math.PI);
    const success = Boolean(r.success);
    const col = success ? { r: 205, g: 235, b: 255 } : { r: 255, g: 170, b: 190 };
    const alpha = (success ? 0.55 : 0.48) + pulse * 0.28;

    ctx.save();
    ctx.strokeStyle = `rgba(${col.r},${col.g},${col.b},${clamp(alpha, 0, 1)})`;
    ctx.lineWidth = 2.6;
    ctx.shadowColor = `rgba(${col.r},${col.g},${col.b},0.55)`;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(Number(a.x) || 0, Number(a.y) || 0);
    ctx.lineTo(Number(b.x) || 0, Number(b.y) || 0);
    ctx.stroke();
    ctx.restore();

    const mx = Number(r.mx) || (Number(a.x) + Number(b.x)) / 2;
    const my = Number(r.my) || (Number(a.y) + Number(b.y)) / 2;
    const ringT = easeOutQuad(tt);
    const ringR = lerp(10, 34, ringT);
    const ringA = (success ? 0.35 : 0.28) * (1 - tt);
    ctx.beginPath();
    ctx.strokeStyle = `rgba(${col.r},${col.g},${col.b},${clamp(ringA, 0, 1)})`;
    ctx.lineWidth = 1.7;
    ctx.arc(mx, my, ringR, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawMicroReincarnateRituals(ctx, rituals) {
  const list = Array.isArray(rituals) ? rituals : [];
  if (!list.length) return;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const rr of list) {
    const t = clamp((Number(rr?.t) || 0) / 1.0, 0, 1);
    const x = Number(rr?.x) || 0;
    const y = Number(rr?.y) || 0;

    // Center star (slightly golden + stronger glow).
    const center = rr?.entity;
    if (center) {
      const oldKind = typeof center.getDominantKind === "function" ? center.getDominantKind() : "stamina";
      const base = oldKind === "attack" ? "#ffb0c0" : oldKind === "health" ? "#c6ffcc" : "#b7d9ff";
      const grow = 1 + 0.12 * easeInOutCubic(t);
      const rEntity = Math.max(0, Number(center?._visualRadius) || Number(center.radius) || 12) * grow;
      const size = clamp(2.2 + (rEntity - 12) * 0.1, 2.2, 5.6);
      const haloR = size * 11;

      ctx.save();
      ctx.translate(x, y);
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, haloR);
      halo.addColorStop(0, rgbaFromHex(base, 0.35 + 0.25 * (1 - t)));
      halo.addColorStop(0.2, "rgba(255,245,210,0.18)");
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, haloR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(255,248,225,0.92)";
      ctx.beginPath();
      ctx.arc(0, 0, size, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.arc(-size * 0.28, -size * 0.28, Math.max(0.7, size * 0.6), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Constellation burst: many lines appear instantly, then collapse into the center to form a "gate".
    const appear = clamp(t / 0.12, 0, 1);
    const collapse = t < 0.12 ? 0 : easeInOutCubic((t - 0.12) / 0.88);
    const points = Array.isArray(rr?.points) ? rr.points : [];

    ctx.save();
    ctx.shadowColor = "rgba(200,235,255,0.45)";
    ctx.shadowBlur = 10;
    for (const p of points) {
      const w = clamp(Number(p?.w) || 1, 0.2, 2.0);
      const ex = x + (Number(p?.dx) || 0) * (1 - collapse);
      const ey = y + (Number(p?.dy) || 0) * (1 - collapse);
      const a = (0.52 + 0.12 * w) * appear * (1 - 0.25 * collapse);
      if (a <= 0) continue;

      ctx.beginPath();
      ctx.strokeStyle = `rgba(200,235,255,${clamp(a, 0, 1)})`;
      ctx.lineWidth = 1.2 + 1.1 * w * (1 - collapse);
      ctx.moveTo(x, y);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      const pr = (0.9 + 0.9 * w) * (1 - collapse);
      ctx.fillStyle = `rgba(255,255,255,${clamp(0.35 * appear * (1 - collapse), 0, 1)})`;
      ctx.beginPath();
      ctx.arc(ex, ey, pr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Gate-like light near the end.
    const gateT = clamp((t - 0.55) / 0.45, 0, 1);
    if (gateT > 0) {
      const g = easeOutQuad(gateT);
      const gateR = lerp(18, 72, g);
      const ringA = 0.55 * g * (1 - 0.05 * Math.sin(t * Math.PI * 2));

      ctx.save();
      ctx.shadowColor = "rgba(255,240,190,0.55)";
      ctx.shadowBlur = 18;

      const glow = ctx.createRadialGradient(x, y, 0, x, y, gateR * 1.15);
      glow.addColorStop(0, `rgba(255,245,215,${0.22 * g})`);
      glow.addColorStop(0.4, `rgba(255,225,170,${0.12 * g})`);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, gateR * 1.15, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.strokeStyle = `rgba(255,240,195,${clamp(ringA, 0, 1)})`;
      ctx.lineWidth = 2.4;
      ctx.arc(x, y, gateR, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle = `rgba(255,255,255,${clamp(0.18 * g, 0, 1)})`;
      ctx.lineWidth = 1.2;
      ctx.arc(x, y, gateR * 0.62, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }
  }

  ctx.restore();
}

function drawMicroFx(ctx, fxList) {
  const list = Array.isArray(fxList) ? fxList : [];
  if (!list.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const fx of list) {
    const type = String(fx?.type || "");
    const dur = Math.max(0.001, Number(fx?.duration) || 0.35);
    const t = clamp((Number(fx?.t) || 0) / dur, 0, 1);
    const x = Number(fx?.x) || 0;
    const y = Number(fx?.y) || 0;

    if (type === "mergeSuccess") {
      const rr = lerp(10, 46, easeOutQuad(t));
      const a = 0.85 * (1 - t);
      ctx.beginPath();
      ctx.strokeStyle = `rgba(210,245,255,${clamp(a, 0, 1)})`;
      ctx.lineWidth = 2.2;
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.stroke();
    } else if (type === "mergeFail") {
      const rr = lerp(8, 34, easeOutQuad(t));
      const a = 0.75 * (1 - t);
      ctx.beginPath();
      ctx.strokeStyle = `rgba(255,170,190,${clamp(a, 0, 1)})`;
      ctx.lineWidth = 2.0;
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.stroke();
    } else if (type === "reincarnate") {
      const rr = lerp(14, 66, easeOutQuad(t));
      const a = 0.75 * (1 - t);
      ctx.beginPath();
      ctx.strokeStyle = `rgba(255,235,170,${clamp(a, 0, 1)})`;
      ctx.lineWidth = 2.4;
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawMicroStar(ctx, e, { merging = false, cooldownPct = 0, starScale = 1 } = {}) {
  if (!ctx || !e) return;
  const kind = typeof e.getDominantKind === "function" ? e.getDominantKind() : "stamina";
  const base = colorForKind(kind);
  const rEntity = Math.max(0, Number(e?._visualRadius) || Number(e.radius) || 12);
  const size = clamp(2.35 + (rEntity - 11) * 0.45 + (merging ? 0.55 : 0), 2.2, 9.6);
  const scl = clamp(Number(starScale) || 1, 0.4, 4.0);
  const sizeScaled = size * scl;

  ctx.save();
  ctx.translate(Number(e.x) || 0, Number(e.y) || 0);
  ctx.globalCompositeOperation = "lighter";

  const cd = clamp(Number(cooldownPct) || 0, 0, 1);
  const glowMul = 1 - cd * 0.55;

  const sprite = getMicroStarSprite(base);
  if (sprite?.canvas) {
    ctx.globalAlpha *= glowMul;
    const factor = sizeScaled / Math.max(0.001, Number(sprite.baseSize) || MICRO_STAR_SPRITE_BASE_SIZE);
    const w = sprite.canvas.width * factor;
    const h = sprite.canvas.height * factor;
    ctx.drawImage(sprite.canvas, -w / 2, -h / 2, w, h);
  } else {
    const haloR = sizeScaled * 10.2;
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, haloR);
    halo.addColorStop(0, rgbaFromHex(base, 0.55 * glowMul));
    halo.addColorStop(0.25, rgbaFromHex(base, 0.16 * glowMul));
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, haloR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = rgbaFromHex(base, 0.92 * glowMul);
    ctx.beginPath();
    ctx.arc(0, 0, sizeScaled, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(255,255,255,${0.82 * glowMul})`;
    ctx.beginPath();
    ctx.arc(-sizeScaled * 0.22, -sizeScaled * 0.22, Math.max(0.8, sizeScaled * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  return sizeScaled;
}

function drawMicroGalaxyAura(ctx, e, { progress = 0, strength = 0.85, timeSeconds = 0, starScale = 1, quality = 1 } = {}) {
  if (!ctx || !e) return;
  const p = clamp(Number(progress) || 0, 0, 1);
  const s = clamp(Number(strength) || 0, 0, 1);
  if (p <= 0 || s <= 0) return;
  const q = clamp(Number(quality) || 1, 0.15, 1);

  const cx = Number(e.x) || 0;
  const cy = Number(e.y) || 0;
  const kind = typeof e.getDominantKind === "function" ? e.getDominantKind() : "stamina";
  const base = colorForKind(kind);

  const intensity = p * s;
  const scl = clamp(Number(starScale) || 1, 0.4, 4.0);
  const outerR = (34 + 120 * p) * (0.85 + scl * 0.35);
  const aspectX = 1.25;
  const aspectY = 0.72;

  const seed = (Number(e.id) || 1) * 0.1337;
  const baseAngle = (seed - Math.floor(seed)) * Math.PI * 2;
  const spin = timeSeconds * (0.22 + 0.28 * intensity);
  const arms = intensity > 0.7 ? 3 : 2;
  const detail = clamp((intensity - 0.14) / 0.86, 0, 1);
  const particles = Math.max(8, Math.floor(lerp(10, 120, detail) * q));

  // Stable pseudo-random for "star cluster" dots (feels like a galaxy made of many stars).
  let seed32 = (Number(e.id) || 1) | 0;
  seed32 = (seed32 ^ 0x9e3779b9) | 0;
  const rand = () => {
    // LCG (fast, deterministic per entity)
    seed32 = (Math.imul(seed32, 1664525) + 1013904223) | 0;
    return (seed32 >>> 0) / 4294967296;
  };

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // Soft haze.
  const hazeR = outerR * 1.05;
  const haze = ctx.createRadialGradient(cx, cy, 0, cx, cy, hazeR);
  haze.addColorStop(0, rgbaFromHex(base, 0.12 * intensity));
  haze.addColorStop(0.3, rgbaFromHex(base, 0.08 * intensity));
  haze.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = haze;
  ctx.beginPath();
  ctx.arc(cx, cy, hazeR, 0, Math.PI * 2);
  ctx.fill();

  // Disc rings (makes the "galaxy" obvious even when particles are subtle).
  const ringA = clamp(0.22 * intensity * (0.6 + 0.4 * q), 0, 0.45);
  if (ringA > 0.001) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(baseAngle + spin * 0.6);
    ctx.scale(aspectX, aspectY);
    ctx.shadowColor = "rgba(235,250,255,0.35)";
    ctx.shadowBlur = 10 + 10 * intensity;
    ctx.strokeStyle = rgbaFromHex(base, ringA);
    ctx.lineWidth = 1.4 + 2.2 * intensity;
    ctx.beginPath();
    ctx.arc(0, 0, outerR * (0.55 + 0.22 * intensity), 0, Math.PI * 2);
    ctx.stroke();

    // Thin white highlight ring (gives a crisp edge).
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255,255,255,${clamp(0.18 * intensity, 0, 0.22)})`;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.arc(0, 0, outerR * (0.55 + 0.22 * intensity) - (0.9 + intensity * 0.8), 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha *= 0.65;
    ctx.beginPath();
    ctx.arc(0, 0, outerR * (0.82 + 0.08 * intensity), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Star cluster dots (dense near the center, with subtle rotation).
  const clusterDots = Math.max(12, Math.floor(lerp(18, 160, detail) * q));
  const clusterSpin = timeSeconds * (0.12 + 0.18 * intensity);
  const dotCol = "rgba(235,250,255,1)";
  ctx.fillStyle = dotCol;
  for (let i = 0; i < clusterDots; i++) {
    const u = rand();
    const v = rand();
    const w = rand();
    // Bias to center: u^2.2 -> lots of dots near 0
    const rad = Math.pow(u, 2.2) * outerR;
    const ang = v * Math.PI * 2 + clusterSpin + u * (0.6 + 1.4 * intensity);
    const ex = Math.cos(ang) * rad * aspectX;
    const ey = Math.sin(ang) * rad * aspectY;

    const sparkle = w > 0.985 ? 1 : 0;
    const pr = (0.35 + 1.9 * (1 - u)) * (0.7 + scl * 0.12) * (sparkle ? 1.35 : 1);
    const a = (0.02 + 0.26 * (1 - u)) * intensity * (sparkle ? 1.4 : 1);
    if (a <= 0) continue;

    ctx.globalAlpha = clamp(a, 0, 1);
    const px = cx + ex;
    const py = cy + ey;
    if (pr < 1.15) {
      const rr = pr * 2;
      ctx.fillRect(px - pr, py - pr, rr, rr);
    } else {
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
    }

    if (sparkle) {
      const sa = clamp(a * 0.65, 0, 1);
      ctx.strokeStyle = `rgba(255,255,255,${sa})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(px - pr * 2.2, py);
      ctx.lineTo(px + pr * 2.2, py);
      ctx.moveTo(px, py - pr * 2.2);
      ctx.lineTo(px, py + pr * 2.2);
      ctx.stroke();
    }
  }

  // Spiral dust / starlets.
  ctx.fillStyle = dotCol;
  for (let i = 0; i < particles; i++) {
    const u = particles <= 1 ? 1 : i / (particles - 1);
    const rad = Math.pow(u, 0.65) * outerR;
    const arm = i % arms;
    const ang = baseAngle + spin + u * (Math.PI * 2.7) + arm * ((Math.PI * 2) / arms);
    const wob = (Math.sin((u * 18 + seed) * 2.1 + timeSeconds * 1.1) * 0.5 + 0.5) * (1 - p) * 6;
    const x = cx + Math.cos(ang) * rad * aspectX + Math.cos(ang + 1.3) * wob;
    const y = cy + Math.sin(ang) * rad * aspectY + Math.sin(ang + 1.3) * wob;

    const pr = (0.35 + 1.1 * (1 - u)) * (0.7 + scl * 0.12);
    const a = (0.01 + 0.09 * (1 - u)) * intensity;
    if (a <= 0) continue;

    ctx.globalAlpha = clamp(a, 0, 1);
    if (pr < 1.05) {
      const rr = pr * 2;
      ctx.fillRect(x - pr, y - pr, rr, rr);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, pr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawMacroTiles(ctx, camera, tileSize, viewW, viewH, macroWorld, weatherFx) {
  const startX = Math.floor(camera.x / tileSize);
  const startY = Math.floor(camera.y / tileSize);
  const endX = Math.ceil((camera.x + viewW) / tileSize);
  const endY = Math.ceil((camera.y + viewH) / tileSize);
  const edgeWBase = tileSize * 0.22;
  const edgeWidth = (diff) => Math.max(1, edgeWBase * Math.max(0, Math.min(1, Math.abs(diff) / 6)));
  const edgeAlpha = (diff) => Math.max(0.12, Math.min(0.75, 0.14 + (Math.abs(diff) / 20) * 0.58));
  const hasElevation = Boolean(macroWorld?.getElevationAtTile);

  const grassImgs = (Array.isArray(MACRO_TILE_ASSETS.grass) ? MACRO_TILE_ASSETS.grass : []).map(getImageAsset);
  const soilImgs = (Array.isArray(MACRO_TILE_ASSETS.soil) ? MACRO_TILE_ASSETS.soil : []).map(getImageAsset);
  const sandImgs = (Array.isArray(MACRO_TILE_ASSETS.sand) ? MACRO_TILE_ASSETS.sand : []).map(getImageAsset);
  const plantOverlayImgs = (Array.isArray(MACRO_TILE_ASSETS.plantOverlay) ? MACRO_TILE_ASSETS.plantOverlay : []).map(getImageAsset);
  const territoryMaskImg = getImageAsset(MACRO_TILE_ASSETS.territoryMask);

  const mountainTiles = MACRO_TILE_ASSETS.mountain || {};
  const mountainImgs = {
    low: getImageAsset(mountainTiles.low),
    mid: getImageAsset(mountainTiles.mid),
    high: getImageAsset(mountainTiles.high),
    peak: getImageAsset(mountainTiles.peak),
  };

  const mountainStamps = MACRO_TILE_ASSETS.mountainStamp || {};
  const mountainStampImgs = {
    low: getMountainStampDrawableAsset(mountainStamps.low, { tolerance: 80 }),
    mid: getMountainStampDrawableAsset(mountainStamps.mid, { tolerance: 80 }),
    high: getMountainStampDrawableAsset(mountainStamps.high, { tolerance: 80 }),
    peak: getMountainStampDrawableAsset(mountainStamps.peak, { tolerance: 80 }),
  };

  const terr = macroWorld?._territoryPaint;
  const terrOwner = terr?.owner;
  const terrLevel = terr?.level;
  const terrPlantMask = terr?.plantMask;
  const terrTw = terr?.tileWidth | 0;
  const terrTh = terr?.tileHeight | 0;
  const terrR = macroWorld?._territoryGroupColorR;
  const terrG = macroWorld?._territoryGroupColorG;
  const terrB = macroWorld?._territoryGroupColorB;
  const hasTerritory = Boolean(terrOwner && terrLevel && terrTw > 0 && terrTh > 0 && terrR && terrG && terrB);
  const wrapTile = (v, max) => {
    const m = max | 0;
    if (m <= 0) return 0;
    const n = v | 0;
    return ((n % m) + m) % m;
  };

  const biomeToGroundKind = (biomeId) => {
    // Macro biomes are color-based; map them to "storybook" ground textures (grass/soil/sand).
    // 0 gray -> soil, 1 desert -> sand, 3 green -> grass, others -> soil.
    const b = Number(biomeId) | 0;
    if (b === 1) return "sand";
    if (b === 3 || b === 4) return "grass";
    return "soil";
  };

  const tileHash = (tx, ty, salt) => {
    const x = (Number(tx) | 0) * 92837111;
    const y = (Number(ty) | 0) * 689287499;
    return (x ^ y ^ (salt | 0)) >>> 0;
  };

  const pickFrom = (imgs, tx, ty, salt) => {
    const list = Array.isArray(imgs) ? imgs : [];
    if (!list.length) return null;

    // Reduce "noisy" per-tile randomness: use low-frequency value-noise so nearby tiles tend to share
    // the same variant (keeps biomes cohesive without obvious grid blocks).
    const cs = 18; // tiles per noise cell (bigger => more unified)
    const x = Number(tx) || 0;
    const y = Number(ty) || 0;
    const fx = x / cs;
    const fy = y / cs;
    const ix0 = Math.floor(fx);
    const iy0 = Math.floor(fy);
    const smoothstep01 = (t) => {
      const v = clamp(Number(t) || 0, 0, 1);
      return v * v * (3 - 2 * v);
    };
    const tx01 = smoothstep01(fx - ix0);
    const ty01 = smoothstep01(fy - iy0);
    const h01 = (hx, hy) => (tileHash(hx, hy, salt) & 0xffff) / 0xffff;
    const v00 = h01(ix0, iy0);
    const v10 = h01(ix0 + 1, iy0);
    const v01 = h01(ix0, iy0 + 1);
    const v11 = h01(ix0 + 1, iy0 + 1);
    const a = v00 * (1 - tx01) + v10 * tx01;
    const b = v01 * (1 - tx01) + v11 * tx01;
    const v = a * (1 - ty01) + b * ty01;
    const idx = clampInt(Math.floor(v * list.length), 0, list.length - 1);
    return list[idx] || list.find(Boolean) || null;
  };

  const groundImgForTile = (tx, ty) => {
    const biomeId = macroWorld?.getBiomeAtTile ? macroWorld.getBiomeAtTile(tx, ty) : 0;
    const kind = biomeToGroundKind(biomeId);
    if (kind === "grass") return pickFrom(grassImgs, tx, ty, 0x13579bdf);
    if (kind === "sand") return pickFrom(sandImgs, tx, ty, 0x9e3779b9);
    return pickFrom(soilImgs, tx, ty, 0x2468ace0);
  };

  const mountainTierForHeight = (hm) => {
    const h = Number(hm) || 0;
    if (h < 5) return "low";
    if (h < 10) return "mid";
    if (h < 15) return "high";
    return "peak";
  };

  for (let ty = startY; ty <= endY; ty++) {
    for (let tx = startX; tx <= endX; tx++) {
      const x = tx * tileSize;
      const y = ty * tileSize;
      const hm = hasElevation ? Number(macroWorld.getElevationAtTile(tx, ty)) || 0 : 0;

      const groundImg = groundImgForTile(tx, ty);
      if (groundImg) {
        ctx.drawImage(groundImg, x, y, tileSize, tileSize);
      } else {
        const biomeId = macroWorld?.getBiomeAtTile ? macroWorld.getBiomeAtTile(tx, ty) : 0;
        const kind = biomeToGroundKind(biomeId);
        ctx.fillStyle = kind === "grass" ? "#a7d5a6" : kind === "sand" ? "#d6c477" : "#b08a5a";
        ctx.fillRect(x, y, tileSize, tileSize);
      }

      // Mountains: overlay per-tile mountain texture based on height.
      if (hm > 0) {
        const tier = mountainTierForHeight(hm);
        const mimg = mountainImgs[tier] || mountainImgs.high || mountainImgs.mid || mountainImgs.low || mountainImgs.peak;
        if (mimg) {
          ctx.drawImage(mimg, x, y, tileSize, tileSize);
        } else {
          const t = Math.max(0, Math.min(1, hm / 20));
          const g = Math.max(75, Math.min(245, Math.round(230 - t * 120)));
          ctx.save();
          ctx.globalAlpha *= 0.35;
          ctx.fillStyle = `rgb(${g},${g},${g})`;
          ctx.fillRect(x, y, tileSize, tileSize);
          ctx.restore();
        }
      }

      // Territory paint overlay is drawn after mountain stamps (see below).

      // Elevation edges (stronger visual step walls).
      if (hasElevation) {
        const rightH = Number(macroWorld.getElevationAtTile(tx + 1, ty)) || 0;
        const bottomH = Number(macroWorld.getElevationAtTile(tx, ty + 1)) || 0;

        const diffR = hm - rightH;
        if (Math.abs(diffR) >= 1) {
          const w = edgeWidth(diffR);
          const a = edgeAlpha(diffR);
          ctx.fillStyle = `rgba(0,0,0,${a})`;
          ctx.fillRect(x + tileSize - w, y, w, tileSize);
        }

        const diffB = hm - bottomH;
        if (Math.abs(diffB) >= 1) {
          const hh = edgeWidth(diffB);
          const a = edgeAlpha(diffB);
          ctx.fillStyle = `rgba(0,0,0,${a})`;
          ctx.fillRect(x, y + tileSize - hh, tileSize, hh);
        }
      }
    }
  }

  // Mountain stamp overlay (per mountain cluster) to reduce the "cutout" feel at the boundary.
  if (macroWorld?.getMountainLabels) {
    const labels = macroWorld.getMountainLabels();
    if (Array.isArray(labels) && labels.length) {
      const pad = tileSize * 6;
      const left = camera.x - pad;
      const top = camera.y - pad;
      const right = camera.x + viewW + pad;
      const bottom = camera.y + viewH + pad;

      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      for (const l of labels) {
        if (!l) continue;
        const tx = Number(l.tx);
        const ty = Number(l.ty);
        const hm = Number(l.height) || 0;
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
        if (!(hm > 0)) continue;

        const rTiles = clamp(Number(l.radiusTiles) || 6, 2, 80);
        const size = (rTiles * 2 + 6) * tileSize;
        const cx = (tx + 0.5) * tileSize;
        const cy = (ty + 0.5) * tileSize;

        if (cx + size * 0.6 < left || cx - size * 0.6 > right || cy + size * 0.6 < top || cy - size * 0.6 > bottom) continue;

        const tier = mountainTierForHeight(hm);
        const stamp =
          mountainStampImgs[tier] || mountainStampImgs.high || mountainStampImgs.mid || mountainStampImgs.low || mountainStampImgs.peak;
        if (!stamp) continue;

        const h01 = clamp(hm / 20, 0, 1);
        const alpha = 0.96 + 0.04 * h01;
        const hash = tileHash(tx, ty, 0x6d2b79f5);
        const flip = (hash & 1) === 1 ? -1 : 1;
        const rot = (((hash >>> 1) % 9) - 4) * 0.045;

        ctx.save();
        ctx.translate(cx, cy + size * 0.06);
        ctx.scale(flip, 1);
        ctx.rotate(rot);
        ctx.globalAlpha *= alpha;
        ctx.drawImage(stamp, -size * 0.5, -size * 0.5, size, size);
        ctx.globalAlpha *= 0.7;
        ctx.drawImage(stamp, -size * 0.5, -size * 0.5, size, size);
        ctx.restore();
      }

      ctx.restore();
    }
  }

  // Plant influence shading (green), as in the previous spec.
  if (macroWorld) {
    const hasPlantMask = terrPlantMask instanceof Uint8Array && terrTw > 0 && terrTh > 0;
    if (hasPlantMask) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      for (let ty = startY; ty <= endY; ty++) {
        for (let tx = startX; tx <= endX; tx++) {
          const idx = wrapTile(tx, terrTw) + wrapTile(ty, terrTh) * terrTw;
          if (!terrPlantMask[idx]) continue;
          const x = tx * tileSize;
          const y = ty * tileSize;
          const overlayImg = pickFrom(plantOverlayImgs, tx, ty, 0x2f6e2b1);
          ctx.globalAlpha = 0.9;
          if (overlayImg) ctx.drawImage(overlayImg, x, y, tileSize, tileSize);
          else {
            ctx.fillStyle = "rgba(67,160,71,0.26)";
            ctx.fillRect(x, y, tileSize, tileSize);
          }
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
    }
  }

  // Territory paint overlay (after mountains + plant influence).
  if (
    terrOwner instanceof Int32Array &&
    terrLevel instanceof Uint8Array &&
    terrTw > 0 &&
    terrTh > 0 &&
    territoryMaskImg &&
    terrR &&
    terrG &&
    terrB
  ) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    for (let ty = startY; ty <= endY; ty++) {
      for (let tx = startX; tx <= endX; tx++) {
        const idx = wrapTile(tx, terrTw) + wrapTile(ty, terrTh) * terrTw;
        if (terrPlantMask && terrPlantMask[idx]) continue;
        const lvl = terrLevel[idx] | 0;
        if (lvl <= 0) continue;
        const owner = terrOwner[idx] | 0;
        if (owner < 0) continue;
        const r = terrR?.[owner];
        const g = terrG?.[owner];
        const b = terrB?.[owner];
        if (!(Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b))) continue;
        const tint = getTerritoryTintCanvas(r, g, b, territoryMaskImg);
        if (!tint) continue;
        const a = TERRITORY_ALPHA_BY_LEVEL[lvl] ?? 0.22;
        ctx.globalAlpha = a;
        ctx.drawImage(tint, tx * tileSize, ty * tileSize, tileSize, tileSize);
      }
    }
    ctx.restore();
  }

  if (weatherFx && typeof weatherFx.drawMacroGroundOverlays === "function") {
    weatherFx.drawMacroGroundOverlays(ctx, macroWorld, { startX, endX, startY, endY, tileSize, hasElevation });
  }

  // NOTE: Mountain height labels disabled (numbers on mountains are distracting in the storybook style).
}

function drawMinimap(ctx, macroWorld, camera, minimapSize, viewportW, viewportH) {
  const pad = 14;
  const x0 = viewportW - minimapSize.width - pad;
  const y0 = viewportH - minimapSize.height - pad - 52;
  const w = minimapSize.width;
  const h = minimapSize.height;

  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.strokeRect(x0, y0, w, h);

  const ww = macroWorld._world?.width ?? 1;
  const wh = macroWorld._world?.height ?? 1;
  const sx = w / ww;
  const sy = h / wh;

  ctx.fillStyle = "rgba(255,255,255,0.65)";
  for (const e of macroWorld.entities) {
    const px = x0 + e.x * sx;
    const py = y0 + e.y * sy;
    ctx.fillRect(px, py, 2, 2);
  }

  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2;
  const zoom = Number(camera?.zoom) > 0 ? Number(camera.zoom) : 1;
  const viewW = (camera.viewportWidth ?? viewportW) / zoom;
  const viewH = (camera.viewportHeight ?? viewportH) / zoom;
  ctx.strokeRect(x0 + camera.x * sx, y0 + camera.y * sy, viewW * sx, viewH * sy);
  ctx.restore();
}

function drawMacroMeat(ctx, x, y, r, variant) {
  const rot = variant?.rotation ?? 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);

  // meat chunk
  ctx.fillStyle = "rgba(96,54,36,0.95)";
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.15, r * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // bone
  ctx.fillStyle = "rgba(245,240,235,0.95)";
  ctx.beginPath();
  ctx.ellipse(-r * 0.9, -r * 0.15, r * 0.35, r * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-r * 0.9, r * 0.15, r * 0.35, r * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.rect(-r * 0.9, -r * 0.12, r * 0.95, r * 0.24);
  ctx.fill();
  ctx.restore();
}

function drawMacroRock(ctx, x, y, r, variant) {
  const rot = Number(variant?.rotation) || 0;
  const style = Math.max(0, Math.min(2, Math.round(Number(variant?.obstacleStyle) || 0)));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";

  const base = style === 2 ? "rgba(130,130,130,0.95)" : style === 1 ? "rgba(150,150,150,0.95)" : "rgba(170,170,170,0.95)";
  const grad = ctx.createLinearGradient(-r, -r, r, r);
  grad.addColorStop(0, base);
  grad.addColorStop(1, "rgba(90,90,90,0.95)");
  ctx.fillStyle = grad;

  const n = style === 2 ? 8 : style === 1 ? 7 : 6;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wob = 0.78 + 0.16 * Math.sin(i * 1.7 + style * 0.9);
    const rr = r * wob;
    const px = Math.cos(a) * rr;
    const py = Math.sin(a) * rr * (0.88 + 0.12 * Math.cos(i * 2.1));
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.globalAlpha = 0.28;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.ellipse(-r * 0.18, -r * 0.25, r * 0.42, r * 0.26, -0.25, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawMacroTree(ctx, x, y, r, variant) {
  const rot = Number(variant?.rotation) || 0;
  const style = Math.max(0, Math.min(2, Math.round(Number(variant?.obstacleStyle) || 0)));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot * 0.15);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";

  // shadow
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.ellipse(0, r * 0.72, r * 0.72, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // trunk
  const trunkW = r * 0.34;
  const trunkH = r * 0.78;
  ctx.fillStyle = "rgba(120,80,50,0.95)";
  ctx.beginPath();
  ctx.rect(-trunkW / 2, r * 0.22, trunkW, trunkH);
  ctx.fill();
  ctx.stroke();

  const canopy = ctx.createRadialGradient(-r * 0.2, -r * 0.35, r * 0.2, 0, -r * 0.25, r * 1.05);
  canopy.addColorStop(0, "rgba(150,220,150,0.95)");
  canopy.addColorStop(1, "rgba(40,120,70,0.95)");
  ctx.fillStyle = canopy;

  if (style === 1) {
    // conifer
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.05);
    ctx.lineTo(r * 0.92, r * 0.15);
    ctx.lineTo(-r * 0.92, r * 0.15);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (style === 2) {
    // clustered canopy
    const parts = [
      { x: -r * 0.28, y: -r * 0.25, rr: r * 0.72 },
      { x: r * 0.28, y: -r * 0.25, rr: r * 0.72 },
      { x: 0, y: -r * 0.55, rr: r * 0.78 },
    ];
    for (const p of parts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else {
    // round canopy
    ctx.beginPath();
    ctx.arc(0, -r * 0.35, r * 0.92, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function drawMacroPlant(ctx, x, y, r, variant, stage = 2) {
  const petals = Math.max(3, Math.min(10, variant?.petals ?? 6));
  const filled = Boolean(variant?.filled);
  const rotation = variant?.rotation ?? 0;
  const petalRoundness = variant?.petalRoundness ?? 1;
  const speciesVariant = variant?.speciesVariant ?? 0;
  const growthStage = Math.max(0, Math.min(2, Math.round(Number(stage == null ? 2 : stage))));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.fillStyle = coatFillStyle(ctx, r, "none", variant);

  if (growthStage === 0) {
    // bud
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
    filled ? ctx.fill() : ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
    filled ? ctx.fill() : ctx.stroke();
    ctx.restore();
    return;
  }

  if (growthStage === 1) {
    // stem
    ctx.beginPath();
    ctx.moveTo(0, r * 0.9);
    ctx.lineTo(0, -r * 0.35);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(-r * 0.25, r * 0.25, r * 0.35, r * 0.18, -0.35, 0, Math.PI * 2);
    filled ? ctx.fill() : ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(r * 0.25, r * 0.25, r * 0.35, r * 0.18, 0.35, 0, Math.PI * 2);
    filled ? ctx.fill() : ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, -r * 0.45, r * 0.28, 0, Math.PI * 2);
    filled ? ctx.fill() : ctx.stroke();
    ctx.restore();
    return;
  }

  if (speciesVariant === 0) {
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      const px = Math.cos(a) * r * 0.55;
      const py = Math.sin(a) * r * 0.55;
      ctx.beginPath();
      ctx.ellipse(px, py, r * 0.42 * petalRoundness, r * 0.22, a, 0, Math.PI * 2);
      filled ? ctx.fill() : ctx.stroke();
    }
  } else if (speciesVariant === 1) {
    // leaf-like
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      const px = Math.cos(a) * r * 0.55;
      const py = Math.sin(a) * r * 0.55;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + Math.cos(a) * r * 0.45, py + Math.sin(a) * r * 0.45, px + Math.cos(a + 0.8) * r * 0.25, py + Math.sin(a + 0.8) * r * 0.25);
      ctx.quadraticCurveTo(px, py, px + Math.cos(a - 0.8) * r * 0.25, py + Math.sin(a - 0.8) * r * 0.25);
      ctx.closePath();
      filled ? ctx.fill() : ctx.stroke();
    }
  } else {
    // bush-like blob
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.9, r * 0.65, 0, 0, Math.PI * 2);
    filled ? ctx.fill() : ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.35, r * 0.5, r * 0.35, a * 0.2, 0, Math.PI * 2);
      filled ? ctx.fill() : ctx.stroke();
    }
  }

  ctx.beginPath();
  ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
  filled ? ctx.fill() : ctx.stroke();
  ctx.restore();
}

function spriteStageFromMacro(macro) {
  switch (macro?.lifeStage) {
    case "baby":
      return "baby";
    case "child":
      return "child";
    case "youngAdult":
      return "young";
    case "adult":
    default:
      return "adult";
  }
}

function creatureSpriteUrl(designId, sex, stage) {
  const id = String(designId || "");
  if (!id) return "";
  const s = sex === "female" ? "female" : "male";
  const st = String(stage || "adult");
  return `${STORYBOOK_CREATURE_ASSET_BASE}/${id}/${s}_${st}.png`;
}

function plantSpriteUrl(stage, idx) {
  const st = Math.max(0, Math.min(2, Math.round(Number(stage == null ? 2 : stage))));
  if (st === 0) return `${SAMPLE_PLANT_DIR}/芽.png`;
  if (st === 1) return `${SAMPLE_PLANT_DIR}/茎.png`;
  const n = Math.max(1, Math.min(15, Math.round(Number(idx) || 1)));
  return `${SAMPLE_PLANT_DIR}/植物${n}.png`;
}

const CREATURE_SPRITE_H_PER_RADIUS = 3.2;
const CREATURE_SPRITE_ANCHOR_Y = 0.62;
const PLANT_SPRITE_H_PER_RADIUS = 3.1;
const PLANT_SPRITE_ANCHOR_Y = 0.62;

function drawMacroCreatureSprite(ctx, macro, x, y) {
  const designId = String(macro?.designId || "");
  if (!designId) return false;

  const sex = macro?.sex === "female" ? "female" : "male";
  const stage = spriteStageFromMacro(macro);
  const animUrl = moveAnimSheetUrl(designId, sex, stage);
  const anim = animUrl ? getSpriteSheetFramesAsset(animUrl) : null;

  const motion = macro?._renderMotion || null;
  const moving = Boolean(motion?.moving);
  const phase01 = clamp(Number(motion?.phase01) || 0, 0, 1);
  const facing = Number(motion?.facing) > 0 ? 1 : -1;

  const staticUrl = creatureSpriteUrl(designId, sex, stage);
  // Trim + square-fit so small sprites (e.g. birds/chicks) don't look tiny when stopped vs moving.
  const staticDrawable = staticUrl ? getTrimmedSquareSpriteAsset(staticUrl) : null;

  const hasAnim = anim && Array.isArray(anim.frames) && anim.frames.length;
  const animFrames = hasAnim ? anim.frames : null;

  let drawable = null;
  if (moving) {
    // Moving: prefer sprite-sheet.
    if (animFrames) {
      const idx = clampInt(Math.floor(phase01 * animFrames.length), 0, animFrames.length - 1);
      drawable = animFrames[idx] || animFrames[0] || null;
    }
    // Fallback: if sprite-sheet not ready yet, show the static sprite.
    if (!drawable && staticDrawable) drawable = staticDrawable;
  } else {
    // Stopped/resting: prefer the static storybook sprite.
    if (staticDrawable) drawable = staticDrawable;
    // Fallback: if static isn't loaded yet, show the first sprite-sheet frame (keeps "something" visible).
    if (!drawable && animFrames) drawable = animFrames[0] || null;
  }

  if (!drawable) return false;

  const { w: iw, h: ih } = drawableSize(drawable);
  const r = Math.max(1, Number(macro?.radius) || 1);
  const targetH = Math.max(8, r * CREATURE_SPRITE_H_PER_RADIUS);
  const s = targetH / Math.max(1, ih);
  const dw = iw * s;
  const dh = targetH;

  ctx.save();
  ctx.translate(x, y);
  const pregT = macro?.pregnant ? clamp((Number(macro?.pregnancySeconds) || 0) / 30, 0, 1) : 0;
  const pregScaleX = 1 + 0.14 * pregT;
  const pregScaleY = 1 + 0.08 * pregT;
  // Base sprites face LEFT by default. Flip horizontally when facing to the RIGHT.
  const flip = facing > 0 ? -1 : 1;
  ctx.scale(flip * pregScaleX, pregScaleY);

  const leftX = -dw * 0.5;
  const topY = -dh * CREATURE_SPRITE_ANCHOR_Y;
  ctx.drawImage(drawable, leftX, topY, dw, dh);

  ctx.restore();
  return true;
}

function drawMacroPlantSprite(ctx, macro, x, y) {
  if (!macro) return false;
  const stage = Math.max(0, Math.min(2, Math.round(Number(macro.plantStage == null ? 2 : macro.plantStage))));
  const idxRaw = macro?.variant?.plantSpriteIndex ?? macro?.plantSpriteIndex ?? macro?.id ?? 1;
  const idx = Math.max(1, Math.min(15, Math.round(Number(idxRaw) || 1)));
  const url = plantSpriteUrl(stage, idx);
  const drawable = getKeyedDrawableAsset(url);
  if (!drawable) return false;

  const { w: iw, h: ih } = drawableSize(drawable);
  const r = Math.max(1, Number(macro?.radius) || 1);
  const targetH = Math.max(6, r * PLANT_SPRITE_H_PER_RADIUS);
  const s = targetH / Math.max(1, ih);
  const dw = iw * s;
  const dh = targetH;

  ctx.save();
  ctx.translate(x, y);
  const leftX = -dw * 0.5;
  const topY = -dh * PLANT_SPRITE_ANCHOR_Y;
  ctx.drawImage(drawable, leftX, topY, dw, dh);
  ctx.restore();
  return true;
}

const EGG_HATCH_WARM_SECONDS = 30;
const EGG_WARM_VISUAL_SECONDS = 15;

function drawMacroNest(ctx, x, y, r, variant) {
  const rot = Number(variant?.rotation) || 0;
  const style = Math.max(0, Math.min(2, Math.round(Number(variant?.nestStyle) || 0)));

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.fillStyle = "rgba(190,150,90,0.55)";

  ctx.beginPath();
  ctx.ellipse(0, 0, r, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.globalAlpha = 0.65;
  ctx.strokeStyle = "rgba(80,55,25,0.85)";
  ctx.lineWidth = 2;
  const n = style === 2 ? 9 : style === 1 ? 7 : 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const len = r * (0.7 + 0.25 * Math.sin(i * 1.7));
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25);
    ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMacroEgg(ctx, x, y, r, macro) {
  const warm = Math.max(0, Number(macro?.warmSeconds) || 0);
  const warmed = warm >= EGG_WARM_VISUAL_SECONDS;
  const nearHatch = warm >= EGG_HATCH_WARM_SECONDS * 0.85;
  const t = typeof performance !== "undefined" ? performance.now() : Date.now();

  const wiggle = warmed ? Math.sin(t / 90) * r * (nearHatch ? 0.12 : 0.07) : 0;
  const wobbleRot = warmed ? Math.sin(t / 140) * (nearHatch ? 0.22 : 0.12) : 0;
  const rot = (Number(macro?.variant?.rotation) || 0) + wobbleRot;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.translate(wiggle, 0);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.fillStyle = warmed ? "rgba(255,246,200,0.92)" : "rgba(245,240,235,0.92)";

  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.85, r * 1.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // highlight
  ctx.globalAlpha = warmed ? 0.55 : 0.45;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.ellipse(-r * 0.22, -r * 0.25, r * 0.24, r * 0.38, -0.2, 0, Math.PI * 2);
  ctx.fill();

  // cracks (after warmed)
  if (warmed) {
    ctx.globalAlpha = nearHatch ? 0.85 : 0.65;
    ctx.strokeStyle = "rgba(120,70,20,0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.15, r * 0.1);
    ctx.lineTo(r * 0.05, -r * 0.05);
    ctx.lineTo(r * 0.22, r * 0.06);
    ctx.stroke();
  }

  ctx.restore();

  if (warm > 0) {
    const remaining = Math.max(0, EGG_HATCH_WARM_SECONDS - warm);
    drawMacroCooldownArc(ctx, x, y, r, remaining, EGG_HATCH_WARM_SECONDS, "rgba(255,170,0,0.45)");
  }
}

function drawMacroHerbivore(ctx, x, y, r, large, sex, variant, maturity01 = 1) {
  const maturity = clamp(Number(maturity01) || 0, 0, 1);
  const juvenile = 1 - maturity;

  const limbCount = Math.max(2, Math.min(10, Math.round(Number(variant?.limbCount) || 4)));
  const eyeCountRaw = variant?.eyeCount;
  const eyeCount = Math.max(0, Math.min(8, Math.round(Number(eyeCountRaw == null ? 1 : eyeCountRaw))));
  const tailCountRaw = variant?.tailCount;
  const tailCount = Math.max(0, Math.min(3, Math.round(Number(tailCountRaw == null ? 1 : tailCountRaw))));
  const hornCount = Math.max(0, Math.min(3, Math.round(Number(variant?.hornCount) || 0)));
  const hornScale = clamp(Number(variant?.hornScale) || 1, 0.6, 1.8);
  const tailScale = clamp(Number(variant?.tailScale) || 1, 0.6, 1.8);
  const wingCount = Math.max(0, Math.min(4, Math.round(Number(variant?.wingCount) || 0)));
  const wingStyle = Math.max(0, Math.min(2, Math.round(Number(variant?.wingStyle) || 0)));
  const wingScale = clamp(Number(variant?.wingScale) || 1, 0.6, 1.8);
  const eyeScale = clamp(Number(variant?.eyeScale) || 1, 0.6, 1.8);
  const headAspectBase = clamp(Number(variant?.headAspect) || 1, 0.65, 1.6);
  const headAspect = lerp(1, headAspectBase, maturity);
  const bodyStyle = variant?.bodyStyle === "angular" ? "angular" : "round";

  const bodyRoundW = lerp(0.92, 1.0, maturity);
  const bodyRoundH = lerp(1.18, 1.0, maturity);
  const neckScale = lerp(0.55, 1.0, maturity);
  const headGrow = lerp(1.38, 1.0, maturity);
  const legH = r * lerp(0.55, 0.75, maturity);
  const legWBase = r * lerp(0.18, 0.14, maturity);
  const legW = legWBase * clamp(6 / limbCount, 0.45, 1);
  const tailScaleX = lerp(0.72, 1.0, maturity);
  const tailScaleY = lerp(0.85, 1.0, maturity);

  ctx.save();
  ctx.translate(x, y);
  const flip = variant?.flip ? -1 : 1;
  const rot = variant?.rotation ?? 0;
  ctx.rotate(rot);
  ctx.scale(flip, 1);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  const bodyFill = coatFillStyle(ctx, r, sex, variant);
  ctx.fillStyle = bodyFill;

  const sx = variant?.bodyScaleX ?? 1;
  const sy = variant?.bodyScaleY ?? 1;
  const bodyW = r * (large ? 1.55 : 1.25) * sx * bodyRoundW;
  const bodyH = r * (large ? 0.9 : 0.75) * sy * bodyRoundH;

  // wings (draw behind body)
  const wingGrow = clamp((maturity - 0.15) / 0.85, 0, 1);
  if (wingCount > 0 && wingGrow > 0.02) {
    const span = r * (large ? 1.35 : 1.2) * wingScale * wingGrow;
    const lift = r * 1.05 * wingScale * wingGrow;
    const baseX = -bodyW * 0.15;
    const baseY = -bodyH * 0.35;
    ctx.save();
    ctx.globalAlpha = 0.55 + 0.25 * maturity;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 3;
    for (let i = 0; i < wingCount; i++) {
      const off = (i - (wingCount - 1) / 2) * r * 0.22;
      const ax = baseX + (i % 2 === 0 ? 0 : r * 0.06);
      const ay = baseY + off;
      ctx.beginPath();
      if (wingStyle === 1) {
        // bat-like
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - span * 0.35, ay - lift * 0.85);
        ctx.lineTo(ax - span * 0.75, ay - lift * 0.2);
        ctx.lineTo(ax - span * 1.05, ay - lift * 0.55);
        ctx.lineTo(ax - span * 1.15, ay + lift * 0.15);
        ctx.closePath();
      } else if (wingStyle === 2) {
        // fin/leaf-like
        ctx.ellipse(ax - span * 0.5, ay - lift * 0.35, span * 0.6, lift * 0.35, -0.25, 0, Math.PI * 2);
      } else {
        // feather-like
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo(ax - span * 0.45, ay - lift, ax - span * 1.1, ay - lift * 0.35);
        ctx.quadraticCurveTo(ax - span * 0.7, ay + lift * 0.05, ax, ay);
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.beginPath();
  if (bodyStyle === "angular") {
    const corner = Math.max(4, Math.min(bodyW, bodyH) * 0.22);
    if (ctx.roundRect) ctx.roundRect(-bodyW, -bodyH, bodyW * 2, bodyH * 2, corner);
    else ctx.rect(-bodyW, -bodyH, bodyW * 2, bodyH * 2);
  } else {
    ctx.ellipse(0, 0, bodyW, bodyH, 0, 0, Math.PI * 2);
  }
  ctx.fill();

  const speciesVariant = variant?.speciesVariant ?? 0;
  if (speciesVariant === 0) {
    // neck
    ctx.beginPath();
    ctx.ellipse(bodyW * 0.65, -bodyH * 0.35, r * 0.35 * neckScale, r * 0.45 * neckScale, -0.35, 0, Math.PI * 2);
    ctx.fill();
  } else if (speciesVariant === 1) {
    // rabbit-like long neck/head placement
    ctx.beginPath();
    ctx.ellipse(bodyW * 0.7, -bodyH * 0.25, r * 0.25 * neckScale, r * 0.35 * neckScale, -0.2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // compact neck
    ctx.beginPath();
    ctx.ellipse(bodyW * 0.55, -bodyH * 0.2, r * 0.3 * neckScale, r * 0.32 * neckScale, -0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  const headScaleBase = variant?.headScale ?? 1;
  const headScale = headScaleBase * headGrow;
  const headX = bodyW * 0.95 * lerp(0.92, 1.0, maturity);
  const headY = -bodyH * (speciesVariant === 1 ? 0.65 : 0.55) * lerp(0.78, 1.0, maturity);
  ctx.ellipse(headX, headY, r * 0.42 * headScale * headAspect, r * 0.32 * headScale / headAspect, 0.15, 0, Math.PI * 2);
  ctx.fill();

  // ear(s)
  if (speciesVariant === 1) {
    const earGrow = lerp(0.65, 1.0, maturity);
    ctx.beginPath();
    ctx.moveTo(bodyW * 0.98, -bodyH * 1.0);
    ctx.lineTo(bodyW * 1.03, -bodyH * 1.55 * earGrow);
    ctx.lineTo(bodyW * 1.12, -bodyH * 1.0);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(bodyW * 1.12, -bodyH * 1.02);
    ctx.lineTo(bodyW * 1.18, -bodyH * 1.55 * earGrow);
    ctx.lineTo(bodyW * 1.26, -bodyH * 1.02);
    ctx.closePath();
    ctx.fill();
  } else if (maturity < 0.85) {
    // Juveniles: round, slightly oversized ears (softer look regardless of sex).
    const earScale = 1 + juvenile * 0.35;
    ctx.beginPath();
    ctx.ellipse(bodyW * 1.08, -bodyH * 0.95, r * 0.18 * earScale, r * 0.14 * earScale, 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(bodyW * 1.22, -bodyH * 0.92, r * 0.16 * earScale, r * 0.12 * earScale, 0.25, 0, Math.PI * 2);
    ctx.fill();
  } else if (sex === "female") {
    // round ear (female)
    ctx.beginPath();
    ctx.ellipse(bodyW * 1.12, -bodyH * 0.98, r * 0.16, r * 0.12, 0.2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(bodyW * 1.05, -bodyH * 0.95);
    ctx.lineTo(bodyW * 1.15, -bodyH * 1.2);
    ctx.lineTo(bodyW * 1.2, -bodyH * 0.9);
    ctx.closePath();
    ctx.fill();
  }

  // tail(s)
  if (tailCount > 0) {
    const tsx = tailScaleX * tailScale;
    const tsy = tailScaleY * tailScale;
    const tailWidth = lerp(6, 10, maturity) * clamp(1.05 - 0.12 * (tailCount - 1), 0.55, 1);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = tailWidth;
    for (let i = 0; i < tailCount; i++) {
      const off = (i - (tailCount - 1) / 2) * r * 0.08;
      const len = 1 - i * 0.08;
      ctx.beginPath();
      ctx.moveTo(-bodyW * 1.0 * tsx, (-bodyH * 0.25 + off) * tsy);
      ctx.quadraticCurveTo(
        -bodyW * (1.25 + i * 0.05) * tsx,
        (-bodyH * (0.6 + i * 0.03) + off) * tsy,
        -bodyW * (1.35 + i * 0.08) * tsx * len,
        (-bodyH * 0.15 + off) * tsy,
      );
      ctx.stroke();
    }
    ctx.lineWidth = 3;
    ctx.fillStyle = bodyFill;
  }

  // legs
  for (let i = 0; i < limbCount; i++) {
    const t = (i + 1) / (limbCount + 1);
    const lx = (t - 0.5) * bodyW * 1.2;
    const ly = bodyH * 0.75 + (i % 2) * r * 0.02;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(lx - legW / 2, ly, legW, legH, 3);
      ctx.fill();
    } else {
      ctx.rect(lx - legW / 2, ly, legW, legH);
      ctx.fill();
    }
  }

  // horn(s)
  const hornGrow = clamp((maturity - 0.55) / 0.45, 0, 1);
  if (hornCount > 0 && hornGrow > 0.04) {
    const hornStyle = variant?.hornStyle ?? 0;
    const hornAlpha = lerp(0.08, 0.25, hornGrow);
    const styleMul = hornStyle === 2 ? 1.25 : hornStyle === 1 ? 1.1 : 1.0;
    const len = r * lerp(0.35, 1.0, hornGrow) * styleMul * hornScale;
    const foot = r * lerp(0.06, 0.18, hornGrow);

    ctx.strokeStyle = `rgba(255,255,255,${hornAlpha})`;
    ctx.lineWidth = 3;
    for (let i = 0; i < hornCount; i++) {
      const spread = (i - (hornCount - 1) / 2) * r * 0.14;
      const bx = headX - r * 0.05 + spread;
      const by = headY - r * 0.1;
      const tx = bx + r * 0.18 + spread * 0.15;
      const ty = by - len;
      ctx.beginPath();
      ctx.moveTo(bx - foot, by);
      ctx.lineTo(tx, ty);
      ctx.lineTo(bx + foot, by + len * 0.15);
      ctx.stroke();
    }
    ctx.fillStyle = bodyFill;
  }

  // eye(s)
  if (eyeCount > 0) {
    const eyeR = r * 0.06 * eyeScale * (1 + juvenile * 0.6);
    const rows = eyeCount > 4 ? 2 : 1;
    const perRow = rows === 1 ? eyeCount : Math.ceil(eyeCount / 2);
    const spacingX = eyeR * 2.2;
    const spacingY = eyeR * 2.0;

    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    for (let i = 0; i < eyeCount; i++) {
      const row = rows === 1 ? 0 : Math.floor(i / perRow);
      const col = rows === 1 ? i : i % perRow;
      const cx = col - (perRow - 1) / 2;
      const cy = row - (rows - 1) / 2;
      const ex = headX + cx * spacingX;
      const ey = headY + cy * spacingY - r * 0.02;

      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.beginPath();
      ctx.arc(ex + eyeR * 0.25, ey, eyeR * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.restore();
}

function drawMacroPredator(ctx, x, y, r, sex, variant, maturity01 = 1) {
  const maturity = clamp(Number(maturity01) || 0, 0, 1);
  const juvenile = 1 - maturity;

  const limbCount = Math.max(2, Math.min(10, Math.round(Number(variant?.limbCount) || 4)));
  const eyeCountRaw = variant?.eyeCount;
  const eyeCount = Math.max(0, Math.min(8, Math.round(Number(eyeCountRaw == null ? 1 : eyeCountRaw))));
  const tailCountRaw = variant?.tailCount;
  const tailCount = Math.max(0, Math.min(3, Math.round(Number(tailCountRaw == null ? 1 : tailCountRaw))));
  const hornCount = Math.max(0, Math.min(3, Math.round(Number(variant?.hornCount) || 0)));
  const hornScale = clamp(Number(variant?.hornScale) || 1, 0.6, 1.8);
  const tailScale = clamp(Number(variant?.tailScale) || 1, 0.6, 1.8);
  const wingCount = Math.max(0, Math.min(4, Math.round(Number(variant?.wingCount) || 0)));
  const wingStyle = Math.max(0, Math.min(2, Math.round(Number(variant?.wingStyle) || 0)));
  const wingScale = clamp(Number(variant?.wingScale) || 1, 0.6, 1.8);
  const eyeScale = clamp(Number(variant?.eyeScale) || 1, 0.6, 1.8);
  const headAspectBase = clamp(Number(variant?.headAspect) || 1, 0.65, 1.6);
  const headAspect = lerp(1, headAspectBase, maturity);
  const bodyStyle = variant?.bodyStyle === "angular" ? "angular" : "round";

  const bodyRoundW = lerp(0.92, 1.0, maturity);
  const bodyRoundH = lerp(1.18, 1.0, maturity);
  const headGrow = lerp(1.5, 1.0, maturity);
  const tailScaleX = lerp(0.72, 1.0, maturity);
  const tailScaleY = lerp(0.85, 1.0, maturity);
  const tailSX = tailScaleX * tailScale;
  const tailSY = tailScaleY * tailScale;
  const legH = r * lerp(0.55, 0.7, maturity);
  const legWBase = r * lerp(0.2, 0.16, maturity);
  const legW = legWBase * clamp(6 / limbCount, 0.45, 1);

  ctx.save();
  ctx.translate(x, y);
  const flip = variant?.flip ? -1 : 1;
  const rot = variant?.rotation ?? 0;
  ctx.rotate(rot);
  ctx.scale(flip, 1);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  const bodyFill = coatFillStyle(ctx, r, sex, variant);
  ctx.fillStyle = bodyFill;

  const sx = variant?.bodyScaleX ?? 1;
  const sy = variant?.bodyScaleY ?? 1;
  const headScale = (variant?.headScale ?? 1) * headGrow;
  const speciesVariant = sex === "female" ? 2 : variant?.speciesVariant ?? 0;
  const bodyW = r * (speciesVariant === 2 ? 0.9 : 0.95) * sx * bodyRoundW;
  const bodyH = r * (speciesVariant === 2 ? 0.55 : 0.6) * sy * bodyRoundH;

  // wings (draw behind body)
  const wingGrow = clamp((maturity - 0.15) / 0.85, 0, 1);
  if (wingCount > 0 && wingGrow > 0.02) {
    const span = r * 1.25 * wingScale * wingGrow;
    const lift = r * 1.0 * wingScale * wingGrow;
    const baseX = -bodyW * 0.1;
    const baseY = -bodyH * 0.35;
    ctx.save();
    ctx.globalAlpha = 0.5 + 0.25 * maturity;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 3;
    for (let i = 0; i < wingCount; i++) {
      const off = (i - (wingCount - 1) / 2) * r * 0.22;
      const ax = baseX + (i % 2 === 0 ? 0 : r * 0.06);
      const ay = baseY + off;
      ctx.beginPath();
      if (wingStyle === 1) {
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - span * 0.35, ay - lift * 0.85);
        ctx.lineTo(ax - span * 0.75, ay - lift * 0.2);
        ctx.lineTo(ax - span * 1.05, ay - lift * 0.55);
        ctx.lineTo(ax - span * 1.15, ay + lift * 0.15);
        ctx.closePath();
      } else if (wingStyle === 2) {
        ctx.ellipse(ax - span * 0.5, ay - lift * 0.35, span * 0.6, lift * 0.35, -0.25, 0, Math.PI * 2);
      } else {
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo(ax - span * 0.45, ay - lift, ax - span * 1.1, ay - lift * 0.35);
        ctx.quadraticCurveTo(ax - span * 0.7, ay + lift * 0.05, ax, ay);
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = bodyFill;
  }

  let headX = 0;
  let headY = 0;

  if (speciesVariant === 2) {
    // cat-like
    ctx.beginPath();
    if (bodyStyle === "angular") {
      const corner = Math.max(4, Math.min(bodyW, bodyH) * 0.22);
      if (ctx.roundRect) ctx.roundRect(-bodyW, -bodyH, bodyW * 2, bodyH * 2, corner);
      else ctx.rect(-bodyW, -bodyH, bodyW * 2, bodyH * 2);
    } else {
      ctx.ellipse(0, 0, bodyW, bodyH, 0, 0, Math.PI * 2);
    }
    ctx.fill();

    headX = r * 0.9 * lerp(0.92, 1.0, maturity);
    headY = -r * 0.35 * lerp(0.75, 1.0, maturity);
    ctx.beginPath();
    ctx.ellipse(headX, headY, r * 0.4 * headScale * headAspect, r * 0.32 * headScale / headAspect, 0.1, 0, Math.PI * 2);
    ctx.fill();

    // round ears (female)
    const earScale = 1 + juvenile * 0.35;
    ctx.beginPath();
    ctx.arc(r * 0.9, -r * 0.75 * lerp(0.85, 1.0, maturity), r * 0.18 * earScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(r * 1.18, -r * 0.72 * lerp(0.85, 1.0, maturity), r * 0.18 * earScale, 0, Math.PI * 2);
    ctx.fill();

    // tail(s) (thin)
    if (tailCount > 0) {
      for (let i = 0; i < tailCount; i++) {
        const off = (i - (tailCount - 1) / 2) * r * 0.08;
        const len = (1 - i * 0.1) * tailSX;
        ctx.beginPath();
        ctx.moveTo(-r * 0.9 * len, (-r * 0.05 + off) * tailSY);
        ctx.quadraticCurveTo(-r * 1.6 * len, (-r * 0.65 + off) * tailSY, -r * 1.15 * len, (-r * 1.0 + off) * tailSY);
        ctx.lineTo(-r * 1.0 * len, (-r * 0.85 + off) * tailSY);
        ctx.quadraticCurveTo(-r * 1.25 * len, (-r * 0.55 + off) * tailSY, -r * 0.9 * len, (-r * 0.2 + off) * tailSY);
        ctx.fill();
      }
    }
  } else {
    // Body silhouette (wolf-like)
    ctx.beginPath();
    if (bodyStyle === "angular") {
      const corner = Math.max(4, Math.min(bodyW, bodyH) * 0.22);
      if (ctx.roundRect) ctx.roundRect(-bodyW, -bodyH, bodyW * 2, bodyH * 2, corner);
      else ctx.rect(-bodyW, -bodyH, bodyW * 2, bodyH * 2);
    } else {
      ctx.ellipse(0, 0, bodyW, bodyH, 0, 0, Math.PI * 2);
    }
    ctx.fill();

    // Chest bump
    ctx.beginPath();
    ctx.ellipse(r * 0.25, r * 0.2, r * 0.55 * lerp(0.85, 1.0, maturity), r * 0.42 * lerp(0.9, 1.0, maturity), -0.25, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.beginPath();
    headX = r * 0.95 * lerp(0.92, 1.0, maturity);
    headY = -r * 0.45 * lerp(0.75, 1.0, maturity);
    ctx.ellipse(headX, headY, r * 0.45 * headScale * headAspect, r * 0.35 * headScale / headAspect, 0.15, 0, Math.PI * 2);
    ctx.fill();

    // Snout
    const snoutMul = lerp(0.72, 1.0, maturity);
    const faceYMul = lerp(0.85, 1.0, maturity);
    ctx.beginPath();
    ctx.moveTo(r * 1.25 * snoutMul, -r * 0.45 * faceYMul);
    ctx.lineTo(r * 1.6 * snoutMul, -r * 0.32 * faceYMul);
    ctx.lineTo(r * 1.25 * snoutMul, -r * 0.2 * faceYMul);
    ctx.closePath();
    ctx.fill();

    // Ears
    if (maturity < 0.85) {
      const earScale = 1 + juvenile * 0.35;
      ctx.beginPath();
      ctx.arc(r * 0.9, -r * 0.85 * faceYMul, r * 0.18 * earScale, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(r * 1.18, -r * 0.82 * faceYMul, r * 0.18 * earScale, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(r * 0.8, -r * 0.95);
      ctx.lineTo(r * 0.92, -r * 1.25);
      ctx.lineTo(r * 1.05, -r * 0.92);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(r * 1.05, -r * 0.9);
      ctx.lineTo(r * 1.18, -r * 1.18);
      ctx.lineTo(r * 1.25, -r * 0.86);
      ctx.closePath();
      ctx.fill();
    }

    // Tail(s)
    if (tailCount > 0) {
      for (let i = 0; i < tailCount; i++) {
        const off = (i - (tailCount - 1) / 2) * r * 0.08;
        const len = (1 - i * 0.1) * tailSX;
        ctx.beginPath();
        ctx.moveTo(-r * 0.95 * len, (-r * 0.15 + off) * tailSY);
        ctx.quadraticCurveTo(-r * 1.45 * len, (-r * 0.55 + off) * tailSY, -r * 1.15 * len, (-r * 0.85 + off) * tailSY);
        ctx.quadraticCurveTo(-r * 1.55 * len, (-r * 0.6 + off) * tailSY, -r * 1.6 * len, (-r * 0.2 + off) * tailSY);
        ctx.quadraticCurveTo(-r * 1.35 * len, (-r * 0.1 + off) * tailSY, -r * 0.95 * len, (-r * 0.15 + off) * tailSY);
        ctx.fill();
      }
    }
  }

  // horn(s)
  const hornGrow = clamp((maturity - 0.55) / 0.45, 0, 1);
  if (hornCount > 0 && hornGrow > 0.04) {
    const hornStyle = variant?.hornStyle ?? 0;
    const hornAlpha = lerp(0.08, 0.25, hornGrow);
    const styleMul = hornStyle === 2 ? 1.25 : hornStyle === 1 ? 1.1 : 1.0;
    const len = r * lerp(0.3, 0.95, hornGrow) * styleMul * hornScale;
    const foot = r * lerp(0.06, 0.18, hornGrow);

    ctx.strokeStyle = `rgba(255,255,255,${hornAlpha})`;
    ctx.lineWidth = 3;
    for (let i = 0; i < hornCount; i++) {
      const spread = (i - (hornCount - 1) / 2) * r * 0.14;
      const bx = headX - r * 0.05 + spread;
      const by = headY - r * 0.1;
      const tx = bx + r * 0.15 + spread * 0.12;
      const ty = by - len;
      ctx.beginPath();
      ctx.moveTo(bx - foot, by);
      ctx.lineTo(tx, ty);
      ctx.lineTo(bx + foot, by + len * 0.15);
      ctx.stroke();
    }
    ctx.fillStyle = bodyFill;
  }

  // eye(s)
  if (eyeCount > 0) {
    const eyeR = r * 0.06 * eyeScale * (1 + juvenile * 0.6);
    const rows = eyeCount > 4 ? 2 : 1;
    const perRow = rows === 1 ? eyeCount : Math.ceil(eyeCount / 2);
    const spacingX = eyeR * 2.2;
    const spacingY = eyeR * 2.0;

    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    for (let i = 0; i < eyeCount; i++) {
      const row = rows === 1 ? 0 : Math.floor(i / perRow);
      const col = rows === 1 ? i : i % perRow;
      const cx = col - (perRow - 1) / 2;
      const cy = row - (rows - 1) / 2;
      const ex = headX + cx * spacingX + r * 0.05;
      const ey = headY + cy * spacingY - r * 0.02;

      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.beginPath();
      ctx.arc(ex + eyeR * 0.25, ey, eyeR * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Legs
  const legBaseY = bodyH * 0.62;
  for (let i = 0; i < limbCount; i++) {
    const t = (i + 1) / (limbCount + 1);
    const lx = (t - 0.5) * bodyW * 1.2;
    const ly = legBaseY + (i % 2) * r * 0.02;
    ctx.beginPath();
    ctx.roundRect?.(lx - legW / 2, ly, legW, legH, 3);
    if (ctx.roundRect) ctx.fill();
    else {
      ctx.rect(lx - legW / 2, ly, legW, legH);
      ctx.fill();
    }
  }

  ctx.restore();
}

function coatFillStyle(ctx, r, sex, variant) {
  const coat = variant?.coat;
  const stops = Array.isArray(coat?.stops) && coat.stops.length ? coat.stops : [sex === "female" ? "#f09ab0" : "#111"];
  if (stops.length === 1) return stops[0];

  const angle = typeof coat?.angle === "number" ? coat.angle : 0;
  const ax = Math.cos(angle);
  const ay = Math.sin(angle);
  const g = ctx.createLinearGradient(-ax * r, -ay * r, ax * r, ay * r);
  if (stops.length === 2) {
    g.addColorStop(0, stops[0]);
    g.addColorStop(1, stops[1]);
    return g;
  }
  g.addColorStop(0, stops[0]);
  g.addColorStop(0.5, stops[1]);
  g.addColorStop(1, stops[2] ?? stops[stops.length - 1]);
  return g;
}

function drawMacroCooldownArc(ctx, x, y, r, remaining, total, color = "rgba(0,0,0,0.45)") {
  const pct = clamp(total > 0 ? remaining / total : 0, 0, 1);
  if (pct <= 0) return;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.arc(x, y, r + 6, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2) * (1 - pct));
  ctx.stroke();
}

function drawHeartIcon(ctx, x, y, size, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(255,84,140,0.95)";
  ctx.beginPath();
  const s = size;
  ctx.moveTo(0, s * 0.35);
  ctx.bezierCurveTo(s * 0.8, -s * 0.25, s * 0.9, s * 0.8, 0, s * 1.2);
  ctx.bezierCurveTo(-s * 0.9, s * 0.8, -s * 0.8, -s * 0.25, 0, s * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawEatIcon(ctx, x, y, type, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";

  if (type === "milk") {
    ctx.fillStyle = "rgba(245,245,250,0.98)";
    ctx.beginPath();
    ctx.roundRect?.(-6, -10, 12, 18, 3);
    if (ctx.roundRect) ctx.fill();
    else {
      ctx.rect(-6, -10, 12, 18);
      ctx.fill();
    }
    ctx.stroke();
    ctx.fillStyle = "rgba(120,120,140,0.85)";
    ctx.beginPath();
    ctx.rect(-4, -13, 8, 3);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (type === "plant") {
    ctx.fillStyle = "rgba(67,160,71,0.95)";
    ctx.beginPath();
    ctx.ellipse(-4, 0, 8, 5, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(5, -1, 8, 5, 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-2, 6);
    ctx.lineTo(4, -10);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // meat
  ctx.fillStyle = "rgba(96,54,36,0.95)";
  ctx.beginPath();
  ctx.ellipse(4, 0, 10, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(245,240,235,0.95)";
  ctx.beginPath();
  ctx.ellipse(-8, -2.5, 4, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-8, 2.5, 4, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(-8, -2, 10, 4);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawMacroStats(ctx, macro, x, y) {
  if (!macro) return;
  if (macro.kind === "egg" || macro.kind === "nest") return;
  const hpMax = macro.hpMax ?? 0;
  if (!(hpMax > 0)) return;

  const isAnimal =
    macro.kind !== "plant" &&
    macro.kind !== "meat" &&
    macro.kind !== "egg" &&
    macro.kind !== "nest" &&
    macro.kind !== "rock" &&
    macro.kind !== "tree";
  const w = 58;
  const h = 6;
  const gap = 3;
  const x0 = x - w / 2;
  const y0 = y - macro.radius - 20;

  const hpPct = clamp((macro.hp ?? 0) / hpMax, 0, 1);
  const hasLife = (macro.lifeMaxSeconds ?? 0) > 0;
  const hungerPct = clamp((macro.hungerMax ?? 0) > 0 ? (macro.hunger ?? 0) / macro.hungerMax : 1, 0, 1);
  const lifePct = hasLife ? clamp((macro.lifeSeconds ?? 0) / macro.lifeMaxSeconds, 0, 1) : 0;

  const bars = [
    { pct: hpPct, color: "rgba(231,76,60,0.92)" },
    ...(isAnimal
      ? [
          {
            pct: hungerPct,
            color: "rgba(241,196,15,0.92)",
          },
        ]
      : []),
    ...(hasLife
      ? [
          {
            pct: lifePct,
            color: "rgba(210,210,210,0.92)",
          },
        ]
      : []),
  ];

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 1;

  const topY = y0 - (bars.length - 1) * (h + gap);
  for (let i = 0; i < bars.length; i++) {
    const by = topY + i * (h + gap);
    ctx.fillRect(x0, by, w, h);
    ctx.strokeRect(x0, by, w, h);
    ctx.fillStyle = bars[i].color;
    ctx.fillRect(x0, by, w * bars[i].pct, h);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
  }

  ctx.font = "11px system-ui, -apple-system, 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  const parts = [`体${Math.round(hpPct * 100)}%`];
  if (isAnimal) parts.push(`空${Math.round(hungerPct * 100)}%`);
  if (hasLife) parts.push(`寿${Math.round(lifePct * 100)}%`);
  ctx.fillText(parts.join(" "), x, y0 + 2);
  ctx.restore();
}

function drawMacroEntity(ctx, macro, { timeSeconds = 0, dtSeconds = 0, macroWorld = null, tileSize = 64 } = {}) {
  const { x, y, radius, kind } = macro;
  const eatT = macro?.eatFxSeconds ?? 0;
  const bounce = eatT > 0 ? Math.sin(clamp(1 - eatT / 0.45, 0, 1) * Math.PI) * radius * 0.22 : 0;
  const yy = y - bounce;

  if (kind === "rock") {
    drawMacroRock(ctx, x, yy, radius, macro.variant);
    return;
  }
  if (kind === "tree") {
    drawMacroTree(ctx, x, yy, radius, macro.variant);
    return;
  }
  if (kind === "meat") {
    drawMacroMeat(ctx, x, yy, radius, macro.variant);
    if ((macro.lifeSeconds ?? 0) > 0) {
      drawMacroCooldownArc(ctx, x, yy, radius, macro.lifeSeconds ?? 0, macro.lifeMaxSeconds ?? 1, "rgba(255,255,255,0.35)");
    }
    return;
  }
  if (kind === "plant") {
    if (!drawMacroPlantSprite(ctx, macro, x, yy)) {
      drawMacroPlant(ctx, x, yy, radius, macro.variant, macro.plantStage);
    }
    drawMacroStats(ctx, macro, x, yy);
    return;
  }
  if (kind === "nest") {
    drawMacroNest(ctx, x, yy, radius, macro.variant);
    return;
  }
  if (kind === "egg") {
    drawMacroEgg(ctx, x, yy, radius, macro);
    return;
  }

  // Render-only motion state (for sprite-sheet animation).
  macro._renderMotion = getMacroMotionState(macro, timeSeconds, dtSeconds, macroWorld, tileSize);

  const maturity = maturityFromMacro(macro);
  let v = macro.variant;
  if (macro.pregnant && v) {
    const t = clamp((Number(macro.pregnancySeconds) || 0) / 30, 0, 1);
    const baseX = Number(v.bodyScaleX) || 1;
    const baseY = Number(v.bodyScaleY) || 1;
    v = {
      ...v,
      bodyScaleX: clamp(baseX * (1 + 0.14 * t), 0.85, 1.8),
      bodyScaleY: clamp(baseY * (1 + 0.28 * t), 0.75, 2.0),
    };
  }
  if (kind === "largeHerbivore") {
    const drew = drawMacroCreatureSprite(ctx, macro, x, yy);
    if (!drew) {
      const vNoParts = v ? { ...v, tailCount: 0, hornCount: 0, wingCount: 0 } : v;
      drawMacroHerbivore(ctx, x, yy, radius, true, macro.sex, vNoParts, maturity);
    }
  } else if (kind === "smallHerbivore") {
    const drew = drawMacroCreatureSprite(ctx, macro, x, yy);
    if (!drew) {
      const vNoParts = v ? { ...v, tailCount: 0, hornCount: 0, wingCount: 0 } : v;
      drawMacroHerbivore(ctx, x, yy, radius, false, macro.sex, vNoParts, maturity);
    }
  } else {
    const drew = drawMacroCreatureSprite(ctx, macro, x, yy);
    if (!drew) {
      const vNoParts = v ? { ...v, tailCount: 0, hornCount: 0, wingCount: 0 } : v;
      drawMacroPredator(ctx, x, yy, radius, macro.sex, vNoParts, maturity);
    }
  }

  if ((macro.hitFxSeconds ?? 0) > 0) {
    const a = clamp(macro.hitFxSeconds / 0.25, 0, 1);
    const t = typeof performance !== "undefined" ? performance.now() : Date.now();
    const blink = 0.4 + 0.6 * Math.abs(Math.sin(t / 70));

    ctx.save();
    ctx.globalAlpha = 0.28 * a * blink;
    ctx.fillStyle = "rgba(255,70,70,0.95)";
    ctx.beginPath();
    ctx.arc(x, yy, radius * 1.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.strokeStyle = `rgba(255,90,90,${0.55 * a})`;
    ctx.lineWidth = 4;
    ctx.arc(x, yy, radius + 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawMacroCooldownArc(ctx, x, yy, radius, macro.attackCooldownSeconds ?? 0, 2);
  drawMacroStats(ctx, macro, x, yy);

  if (macro.heatActive) {
    drawHeartIcon(ctx, x + radius * 0.45, yy - radius - 34, 9, 0.95);
  }

  if (eatT > 0 && macro.eatFxType) {
    const a = clamp(eatT / 0.45, 0, 1);
    drawEatIcon(ctx, x - radius * 0.5, yy - radius - 34, macro.eatFxType, 0.85 * a);
  }
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this._microBg = { w: 0, h: 0, stars: [], canvas: null };
    this._microGalaxyLayer = { w: 0, h: 0, canvas: null, ctx: null, lastAt: 0, lastKey: "" };
    this._microPairsCache = { pairs: [], lastAt: 0, lastKey: "" };
    this._weatherFx = new WeatherFx();
    this._lastRenderAtSeconds = null;
    this._macroMotionCleanupAtSeconds = 0;
  }

  resizeToDisplaySize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const cw = Math.max(1, Math.floor(rect.width));
    const ch = Math.max(1, Math.floor(rect.height));
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (this._microBg.w !== cw || this._microBg.h !== ch) {
      const stars = buildMicroBgStars(cw, ch);
      let bgCanvas = null;
      if (typeof document !== "undefined") {
        bgCanvas = document.createElement("canvas");
        bgCanvas.width = cw;
        bgCanvas.height = ch;
        const bgCtx = bgCanvas.getContext("2d");
        if (bgCtx) drawMicroBgStars(bgCtx, stars);
      }
      this._microBg = { w: cw, h: ch, stars, canvas: bgCanvas };
    }

    if (this._microGalaxyLayer.w !== cw || this._microGalaxyLayer.h !== ch) {
      let layerCanvas = null;
      let layerCtx = null;
      if (typeof document !== "undefined") {
        layerCanvas = document.createElement("canvas");
        layerCanvas.width = cw;
        layerCanvas.height = ch;
        layerCtx = layerCanvas.getContext("2d");
      }
      this._microGalaxyLayer = { w: cw, h: ch, canvas: layerCanvas, ctx: layerCtx, lastAt: 0, lastKey: "" };
    }
  }

  render(scene, { paused }) {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const timeSeconds =
      typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() / 1000 : Date.now() / 1000;
    const prevAt = Number(this._lastRenderAtSeconds);
    const dtSeconds = Number.isFinite(prevAt) ? clamp(timeSeconds - prevAt, 0, 0.1) : 1 / 60;
    this._lastRenderAtSeconds = timeSeconds;

    ctx.clearRect(0, 0, w, h);
    fillBackground(ctx, w, h, scene.viewMode);

    ctx.save();
    ctx.globalAlpha = paused ? 0.85 : 1;
    if (scene.viewMode === "macro") {
      const camera = scene.macroCamera;
      const zoom = Number(camera?.zoom) > 0 ? Number(camera.zoom) : 1;
      const tileSize = scene.macroConfig?.tileSize ?? 64;
      const macroWorld = scene.macroWorld;
      const weatherKind = macroWorld && typeof macroWorld.getWeatherKind === "function" ? macroWorld.getWeatherKind() : macroWorld?._weatherKind;
      ctx.save();
      ctx.scale(zoom, zoom);
      ctx.translate(-camera.x, -camera.y);

      const viewW = w / zoom;
      const viewH = h / zoom;
      const dtFx = paused ? 0 : dtSeconds;
      if (this._weatherFx) {
        this._weatherFx.step(dtFx, weatherKind, {
          screenW: w,
          screenH: h,
          macroWorld,
          viewBoundsWorld: { left: camera.x, top: camera.y, right: camera.x + viewW, bottom: camera.y + viewH },
        });
      }
      drawMacroTiles(ctx, camera, tileSize, viewW, viewH, macroWorld, this._weatherFx);

      const margin = 120 / zoom;
      const left = camera.x - margin;
      const top = camera.y - margin;
      const right = camera.x + viewW + margin;
      const bottom = camera.y + viewH + margin;
      // Draw order: tiles < (nest/egg/plant/meat/obstacles) < animals
      // so animals look like they walk on top of nests/eggs.
      const animals = [];
      const others = [];
      for (const m of scene.macroWorld.entities) {
        const r = m.radius ?? 0;
        if (m.x + r < left || m.x - r > right || m.y + r < top || m.y - r > bottom) continue;
        const kind = m.kind;
        const isAnimal = kind === "largeHerbivore" || kind === "smallHerbivore" || kind === "predator";
        (isAnimal ? animals : others).push(m);
      }
      const dtAnim = paused ? 0 : dtSeconds;
      const drawOpts = { timeSeconds, dtSeconds: dtAnim, macroWorld, tileSize };
      for (const m of others) drawMacroEntity(ctx, m, drawOpts);
      for (const m of animals) drawMacroEntity(ctx, m, drawOpts);
      if (timeSeconds - (this._macroMotionCleanupAtSeconds ?? 0) > 2) {
        cleanupMacroMotionCache(timeSeconds, 15);
        this._macroMotionCleanupAtSeconds = timeSeconds;
      }

      if (this._weatherFx && typeof this._weatherFx.drawMacroWorldOverlay === "function") {
        this._weatherFx.drawMacroWorldOverlay(ctx);
      }
      ctx.restore();

      if (this._weatherFx && typeof this._weatherFx.drawScreenOverlay === "function") {
        this._weatherFx.drawScreenOverlay(ctx, weatherKind, { screenW: w, screenH: h });
      }

      if (scene.macroConfig?.minimapSize && camera) {
        drawMinimap(ctx, scene.macroWorld, camera, scene.macroConfig.minimapSize, w, h);
      }
    } else {
      const microWorld = scene.microWorld;
      const entities = Array.isArray(microWorld?.entities) ? microWorld.entities : [];
      const rituals =
        microWorld && typeof microWorld.getMergeRituals === "function"
          ? microWorld.getMergeRituals()
          : Array.isArray(microWorld?._mergeRituals)
            ? microWorld._mergeRituals
            : [];
      const reincRituals =
        microWorld && typeof microWorld.getReincarnateRituals === "function"
          ? microWorld.getReincarnateRituals()
          : Array.isArray(microWorld?._reincarnateRituals)
            ? microWorld._reincarnateRituals
            : [];
      const fx =
        microWorld && typeof microWorld.getMicroFx === "function"
          ? microWorld.getMicroFx()
          : Array.isArray(microWorld?._microFx)
            ? microWorld._microFx
            : [];
      const mergeCooldownSecondsRaw =
        microWorld && typeof microWorld.getMergeCooldownSeconds === "function"
          ? microWorld.getMergeCooldownSeconds()
          : Number(microWorld?._mergeCooldownSeconds);
      const mergeCooldownSeconds = clamp(Number(mergeCooldownSecondsRaw) || 20, 1, 30);
      const microStarScale = clamp(Number(scene.microStarScale) || 1, 0.6, 3.0);
      const microGalaxyStrength = clamp(Number(scene.microGalaxyStrength) || 0, 0, 1);
      const microGalaxyStartPct = clamp(Number(scene.microGalaxyStartPct) || 0.4, 0.1, 0.9);
      const maxIndividualsRaw =
        microWorld && typeof microWorld.getReincarnationIndividuals === "function"
          ? microWorld.getReincarnationIndividuals()
          : Number(microWorld?._reincarnationIndividuals);
      const maxIndividuals = Math.max(5, Math.min(100, Number(maxIndividualsRaw) || 30));
      const startCount = clamp(Math.floor(maxIndividuals * microGalaxyStartPct), 2, Math.max(2, maxIndividuals - 1));

      const bg = this._microBg?.canvas;
      if (bg) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(bg, 0, 0);
        ctx.restore();
      } else {
        drawMicroBgStars(ctx, this._microBg?.stars);
      }

      const linkRadiusPx = Math.min(w, h) * 0.25;
      const pairCache = this._microPairsCache;
      const pairKey = `${entities.length}|${Math.round(linkRadiusPx)}`;
      const pairInterval = 1 / 20;
      const shouldUpdatePairs = pairKey !== pairCache.lastKey || timeSeconds - (pairCache.lastAt || 0) >= pairInterval;
      if (shouldUpdatePairs) {
        pairCache.pairs = computeMicroMutualNearestPairs(entities, linkRadiusPx);
        pairCache.lastAt = timeSeconds;
        pairCache.lastKey = pairKey;
      }
      drawMicroConstellationPairs(ctx, pairCache.pairs, linkRadiusPx);

      drawMicroReincarnateRituals(ctx, reincRituals);

      const byId = new Map();
      const mergingIds = new Set();
      for (const e of entities) {
        if (!e) continue;
        byId.set(e.id, e);
      }
      for (const r of rituals) {
        if (!r) continue;
        if (r.aId != null) mergingIds.add(r.aId);
        if (r.bId != null) mergingIds.add(r.bId);
      }
      drawMicroMergeRituals(ctx, rituals, byId);

      const entityInfo = [];
      const galaxyList = [];
      for (const e of entities) {
        if (!e) continue;

        const onCooldown = typeof e.isOnCooldown === "function" ? e.isOnCooldown() : (Number(e.cooldownSeconds) || 0) > 0;
        const cooldown = onCooldown ? Number(e.cooldownSeconds) || 0 : 0;
        const pct = onCooldown ? clamp(cooldown / mergeCooldownSeconds, 0, 1) : 0;

        const count = Number(e.individualCount) || (Array.isArray(e.genes) ? e.genes.length : 1);
        const denom = Math.max(1, maxIndividuals - startCount);
        const galaxyProgress = clamp((count - startCount) / denom, 0, 1) * (1 - pct * 0.85);
        entityInfo.push({ e, onCooldown, pct, galaxyProgress });
        if (microGalaxyStrength > 0 && galaxyProgress > 0.001) galaxyList.push({ e, progress: galaxyProgress });
      }

      if (microGalaxyStrength > 0 && galaxyList.length) {
        const layer = this._microGalaxyLayer;
        const layerCtx = layer?.ctx;
        const layerCanvas = layer?.canvas;
        const galaxyCount = galaxyList.length;
        const maxAuras = 30;
        const quality = clamp(1 - Math.max(0, galaxyCount - 12) / 60, 0.35, 1);

        const key = `${microGalaxyStrength}|${microGalaxyStartPct}|${microStarScale}|${startCount}|${maxIndividuals}|g=${galaxyCount}`;
        let interval = 1 / 20;
        if (galaxyCount > maxAuras * 2) interval = 1 / 12;
        else if (galaxyCount > maxAuras) interval = 1 / 15;
        const shouldUpdate = key !== layer.lastKey || timeSeconds - (layer.lastAt || 0) >= interval;
        const needList = !layerCanvas || (layerCtx && layerCanvas && shouldUpdate);
        const drawList = needList
          ? galaxyCount > maxAuras
            ? [...galaxyList].sort((a, b) => (Number(b.progress) || 0) - (Number(a.progress) || 0)).slice(0, maxAuras)
            : galaxyList
          : null;
        if (layerCtx && layerCanvas && shouldUpdate) {
          layerCtx.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
          for (const item of drawList || []) {
            drawMicroGalaxyAura(layerCtx, item.e, {
              progress: item.progress,
              strength: microGalaxyStrength,
              timeSeconds,
              starScale: microStarScale,
              quality,
            });
          }
          layer.lastAt = timeSeconds;
          layer.lastKey = key;
        }
        if (layerCanvas) {
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.drawImage(layerCanvas, 0, 0);
          ctx.restore();
        } else {
          for (const item of drawList || []) {
            drawMicroGalaxyAura(ctx, item.e, {
              progress: item.progress,
              strength: microGalaxyStrength,
              timeSeconds,
              starScale: microStarScale,
              quality,
            });
          }
        }
      }

      for (const info of entityInfo) {
        const e = info.e;
        const onCooldown = info.onCooldown;
        const pct = info.pct;

        if (scene.microDebug) {
          ctx.save();
          ctx.translate(Number(e.x) || 0, Number(e.y) || 0);
          ctx.globalAlpha *= 0.92;
          drawCompositeEntity(ctx, e);
          ctx.restore();
        }

        const starSize = drawMicroStar(ctx, e, {
          merging: mergingIds.has(e.id),
          cooldownPct: pct,
          starScale: microStarScale,
        }) || 2.2;

        if (onCooldown) {
          const rr = 18 + starSize * 2.2;
          const cx = Number(e.x) || 0;
          const cy = Number(e.y) || 0;
          const progress = clamp(1 - pct, 0, 1);
          const a = -Math.PI / 2 + progress * Math.PI * 2;
          const sx = cx + Math.cos(a) * rr;
          const sy = cy + Math.sin(a) * rr;

          ctx.save();
          ctx.globalCompositeOperation = "lighter";

          // Orbit ring (thin) + a small satellite dot that makes one full rotation over the cooldown.
          ctx.beginPath();
          ctx.strokeStyle = "rgba(180,210,255,0.22)";
          ctx.lineWidth = 1.4;
          ctx.arc(cx, cy, rr, 0, Math.PI * 2);
          ctx.stroke();

          const satR = 1.6 + 0.7 * (1 - pct);
          ctx.fillStyle = "rgba(235,250,255,0.78)";
          ctx.beginPath();
          ctx.arc(sx, sy, satR, 0, Math.PI * 2);
          ctx.fill();

          ctx.restore();
        }
      }

      drawMicroFx(ctx, fx);
    }
    ctx.restore();
  }
}
