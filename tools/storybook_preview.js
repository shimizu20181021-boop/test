/*
  Storybook creature preview (WebGL + PNG)
  - Preview only (not wired into the main game yet)
  - Requires running via a local server (VS Code Live Server etc.)
*/

const DESIGNS = [
  { id: "herb_pig", label: "草食（ブタ）" },
  { id: "herb_horse", label: "草食（ウマ）" },
  { id: "herb_zebra", label: "草食（シマウマ）" },
  { id: "herb_pigeon", label: "草食（ハト）" },
  { id: "omn_mouse", label: "雑食（ネズミ）" },
  { id: "omn_boar", label: "雑食（イノシシ）" },
  { id: "omn_crow", label: "雑食（カラス）" },
  { id: "omn_cat", label: "雑食（ネコ）" },
  { id: "pred_wolf", label: "肉食（オオカミ）" },
  { id: "pred_bear", label: "肉食（クマ）" },
  { id: "pred_raccoon", label: "肉食（アライグマ）" },
  { id: "pred_lion", label: "肉食（ライオン）" },
  { id: "pred_owl", label: "肉食（フクロウ）" },
];

const ASSET_BASE = "./assets/storybook/creatures_png";
const SAMPLE_BASE = "./assets/sample";
const ANIM_BASE = "./assets/アニメーション";
const CACHE_BUST = String(Date.now());

// 移動（歩行/飛行）スプライトシート（7フレーム）
// NOTE: ここでは「素材確認用」のため、ディレクトリ名の日本語をそのまま使用します。
const MOVE_ANIM_BY_DESIGN = {
  herb_pig: { dietDir: "草食", species: "豚" },
  herb_horse: { dietDir: "草食", species: "馬" },
  herb_zebra: { dietDir: "草食", species: "シマウマ" },
  herb_pigeon: { dietDir: "草食", species: "ハト" },

  omn_mouse: { dietDir: "雑食", species: "ネズミ" },
  omn_boar: { dietDir: "雑食", species: "イノシシ" },
  omn_crow: { dietDir: "雑食", species: "カラス" },
  omn_cat: { dietDir: "草食", species: "猫" },
  pred_raccoon: { dietDir: "雑食", species: "アライグマ" },

  pred_wolf: { dietDir: "肉食", species: "オオカミ" },
  pred_bear: { dietDir: "肉食", species: "クマ" },
  pred_owl: { dietDir: "肉食", species: "フクロウ" },
  pred_lion: { dietDir: "肉食", species: "ライオン" },
};

const STAGE_JP = {
  baby: "赤ちゃん",
  child: "子供",
  young: "若大人",
  adult: "大人",
};

// 攻撃アニメ（現状はライオンのみ）
const ATTACK_ANIM_BY_DESIGN = {
  pred_lion: { dietDir: "肉食", species: "ライオン" },
  pred_owl: { dietDir: "肉食", species: "フクロウ" },
  pred_wolf: { dietDir: "肉食", species: "オオカミ" },
  pred_bear: { dietDir: "肉食", species: "クマ" },
};

const EAT_ANIM_BY_DESIGN = {
  herb_pig: { dietDir: "草食", species: "豚" },
  herb_horse: { dietDir: "草食", species: "馬" },
  herb_zebra: { dietDir: "草食", species: "シマウマ" },
  herb_pigeon: { dietDir: "草食", species: "ハト" },

  omn_mouse: { dietDir: "雑食", species: "ネズミ" },
  omn_boar: { dietDir: "雑食", species: "イノシシ" },
  omn_crow: { dietDir: "雑食", species: "カラス" },
  omn_cat: { dietDir: "草食", species: "猫" },
  pred_raccoon: { dietDir: "雑食", species: "アライグマ" },

  pred_wolf: { dietDir: "肉食", species: "オオカミ" },
  pred_bear: { dietDir: "肉食", species: "クマ" },
  pred_owl: { dietDir: "肉食", species: "フクロウ" },
  pred_lion: { dietDir: "肉食", species: "ライオン" },
};

function moveAnimSheetUrl(designId, sex, stage) {
  const id = String(designId || "");
  const spec = MOVE_ANIM_BY_DESIGN[id];
  if (!spec) return "";
  const sexJp = String(sex || "male") === "female" ? "雌" : "雄";
  const stageJp = STAGE_JP[String(stage || "adult")] || STAGE_JP.adult;
  const sp = String(spec.species || "");
  const dd = String(spec.dietDir || "");
  if (!sp || !dd) return "";
  return `${ANIM_BASE}/${dd}/${sp}/移動/${sp}${sexJp}_${stageJp}.png?v=${encodeURIComponent(CACHE_BUST)}`;
}

function attackAnimSheetUrl(designId, sex, stage) {
  const id = String(designId || "");
  const spec = ATTACK_ANIM_BY_DESIGN[id];
  if (!spec) return "";

  const st = String(stage || "adult");
  if (st !== "young" && st !== "adult") return "";

  const sexJp = String(sex || "male") === "female" ? "雌" : "雄";
  const stageJp = STAGE_JP[st] || STAGE_JP.adult;
  const sp = String(spec.species || "");
  const dd = String(spec.dietDir || "");
  if (!sp || !dd) return "";

  return `${ANIM_BASE}/${dd}/${sp}/攻撃/${sp}${sexJp}_${stageJp}.png?v=${encodeURIComponent(CACHE_BUST)}`;
}

function eatAnimSheetUrl(designId, sex, stage) {
  const id = String(designId || "");
  const spec = EAT_ANIM_BY_DESIGN[id];
  if (!spec) return "";

  const sexJp = String(sex || "male") === "female" ? "雌" : "雄";
  const stageJp = STAGE_JP[String(stage || "adult")] || STAGE_JP.adult;
  const sp = String(spec.species || "");
  const dd = String(spec.dietDir || "");
  if (!sp || !dd) return "";

  return `${ANIM_BASE}/${dd}/${sp}/食事/${sp}${sexJp}_${stageJp}.png?v=${encodeURIComponent(CACHE_BUST)}`;
}

const PART_SETS = {
  horn: { dir: "ツノ", prefix: "ツノ", count: 3, label: "ツノ" },
  wing: { dir: "羽", prefix: "羽", count: 3, label: "羽" },
};
const PLANT_SET = { dir: "植物", label: "植物" };
const PLANT_VARIANTS = [
  { id: "1", label: "Lv1 植物1", stillFile: "植物1.png", animFile: "Lv1_植物_1.png" },
  { id: "2", label: "Lv1 植物2", stillFile: "植物2.png", animFile: "Lv1_植物_2.png" },
  { id: "3", label: "Lv1 植物3", stillFile: "植物3.png", animFile: "Lv1_植物_3.png" },
  { id: "4", label: "Lv1 植物4", stillFile: "植物4.png", animFile: "Lv1_植物_4.png" },
  { id: "5", label: "Lv1 植物5", stillFile: "植物5.png", animFile: "Lv1_植物_5.png" },
  { id: "6", label: "Lv2 植物6", stillFile: "植物6.png", animFile: "Lv2_植物_6.png" },
  { id: "7", label: "Lv2 植物7", stillFile: "植物7.png", animFile: "Lv2_植物_7.png" },
  { id: "8", label: "Lv2 植物8", stillFile: "植物8.png", animFile: "Lv2_植物_8.png" },
  { id: "9", label: "Lv2 植物9", stillFile: "植物9.png", animFile: "Lv2_植物_9.png" },
  { id: "10", label: "Lv2 植物10", stillFile: "植物10.png", animFile: "Lv2_植物_10.png" },
  { id: "11", label: "Lv3 植物11", stillFile: "植物11.png", animFile: "Lv3_植物_11.png" },
  { id: "12", label: "Lv3 植物12", stillFile: "植物12.png", animFile: "Lv3_植物_12.png" },
  { id: "13", label: "Lv3 植物13", stillFile: "植物13.png", animFile: "Lv3_植物_13.png" },
  { id: "14", label: "Lv3 植物14", stillFile: "植物14.png", animFile: "Lv3_植物_14.png" },
  { id: "15", label: "Lv3 植物15", stillFile: "植物15.png", animFile: "Lv3_植物_15.png" },
  { id: "500", label: "Lv4 植物500", stillFile: "植物500.png", animFile: "Lv_4_植物500.png", drawScale: 1.2 },
  { id: "1000", label: "Lv5 植物1000", stillFile: "植物1000.png", animFile: "Lv_5_植物1000.png", drawScale: 1.2 },
];
const PLANT_VARIANT_BY_ID = new Map(PLANT_VARIANTS.map((spec) => [String(spec.id), spec]));
const DEFAULT_PLANT_VARIANT_ID = String(PLANT_VARIANTS[0]?.id || "1");
const PLANT_ANIM_SET = { dir: "植物", frameCount: 5 };
const PLANT_STAGE_SET = [
  { id: "bud", label: "芽", file: "芽.png" },
  { id: "stem", label: "茎", file: "茎.png" },
];
const PLANT_ANIM_FPS = 1.6;
const PLANT_ANIM_SEARCH_RADIUS = 96;

const DEFAULT_TINT = [1, 1, 1];
const DEFAULT_PAPER = 1.0;
const BASE_SCALE = 0.92;

const FACE_MARKS_BY_DESIGN = {
  herb_pig: { mouth: { u: 0.18, v: 0.56 } },
  default: { mouth: { u: 0.18, v: 0.56 } },
};

function faceMarksFor(designId) {
  const id = String(designId || "");
  return FACE_MARKS_BY_DESIGN[id] || FACE_MARKS_BY_DESIGN.default;
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function clampInt(value, min, max) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function fmt2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0.00";
  return x.toFixed(2);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function assetUrl(designId, sex, stage) {
  const sid = String(designId || "");
  const s = String(sex || "male");
  const st = String(stage || "adult");
  return `${ASSET_BASE}/${sid}/${s}_${st}.png?v=${encodeURIComponent(CACHE_BUST)}`;
}

function sampleAssetUrl(dir, filename) {
  const d = String(dir || "");
  const f = String(filename || "");
  return `${SAMPLE_BASE}/${d}/${f}?v=${encodeURIComponent(CACHE_BUST)}`;
}

function partAssetUrl(kind, idx) {
  const k = String(kind || "");
  const n = clampInt(idx, 1, 9999);
  const set = PART_SETS[k];
  if (!set) return "";
  return sampleAssetUrl(set.dir, `${set.prefix}${n}.png`);
}

function plantVariantSpec(variantId) {
  const key = String(variantId ?? "");
  return PLANT_VARIANT_BY_ID.get(key) || PLANT_VARIANT_BY_ID.get(DEFAULT_PLANT_VARIANT_ID) || null;
}

function normalizePlantVariantId(variantId) {
  const spec = plantVariantSpec(variantId);
  return String(spec?.id || DEFAULT_PLANT_VARIANT_ID);
}

function randomPlantVariantId() {
  const spec = PLANT_VARIANTS[Math.floor(Math.random() * PLANT_VARIANTS.length)];
  return String(spec?.id || DEFAULT_PLANT_VARIANT_ID);
}

function plantAssetUrl(variantId) {
  const spec = plantVariantSpec(variantId);
  if (!spec) return "";
  return sampleAssetUrl(PLANT_SET.dir, spec.stillFile);
}

function plantAnimSheetUrl(variantId) {
  const spec = plantVariantSpec(variantId);
  if (!spec) return "";
  return `${ANIM_BASE}/${PLANT_ANIM_SET.dir}/${encodeURIComponent(spec.animFile)}?v=${encodeURIComponent(CACHE_BUST)}`;
}

function plantVariantDrawScale(variantId) {
  const spec = plantVariantSpec(variantId);
  return clampNumber(spec?.drawScale ?? 1, 0.5, 1.5);
}

function plantStageAssetUrl(stageId) {
  const id = String(stageId || "");
  const spec = PLANT_STAGE_SET.find((x) => x.id === id);
  if (!spec) return "";
  return sampleAssetUrl(PLANT_SET.dir, spec.file);
}

function plantStageAnimSheetUrl(stageId) {
  const id = String(stageId || "");
  const spec = PLANT_STAGE_SET.find((x) => x.id === id);
  if (!spec) return "";
  return `${ANIM_BASE}/${PLANT_ANIM_SET.dir}/${encodeURIComponent(spec.file)}?v=${encodeURIComponent(CACHE_BUST)}`;
}

function makePlantVariantPreviewSpec(idx) {
  const spec = plantVariantSpec(idx);
  if (!spec) return null;
  return {
    id: `plant_${spec.id}`,
    label: spec.label,
    stillUrl: plantAssetUrl(spec.id),
    animUrl: plantAnimSheetUrl(spec.id),
    drawScale: plantVariantDrawScale(spec.id),
  };
}

function makePlantStagePreviewSpec(stageId) {
  const id = String(stageId || "");
  const spec = PLANT_STAGE_SET.find((x) => x.id === id);
  if (!spec) return null;
  return {
    id: `plant_stage_${spec.id}`,
    label: spec.label,
    stillUrl: plantStageAssetUrl(spec.id),
    animUrl: plantStageAnimSheetUrl(spec.id),
  };
}

const keyedDrawableCache = new Map();
function loadKeyedDrawable(url, { bgThreshold = 210, chromaThreshold = 18 } = {}) {
  const u = String(url || "");
  const key = `${u}|bg=${bgThreshold}|ch=${chromaThreshold}`;
  if (keyedDrawableCache.has(key)) return keyedDrawableCache.get(key);

  const p = loadImage(u).then((img) => {
    const w = Math.max(1, Number(img.naturalWidth || img.width || 1));
    const h = Math.max(1, Number(img.naturalHeight || img.height || 1));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return img;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const im = ctx.getImageData(0, 0, w, h);
    const d = im.data;

    const pxCount = w * h;
    const seen = new Uint8Array(pxCount);
    const queue = [];
    queue.length = 0;

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

    // seed: edge pixels only (prevents eating into bright/neutral highlights inside the object)
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
    return c;
  });

  keyedDrawableCache.set(key, p);
  return p;
}

const darkKeyedDrawableCache = new Map();
function loadDarkKeyedDrawable(url, { bgMaxThreshold = 12, chromaThreshold = 18 } = {}) {
  const u = String(url || "");
  const key = `${u}|dark|max=${bgMaxThreshold}|ch=${chromaThreshold}`;
  if (darkKeyedDrawableCache.has(key)) return darkKeyedDrawableCache.get(key);

  const p = loadImage(u).then((img) => {
    const w = Math.max(1, Number(img.naturalWidth || img.width || 1));
    const h = Math.max(1, Number(img.naturalHeight || img.height || 1));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return img;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const im = ctx.getImageData(0, 0, w, h);
    const d = im.data;

    const pxCount = w * h;
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
      if (max > bgMaxThreshold) return false;
      const min = r < g ? (r < b ? r : b) : g < b ? g : b;
      const chroma = max - min;
      return chroma <= chromaThreshold;
    };

    const pushIf = (p0) => {
      if (p0 < 0 || p0 >= pxCount) return;
      if (seen[p0]) return;
      if (!isCandidate(p0)) return;
      seen[p0] = 1;
      d[p0 * 4 + 3] = 0;
      queue.push(p0);
    };

    // seed: edge pixels only (prevents eating into dark details inside the object)
    for (let x = 0; x < w; x++) {
      pushIf(x);
      pushIf((h - 1) * w + x);
    }
    for (let y = 1; y < h - 1; y++) {
      pushIf(y * w);
      pushIf(y * w + (w - 1));
    }

    for (let qi = 0; qi < queue.length; qi++) {
      const p0 = queue[qi];
      const x = p0 % w;
      const y = (p0 / w) | 0;
      if (x > 0) pushIf(p0 - 1);
      if (x < w - 1) pushIf(p0 + 1);
      if (y > 0) pushIf(p0 - w);
      if (y < h - 1) pushIf(p0 + w);
    }
    ctx.putImageData(im, 0, 0);
    return c;
  });

  darkKeyedDrawableCache.set(key, p);
  return p;
}

function loadDrawable(url, { keyBg = false } = {}) {
  return keyBg ? loadKeyedDrawable(url) : loadImage(url);
}

const spriteSheetFramesCache = new Map();
function loadSpriteSheetFrames(
  url,
  {
    frameCount = 4,
    targetSize = 512,
    alphaThreshold = 8,
    paddingPct = 0.1,
    bgMaxThreshold = 12,
    chromaThreshold = 18,
    searchRadiusPx = 260,
    splitMode = "auto", // "auto" | "equal"
  } = {},
) {
  const u = String(url || "");
  if (!u) return Promise.resolve(null);
  const fc = clampInt(frameCount, 1, 16);
  const mode = splitMode === "equal" ? "equal" : "auto";
  const key = `${u}|fc=${fc}|ts=${targetSize}|a=${alphaThreshold}|pad=${paddingPct}|bgMax=${bgMaxThreshold}|ch=${chromaThreshold}|sr=${searchRadiusPx}|m=${mode}`;
  if (spriteSheetFramesCache.has(key)) return spriteSheetFramesCache.get(key);

  const p = loadDarkKeyedDrawable(u, { bgMaxThreshold, chromaThreshold }).then((sheet0) => {
    if (!sheet0 || typeof document === "undefined") return null;

    const { w: sw, h: sh } = drawableSize(sheet0);
    if (!(sw > 0 && sh > 0)) return null;

    const tmp = document.createElement("canvas");
    tmp.width = sw;
    tmp.height = sh;
    const tctx = tmp.getContext("2d", { willReadFrequently: true });
    if (!tctx) return null;
    tctx.clearRect(0, 0, sw, sh);
    tctx.drawImage(sheet0, 0, 0);

    const im = tctx.getImageData(0, 0, sw, sh);
    const d = im.data;

    // Additional background keying for "non-dark" sprite sheets (e.g. gray gradient backdrops).
    // IMPORTANT: Only run this when the edges are still mostly opaque after dark-keying.
    // Otherwise (e.g. black BG already removed), edge-touching subjects like birds can be erased.
    const shouldBrightKey = (() => {
      const step = 4;
      let total = 0;
      let opaque = 0;
      const aThr = clampInt(alphaThreshold, 0, 255);
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
      // Heuristic: if >~12% of edge samples are opaque, the background wasn't dark-keyed away.
      return ratio > 0.12;
    })();

    if (shouldBrightKey) {
      const bgThreshold = 40;
      const pxCount = sw * sh;
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
        const chroma = max - min;
        return chroma <= chromaThreshold;
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

    // Write back keying results so downstream drawImage uses the keyed pixels.
    if (shouldBrightKey) tctx.putImageData(im, 0, 0);

    const countColumnAlpha = (x) => {
      const xx = clampInt(x, 0, sw - 1);
      let c = 0;
      for (let y = 0; y < sh; y += 2) {
        const a = d[(y * sw + xx) * 4 + 3];
        if (a > alphaThreshold) c++;
      }
      return c;
    };

    const counts = new Int32Array(sw);
    let maxCount = 0;
    for (let x = 0; x < sw; x++) {
      const c = countColumnAlpha(x);
      counts[x] = c;
      if (c > maxCount) maxCount = c;
    }

    const getCutsAuto = () => {
      if (!(fc >= 2)) return [];

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

      const cuts = [];
      let prev = 0;
      for (let i = 1; i < fc; i++) {
        const center = Math.round((sw * i) / fc);
        const start = clampInt(center - searchRadiusPx, prev + 10, sw - 2);
        const end = clampInt(center + searchRadiusPx, start + 10, sw - 2);
        const cut = findBestValley(start, end, center);
        cuts.push(cut);
        prev = cut;
      }
      // ensure strictly increasing & in bounds
      for (let i = 0; i < cuts.length; i++) {
        const min = i === 0 ? 5 : cuts[i - 1] + 10;
        const max = sw - 6;
        cuts[i] = clampInt(cuts[i], min, max);
      }
      return cuts;
    };

    const getCutsEqual = () => {
      // Use rounded boundaries so the remainder is distributed.
      const cuts = [];
      for (let i = 1; i < fc; i++) {
        const boundary = Math.round((sw * i) / fc);
        cuts.push(boundary - 1);
      }
      // ensure strictly increasing & in bounds (same policy as auto)
      for (let i = 0; i < cuts.length; i++) {
        const min = i === 0 ? 5 : cuts[i - 1] + 10;
        const max = sw - 6;
        cuts[i] = clampInt(cuts[i], min, max);
      }
      return cuts.map((x) => clampInt(x, 0, sw - 2));
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

      const x0 = seg.x0;
      const x1 = seg.x1;
      const scanX0 = x0;
      const scanX1 = x1;

      let minX = scanX1;
      let minY = sh - 1;
      let maxX = scanX0;
      let maxY = 0;
      let found = false;

      for (let y = 0; y < sh; y++) {
        let row = (y * sw + scanX0) * 4;
        for (let x = scanX0; x <= scanX1; x++) {
          const a = d[row + 3];
          if (a > alphaThreshold) {
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
      else bounds.push({ minX: minX - x0, maxX: maxX - x0, minY, maxY });
    }

    const valid = bounds.filter(Boolean);
    if (!valid.length) return null;

    const outSize = Math.max(0, Math.round(Number(targetSize) || 0));
    const frames = new Array(fc);
    for (let fi = 0; fi < fc; fi++) {
      const seg = segments[fi];
      const b = bounds[fi];
      if (!seg || !b) {
        frames[fi] = null;
        continue;
      }

      const segW = Math.max(1, seg.x1 - seg.x0 + 1);
      const bw = Math.max(1, b.maxX - b.minX + 1);
      const bh = Math.max(1, b.maxY - b.minY + 1);
      const pad = Math.max(0, Math.round(Math.max(bw, bh) * clampNumber(paddingPct, 0, 0.5)));

      const minCropX = 0;
      const maxCropX = Math.max(minCropX, segW - 1);

      const cropX0 = clampInt(b.minX - pad, minCropX, maxCropX);
      const cropX1 = clampInt(b.maxX + pad, minCropX, maxCropX);
      const cropY0 = clampInt(b.minY - pad, 0, sh - 1);
      const cropY1 = clampInt(b.maxY + pad, 0, sh - 1);

      const cropW = Math.max(1, cropX1 - cropX0 + 1);
      const cropH = Math.max(1, cropY1 - cropY0 + 1);
      const srcX = seg.x0 + cropX0;
      const srcY = cropY0;

      const c = document.createElement("canvas");
      const dstSize = outSize > 0 ? outSize : cropW;
      c.width = dstSize;
      c.height = outSize > 0 ? outSize : cropH;
      const cctx = c.getContext("2d");
      if (!cctx) {
        frames[fi] = c;
        continue;
      }
      cctx.clearRect(0, 0, c.width, c.height);

      if (outSize > 0) {
        const outerPad = Math.round(dstSize * 0.04);
        const availW = Math.max(1, dstSize - 2 * outerPad);
        const availH = Math.max(1, dstSize - 2 * outerPad);
        const scale = Math.max(0.0001, Math.min(availW / cropW, availH / cropH));
        const dw = Math.max(1, Math.round(cropW * scale));
        const dh = Math.max(1, Math.round(cropH * scale));
        const dx = Math.round((dstSize - dw) / 2);
        const dy = Math.round((dstSize - dh) / 2);
        cctx.drawImage(tmp, srcX, srcY, cropW, cropH, dx, dy, dw, dh);
      } else {
        cctx.drawImage(tmp, srcX, srcY, cropW, cropH, 0, 0, cropW, cropH);
      }

      frames[fi] = c;
    }

    return { frames, frameCount: fc, url: u };
  });

  spriteSheetFramesCache.set(key, p);
  return p;
}

function drawableSize(drawable) {
  if (!drawable) return { w: 1, h: 1 };
  const w = Math.max(1, Number(drawable.naturalWidth || drawable.width || 1));
  const h = Math.max(1, Number(drawable.naturalHeight || drawable.height || 1));
  return { w, h };
}

function drawContained(ctx, drawable, x, y, w, h) {
  if (!ctx || !drawable) return;
  const sz = drawableSize(drawable);
  const s = Math.min(w / sz.w, h / sz.h);
  const dw = sz.w * s;
  const dh = sz.h * s;
  ctx.drawImage(drawable, x + (w - dw) * 0.5, y + (h - dh) * 0.5, dw, dh);
}

function drawOverlayPart2d(ctx, drawable, { cx = 0, cy = 0, width = 0, alpha = 1 } = {}) {
  if (!ctx || !drawable) return;
  const w = Math.max(0, Number(width) || 0);
  if (w <= 0) return;
  const sz = drawableSize(drawable);
  const h = (w * sz.h) / Math.max(1, sz.w);
  ctx.save();
  ctx.globalAlpha *= clampNumber(alpha, 0, 1);
  ctx.drawImage(drawable, cx - w * 0.5, cy - h * 0.5, w, h);
  ctx.restore();
}

const imageCache = new Map();
function loadImage(url) {
  const u = String(url || "");
  if (imageCache.has(u)) return imageCache.get(u);

  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`画像が読み込めません: ${u}`));
    img.src = u;
  });

  imageCache.set(u, p);
  return p;
}

function createShader(gl, type, source) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const msg = gl.getShaderInfoLog(sh) || "shader compile error";
    gl.deleteShader(sh);
    throw new Error(msg);
  }
  return sh;
}

function createProgram(gl, vsSource, fsSource) {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const msg = gl.getProgramInfoLog(prog) || "program link error";
    gl.deleteProgram(prog);
    throw new Error(msg);
  }
  return prog;
}

function resizeCanvasToDisplaySize(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    return true;
  }
  return false;
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function randomTintFor(_designId) {
  return [1, 1, 1];
}

function isHerbDesign(designId) {
  const id = String(designId || "");
  return id.startsWith("herb_");
}

function isOmniDesign(designId) {
  const id = String(designId || "");
  return id.startsWith("omn_");
}

function foodKindForDesign(designId) {
  if (isHerbDesign(designId)) return "plant";
  if (isOmniDesign(designId)) return Math.random() < 0.7 ? "plant" : "meat";
  return "meat";
}

class WebglSpriteCard {
  constructor({ canvas, label, id }) {
    this.canvas = canvas;
    this.label = String(label || "");
    this.id = String(id || "");

    const gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true });
    this.gl = gl;
    this.ok = Boolean(gl);

    this.texture = null;
    this.currentUrl = null;
    this.pendingUrl = null;
    this.texW = 1;
    this.texH = 1;
    this.tint = [...DEFAULT_TINT];
    this.paper = DEFAULT_PAPER;
    this.seed = Math.random() * 9999;

    if (!this.ok) return;

    const vs = `
      attribute vec2 aPos;
      attribute vec2 aUv;
      uniform float uZoom;
      uniform float uBaseScale;
      uniform vec2 uFitScale;
      varying vec2 vUv;
      void main() {
        vec2 pos = aPos * (uBaseScale * uZoom) * uFitScale;
        gl_Position = vec4(pos, 0.0, 1.0);
        vUv = aUv;
      }
    `;

    const fs = `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uTex;
      uniform vec3 uTint;
      uniform float uPaper;
      uniform float uSeed;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      }

      void main() {
        vec4 t = texture2D(uTex, vUv);
        if (t.a < 0.01) discard;

        vec3 c = t.rgb * uTint;

        // storybook-ish grain
        float n = hash(gl_FragCoord.xy + vec2(uSeed, uSeed * 0.37));
        c *= (0.94 + 0.10 * n * uPaper);

        // gentle warm paper lift
        vec3 paper = vec3(1.0, 0.985, 0.95);
        c = mix(c, c * paper, 0.08 * uPaper);

        gl_FragColor = vec4(c, t.a);
      }
    `;

    this.program = createProgram(gl, vs, fs);

    this.aPos = gl.getAttribLocation(this.program, "aPos");
    this.aUv = gl.getAttribLocation(this.program, "aUv");
    this.uTex = gl.getUniformLocation(this.program, "uTex");
    this.uZoom = gl.getUniformLocation(this.program, "uZoom");
    this.uBaseScale = gl.getUniformLocation(this.program, "uBaseScale");
    this.uFitScale = gl.getUniformLocation(this.program, "uFitScale");
    this.uTint = gl.getUniformLocation(this.program, "uTint");
    this.uPaper = gl.getUniformLocation(this.program, "uPaper");
    this.uSeed = gl.getUniformLocation(this.program, "uSeed");

    const verts = new Float32Array([
      // x, y, u, v
      -1, -1, 0, 1,
      1, -1, 1, 1,
      1, 1, 1, 0,
      -1, 1, 0, 0,
    ]);
    const idx = new Uint16Array([0, 1, 2, 0, 2, 3]);

    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  async setTextureUrl(url) {
    if (!this.ok) return;
    const u = String(url || "");
    if (u === this.currentUrl) return;

    this.pendingUrl = u;

    const img = await loadImage(u);
    if (this.pendingUrl !== u) return;

    this.texW = Math.max(1, Number(img.naturalWidth) || Number(img.width) || 1);
    this.texH = Math.max(1, Number(img.naturalHeight) || Number(img.height) || 1);

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // Our quad UVs are already "top-left origin" (v=0 at top), so don't flip.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.currentUrl = u;
  }

  draw({ zoom = 1 } = {}) {
    if (!this.ok) return;

    resizeCanvasToDisplaySize(this.canvas);

    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);

    gl.enableVertexAttribArray(this.aPos);
    gl.enableVertexAttribArray(this.aUv);

    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, 16, 8);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    gl.uniform1i(this.uTex, 0);
    gl.uniform1f(this.uZoom, clampNumber(zoom, 0.35, 3.0));
    gl.uniform1f(this.uBaseScale, BASE_SCALE);
    // Preserve texture aspect ratio inside the (often square) canvas.
    const cAsp = this.canvas.width / this.canvas.height;
    const tAsp = this.texW / this.texH;
    let sx = 1;
    let sy = 1;
    if (tAsp > cAsp) {
      sy = cAsp / tAsp;
    } else if (tAsp < cAsp) {
      sx = tAsp / cAsp;
    }
    gl.uniform2f(this.uFitScale, sx, sy);
    gl.uniform3f(this.uTint, this.tint[0], this.tint[1], this.tint[2]);
    gl.uniform1f(this.uPaper, this.paper);
    gl.uniform1f(this.uSeed, this.seed);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    gl.bindTexture(gl.TEXTURE_2D, null);
  }
}

class SimpleSim {
  constructor({ canvas, selectedEl, statusEl }) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext?.("2d", { alpha: true }) || null;
    this.selectedEl = selectedEl || null;
    this.statusEl = statusEl || null;

    this.designId = "";
    this.designLabel = "";
    this.sex = "male";
    this.stage = "adult";

    this.spriteUrl = "";
    this.spriteImg = null;
    this.walkSheetUrl = "";
    this.walkFrames = null;
    this.walkFramesLoading = null;
    this.eatSheetUrl = "";
    this.eatFrames = null;
    this.eatFramesLoading = null;
    this.attackSheetUrl = "";
    this.attackFrames = null;
    this.attackFramesLoading = null;

    // overlay parts + plants (from assets/sample)
    this.keyBg = true;
    this.parts = { horn: 0, wing: 0 };
    this.partUrls = { horn: "", wing: "" };
    this.partDrawables = { horn: null, wing: null };
    this.partLoading = { horn: null, wing: null };

    this.plantMode = "random"; // "random" or plant variant id
    this.plantDrawables = new Map(); // idx -> drawable
    this.plantLoading = new Map(); // idx -> Promise

    // plant animations (7-frame sprite sheets; variant-based cache)
    this.plantAnimFrames = new Map(); // idx -> frames[]
    this.plantAnimLoading = new Map(); // idx -> Promise

    // top-down world (survival-game-ish) preview
    this.tileSize = 64;
    this.worldTilesW = 40;
    this.worldTilesH = 26;
    this.worldW = this.tileSize * this.worldTilesW;
    this.worldH = this.tileSize * this.worldTilesH;

    this.camX = this.worldW * 0.5;
    this.camY = this.worldH * 0.5;
    this.camZoom = 0.75;
    this.followCamera = true;

    this.time = 0;
    this.lastTs = 0;
    this.running = false;

    // manual demo mode (for preview)
    this.attackMode = false;
    this.attackAnimT = 0;

    this.reset();
  }

  reset() {
    this.hunger = 1.0;
    this.state = "wander"; // wander | seek_food | eat
    this.stateT = 0;
    this.eatFxT = 0;
    this.posX = 0;
    this.posY = 0;
    this.velX = 0;
    this.velY = 0;
    this.goalX = null;
    this.goalY = null;
    this.goalCooldownT = 0;
    this.targetFoodIdx = -1;
    this.foods = [];
    this.lastEatKind = "plant";

    // simple "life" animations
    this.walkPhase = 0;
    this.facing = -1; // -1: left (default PNG direction), +1: right
    this.chewPhase = 0;
    this.chewFxT = 0;

    this.attackMode = false;
    this.attackAnimT = 0;

    this._ensureInitialPosition();
    this._renderStatus();
  }

  _ensureInitialPosition() {
    const ctx = this.ctx;
    if (!ctx) return;
    this.posX = this.worldW * 0.5;
    this.posY = this.worldH * 0.5;
    this.camX = this.posX;
    this.camY = this.posY;
  }

  setSelection({ designId, designLabel }) {
    this.designId = String(designId || "");
    this.designLabel = String(designLabel || "");
    if (this.selectedEl) {
      this.selectedEl.textContent = this.designLabel ? `：${this.designLabel}（${this.designId}）` : "（未選択）";
    }
    this._syncSprite();
  }

  setAppearance({ sex, stage }) {
    if (sex) this.sex = String(sex);
    if (stage) this.stage = String(stage);
    this._syncSprite();
  }

  setAttackMode(enabled) {
    const on = Boolean(enabled);
    if (on === this.attackMode) return;
    this.attackMode = on;
    if (on) {
      this.attackAnimT = 0;
      this.state = "attack";
      this.goalX = null;
      this.goalY = null;
      this.targetFoodIdx = -1;
      this.velX = 0;
      this.velY = 0;
    } else {
      if (this.state === "attack") this.state = "wander";
      this.goalX = null;
      this.goalY = null;
      this.targetFoodIdx = -1;
      this.goalCooldownT = 0.25;
    }
    this._renderStatus();
  }

  toggleAttackMode() {
    this.setAttackMode(!this.attackMode);
  }

  setParts({ horn = 0, wing = 0, keyBg = this.keyBg } = {}) {
    const nextKeyBg = Boolean(keyBg);
    const keyChanged = nextKeyBg !== this.keyBg;
    this.keyBg = nextKeyBg;
    this.parts.horn = clampInt(horn, 0, PART_SETS.horn.count);
    this.parts.wing = clampInt(wing, 0, PART_SETS.wing.count);
    if (keyChanged) {
      this.partUrls = { horn: "", wing: "" };
      this.partDrawables = { horn: null, wing: null };
      this.partLoading = { horn: null, wing: null };
      this.plantDrawables.clear();
      this.plantLoading.clear();
      this._syncWalkSheet();
    }
    this._syncParts();
  }

  setPlantConfig({ plant = "random", keyBg = this.keyBg } = {}) {
    const nextKeyBg = Boolean(keyBg);
    const keyChanged = nextKeyBg !== this.keyBg;
    this.keyBg = nextKeyBg;
    if (keyChanged) {
      this.partUrls = { horn: "", wing: "" };
      this.partDrawables = { horn: null, wing: null };
      this.partLoading = { horn: null, wing: null };
      this.plantDrawables.clear();
      this.plantLoading.clear();
      this._syncParts();
      this._syncWalkSheet();
    }
    const v = String(plant ?? "random");
    if (v === "random") this.plantMode = "random";
    else this.plantMode = normalizePlantVariantId(v);
  }

  _syncParts() {
    this._syncOnePart("horn");
    this._syncOnePart("wing");
  }

  _syncOnePart(kind) {
    const k = String(kind || "");
    const idx = clampInt(this.parts?.[k] ?? 0, 0, PART_SETS[k]?.count ?? 0);
    if (!idx) {
      this.partUrls[k] = "";
      this.partDrawables[k] = null;
      this.partLoading[k] = null;
      return;
    }

    const url = partAssetUrl(k, idx);
    if (!url || url === this.partUrls[k]) return;

    this.partUrls[k] = url;
    const keyBg = Boolean(this.keyBg);
    const p = loadDrawable(url, { keyBg })
      .then((drawable) => {
        if (this.partUrls[k] !== url) return;
        this.partDrawables[k] = drawable;
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(err);
        if (this.partUrls[k] === url) this.partDrawables[k] = null;
      });
    this.partLoading[k] = p;
  }

  _pickPlantVariant() {
    if (this.plantMode === "random") return randomPlantVariantId();
    return normalizePlantVariantId(this.plantMode);
  }

  _ensurePlantDrawable(idx) {
    const plantId = normalizePlantVariantId(idx);
    if (this.plantDrawables.has(plantId)) return this.plantDrawables.get(plantId);
    if (this.plantLoading.has(plantId)) return null;

    const url = plantAssetUrl(plantId);
    const keyBg = Boolean(this.keyBg);
    const p = loadDrawable(url, { keyBg })
      .then((drawable) => {
        this.plantDrawables.set(plantId, drawable);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(err);
      })
      .finally(() => {
        this.plantLoading.delete(plantId);
      });

    this.plantLoading.set(plantId, p);
    return null;
  }

  _ensurePlantAnimFrames(idx) {
    const plantId = normalizePlantVariantId(idx);
    if (this.plantAnimFrames.has(plantId)) return this.plantAnimFrames.get(plantId);
    if (this.plantAnimLoading.has(plantId)) return null;

    const url = plantAnimSheetUrl(plantId);
    const p = loadSpriteSheetFrames(url, {
      frameCount: PLANT_ANIM_SET.frameCount,
      targetSize: 256,
      alphaThreshold: 8,
      paddingPct: 0.08,
      bgMaxThreshold: 12,
      chromaThreshold: 18,
      searchRadiusPx: PLANT_ANIM_SEARCH_RADIUS,
      splitMode: "auto",
    })
      .then((res) => {
        const frames = Array.isArray(res?.frames) ? res.frames.filter(Boolean) : [];
        if (frames.length) this.plantAnimFrames.set(plantId, frames);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(err);
      })
      .finally(() => {
        this.plantAnimLoading.delete(plantId);
      });

    this.plantAnimLoading.set(plantId, p);
    return null;
  }

  _syncSprite() {
    const designId = String(this.designId || "");
    if (!designId) return;

    const url = assetUrl(designId, this.sex, this.stage);
    if (url === this.spriteUrl) return;

    this.spriteUrl = url;
    loadImage(url)
      .then((img) => {
        if (this.spriteUrl !== url) return;
        this.spriteImg = img;
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(err);
        this.spriteImg = null;
      });

    this._syncWalkSheet();
    this._syncEatSheet();
    this._syncAttackSheet();
  }

  _syncWalkSheet() {
    const url = moveAnimSheetUrl(this.designId, this.sex, this.stage);
    if (url === this.walkSheetUrl) return;

    this.walkSheetUrl = url;
    this.walkFrames = null;
    this.walkFramesLoading = null;
    if (!url) return;

    const token = url;
    this.walkFramesLoading = loadSpriteSheetFrames(url, {
      frameCount: 7,
      targetSize: 512,
      alphaThreshold: 8,
      paddingPct: 0.12,
      bgMaxThreshold: 12,
      chromaThreshold: 18,
      searchRadiusPx: 260,
      // Most sheets have clear gaps (e.g. ~80px) between frames, but frame widths vary.
      // Use auto valley detection so cuts land inside the gaps (prevents neighboring-frame bleed).
      splitMode: "auto",
    })
      .then((res) => {
        if (this.walkSheetUrl !== token) return;
        this.walkFrames = res?.frames || null;
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(err);
        if (this.walkSheetUrl === token) this.walkFrames = null;
      });
  }

  _syncEatSheet() {
    const url = eatAnimSheetUrl(this.designId, this.sex, this.stage);
    if (url === this.eatSheetUrl) return;

    this.eatSheetUrl = url;
    this.eatFrames = null;
    this.eatFramesLoading = null;
    if (!url) return;

    const token = url;
    this.eatFramesLoading = loadSpriteSheetFrames(url, {
      frameCount: 7,
      targetSize: 512,
      alphaThreshold: 8,
      paddingPct: 0.12,
      bgMaxThreshold: 12,
      chromaThreshold: 18,
      searchRadiusPx: 260,
      splitMode: "auto",
    })
      .then((res) => {
        if (this.eatSheetUrl !== token) return;
        this.eatFrames = res?.frames || null;
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(err);
        if (this.eatSheetUrl === token) this.eatFrames = null;
      });
  }

  _syncAttackSheet() {
    const url = attackAnimSheetUrl(this.designId, this.sex, this.stage);
    if (url === this.attackSheetUrl) return;

    this.attackSheetUrl = url;
    this.attackFrames = null;
    this.attackFramesLoading = null;

    if (!url) {
      if (this.attackMode) this.setAttackMode(false);
      return;
    }

    const token = url;
    this.attackFramesLoading = loadSpriteSheetFrames(url, {
      frameCount: 4,
      targetSize: 512,
      alphaThreshold: 8,
      paddingPct: 0.12,
      bgMaxThreshold: 12,
      chromaThreshold: 18,
      searchRadiusPx: 260,
      // Attack sheets often have uneven spacing; use auto valley detection to avoid neighbor-frame bleed.
      splitMode: "auto",
    })
      .then((res) => {
        if (this.attackSheetUrl !== token) return;
        this.attackFrames = res?.frames || null;
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(err);
        if (this.attackSheetUrl === token) this.attackFrames = null;
      });
  }

  screenToWorld(xPx, yPx) {
    if (!this.ctx) return { x: 0, y: 0 };
    resizeCanvasToDisplaySize(this.canvas);
    const w = this.canvas.width;
    const h = this.canvas.height;
    const z = clampNumber(this.camZoom, 0.35, 2.5);
    const x = (xPx - w * 0.5) / z + this.camX;
    const y = (yPx - h * 0.5) / z + this.camY;
    return {
      x: clampNumber(x, 0, this.worldW),
      y: clampNumber(y, 0, this.worldH),
    };
  }

  worldToScreen(x, y) {
    if (!this.ctx) return { x: 0, y: 0 };
    resizeCanvasToDisplaySize(this.canvas);
    const w = this.canvas.width;
    const h = this.canvas.height;
    const z = clampNumber(this.camZoom, 0.35, 2.5);
    return {
      x: (x - this.camX) * z + w * 0.5,
      y: (y - this.camY) * z + h * 0.5,
    };
  }

  spawnFoodAt(xWorld, yWorld, kindOverride = null) {
    if (!this.ctx) return;
    const x = clampNumber(xWorld, 0, this.worldW);
    const y = clampNumber(yWorld, 0, this.worldH);
    const kind = kindOverride ? String(kindOverride) : foodKindForDesign(this.designId);
    const item = { x, y, kind };
    if (kind === "plant") {
      item.plantVariant = this._pickPlantVariant();
      item.animSeed = Math.random();
    }
    this.foods.push(item);
  }

  spawnFoodRandom() {
    if (!this.ctx) return;
    const x = randRange(this.tileSize * 1.2, this.worldW - this.tileSize * 1.2);
    const y = randRange(this.tileSize * 1.2, this.worldH - this.tileSize * 1.2);
    this.spawnFoodAt(x, y);
  }

  spawnPlantRandom() {
    if (!this.ctx) return;
    const x = randRange(this.tileSize * 1.2, this.worldW - this.tileSize * 1.2);
    const y = randRange(this.tileSize * 1.2, this.worldH - this.tileSize * 1.2);
    this.spawnFoodAt(x, y, "plant");
  }

  makeHungry() {
    this.hunger = Math.min(this.hunger, 0.35);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTs = performance.now();
    const tick = (ts) => {
      if (!this.running) return;
      const dt = Math.min(0.05, Math.max(0.001, (ts - this.lastTs) / 1000));
      this.lastTs = ts;
      this.update(dt);
      this.draw();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
  }

  _pickWanderGoal() {
    this.goalX = randRange(this.tileSize * 1.2, this.worldW - this.tileSize * 1.2);
    this.goalY = randRange(this.tileSize * 1.2, this.worldH - this.tileSize * 1.2);
  }

  _nearestFoodIdx() {
    if (!this.foods.length) return -1;
    let best = 0;
    const dx0 = this.foods[0].x - this.posX;
    const dy0 = (this.foods[0].y ?? 0) - this.posY;
    let bestD = dx0 * dx0 + dy0 * dy0;
    for (let i = 1; i < this.foods.length; i++) {
      const dx = this.foods[i].x - this.posX;
      const dy = (this.foods[i].y ?? 0) - this.posY;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  update(dt) {
    if (!this.ctx) return;
    resizeCanvasToDisplaySize(this.canvas);

    this.time += dt;
    this.hunger = Math.max(0, this.hunger - dt * 0.008);
    this.eatFxT = Math.max(0, this.eatFxT - dt);
    this.goalCooldownT = Math.max(0, this.goalCooldownT - dt);

    // chewing fx (while eating and a bit after)
    const chewActive = this.state === "eat" || this.eatFxT > 0;
    if (chewActive) {
      this.chewPhase = (this.chewPhase + dt * 12.5) % (Math.PI * 2);
      this.chewFxT = Math.min(1.0, this.chewFxT + dt * 5.5);
    } else {
      this.chewFxT = Math.max(0, this.chewFxT - dt * 3);
    }

    if (this.attackMode) {
      this.state = "attack";
      this.goalX = null;
      this.goalY = null;
      this.targetFoodIdx = -1;
      this.velX = 0;
      this.velY = 0;
      this.attackAnimT += dt;
      if (this.followCamera) {
        const k = Math.min(1, dt * 3.2);
        this.camX += (this.posX - this.camX) * k;
        this.camY += (this.posY - this.camY) * k;
      }
      this._renderStatus();
      return;
    }

    const shouldSeekFood = this.foods.length > 0 && this.hunger < 0.7;
    const eatDist = this.tileSize * 0.28;
    const eatDist2 = eatDist * eatDist;

    if (this.state === "eat") {
      this.stateT -= dt;
      this.velX = 0;
      this.velY = 0;
      if (this.stateT <= 0) {
        const idx = this.targetFoodIdx;
        if (idx >= 0 && idx < this.foods.length) {
          this.foods.splice(idx, 1);
        }
        this.targetFoodIdx = -1;
        this.hunger = Math.min(1, this.hunger + 0.75);
        this.eatFxT = 0.8;
        this.state = "wander";
        this.goalX = null;
        this.goalY = null;
        this.goalCooldownT = 0.4;
      }
      this._renderStatus();
      return;
    }

    if (shouldSeekFood) {
      if (this.state !== "seek_food") {
        this.state = "seek_food";
      }
      this.targetFoodIdx = this._nearestFoodIdx();
    } else {
      if (this.state !== "wander") {
        this.state = "wander";
        this.goalX = null;
        this.goalY = null;
        this.targetFoodIdx = -1;
        this.goalCooldownT = 0.25;
      }
    }

    const pad = this.tileSize * 0.65;
    const left = pad;
    const right = this.worldW - pad;
    const top = pad;
    const bottom = this.worldH - pad;

    let desiredVX = 0;
    let desiredVY = 0;
    if (this.state === "wander") {
      if (this.goalX === null) this._pickWanderGoal();
      const dx = this.goalX - this.posX;
      const dy = (this.goalY ?? this.posY) - this.posY;
      const d2 = dx * dx + dy * dy;
      const arrive2 = (this.tileSize * 0.22) * (this.tileSize * 0.22);

      if (d2 < arrive2 && this.goalCooldownT <= 0) {
        this._pickWanderGoal();
        this.goalCooldownT = randRange(0.4, 1.1);
      }

      if (this.goalCooldownT > 0 && d2 < (this.tileSize * 0.6) * (this.tileSize * 0.6)) {
        desiredVX = 0;
        desiredVY = 0;
      } else {
        const d = Math.sqrt(d2) || 1;
        const spd = 88;
        desiredVX = (dx / d) * spd;
        desiredVY = (dy / d) * spd;
      }
    } else if (this.state === "seek_food") {
      const idx = this.targetFoodIdx;
      if (idx >= 0 && idx < this.foods.length) {
        const fx = this.foods[idx].x;
        const fy = this.foods[idx].y ?? this.posY;
        const dx = fx - this.posX;
        const dy = fy - this.posY;
        const d2 = dx * dx + dy * dy;
        const d = Math.sqrt(d2) || 1;
        const spd = 132;
        desiredVX = (dx / d) * spd;
        desiredVY = (dy / d) * spd;
        if (d2 < eatDist2) {
          this.lastEatKind = this.foods[idx].kind || this.lastEatKind;
          this.state = "eat";
          this.stateT = 1.0;
          desiredVX = 0;
          desiredVY = 0;
        }
      } else {
        this.state = "wander";
        this.goalX = null;
        this.goalY = null;
        desiredVX = 0;
        desiredVY = 0;
      }
    }

    // Smooth velocity a bit to avoid jitter.
    this.velX += (desiredVX - this.velX) * Math.min(1, dt * 7);
    this.velY += (desiredVY - this.velY) * Math.min(1, dt * 7);
    this.posX += this.velX * dt;
    this.posY += this.velY * dt;

    const speed = Math.hypot(this.velX, this.velY);
    const moving = speed > 10 && this.state !== "eat";
    if (moving) {
      if (this.velX > 10) this.facing = 1;
      else if (this.velX < -10) this.facing = -1;
      const rate = clampNumber(speed / 92, 0.65, 2.6);
      this.walkPhase = (this.walkPhase + dt * rate * Math.PI * 2) % (Math.PI * 2);
    }

    if (this.posX < left) {
      this.posX = left;
      this.goalX = null;
      this.goalY = null;
      this.velX = Math.max(0, this.velX);
    } else if (this.posX > right) {
      this.posX = right;
      this.goalX = null;
      this.goalY = null;
      this.velX = Math.min(0, this.velX);
    }
    if (this.posY < top) {
      this.posY = top;
      this.goalX = null;
      this.goalY = null;
      this.velY = Math.max(0, this.velY);
    } else if (this.posY > bottom) {
      this.posY = bottom;
      this.goalX = null;
      this.goalY = null;
      this.velY = Math.min(0, this.velY);
    }

    if (this.followCamera) {
      const k = Math.min(1, dt * 3.2);
      this.camX += (this.posX - this.camX) * k;
      this.camY += (this.posY - this.camY) * k;
    }

    this._renderStatus();
  }

  _renderStatus() {
    if (!this.statusEl) return;
    const h = Math.round(this.hunger * 100);
    const stateLabel =
      this.state === "attack"
        ? "攻撃"
        : this.state === "seek_food"
          ? "食事へ移動"
          : this.state === "eat"
            ? "食事"
            : this.foods.length
              ? "徘徊（食事待ち）"
              : "徘徊";
    const walkCount = Array.isArray(this.walkFrames) ? this.walkFrames.filter(Boolean).length : 0;
    const eatCount = Array.isArray(this.eatFrames) ? this.eatFrames.filter(Boolean).length : 0;
    const attackCount = Array.isArray(this.attackFrames) ? this.attackFrames.filter(Boolean).length : 0;
    const notes = [];
    if (this.walkSheetUrl && walkCount) notes.push(`歩行:${walkCount}f`);
    if (this.eatSheetUrl && eatCount) notes.push(`食事:${eatCount}f`);
    if (this.attackSheetUrl && attackCount) notes.push(`攻撃:${attackCount}f`);
    const animNote = notes.length ? ` / アニメ: ${notes.join(" / ")}` : "";
    this.statusEl.textContent = `状態: ${stateLabel} / 空腹: ${h}% / ごはん: ${this.foods.length}${animNote}`;
  }

  _drawFoodIcon(ctx, x, y, kind) {
    ctx.save();
    ctx.translate(x, y);
    const z = clampNumber(this.camZoom, 0.35, 2.5);
    ctx.scale(z, z);
    ctx.globalAlpha = 0.98;

    const k = String(kind || "plant");
    if (k === "meat") {
      // steak-ish
      ctx.fillStyle = "#d23b3b";
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 2;
      const w = 22;
      const h = 14;
      const r = 6;
      ctx.beginPath();
      ctx.moveTo(-w / 2 + r, -h / 2);
      ctx.arcTo(w / 2, -h / 2, w / 2, h / 2, r);
      ctx.arcTo(w / 2, h / 2, -w / 2, h / 2, r);
      ctx.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r);
      ctx.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      ctx.beginPath();
      ctx.ellipse(2, 0, 5, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // leaf-ish
      ctx.fillStyle = "#2ea44f";
      ctx.strokeStyle = "rgba(0,0,0,0.22)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(-4, 0, 9, 6, -0.4, 0, Math.PI * 2);
      ctx.ellipse(6, -1, 8, 5, 0.6, 0, Math.PI * 2);
      ctx.fill("nonzero");
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.beginPath();
      ctx.moveTo(-2, 3);
      ctx.lineTo(8, -2);
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawFood(ctx, x, y, food) {
    if (typeof food === "string") {
      this._drawFoodIcon(ctx, x, y, food);
      return;
    }

    const kind = String(food?.kind || "plant");
    if (kind !== "plant") {
      this._drawFoodIcon(ctx, x, y, kind);
      return;
    }

    // plant sprite (fallback to icon if not loaded)
    let idx = normalizePlantVariantId(food?.plantVariant);
    if (!food?.plantVariant || !PLANT_VARIANT_BY_ID.has(String(food.plantVariant))) {
      idx = this._pickPlantVariant();
      if (food && typeof food === "object") food.plantVariant = idx;
    }

    const animFrames = this._ensurePlantAnimFrames(idx);
    if (Array.isArray(animFrames) && animFrames.length) {
      const seed = Number(food?.animSeed ?? 0);
      const t = this.time * PLANT_ANIM_FPS + seed * animFrames.length;
      const fi = clampInt(Math.floor(t % animFrames.length), 0, animFrames.length - 1);
      const frame = animFrames[fi] || animFrames[0];

      const z = clampNumber(this.camZoom, 0.35, 2.5);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(z, z);
      ctx.globalAlpha = 0.98;
      const size = 56 * plantVariantDrawScale(idx);
      drawContained(ctx, frame, -size * 0.5, -size * 0.84, size, size);
      ctx.restore();
      return;
    }

    const drawable = this._ensurePlantDrawable(idx);
    if (!drawable) {
      this._drawFoodIcon(ctx, x, y, "plant");
      return;
    }

    const z = clampNumber(this.camZoom, 0.35, 2.5);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(z, z);
    ctx.globalAlpha = 0.98;
    const size = 56 * plantVariantDrawScale(idx);
    drawContained(ctx, drawable, -size * 0.5, -size * 0.84, size, size);
    ctx.restore();
  }

  _drawOverlayPart(ctx, drawable, { cx = 0, cy = 0, width = 0, alpha = 1 } = {}) {
    if (!ctx || !drawable) return;
    const w = Math.max(0, Number(width) || 0);
    if (w <= 0) return;

    const sz = drawableSize(drawable);
    const h = (w * sz.h) / Math.max(1, sz.w);

    ctx.save();
    ctx.globalAlpha *= clampNumber(alpha, 0, 1);
    ctx.drawImage(drawable, cx - w * 0.5, cy - h * 0.5, w, h);
    ctx.restore();
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;

    resizeCanvasToDisplaySize(this.canvas);
    const w = this.canvas.width;
    const h = this.canvas.height;
    const z = clampNumber(this.camZoom, 0.35, 2.5);

    // background
    ctx.fillStyle = "#d6d6d6";
    ctx.fillRect(0, 0, w, h);

    // tile grid (macro-world-ish)
    const minWX = this.camX - (w * 0.5) / z;
    const maxWX = this.camX + (w * 0.5) / z;
    const minWY = this.camY - (h * 0.5) / z;
    const maxWY = this.camY + (h * 0.5) / z;

    const tx0 = clampInt(Math.floor(minWX / this.tileSize), 0, this.worldTilesW - 1);
    const tx1 = clampInt(Math.ceil(maxWX / this.tileSize), 0, this.worldTilesW - 1);
    const ty0 = clampInt(Math.floor(minWY / this.tileSize), 0, this.worldTilesH - 1);
    const ty1 = clampInt(Math.ceil(maxWY / this.tileSize), 0, this.worldTilesH - 1);

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const wx0 = tx * this.tileSize;
        const wy0 = ty * this.tileSize;
        const sx = (wx0 - this.camX) * z + w * 0.5;
        const sy = (wy0 - this.camY) * z + h * 0.5;
        const tw = this.tileSize * z;
        const th = this.tileSize * z;
        ctx.fillStyle = (tx + ty) % 2 === 0 ? "rgba(220,220,220,0.92)" : "rgba(206,206,206,0.92)";
        ctx.fillRect(sx, sy, tw, th);
      }
    }

    ctx.strokeStyle = "rgba(0,0,0,0.06)";
    ctx.lineWidth = 1;
    for (let ty = ty0; ty <= ty1; ty++) {
      const wy0 = ty * this.tileSize;
      const sy = (wy0 - this.camY) * z + h * 0.5;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
      ctx.stroke();
    }
    for (let tx = tx0; tx <= tx1; tx++) {
      const wx0 = tx * this.tileSize;
      const sx = (wx0 - this.camX) * z + w * 0.5;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
      ctx.stroke();
    }

    // foods
    for (const f of this.foods) {
      const sp = this.worldToScreen(f.x, f.y ?? 0);
      this._drawFood(ctx, sp.x, sp.y, f);
    }

    const speed = Math.hypot(this.velX, this.velY);
    const moving = speed > 10 && this.state !== "eat";

    const walkFrames = this.walkFrames;
    const eatFrames = this.eatFrames;
    const attackFrames = this.attackFrames;
    let img = this.spriteImg;
    // Prefer animated sheet's idle frame so style stays consistent.
    if (this.walkSheetUrl && Array.isArray(walkFrames) && walkFrames.length) {
      img = walkFrames[0] || img;
    }
    if (this.state === "attack" && Array.isArray(attackFrames) && attackFrames.length) {
      const frames = attackFrames.filter(Boolean);
      if (frames.length) {
        const fps = 9.5;
        const idx = clampInt(Math.floor((this.attackAnimT * fps) % frames.length), 0, frames.length - 1);
        img = frames[idx] || frames[0] || img;
      }
    } else if (this.state === "eat" && Array.isArray(eatFrames) && eatFrames.length) {
      const phase01 = (this.chewPhase / (Math.PI * 2)) % 1;
      const idx = clampInt(Math.floor(phase01 * eatFrames.length), 0, eatFrames.length - 1);
      img = eatFrames[idx] || eatFrames[0] || img;
    } else if (moving && Array.isArray(walkFrames) && walkFrames.length) {
      const phase01 = (this.walkPhase / (Math.PI * 2)) % 1;
      const idx = clampInt(Math.floor(phase01 * walkFrames.length), 0, walkFrames.length - 1);
      img = walkFrames[idx] || walkFrames[0] || img;
    }

    if (!img) {
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.font = "14px sans-serif";
      ctx.fillText("画像読み込み中…", 14, 22);
      return;
    }

    const imgW = Number(img.naturalWidth || img.width || 1);
    const imgH = Number(img.naturalHeight || img.height || 1);

    // sprite size in world-units (scales with zoom)
    const spriteWorldW = this.tileSize * 1.65;
    const spriteWorldH = (spriteWorldW * imgH) / imgW;
    const drawW = spriteWorldW * z;
    const drawH = spriteWorldH * z;

    // NOTE: Walking bob/sway intentionally disabled; use sprite-sheet motion only.
    const bob = 0;

    // Base sprites face LEFT by default (most provided PNGs are left-facing).
    // Flip horizontally when moving to the RIGHT.
    const flipX = (this.facing || -1) > 0;
    const anchorY = 0.86;

    const sp = this.worldToScreen(this.posX, this.posY);
    const marks = faceMarksFor(this.designId);
    const chewAmt = clampNumber(this.chewFxT, 0, 1);

    ctx.save();
    ctx.translate(sp.x, sp.y + bob);
    if (flipX) ctx.scale(-1, 1);

    // walk: sprite-sheet only (no extra sway/bob)

    const imgX = -drawW / 2;
    const imgY = -drawH * anchorY;

    const wing = this.partDrawables.wing;
    const horn = this.partDrawables.horn;

    ctx.drawImage(img, imgX, imgY, drawW, drawH);

    // parts on top (preview)
    if (horn) {
      this._drawOverlayPart(ctx, horn, {
        cx: imgX + drawW * 0.30,
        cy: imgY + drawH * 0.16,
        width: drawW * 0.75,
        alpha: 0.98,
      });
    }
    if (wing) {
      this._drawOverlayPart(ctx, wing, {
        // Move wings to the back/upper area so they don't cover the face.
        cx: imgX + drawW * 0.92,
        cy: imgY + drawH * 0.15,
        width: drawW * 0.62,
        alpha: 0.82,
      });
    }

    // chew marks near the mouth while eating
    if (chewAmt > 0.02) {
      const mx = imgX + drawW * marks.mouth.u;
      const my = imgY + drawH * marks.mouth.v;
      const p = 0.5 + 0.5 * Math.sin(this.chewPhase * 1.25);
      const a = 0.25 + 0.75 * p;
      const r = drawW * 0.03;
      ctx.save();
      ctx.globalAlpha = 0.65 * a * chewAmt;
      ctx.strokeStyle = "rgba(30, 18, 12, 0.65)";
      ctx.lineWidth = Math.max(1.1, drawW * 0.012);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(mx + r * 0.8, my - r * 0.15);
      ctx.lineTo(mx + r * 1.55, my - r * 0.75);
      ctx.moveTo(mx + r * 0.8, my + r * 0.15);
      ctx.lineTo(mx + r * 1.55, my + r * 0.75);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();

    if (this.state === "eat" || this.eatFxT > 0) {
      const fxX = sp.x + (flipX ? -drawW * 0.12 : drawW * 0.12);
      const fxY = sp.y - drawH * 0.92 + bob + Math.sin(this.chewPhase) * (this.tileSize * 0.03 * z);
      let kind = this.lastEatKind || "plant";
      if (this.state === "eat") {
        const idx = this.targetFoodIdx;
        if (idx >= 0 && idx < this.foods.length) {
          kind = this.foods[idx].kind || kind;
        }
      }
      this._drawFood(ctx, fxX, fxY, kind);
    }
  }
}

function buildCard({ design }) {
  const card = document.createElement("div");
  card.className = "sbCard";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `${design.label} を選択`);

  const header = document.createElement("div");
  header.className = "sbCardHeader";
  header.innerHTML = `<div>${escapeHtml(design.label)}</div><div style="opacity:.65">${escapeHtml(design.id)}</div>`;

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "sbCardCanvas";

  const wrap = document.createElement("div");
  wrap.className = "sbCanvasWrap";

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-label", design.label);
  wrap.appendChild(canvas);

  const overlay = document.createElement("canvas");
  overlay.className = "sbOverlayCanvas";
  overlay.setAttribute("aria-hidden", "true");
  wrap.appendChild(overlay);

  canvasWrap.appendChild(wrap);
  card.appendChild(header);
  card.appendChild(canvasWrap);

  const renderer = new WebglSpriteCard({ canvas, label: design.label, id: design.id });

  if (!renderer.ok) {
    wrap.textContent = "WebGL が利用できません（別のブラウザでお試しください）";
  }

  return { card, header, renderer, overlay };
}

function buildAssetThumbCard({ label, id, url, drawScale = 1 }) {
  const card = document.createElement("div");
  card.className = "sbCard";
  card.tabIndex = -1;

  const header = document.createElement("div");
  header.className = "sbCardHeader";
  header.innerHTML = `<div>${escapeHtml(label)}</div><div style="opacity:.65">${escapeHtml(id)}</div>`;

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "sbCardCanvas";

  const wrap = document.createElement("div");
  wrap.className = "sbCanvasWrap";

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-label", label);
  wrap.appendChild(canvas);

  canvasWrap.appendChild(wrap);
  card.appendChild(header);
  card.appendChild(canvasWrap);

  return {
    card,
    header,
    canvas,
    url: String(url || ""),
    id: String(id || ""),
    label: String(label || ""),
    token: "",
    drawScale: clampNumber(drawScale, 0.5, 1.5),
  };
}

function initPlantAnimModal() {
  const modal = document.getElementById("sbPlantAnimModal");
  const back = document.getElementById("sbPlantAnimBack");
  const closeBtn = document.getElementById("sbPlantAnimClose");
  const titleEl = document.getElementById("sbPlantAnimTitle");
  const subEl = document.getElementById("sbPlantAnimSub");
  const canvas = document.getElementById("sbPlantAnimCanvas");
  const ctx = canvas?.getContext?.("2d", { alpha: true }) || null;

  if (!modal || !canvas || !ctx) {
    return { open: () => {}, close: () => {}, setKeyBg: () => {} };
  }

  let isOpen = false;
  let currentSpec = makePlantVariantPreviewSpec(1);
  let keyBg = true;
  let lastTs = 0;
  let t = 0;

  const animFramesById = new Map();
  const animLoadingById = new Map();

  let stillUrl = "";
  let stillDrawable = null;
  let stillLoading = null;

  const setHeader = () => {
    if (titleEl) titleEl.textContent = "植物アニメ";
    if (subEl) subEl.textContent = `${currentSpec?.label || "植物"}（${PLANT_ANIM_SET.frameCount}フレーム）`;
  };

  const ensureAnim = () => {
    const spec = currentSpec;
    const key = String(spec?.id || "");
    const url = String(spec?.animUrl || "");
    if (!key || !url) return;
    if (animFramesById.has(key)) return;
    if (animLoadingById.has(key)) return;

    const p = loadSpriteSheetFrames(url, {
      frameCount: PLANT_ANIM_SET.frameCount,
      targetSize: 512,
      alphaThreshold: 8,
      paddingPct: 0.08,
      bgMaxThreshold: 12,
      chromaThreshold: 18,
      searchRadiusPx: PLANT_ANIM_SEARCH_RADIUS,
      splitMode: "auto",
    })
      .then((res) => {
        const frames = Array.isArray(res?.frames) ? res.frames.filter(Boolean) : [];
        if (frames.length) animFramesById.set(key, frames);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(err);
      })
      .finally(() => {
        animLoadingById.delete(key);
      });

    animLoadingById.set(key, p);
  };

  const ensureStill = () => {
    const url = String(currentSpec?.stillUrl || "");
    if (!url || url === stillUrl) return;

    stillUrl = url;
    stillDrawable = null;
    stillLoading = loadDrawable(url, { keyBg })
      .then((d) => {
        if (stillUrl !== url) return;
        stillDrawable = d;
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(err);
        if (stillUrl === url) stillDrawable = null;
      })
      .finally(() => {
        if (stillUrl === url) stillLoading = null;
      });
  };

  const drawFrame = () => {
    resizeCanvasToDisplaySize(canvas);
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const drawDrawable = (drawable) => {
      if (!drawable) return;
      const sz = drawableSize(drawable);
      const drawScale = clampNumber(currentSpec?.drawScale ?? 1, 0.5, 1.5);
      const maxW = w * 0.92 * drawScale;
      const maxH = h * 0.92 * drawScale;
      const s = Math.max(0.0001, Math.min(maxW / sz.w, maxH / sz.h));
      const dw = Math.max(1, Math.round(sz.w * s));
      const dh = Math.max(1, Math.round(sz.h * s));
      const dx = Math.round((w - dw) / 2);
      const bottomY = Math.round(h * 0.86);
      const dy = Math.round(bottomY - dh);
      ctx.globalAlpha = 0.98;
      ctx.drawImage(drawable, dx, dy, dw, dh);
    };

    const frames = animFramesById.get(String(currentSpec?.id || ""));
    if (Array.isArray(frames) && frames.length) {
      const i = clampInt(Math.floor((t * PLANT_ANIM_FPS) % frames.length), 0, frames.length - 1);
      drawDrawable(frames[i] || frames[0]);
      return;
    }

    if (stillDrawable) {
      drawDrawable(stillDrawable);
      return;
    }

    // loading / fallback text
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.font = "14px sans-serif";
    ctx.fillText("読み込み中…", 14, 22);
  };

  const tick = (ts) => {
    if (!isOpen) return;
    const dt = Math.min(0.05, Math.max(0.001, (ts - lastTs) / 1000));
    lastTs = ts;
    t += dt;
    drawFrame();
    requestAnimationFrame(tick);
  };

  const open = (specOrIdx) => {
    if (typeof specOrIdx === "number") currentSpec = makePlantVariantPreviewSpec(specOrIdx);
    else if (specOrIdx && typeof specOrIdx === "object") currentSpec = specOrIdx;
    else currentSpec = makePlantVariantPreviewSpec(1);
    setHeader();

    // Reset time so repeated opens start from the beginning-ish.
    t = 0;
    lastTs = performance.now();

    // Ensure assets.
    ensureAnim();
    ensureStill();

    isOpen = true;
    modal.hidden = false;
    requestAnimationFrame(tick);
  };

  const close = () => {
    isOpen = false;
    modal.hidden = true;
  };

  closeBtn?.addEventListener("click", close);
  back?.addEventListener("click", close);
  window.addEventListener("keydown", (ev) => {
    if (!isOpen) return;
    if (ev.key === "Escape") close();
  });

  return {
    open,
    close,
    setKeyBg: (v) => {
      keyBg = Boolean(v);
      // Re-load still drawable with the new keying policy.
      stillUrl = "";
      stillDrawable = null;
      stillLoading = null;
      ensureStill();
    },
  };
}

function renderCardOverlay(cardItem, { zoom = 1, horn = 0, wing = 0, keyBg = false } = {}) {
  const canvas = cardItem?.overlay;
  if (!canvas) return;
  const ctx = canvas.getContext?.("2d", { alpha: true }) || null;
  if (!ctx) return;

  resizeCanvasToDisplaySize(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const useHorn = clampInt(horn, 0, PART_SETS.horn.count);
  const useWing = clampInt(wing, 0, PART_SETS.wing.count);
  if (!useHorn && !useWing) return;

  const texW = Math.max(1, Number(cardItem?.renderer?.texW || 1));
  const texH = Math.max(1, Number(cardItem?.renderer?.texH || 1));

  const z = clampNumber(zoom, 0.35, 3.0);
  const token = `${useHorn}|${useWing}|${keyBg ? 1 : 0}|${texW}x${texH}|z=${z.toFixed(3)}`;
  cardItem._overlayToken = token;

  const tasks = [];
  if (useHorn) tasks.push(loadDrawable(partAssetUrl("horn", useHorn), { keyBg }).then((d) => ({ kind: "horn", d })));
  if (useWing) tasks.push(loadDrawable(partAssetUrl("wing", useWing), { keyBg }).then((d) => ({ kind: "wing", d })));

  Promise.allSettled(tasks).then((res) => {
    if (cardItem._overlayToken !== token) return;

    const drawables = { horn: null, wing: null };
    for (const r of res) {
      if (r.status !== "fulfilled") continue;
      const k = String(r.value?.kind || "");
      if (k && r.value?.d) drawables[k] = r.value.d;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cw = canvas.width;
    const ch = canvas.height;

    // Match WebGL card fit (centered, preserve aspect).
    const cAsp = cw / ch;
    const tAsp = texW / texH;
    let sxFit = 1;
    let syFit = 1;
    if (tAsp > cAsp) syFit = cAsp / tAsp;
    else if (tAsp < cAsp) sxFit = tAsp / cAsp;

    const drawW = cw * BASE_SCALE * z * sxFit;
    const drawH = ch * BASE_SCALE * z * syFit;
    const x0 = cw * 0.5 - drawW * 0.5;
    const y0 = ch * 0.5 - drawH * 0.5;

    // single overlay canvas: draw all on top (preview purpose)
    if (drawables.wing) {
      drawOverlayPart2d(ctx, drawables.wing, {
        // Move wings to the back/upper area so they don't cover the face.
        cx: x0 + drawW * 0.72,
        cy: y0 + drawH * 0.26,
        width: drawW * 0.58,
        alpha: 0.82,
      });
    }
    if (drawables.horn) {
      drawOverlayPart2d(ctx, drawables.horn, {
        cx: x0 + drawW * 0.30,
        cy: y0 + drawH * 0.18,
        width: drawW * 0.78,
        alpha: 0.98,
      });
    }
  });
}

async function main() {
  const grid = document.getElementById("sbGrid");
  const sexSel = document.getElementById("sbSex");
  const stageSel = document.getElementById("sbStage");
  const btnRand = document.getElementById("sbRandomize");
  const btnReset = document.getElementById("sbReset");
  const zoomRange = document.getElementById("sbZoom");
  const zoomVal = document.getElementById("sbZoomVal");

  const hornSel = document.getElementById("sbHorn");
  const wingSel = document.getElementById("sbWing");
  const plantSel = document.getElementById("sbPlant");
  const keyBgChk = document.getElementById("sbKeyBg");
  const assetsGrid = document.getElementById("sbAssetsGrid");

  const simCanvas = document.getElementById("sbSimCanvas");
  const simSelected = document.getElementById("sbSimSelected");
  const simStatus = document.getElementById("sbSimStatus");
  const simBtnFood = document.getElementById("sbSimSpawnFood");
  const simBtnHungry = document.getElementById("sbSimHungry");
  const simBtnAttack = document.getElementById("sbSimAttack");
  const simBtnReset = document.getElementById("sbSimReset");

  if (grid && location?.protocol === "file:") {
    return;
  }

  if (plantSel) {
    const currentPlantValue = String(plantSel.value || "random");
    plantSel.textContent = "";
    const randomOpt = document.createElement("option");
    randomOpt.value = "random";
    randomOpt.textContent = "ランダム";
    plantSel.appendChild(randomOpt);
    for (const spec of PLANT_VARIANTS) {
      const opt = document.createElement("option");
      opt.value = spec.id;
      opt.textContent = spec.label;
      plantSel.appendChild(opt);
    }
    plantSel.value = currentPlantValue === "random" ? "random" : normalizePlantVariantId(currentPlantValue);
  }

  const cards = [];
  grid.textContent = "";

  for (const d of DESIGNS) {
    const { card, header, renderer, overlay } = buildCard({ design: d });
    grid.appendChild(card);
    cards.push({ design: d, card, header, renderer, overlay, tint: [...DEFAULT_TINT], _overlayToken: "" });
  }

  let selectedId = String(DESIGNS?.[0]?.id || "");
  const sim = simCanvas ? new SimpleSim({ canvas: simCanvas, selectedEl: simSelected, statusEl: simStatus }) : null;

  const refreshAttackUi = () => {
    if (!simBtnAttack) return;
    if (!sim) {
      simBtnAttack.disabled = true;
      simBtnAttack.textContent = "攻撃（未対応）";
      return;
    }
    const sex = String(sexSel?.value || "male");
    const stage = String(stageSel?.value || "adult");
    const canAttack = Boolean(attackAnimSheetUrl(selectedId, sex, stage));
    if (!canAttack) sim.setAttackMode(false);
    simBtnAttack.disabled = !canAttack;
    simBtnAttack.textContent = canAttack ? (sim.attackMode ? "攻撃: ON" : "攻撃: OFF") : "攻撃（未対応）";
  };

  const assetThumbs = [];
  const plantModal = initPlantAnimModal();
  if (assetsGrid) {
    assetsGrid.textContent = "";
    const items = [];

    for (const [kind, set] of Object.entries(PART_SETS)) {
      for (let i = 1; i <= set.count; i++) {
        items.push({
          id: `${kind}_${i}`,
          label: `${set.label}${i}`,
          url: partAssetUrl(kind, i),
        });
      }
    }
    for (const plantSpec of PLANT_VARIANTS) {
      const previewSpec = makePlantVariantPreviewSpec(plantSpec.id);
      if (!previewSpec) continue;
      items.push({
        id: previewSpec.id,
        label: previewSpec.label,
        url: previewSpec.stillUrl,
        previewSpec,
        drawScale: previewSpec.drawScale || 1,
      });
    }
    for (const stage of PLANT_STAGE_SET) {
      const previewSpec = makePlantStagePreviewSpec(stage.id);
      if (!previewSpec) continue;
      items.push({
        id: previewSpec.id,
        label: previewSpec.label,
        url: previewSpec.stillUrl,
        previewSpec,
      });
    }

    for (const it of items) {
      const t = buildAssetThumbCard(it);
      t.previewSpec = it.previewSpec || null;
      assetsGrid.appendChild(t.card);
      assetThumbs.push(t);
    }
  }

  const drawAssetThumbs = ({ keyBg = false } = {}) => {
    plantModal?.setKeyBg?.(keyBg);
    for (const t of assetThumbs) {
      const canvas = t.canvas;
      const ctx = canvas?.getContext?.("2d", { alpha: true }) || null;
      if (!ctx) continue;

      const token = `${t.url}|key=${keyBg ? 1 : 0}`;
      t.token = token;

      loadDrawable(t.url, { keyBg })
        .then((drawable) => {
          if (t.token !== token) return;
          resizeCanvasToDisplaySize(canvas);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const drawScale = clampNumber(t.drawScale ?? 1, 0.5, 1.5);
          const padX = ((drawScale - 1) * canvas.width) / 2;
          const padY = ((drawScale - 1) * canvas.height) / 2;
          drawContained(ctx, drawable, -padX, -padY, canvas.width + padX * 2, canvas.height + padY * 2);
        })
        .catch((err) => {
          if (t.token !== token) return;
          t.header.innerHTML = `<div>${escapeHtml(t.label)}</div><div style="opacity:.65">読み込み失敗</div>`;
          // eslint-disable-next-line no-console
          console.error(err);
      });
    }
  };

  // Plant thumbnails: open a dedicated animation modal for closer inspection.
  for (const t of assetThumbs) {
    if (!t.previewSpec) continue;
    t.card.classList.add("isClickable");
    t.card.tabIndex = 0;
    t.card.setAttribute("role", "button");
    t.card.setAttribute("aria-label", `${t.label} をプレビュー`);
    t.card.title = `クリックでアニメプレビュー（${PLANT_ANIM_SET.frameCount}フレーム）`;
    t.card.addEventListener("click", () => plantModal.open(t.previewSpec));
    t.card.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        plantModal.open(t.previewSpec);
      }
    });
  }

  const applySelectionUi = () => {
    for (const c of cards) {
      if (!c.card) continue;
      if (c.design.id === selectedId) c.card.classList.add("isSelected");
      else c.card.classList.remove("isSelected");
    }

    if (sim) {
      const d = cards.find((x) => x.design.id === selectedId)?.design;
      sim.setSelection({ designId: selectedId, designLabel: d?.label || selectedId });
      sim.setAppearance({ sex: String(sexSel?.value || "male"), stage: String(stageSel?.value || "adult") });
    }

    refreshAttackUi();
  };

  let randomized = false;

  const applyAll = () => {
    const sex = String(sexSel?.value || "male");
    const stage = String(stageSel?.value || "adult");
    const zoom = clampNumber(zoomRange?.value ?? 1.0, 0.35, 3.0);
    if (zoomVal) zoomVal.textContent = fmt2(zoom);

    const keyBg = Boolean(keyBgChk?.checked);
    const horn = clampInt(hornSel?.value ?? 0, 0, PART_SETS.horn.count);
    const wing = clampInt(wingSel?.value ?? 0, 0, PART_SETS.wing.count);
    const plant = plantSel?.value ?? "random";

    for (const c of cards) {
      if (!c.renderer?.ok) continue;

      const url = assetUrl(c.design.id, sex, stage);
      c.renderer.tint = randomized ? randomTintFor(c.design.id) : [...DEFAULT_TINT];

      c.renderer
        .setTextureUrl(url)
        .then(() => {
          c.renderer.draw({ zoom });
          renderCardOverlay(c, { zoom, horn, wing, keyBg });
        })
        .catch((err) => {
          c.header.innerHTML = `<div>${escapeHtml(c.design.label)}</div><div style="opacity:.65">読み込み失敗</div>`;
          // eslint-disable-next-line no-console
          console.error(err);
        });
    }

    // keep sim sprite in sync with sex/stage
    sim?.setAppearance({ sex, stage });
    sim?.setParts({ horn, wing, keyBg });
    sim?.setPlantConfig({ plant, keyBg });
    drawAssetThumbs({ keyBg });

    refreshAttackUi();
  };

  sexSel?.addEventListener("change", applyAll);
  stageSel?.addEventListener("change", applyAll);
  zoomRange?.addEventListener("input", applyAll);
  hornSel?.addEventListener("change", applyAll);
  wingSel?.addEventListener("change", applyAll);
  plantSel?.addEventListener("change", applyAll);
  keyBgChk?.addEventListener("change", applyAll);

  btnRand?.addEventListener("click", () => {
    randomized = true;
    applyAll();
  });

  btnReset?.addEventListener("click", () => {
    randomized = false;
    applyAll();
  });

  for (const c of cards) {
    c.card?.addEventListener("click", () => {
      selectedId = c.design.id;
      applySelectionUi();
    });
    c.card?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        selectedId = c.design.id;
        applySelectionUi();
      }
    });
  }

  if (sim) {
    applySelectionUi();
    sim.start();

    const placeFoodFromEvent = (ev) => {
      const rect = simCanvas.getBoundingClientRect();
      const xCss = ev.clientX - rect.left;
      const yCss = ev.clientY - rect.top;
      const xPx = (xCss / Math.max(1, rect.width)) * simCanvas.width;
      const yPx = (yCss / Math.max(1, rect.height)) * simCanvas.height;
      const wpos = sim.screenToWorld(xPx, yPx);
      sim.spawnFoodAt(wpos.x, wpos.y);
    };

    simCanvas?.addEventListener("pointerdown", (ev) => {
      placeFoodFromEvent(ev);
    });

    simCanvas?.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        const factor = ev.deltaY > 0 ? 0.9 : 1.1;
        sim.camZoom = clampNumber(sim.camZoom * factor, 0.35, 2.5);
      },
      { passive: false },
    );

    simBtnFood?.addEventListener("click", () => sim.spawnFoodRandom());
    simBtnHungry?.addEventListener("click", () => sim.makeHungry());
    simBtnAttack?.addEventListener("click", () => {
      sim.toggleAttackMode();
      refreshAttackUi();
    });
    simBtnReset?.addEventListener("click", () => sim.reset());
  }

  // Initial render.
  applyAll();
  applySelectionUi();

  // Re-render after layout settles.
  requestAnimationFrame(applyAll);
  window.addEventListener("resize", () => requestAnimationFrame(applyAll));
}

main().catch((err) => {
  const grid = document.getElementById("sbGrid");
  if (grid) {
    const proto = location?.protocol || "";
    const hint =
      proto === "file:"
        ? "このページは file:// 直開きだと読み込みが失敗するため、VS Code Live Server などローカルサーバーで開いてください。"
        : "Live Server で開いている場合は、開発者ツールの Console / Network で ./assets/...png が 404 になっていないか確認してください。";

    grid.innerHTML = `
      <div class="sbCard" style="grid-column: 1 / -1">
        <div class="sbCardHeader"><div>読み込みエラー</div></div>
        <div class="sbCardCanvas">
          <div style="font-size: 12px; line-height: 1.7; color: rgba(0, 0, 0, 0.78)">
            ${escapeHtml(String(err?.message || err))}<br />
            <span style="opacity: 0.7">(${escapeHtml(proto)})</span>
            <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(0, 0, 0, 0.12)">
              ${escapeHtml(hint)}
            </div>
          </div>
        </div>
      </div>
    `;
  }
  // eslint-disable-next-line no-console
  console.error(err);
});
