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
  // Snap to screen pixels to reduce hairline seams between tiles when zoom/pan lands on sub-pixels.
  ctx.setTransform(z, 0, 0, z, Math.round(tx), Math.round(ty));
}

function viewBounds(camera, canvas) {
  const z = Math.max(0.001, Number(camera.zoom) || 1);
  const w = canvas.width / z;
  const h = canvas.height / z;
  const left = Number(camera.x) || 0;
  const top = Number(camera.y) || 0;
  return { left, top, right: left + w, bottom: top + h, zoom: z };
}

function tileOverlapWorld(camera, overlapPx = 1) {
  const z = Math.max(0.001, Number(camera?.zoom) || 1);
  return Math.max(0, Number(overlapPx) || 0) / z;
}

function drawTile(ctx, img, x, y, size, overlapWorld) {
  if (!ctx || !img) return;
  const s = Math.max(0, Number(size) || 0);
  if (!(s > 0)) return;
  const ov = Math.max(0, Number(overlapWorld) || 0);
  const o2 = ov * 0.5;
  ctx.drawImage(img, x - o2, y - o2, s + ov, s + ov);
}

function prepareSeamlessTile(img, { outSize = 256, cropFrac = 0.16, edgeBlendFrac = 0.1 } = {}) {
  if (!img) return null;
  const sw = Number(img.naturalWidth || img.width || 0);
  const sh = Number(img.naturalHeight || img.height || 0);
  if (!(sw > 0 && sh > 0)) return null;

  const out = Math.max(32, Math.round(Number(outSize) || 256));
  const crop = clamp(Math.round(Math.min(sw, sh) * clamp(cropFrac, 0, 0.45)), 0, Math.floor(Math.min(sw, sh) / 2) - 1);
  const srcW = Math.max(1, sw - crop * 2);
  const srcH = Math.max(1, sh - crop * 2);

  const c = document.createElement("canvas");
  c.width = out;
  c.height = out;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return c;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, out, out);
  ctx.drawImage(img, crop, crop, srcW, srcH, 0, 0, out, out);

  const edge = clamp(Math.round(out * clamp(edgeBlendFrac, 0, 0.49)), 0, Math.floor(out / 2) - 1) | 0;
  const im = ctx.getImageData(0, 0, out, out);
  const d = im.data;

  // Devignette: many watercolor tiles have a dark outer vignette that becomes a visible grid when tiled.
  // We estimate edge vs center luminance and apply a gentle gain near the edges.
  {
    const step = 3;
    const sampleLuma = (x0, y0, w, h) => {
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y0 + h; y += step) {
        for (let x = x0; x < x0 + w; x += step) {
          const idx = (y * out + x) * 4;
          const a = d[idx + 3];
          if (a <= 0) continue;
          const r = d[idx];
          const g = d[idx + 1];
          const b = d[idx + 2];
          sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
          n++;
        }
      }
      return n > 0 ? sum / n : 0;
    };

    const centerSize = Math.max(8, Math.round(out * 0.22));
    const centerX = (out - centerSize) >> 1;
    const centerY = (out - centerSize) >> 1;
    const centerL = sampleLuma(centerX, centerY, centerSize, centerSize);

    const edgeW = Math.max(6, Math.round(out * 0.08));
    let edgeSum = 0;
    let edgeN = 0;
    for (let y = 0; y < out; y += step) {
      for (let x = 0; x < out; x += step) {
        const dist = Math.min(x, y, out - 1 - x, out - 1 - y);
        if (dist >= edgeW) continue;
        const idx = (y * out + x) * 4;
        const a = d[idx + 3];
        if (a <= 0) continue;
        const r = d[idx];
        const g = d[idx + 1];
        const b = d[idx + 2];
        edgeSum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        edgeN++;
      }
    }
    const edgeL = edgeN > 0 ? edgeSum / edgeN : 0;

    if (centerL > 1 && edgeL > 1 && edgeL < centerL * 0.97) {
      const gainMax = clamp(centerL / edgeL, 1, 1.55);
      const edgeStart = edgeW;
      const edgeEnd = Math.max(edgeStart + 2, Math.round(out * 0.28));
      for (let y = 0; y < out; y++) {
        for (let x = 0; x < out; x++) {
          const dist = Math.min(x, y, out - 1 - x, out - 1 - y);
          if (dist >= edgeEnd) continue;
          let t = (edgeEnd - dist) / Math.max(1, edgeEnd - edgeStart);
          t = clamp(t, 0, 1);
          t = t * t * (3 - 2 * t); // smoothstep
          const g = 1 + (gainMax - 1) * t;
          const idx = (y * out + x) * 4;
          const a = d[idx + 3];
          if (a <= 0) continue;
          d[idx] = clamp(Math.round(d[idx] * g), 0, 255);
          d[idx + 1] = clamp(Math.round(d[idx + 1] * g), 0, 255);
          d[idx + 2] = clamp(Math.round(d[idx + 2] * g), 0, 255);
        }
      }
    }
  }

  const blendEdgesLR = (src) => {
    for (let y = 0; y < out; y++) {
      const row = y * out;
      for (let x = 0; x < edge; x++) {
        const u = 1 - x / (edge - 1);
        const xr = out - edge + x;
        const il = (row + x) * 4;
        const ir = (row + xr) * 4;
        for (let k = 0; k < 4; k++) {
          const L = src[il + k];
          const R = src[ir + k];
          const A = (L + R) * 0.5;
          d[il + k] = L * (1 - u) + A * u;
          d[ir + k] = R * (1 - u) + A * u;
        }
      }
    }
  };

  const blendEdgesTB = (src) => {
    for (let y = 0; y < edge; y++) {
      const u = 1 - y / (edge - 1);
      const yr = out - edge + y;
      for (let x = 0; x < out; x++) {
        const it = (y * out + x) * 4;
        const ib = (yr * out + x) * 4;
        for (let k = 0; k < 4; k++) {
          const T = src[it + k];
          const B = src[ib + k];
          const A = (T + B) * 0.5;
          d[it + k] = T * (1 - u) + A * u;
          d[ib + k] = B * (1 - u) + A * u;
        }
      }
    }
  };

  if (edge >= 2) {
    blendEdgesLR(d.slice());
    blendEdgesTB(d.slice());
  }
  ctx.putImageData(im, 0, 0);
  return c;
}

// (No dedicated mountain-only mask here: keep it simple and render the stamp clipped by the
// already-drawn mountain layer using canvas compositing.)

function prepareMountainStamp(img, { tolerance = 50 } = {}) {
  if (!img) return null;
  const w = Number(img.naturalWidth || img.width || 0);
  const h = Number(img.naturalHeight || img.height || 0);
  if (!(w > 0 && h > 0)) return null;

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return c;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const im = ctx.getImageData(0, 0, w, h);
  const d = im.data;

  // Estimate background color from the four corners (mountain stamps are centered, corners are background).
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
    for (let y = y0; y < y0 + cs; y++) {
      for (let x = x0; x < x0 + cs; x++) {
        const idx = (y * w + x) * 4;
        const a = d[idx + 3];
        if (a <= 0) continue;
        br += d[idx];
        bg += d[idx + 1];
        bb += d[idx + 2];
        bn++;
      }
    }
  }
  if (bn <= 0) return c;
  br /= bn;
  bg /= bn;
  bb /= bn;

  const tol = clamp(Number(tolerance) || 50, 1, 140);
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

  // Flood-fill from edges and key out only the background-connected region (keeps interior highlights intact).
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
  return c;
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
  const varNoise = makeValueNoise(seed ^ 0x7f4a7c15, 18, { wTiles: w, hTiles: h });
  const warpAmp = 8.0; // tiles

  const islands = [];
  for (let k = 0; k < islandCount; k++) {
    const pick = rand01();
    const kind = pick < 0.55 ? 0 : pick < 0.85 ? 1 : 2; // grass > soil > sand
    const scale = 0.85 + rand01() * 0.8; // larger => larger region
    const baseVariant = (Math.floor(rand01() * 4) & 3) >>> 0;
    islands.push({ x: rand01() * w, y: rand01() * h, kind, scale, baseVariant });
  }

  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const i = worldIdx(tx, ty, w);
      const wx = tx + (warpX.at(tx, ty) - 0.5) * warpAmp;
      const wy = ty + (warpY.at(tx, ty) - 0.5) * warpAmp;

      let bestKind = 0;
      let bestVar = 0;
      let bestScore = 1e18;
      for (const isl of islands) {
        const dx = wx - isl.x;
        const dy = wy - isl.y;
        const d2 = dx * dx + dy * dy;
        const s = d2 / Math.max(0.0001, isl.scale * isl.scale);
        if (s < bestScore) {
          bestScore = s;
          bestKind = isl.kind;
          bestVar = isl.baseVariant & 3;
        }
      }

      const vn = clamp(varNoise.at(tx, ty), 0, 0.999999);
      ground[i] = bestKind;
      // Keep each "island" cohesive: pick a base tile variant per island,
      // with a small amount of low-frequency variation so it doesn't look too uniform.
      let v = bestVar & 3;
      if (vn > 0.88) v = (bestVar + 1) & 3;
      if (vn > 0.96) v = (bestVar + 2) & 3;
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
  const mountainBlendMask = { canvas: document.createElement("canvas"), ctx: null };
  mountainBlendMask.ctx = mountainBlendMask.canvas.getContext("2d");

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
    const ov = tileOverlapWorld(camera, 2);
    for (let ty = r.sY; ty <= r.eY; ty++) {
      for (let tx = r.sX; tx <= r.eX; tx++) {
        const i = worldIdx(tx, ty, world.w);
        const kind = world.ground[i];
        if (kind === 3) continue;
        const v = world.variant[i] & 3;
        const img = kind === 0 ? textures.grass[v] : kind === 1 ? textures.soil[v] : textures.sand[v];
        drawTile(ctx, img, tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, ov);
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
    const ov = tileOverlapWorld(camera, 2);

    // Base: draw per-tile mountain texture first.
    for (let ty = r.sY; ty <= r.eY; ty++) {
      for (let tx = r.sX; tx <= r.eX; tx++) {
        const i = worldIdx(tx, ty, world.w);
        if (world.ground[i] !== 3) continue;
        const hm = Number(world.getElevationAtTile(tx, ty)) || 0;
        const img = hm < 5 ? textures.mountainLow : hm < 10 ? textures.mountainMid : hm < 15 ? textures.mountainHigh : textures.mountainPeak;
        drawTile(ctx, img, tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, ov);
      }
    }

    // Overlay: draw the mountain stamp, then apply a soft mask so the mountain blends into the plains.
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
      ctx.filter = "contrast(1.08) saturate(1.05)";
      ctx.translate(cx, cy + size * 0.06);
      ctx.scale(flip, 1);
      ctx.rotate(rot);
      ctx.globalAlpha = alpha;
      ctx.drawImage(stamp, -size * 0.5, -size * 0.5, size, size);
      ctx.globalAlpha = alpha * 0.7;
      ctx.drawImage(stamp, -size * 0.5, -size * 0.5, size, size);
      ctx.filter = "none";
      ctx.restore();
    }

    ctx.restore();

    // Soft edge mask (smooth radial feather) to avoid the "cutout" look on the tile boundary.
    // We build a mask per mountain cluster (circle + feather) and apply it once.
    const mctx = mountainBlendMask.ctx;
    if (!mctx) return;
    if (mountainBlendMask.canvas.width !== ctx.canvas.width) mountainBlendMask.canvas.width = ctx.canvas.width;
    if (mountainBlendMask.canvas.height !== ctx.canvas.height) mountainBlendMask.canvas.height = ctx.canvas.height;

    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, mountainBlendMask.canvas.width, mountainBlendMask.canvas.height);
    mctx.imageSmoothingEnabled = true;
    mctx.imageSmoothingQuality = "high";
    setWorldTransform(mctx, camera);

    const corePadTiles = 1.0; // expands fully-opaque core beyond mountain tiles a bit
    const featherTiles = 2.0; // fades out into the plains
    const outerPadTiles = corePadTiles + featherTiles; // ~= 3 tiles (matches stamp margin)

    for (const c of clusters) {
      if (!c) continue;
      const minX = (c.x | 0) - (c.r | 0) - 6;
      const maxX = (c.x | 0) + (c.r | 0) + 6;
      const minY = (c.y | 0) - (c.r | 0) - 6;
      const maxY = (c.y | 0) + (c.r | 0) + 6;
      if (maxX < r.sX || minX > r.eX || maxY < r.sY || minY > r.eY) continue;

      const cx = (Number(c.x) + 0.5) * TILE_SIZE;
      const cy = (Number(c.y) + 0.5) * TILE_SIZE;
      const coreR = (Number(c.r) + corePadTiles) * TILE_SIZE;
      const outerR = (Number(c.r) + outerPadTiles) * TILE_SIZE;

      const g = mctx.createRadialGradient(cx, cy, coreR, cx, cy, outerR);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(1, "rgba(255,255,255,0)");

      mctx.save();
      mctx.globalCompositeOperation = "source-over";
      mctx.fillStyle = g;
      mctx.beginPath();
      mctx.arc(cx, cy, outerR, 0, Math.PI * 2);
      mctx.fill();

      // Ensure the mountain core stays fully opaque (avoids any haze from the feather blending).
      mctx.fillStyle = "rgba(255,255,255,1)";
      mctx.beginPath();
      mctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      mctx.fill();
      mctx.restore();
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    // small blur to hide any remaining pixel-edge artifacts (independent of zoom)
    ctx.filter = "blur(2px)";
    ctx.drawImage(mountainBlendMask.canvas, 0, 0);
    ctx.filter = "none";
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
    const tileOv = tileOverlapWorld(camera, 2);
    for (let ty = r.sY; ty <= r.eY; ty++) {
      for (let tx = r.sX; tx <= r.eX; tx++) {
        const i = worldIdx(tx, ty, world.w);
        if (!world.plantGreen[i]) continue;
        if (world.ground[i] === 3) continue;
        const ovIdx = ((tx * 73856093) ^ (ty * 19349663) ^ (world._biomeSeed * 83492791)) & 1;
        const overlayImg = textures.plantOverlays?.[ovIdx] || textures.plantOverlays?.[0];
        ctx.globalAlpha = 0.9;
        drawTile(ctx, overlayImg, tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, tileOv);
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
    const ov = tileOverlapWorld(camera, 2);
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
        drawTile(ctx, tint, tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, ov);
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
    if (wet > 0.01) {
      const x = r.sX * TILE_SIZE;
      const y = r.sY * TILE_SIZE;
      const w = (r.eX - r.sX + 1) * TILE_SIZE;
      const h = (r.eY - r.sY + 1) * TILE_SIZE;
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = 0.18 * wet;
      ctx.fillStyle = "rgb(120,145,165)";
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }

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

    const prep = (img) =>
      prepareSeamlessTile(img, {
        outSize: 256,
        cropFrac: 0.22,
        edgeBlendFrac: 0.14,
      }) || img;

    textures = {
      grass: grass.map(prep),
      soil: soil.map(prep),
      sand: sand.map(prep),
      mountainLow: prep(mountainLow),
      mountainMid: prep(mountainMid),
      mountainHigh: prep(mountainHigh),
      mountainPeak: prep(mountainPeak),
      mountainStamp: {
        low: prepareMountainStamp(mountainStamps?.[0], { tolerance: 56 }) || mountainStamps?.[0],
        mid: prepareMountainStamp(mountainStamps?.[1], { tolerance: 56 }) || mountainStamps?.[1],
        high: prepareMountainStamp(mountainStamps?.[2], { tolerance: 56 }) || mountainStamps?.[2],
        peak: prepareMountainStamp(mountainStamps?.[3], { tolerance: 56 }) || mountainStamps?.[3],
      },
      plantOverlays: plantOverlays.map(prep),
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
