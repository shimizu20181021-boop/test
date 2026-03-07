import { clamp } from "../core/utils.js";
import { WeatherFx } from "../render/weather_fx.js";

const ASSETS = {
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

const TILE_SIZE = 64;
const WORLD_TILES = { w: 200, h: 200 };
const TERRITORY_ALPHA_BY_LEVEL = [0, 0.12, 0.22, 0.32, 0.45];

const imageCache = new Map();
function loadImage(url) {
  const u = String(url || "");
  if (imageCache.has(u)) return imageCache.get(u);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`画像の読み込みに失敗: ${u}`));
    img.src = u;
  });
  imageCache.set(u, p);
  return p;
}

function resizeCanvasToDisplaySize(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    return true;
  }
  return false;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function worldIdx(tx, ty, w) {
  return ty * w + tx;
}

function setWorldTransform(ctx, camera) {
  const z = Math.max(0.001, Number(camera.zoom) || 1);
  const tx = -((Number(camera.x) || 0) * z);
  const ty = -((Number(camera.y) || 0) * z);
  ctx.setTransform(z, 0, 0, z, tx, ty);
}

function viewBounds(camera, canvas) {
  const z = Math.max(0.001, Number(camera.zoom) || 1);
  const w = canvas.width / z;
  const h = canvas.height / z;
  const left = Number(camera.x) || 0;
  const top = Number(camera.y) || 0;
  return { left, top, right: left + w, bottom: top + h, zoom: z };
}

function drawTile(ctx, img, x, y, size) {
  if (!ctx || !img) return;
  const s = Math.max(0, Number(size) || 0);
  if (!(s > 0)) return;
  ctx.drawImage(img, x, y, s, s);
}

function tileHash(tx, ty, salt) {
  const x = (Number(tx) | 0) * 92837111;
  const y = (Number(ty) | 0) * 689287499;
  return (x ^ y ^ (salt | 0)) >>> 0;
}

function pickFrom(imgs, tx, ty, salt) {
  const list = Array.isArray(imgs) ? imgs : [];
  if (!list.length) return null;
  const cs = 18;
  const x = Number(tx) || 0;
  const y = Number(ty) || 0;
  const fx = x / cs;
  const fy = y / cs;
  const ix0 = Math.floor(fx);
  const iy0 = Math.floor(fy);
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
  const idx = clamp(Math.floor(v * list.length), 0, list.length - 1) | 0;
  return list[idx] || list.find(Boolean) || null;
}

function clampCamera(camera, canvas, worldW, worldH) {
  const z = Math.max(0.001, Number(camera.zoom) || 1);
  const viewW = canvas.width / z;
  const viewH = canvas.height / z;
  camera.x = clamp(Number(camera.x) || 0, 0, Math.max(0, worldW - viewW));
  camera.y = clamp(Number(camera.y) || 0, 0, Math.max(0, worldH - viewH));
}

function zoomAt(camera, canvas, px, py, nextZoom, worldW, worldH) {
  const z0 = Math.max(0.001, Number(camera.zoom) || 1);
  const z1 = clamp(Number(nextZoom) || 1, 0.5, 2.8);
  const beforeX = (Number(camera.x) || 0) + px / z0;
  const beforeY = (Number(camera.y) || 0) + py / z0;
  camera.zoom = z1;
  const afterX = (Number(camera.x) || 0) + px / z1;
  const afterY = (Number(camera.y) || 0) + py / z1;
  camera.x += beforeX - afterX;
  camera.y += beforeY - afterY;
  clampCamera(camera, canvas, worldW, worldH);
  return z1;
}

function smoothstep01(t) {
  const x = clamp(Number(t) || 0, 0, 1);
  return x * x * (3 - 2 * x);
}

function makeValueNoise(seed, cellSizeTiles, { wTiles, hTiles } = {}) {
  const cs = Math.max(2, Number(cellSizeTiles) || 8);
  const w = Math.max(1, Number(wTiles) || 1);
  const h = Math.max(1, Number(hTiles) || 1);
  const gw = Math.ceil(w / cs) + 3;
  const gh = Math.ceil(h / cs) + 3;
  const rand01 = mulberry32(seed | 0);
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rand01();

  const sampleGrid = (ix, iy) => {
    const x = clamp(ix | 0, 0, gw - 1);
    const y = clamp(iy | 0, 0, gh - 1);
    return grid[y * gw + x] || 0;
  };

  const at = (x, y) => {
    const fx = Number(x) / cs;
    const fy = Number(y) / cs;
    const ix0 = Math.floor(fx);
    const iy0 = Math.floor(fy);
    const tx = smoothstep01(fx - ix0);
    const ty = smoothstep01(fy - iy0);

    const i00 = sampleGrid(ix0, iy0);
    const i10 = sampleGrid(ix0 + 1, iy0);
    const i01 = sampleGrid(ix0, iy0 + 1);
    const i11 = sampleGrid(ix0 + 1, iy0 + 1);

    const a = i00 * (1 - tx) + i10 * tx;
    const b = i01 * (1 - tx) + i11 * tx;
    return a * (1 - ty) + b * ty;
  };

  return { at };
}

function genWorld(seed) {
  const rand01 = mulberry32(seed);
  const w = WORLD_TILES.w;
  const h = WORLD_TILES.h;
  const n = w * h;

  // 0 grass / 1 soil / 2 sand / 3 mountain
  const ground = new Uint8Array(n);
  const variant = new Uint8Array(n);
  const elevation = new Uint8Array(n);
  const plantGreen = new Uint8Array(n);
  const terrGroup = new Int16Array(n);
  const terrLevel = new Uint8Array(n);

  for (let i = 0; i < n; i++) terrGroup[i] = -1;

  // Biomes as "islands" (contiguous regions) using weighted Voronoi + coordinate warp.
  const islandCount = 14;
  const warpX = makeValueNoise(seed ^ 0x9e3779b9, 22, { wTiles: w, hTiles: h });
  const warpY = makeValueNoise(seed ^ 0x85ebca6b, 22, { wTiles: w, hTiles: h });
  const variantMainNoise = makeValueNoise(seed ^ 0x7f4a7c15, 42, { wTiles: w, hTiles: h });
  const variantDetailNoise = makeValueNoise(seed ^ 0x94d049bb, 18, { wTiles: w, hTiles: h });
  const warpAmp = 8.0; // tiles

  const islands = [];
  for (let k = 0; k < islandCount; k++) {
    const pick = rand01();
    const kind = pick < 0.55 ? 0 : pick < 0.85 ? 1 : 2; // grass > soil > sand
    const scale = 0.85 + rand01() * 0.8; // larger => larger region
    const baseVariant = (Math.floor(rand01() * 4) & 3) >>> 0;
    const accentVariant = (baseVariant + 1 + ((rand01() * 2) | 0)) & 3;
    const rareVariant = (accentVariant + 1 + ((rand01() * 2) | 0)) & 3;
    islands.push({ x: rand01() * w, y: rand01() * h, kind, scale, baseVariant, accentVariant, rareVariant });
  }

  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const i = worldIdx(tx, ty, w);
      const wx = tx + (warpX.at(tx, ty) - 0.5) * warpAmp;
      const wy = ty + (warpY.at(tx, ty) - 0.5) * warpAmp;

      let bestKind = 0;
      let bestIsland = null;
      let bestScore = 1e18;
      let secondScore = 1e18;
      for (const isl of islands) {
        const dx = wx - isl.x;
        const dy = wy - isl.y;
        const d2 = dx * dx + dy * dy;
        const s = d2 / Math.max(0.0001, isl.scale * isl.scale);
        if (s < bestScore) {
          secondScore = bestScore;
          bestScore = s;
          bestKind = isl.kind;
          bestIsland = isl;
        } else if (s < secondScore) {
          secondScore = s;
        }
      }

      ground[i] = bestKind;
      const inside01 = clamp((secondScore - bestScore) / 1.8, 0, 1);
      const vnMain = clamp(variantMainNoise.at(tx, ty), 0, 0.999999);
      const vnDetail = clamp(variantDetailNoise.at(tx, ty), 0, 0.999999);

      // Keep each island mostly on its main tile. Only allow variant changes well inside the island,
      // and keep those changes patchy/low-frequency so the ground reads as a cohesive surface.
      let v = bestIsland ? bestIsland.baseVariant & 3 : 0;
      if (bestIsland && inside01 > 0.4 && vnMain > 0.84) v = bestIsland.accentVariant & 3;
      if (bestIsland && inside01 > 0.72 && vnMain > 0.95 && vnDetail > 0.78) v = bestIsland.rareVariant & 3;
      variant[i] = v;
    }
  }

  // Smooth the biome map a bit (removes speckles, keeps "islands" cohesive).
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(n);
    next.set(ground);
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const i = worldIdx(tx, ty, w);
        const self = ground[i];
        if (self === 3) continue;

        const counts = [0, 0, 0];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const x = tx + dx;
            const y = ty + dy;
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            const k = ground[worldIdx(x, y, w)];
            if (k === 0 || k === 1 || k === 2) counts[k]++;
          }
        }

        let bestK = self;
        let bestC = -1;
        for (let k = 0; k < 3; k++) {
          if (counts[k] > bestC) {
            bestC = counts[k];
            bestK = k;
          }
        }
        // if strong neighborhood majority, switch
        if (bestK !== self && bestC >= 5) next[i] = bestK;
      }
    }
    ground.set(next);
  }

  // Smooth only the tile variants inside the same ground kind.
  // This reduces the visible tile-by-tile "patchwork" while preserving some hand-drawn variation.
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(n);
    next.set(variant);
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const i = worldIdx(tx, ty, w);
        const selfGround = ground[i];
        if (selfGround === 3) continue;
        const selfVar = variant[i] & 3;
        const counts = [0, 0, 0, 0];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const x = tx + dx;
            const y = ty + dy;
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            const ni = worldIdx(x, y, w);
            if (ground[ni] !== selfGround) continue;
            counts[variant[ni] & 3]++;
          }
        }
        let bestVar = selfVar;
        let bestCount = counts[selfVar];
        for (let k = 0; k < 4; k++) {
          if (counts[k] > bestCount) {
            bestCount = counts[k];
            bestVar = k;
          }
        }
        if (bestVar !== selfVar && bestCount >= 5) next[i] = bestVar;
      }
    }
    variant.set(next);
  }

  // mountain clusters (coherent height)
  const clusters = [];
  for (let k = 0; k < 12; k++) {
    clusters.push({
      x: (rand01() * w) | 0,
      y: (rand01() * h) | 0,
      r: 6 + ((rand01() * 11) | 0),
      h: 1 + ((rand01() * 20) | 0),
    });
  }
  for (const c of clusters) {
    const r2 = c.r * c.r;
    for (let dy = -c.r; dy <= c.r; dy++) {
      for (let dx = -c.r; dx <= c.r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const tx = c.x + dx;
        const ty = c.y + dy;
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
        const i = worldIdx(tx, ty, w);
        ground[i] = 3;
        elevation[i] = c.h;
        variant[i] = (rand01() * 4) | 0;
      }
    }
  }

  // plants: mark 8-neighborhood
  for (let p = 0; p < 110; p++) {
    const tx0 = (rand01() * w) | 0;
    const ty0 = (rand01() * h) | 0;
    const i0 = worldIdx(tx0, ty0, w);
    if (ground[i0] === 3) continue;
    const gk = ground[i0];
    // fewer plants on sand/soil
    if (gk === 2 && rand01() < 0.75) continue;
    if (gk === 1 && rand01() < 0.45) continue;
    if (gk === 0 && rand01() < 0.15) continue;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = tx0 + dx;
        const ty = ty0 + dy;
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
        const i = worldIdx(tx, ty, w);
        if (ground[i] !== 3) plantGreen[i] = 1;
      }
    }
  }

  // territory: few centers, 4-level by distance
  const colors = [
    { name: "赤", rgb: { r: 245, g: 90, b: 90 } },
    { name: "青", rgb: { r: 80, g: 140, b: 255 } },
    { name: "紫", rgb: { r: 170, g: 110, b: 245 } },
    { name: "橙", rgb: { r: 255, g: 160, b: 70 } },
    { name: "桃", rgb: { r: 255, g: 130, b: 180 } },
  ];
  const groups = [];
  for (let g = 0; g < 5; g++) {
    groups.push({ id: g, x: (rand01() * w) | 0, y: (rand01() * h) | 0, color: colors[g % colors.length] });
  }
  const maxR = 54;
  const maxR2 = maxR * maxR;
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const i = worldIdx(tx, ty, w);
      if (ground[i] === 3) continue;
      let best = null;
      let bestD2 = 1e18;
      for (const g of groups) {
        const dx = tx - g.x;
        const dy = ty - g.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = g;
        }
      }
      if (!best || bestD2 > maxR2) continue;
      const u = clamp(1 - Math.sqrt(bestD2) / maxR, 0, 1);
      terrGroup[i] = best.id;
      terrLevel[i] = clamp(1 + Math.floor(u * 4), 1, 4);
    }
  }

  return {
    _biomeSeed: seed,
    w,
    h,
    ground,
    variant,
    elevation,
    _mountainClusters: clusters,
    plantGreen,
    terrGroup,
    terrLevel,
    terrGroups: groups,
    getElevationAtTile(tx, ty) {
      const x = tx | 0;
      const y = ty | 0;
      if (x < 0 || y < 0 || x >= w || y >= h) return 0;
      return elevation[worldIdx(x, y, w)] || 0;
    },
  };
}

function main() {
  const canvas = document.getElementById("msCanvas");
  const seasonSel = document.getElementById("msSeason");
  const weatherSel = document.getElementById("msWeather");
  const zoomRange = document.getElementById("msZoom");
  const zoomVal = document.getElementById("msZoomVal");
  const wetEl = document.getElementById("msWet");
  const snowEl = document.getElementById("msSnow");
  const randomizeBtn = document.getElementById("msRandomize");
  const layerMount = document.getElementById("msLayerMount");
  const layerPlant = document.getElementById("msLayerPlant");
  const layerTerr = document.getElementById("msLayerTerr");
  const layerWetSnow = document.getElementById("msLayerWetSnow");
  const layerFx = document.getElementById("msLayerFx");
  if (!canvas) return;
  if (location?.protocol === "file:") return;

  const mainCtx = canvas.getContext("2d");
  if (!mainCtx) return;

  const layers = {};
  for (const k of ["ground", "mountain", "plant", "territory", "wetSnow"]) {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d");
    layers[k] = { canvas: c, ctx };
  }

  function syncLayerCanvases() {
    const w = canvas.width;
    const h = canvas.height;
    for (const l of Object.values(layers)) {
      if (l.canvas.width !== w) l.canvas.width = w;
      if (l.canvas.height !== h) l.canvas.height = h;
    }
  }

  const weatherFx = new WeatherFx();
  let seed = 1337;
  let world = genWorld(seed);
  const worldW = world.w * TILE_SIZE;
  const worldH = world.h * TILE_SIZE;

  const camera = { x: 0, y: 0, zoom: 1 };

  const state = {
    season: String(seasonSel?.value || "spring"),
    weather: String(weatherSel?.value || "sunny"),
  };

  function setZoomUI(z) {
    if (zoomRange) zoomRange.value = String(z);
    if (zoomVal) zoomVal.textContent = Number(z).toFixed(2);
  }

  function fit() {
    resizeCanvasToDisplaySize(canvas);
    syncLayerCanvases();
    const v = viewBounds(camera, canvas);
    camera.x = (worldW - (v.right - v.left)) * 0.5;
    camera.y = (worldH - (v.bottom - v.top)) * 0.5;
    clampCamera(camera, canvas, worldW, worldH);
  }

  function applySeason() {
    state.season = String(seasonSel?.value || "spring");
  }
  function applyWeather() {
    state.weather = String(weatherSel?.value || "sunny");
  }
  function applyZoom() {
    const z = clamp(Number(zoomRange?.value) || 1, 0.5, 2.8);
    camera.zoom = z;
    if (zoomVal) zoomVal.textContent = z.toFixed(2);
    clampCamera(camera, canvas, worldW, worldH);
  }

  seasonSel?.addEventListener("change", applySeason);
  weatherSel?.addEventListener("change", applyWeather);
  zoomRange?.addEventListener("input", applyZoom);
  randomizeBtn?.addEventListener("click", () => {
    seed = (seed + 99991) | 0;
    world = genWorld(seed);
    fit();
  });

  // camera interaction
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    camera.x -= dx / Math.max(0.001, camera.zoom);
    camera.y -= dy / Math.max(0.001, camera.zoom);
    clampCamera(camera, canvas, worldW, worldH);
  });
  canvas.addEventListener("pointerup", () => {
    dragging = false;
  });
  canvas.addEventListener("pointercancel", () => {
    dragging = false;
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const dpr = window.devicePixelRatio || 1;
      const px = e.offsetX * dpr;
      const py = e.offsetY * dpr;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const z = zoomAt(camera, canvas, px, py, camera.zoom * factor, worldW, worldH);
      setZoomUI(z);
    },
    { passive: false },
  );

  // tints (cached)
  const tintCache = new Map();
  function tintMask(rgb, maskImg) {
    const key = `${rgb.r},${rgb.g},${rgb.b}`;
    const cached = tintCache.get(key);
    if (cached) return cached;
    const w = maskImg.naturalWidth || maskImg.width || 0;
    const h = maskImg.naturalHeight || maskImg.height || 0;
    if (!(w > 0 && h > 0)) return null;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(maskImg, 0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    tintCache.set(key, c);
    return c;
  }

  let textures = null;
  function groundTextureForKind(kind, tx, ty) {
    if (!textures) return null;
    if (kind === 0) return pickFrom(textures.grass, tx, ty, 0x13579bdf);
    if (kind === 1) return pickFrom(textures.soil, tx, ty, 0x2468ace0);
    if (kind === 2) return pickFrom(textures.sand, tx, ty, 0x9e3779b9);
    return null;
  }

  function tileRange(v) {
    const sX = clamp(Math.floor(v.left / TILE_SIZE) - 1, 0, world.w - 1) | 0;
    const sY = clamp(Math.floor(v.top / TILE_SIZE) - 1, 0, world.h - 1) | 0;
    const eX = clamp(Math.floor(v.right / TILE_SIZE) + 1, 0, world.w - 1) | 0;
    const eY = clamp(Math.floor(v.bottom / TILE_SIZE) + 1, 0, world.h - 1) | 0;
    return { sX, sY, eX, eY };
  }

  function drawGround(ctx, r) {
    if (!ctx || !textures) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    setWorldTransform(ctx, camera);
    for (let ty = r.sY; ty <= r.eY; ty++) {
      for (let tx = r.sX; tx <= r.eX; tx++) {
        const i = worldIdx(tx, ty, world.w);
        const kind = world.ground[i];
        if (kind === 3) continue;
        const img = groundTextureForKind(kind, tx, ty);
        drawTile(ctx, img, tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE);
      }
    }
  }

  function drawMountains(ctx, r) {
    if (!ctx || !textures) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!layerMount?.checked) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    setWorldTransform(ctx, camera);
    for (let ty = r.sY; ty <= r.eY; ty++) {
      for (let tx = r.sX; tx <= r.eX; tx++) {
        const i = worldIdx(tx, ty, world.w);
        if (world.ground[i] !== 3) continue;
        const hm = Number(world.getElevationAtTile(tx, ty)) || 0;
        const img = hm < 5 ? textures.mountainLow : hm < 10 ? textures.mountainMid : hm < 15 ? textures.mountainHigh : textures.mountainPeak;
        drawTile(ctx, img, tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE);
      }
    }

    const stampSet = textures.mountainStamp;
    const clusters = world?._mountainClusters;
    if (!stampSet || !clusters?.length) return;

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    for (const c of clusters) {
      if (!c) continue;
      const minX = (c.x | 0) - (c.r | 0) - 3;
      const maxX = (c.x | 0) + (c.r | 0) + 3;
      const minY = (c.y | 0) - (c.r | 0) - 3;
      const maxY = (c.y | 0) + (c.r | 0) + 3;
      if (maxX < r.sX || minX > r.eX || maxY < r.sY || minY > r.eY) continue;

      const cx = (Number(c.x) + 0.5) * TILE_SIZE;
      const cy = (Number(c.y) + 0.5) * TILE_SIZE;
      const size = (Number(c.r) * 2 + 6) * TILE_SIZE;
      const h01 = clamp((Number(c.h) || 0) / 20, 0, 1);
      const alpha = 0.88 + 0.08 * h01;
      const hash = (c.x * 928371) ^ (c.y * 19349663) ^ (world._biomeSeed * 83492791);
      const flip = (hash & 1) === 1 ? -1 : 1;
      const rot = (((hash >>> 1) % 9) - 4) * 0.045;

      const hm = Number(c.h) || 0;
      const stamp = hm < 5 ? stampSet.low : hm < 10 ? stampSet.mid : hm < 15 ? stampSet.high : stampSet.peak;
      if (!stamp) continue;

      ctx.save();
      ctx.translate(cx, cy + size * 0.06);
      ctx.scale(flip, 1);
      ctx.rotate(rot);
      ctx.globalAlpha = alpha;
      ctx.drawImage(stamp, -size * 0.5, -size * 0.5, size, size);
      ctx.globalAlpha = alpha * 0.7;
      ctx.drawImage(stamp, -size * 0.5, -size * 0.5, size, size);
      ctx.restore();
    }

    ctx.restore();
  }

  function drawPlants(ctx, r) {
    if (!ctx || !textures) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!layerPlant?.checked) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    setWorldTransform(ctx, camera);
    for (let ty = r.sY; ty <= r.eY; ty++) {
      for (let tx = r.sX; tx <= r.eX; tx++) {
        const i = worldIdx(tx, ty, world.w);
        if (!world.plantGreen[i]) continue;
        if (world.ground[i] === 3) continue;
        const overlayImg = pickFrom(textures.plantOverlays, tx, ty, 0x2f6e2b1);
        ctx.globalAlpha = 0.9;
        drawTile(ctx, overlayImg, tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE);
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawTerritory(ctx, r) {
    if (!ctx || !textures) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!layerTerr?.checked) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    setWorldTransform(ctx, camera);
    for (let ty = r.sY; ty <= r.eY; ty++) {
      for (let tx = r.sX; tx <= r.eX; tx++) {
        const i = worldIdx(tx, ty, world.w);
        const lvl = world.terrLevel[i] | 0;
        if (lvl <= 0) continue;
        const gid = world.terrGroup[i] | 0;
        const g = world.terrGroups[gid];
        if (!g) continue;
        const alpha = TERRITORY_ALPHA_BY_LEVEL[lvl] ?? 0.22;
        const tint = tintMask(g.color.rgb, textures.territoryMask);
        if (!tint) continue;
        ctx.globalAlpha = alpha;
        drawTile(ctx, tint, tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE);
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawWetSnow(ctx, r) {
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!layerWetSnow?.checked) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    setWorldTransform(ctx, camera);

    // "濡れ"の雰囲気（濡れるほど少し暗く、冷たくなる）
    const wet = clamp(weatherFx.wetness01, 0, 1);
    weatherFx.drawMacroGroundOverlays(ctx, world, {
      startX: r.sX,
      endX: r.eX,
      startY: r.sY,
      endY: r.eY,
      tileSize: TILE_SIZE,
      hasElevation: true,
    });
  }

  function composite() {
    mainCtx.setTransform(1, 0, 0, 1, 0, 0);
    mainCtx.clearRect(0, 0, canvas.width, canvas.height);
    mainCtx.drawImage(layers.ground.canvas, 0, 0);
    if (layerMount?.checked) mainCtx.drawImage(layers.mountain.canvas, 0, 0);
    if (layerPlant?.checked) mainCtx.drawImage(layers.plant.canvas, 0, 0);
    if (layerTerr?.checked) mainCtx.drawImage(layers.territory.canvas, 0, 0);
    if (layerWetSnow?.checked) mainCtx.drawImage(layers.wetSnow.canvas, 0, 0);
  }

  function drawFx(dt) {
    void dt;
    const enabled = layerFx ? layerFx.checked : true;
    if (!enabled) return;
    weatherFx.drawScreenOverlay(mainCtx, state.weather, { screenW: canvas.width, screenH: canvas.height });
  }

  let last = performance.now();

  async function boot() {
    const [grass, soil, sand, mountainLow, mountainMid, mountainHigh, mountainPeak, mountainStamps, plantOverlays, territoryMask] = await Promise.all([
      Promise.all(ASSETS.grass.map((p) => loadImage(p))),
      Promise.all(ASSETS.soil.map((p) => loadImage(p))),
      Promise.all(ASSETS.sand.map((p) => loadImage(p))),
      loadImage(ASSETS.mountain.low),
      loadImage(ASSETS.mountain.mid),
      loadImage(ASSETS.mountain.high),
      loadImage(ASSETS.mountain.peak),
      Promise.all([ASSETS.mountainStamp.low, ASSETS.mountainStamp.mid, ASSETS.mountainStamp.high, ASSETS.mountainStamp.peak].map((p) => loadImage(p))),
      Promise.all(ASSETS.plantOverlay.map((p) => loadImage(p))),
      loadImage(ASSETS.territoryMask),
    ]);

    textures = {
      grass,
      soil,
      sand,
      mountainLow,
      mountainMid,
      mountainHigh,
      mountainPeak,
      mountainStamp: {
        low: mountainStamps?.[0],
        mid: mountainStamps?.[1],
        high: mountainStamps?.[2],
        peak: mountainStamps?.[3],
      },
      plantOverlays,
      territoryMask,
    };

    fit();
    applySeason();
    applyWeather();
    applyZoom();

    function tick(now) {
      const t = Number(now) || performance.now();
      const dt = clamp((t - last) / 1000, 0, 0.06);
      last = t;

      resizeCanvasToDisplaySize(canvas);
      syncLayerCanvases();

      const v = viewBounds(camera, canvas);
      const r = tileRange(v);

      weatherFx.step(dt, state.weather, {
        screenW: canvas.width,
        screenH: canvas.height,
        macroWorld: world,
        viewBoundsWorld: v,
      });
      if (wetEl) wetEl.textContent = `${Math.round(clamp(weatherFx.wetness01, 0, 1) * 100)}%`;
      if (snowEl) snowEl.textContent = `${Math.round(clamp(weatherFx.snowCover01, 0, 1) * 100)}%`;

      drawGround(layers.ground.ctx, r);
      drawMountains(layers.mountain.ctx, r);
      drawPlants(layers.plant.ctx, r);
      drawTerritory(layers.territory.ctx, r);
      drawWetSnow(layers.wetSnow.ctx, r);
      composite();
      drawFx(dt);

      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  window.addEventListener("resize", fit);
  fit();
  boot().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
  });
}

main();
