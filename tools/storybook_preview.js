/*
  Storybook creature preview (WebGL + PNG)
  - Preview only (not wired into the main game yet)
  - Requires running via a local server (VS Code Live Server etc.)
*/

const DESIGNS = [
  { id: "herb_pig", label: "草食（ブタ）" },
  { id: "herb_horse", label: "草食（ウマ）" },
  { id: "herb_zebra", label: "草食（シマウマ）" },
  { id: "omn_mouse", label: "雑食（ネズミ）" },
  { id: "omn_boar", label: "雑食（イノシシ）" },
  { id: "omn_bear", label: "雑食（クマ）" },
  { id: "pred_wolf", label: "肉食（オオカミ）" },
  { id: "pred_cat", label: "肉食（ネコ）" },
  { id: "pred_raccoon", label: "肉食（アライグマ）" },
  { id: "pred_lion", label: "肉食（ライオン）" },
];

const ASSET_BASE = "./assets/storybook/creatures_png";
const SAMPLE_BASE = "./assets/sample";
const CACHE_BUST = String(Date.now());

const PART_SETS = {
  horn: { dir: "ツノ", prefix: "ツノ", count: 3, label: "ツノ" },
  wing: { dir: "羽", prefix: "羽", count: 3, label: "羽" },
};
const PLANT_SET = { dir: "植物", prefix: "植物", count: 15, label: "植物" };

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

function plantAssetUrl(idx) {
  const n = clampInt(idx, 1, 9999);
  return sampleAssetUrl(PLANT_SET.dir, `${PLANT_SET.prefix}${n}.png`);
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

function loadDrawable(url, { keyBg = false } = {}) {
  return keyBg ? loadKeyedDrawable(url) : loadImage(url);
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
  return String(designId || "").startsWith("herb_");
}

function isOmniDesign(designId) {
  return String(designId || "").startsWith("omn_");
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

    // overlay parts + plants (from assets/sample)
    this.keyBg = true;
    this.parts = { horn: 0, wing: 0 };
    this.partUrls = { horn: "", wing: "" };
    this.partDrawables = { horn: null, wing: null };
    this.partLoading = { horn: null, wing: null };

    this.plantMode = "random"; // "random" or number
    this.plantDrawables = new Map(); // idx -> drawable
    this.plantLoading = new Map(); // idx -> Promise

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
    this.chewPhase = 0;
    this.chewFxT = 0;

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
    }
    const v = String(plant ?? "random");
    if (v === "random") this.plantMode = "random";
    else this.plantMode = clampInt(v, 1, PLANT_SET.count);
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
    if (this.plantMode === "random") return 1 + Math.floor(Math.random() * PLANT_SET.count);
    return clampInt(this.plantMode, 1, PLANT_SET.count);
  }

  _ensurePlantDrawable(idx) {
    const n = clampInt(idx, 1, PLANT_SET.count);
    if (this.plantDrawables.has(n)) return this.plantDrawables.get(n);
    if (this.plantLoading.has(n)) return null;

    const url = plantAssetUrl(n);
    const keyBg = Boolean(this.keyBg);
    const p = loadDrawable(url, { keyBg })
      .then((drawable) => {
        this.plantDrawables.set(n, drawable);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(err);
      })
      .finally(() => {
        this.plantLoading.delete(n);
      });

    this.plantLoading.set(n, p);
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
    if (kind === "plant") item.plantVariant = this._pickPlantVariant();
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
      this.state === "seek_food" ? "食事へ移動" : this.state === "eat" ? "食事" : this.foods.length ? "徘徊（食事待ち）" : "徘徊";
    this.statusEl.textContent = `状態: ${stateLabel} / 空腹: ${h}% / ごはん: ${this.foods.length}`;
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
    let idx = clampInt(food?.plantVariant ?? 0, 1, PLANT_SET.count);
    if (!Number.isFinite(Number(food?.plantVariant))) {
      idx = this._pickPlantVariant();
      if (food && typeof food === "object") food.plantVariant = idx;
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
    const size = 56;
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

    const img = this.spriteImg;
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

    const speed = Math.hypot(this.velX, this.velY);
    const moving = speed > 10 && this.state !== "eat";
    const walkAmt = moving ? clampNumber(speed / 160, 0, 1) : 0;
    const step = Math.sin(this.walkPhase);
    const bounce = moving ? Math.abs(step) : 0; // 0..1, two peaks per cycle
    const bounceCentered = bounce * 2 - 1; // -1..1 (foot contact low -> -1)
    const bob = moving
      ? bounceCentered * (this.tileSize * 0.09 * z) * (0.35 + 0.65 * walkAmt)
      : this.state === "eat"
        ? Math.sin(this.chewPhase) * (this.tileSize * 0.06 * z) * (0.4 + 0.6 * this.chewFxT)
        : 0;

    const facingLeft = this.velX < -10;
    const anchorY = 0.86;

    const sp = this.worldToScreen(this.posX, this.posY);
    const marks = faceMarksFor(this.designId);
    const chewAmt = clampNumber(this.chewFxT, 0, 1);

    ctx.save();
    ctx.translate(sp.x, sp.y + bob);
    if (facingLeft) ctx.scale(-1, 1);

    // walk: vertical bob + slight tilt (simple)
    const tilt = moving ? step * 0.085 * (0.35 + 0.65 * walkAmt) : 0;
    ctx.rotate(tilt);

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
      const fxX = sp.x + (facingLeft ? -drawW * 0.12 : drawW * 0.12);
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

function buildAssetThumbCard({ label, id, url }) {
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

  return { card, header, canvas, url: String(url || ""), id: String(id || ""), label: String(label || ""), token: "" };
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
  const simBtnReset = document.getElementById("sbSimReset");

  if (grid && location?.protocol === "file:") {
    return;
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

  const assetThumbs = [];
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
    for (let i = 1; i <= PLANT_SET.count; i++) {
      items.push({
        id: `plant_${i}`,
        label: `${PLANT_SET.label}${i}`,
        url: plantAssetUrl(i),
      });
    }

    for (const it of items) {
      const t = buildAssetThumbCard(it);
      assetsGrid.appendChild(t.card);
      assetThumbs.push(t);
    }
  }

  const drawAssetThumbs = ({ keyBg = false } = {}) => {
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
          drawContained(ctx, drawable, 0, 0, canvas.width, canvas.height);
        })
        .catch((err) => {
          if (t.token !== token) return;
          t.header.innerHTML = `<div>${escapeHtml(t.label)}</div><div style="opacity:.65">読み込み失敗</div>`;
          // eslint-disable-next-line no-console
          console.error(err);
        });
    }
  };

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
