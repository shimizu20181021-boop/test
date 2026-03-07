// Elevation (height) generation for the macro world (tile-based).
// Heights are integer meters in the range 0..20.

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function seededInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function seededFloat(rng, min, max) {
  return rng() * (max - min) + min;
}

function wrapIndex(n, span) {
  const s = span | 0;
  if (s <= 0) return 0;
  let x = (n | 0) % s;
  if (x < 0) x += s;
  return x;
}

function torusDelta(a, b, span) {
  const s = Number(span) || 0;
  if (s <= 0) return Math.abs(a - b);
  const d = Math.abs(a - b);
  return Math.min(d, s - d);
}

function clampInt(n, min, max) {
  const v = Math.round(Number(n) || 0);
  return Math.max(min, Math.min(max, v));
}

function clamp01(n) {
  const v = Number(n) || 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

// Creates a "blob" elevation map:
// - Flat tiles are 0m
// - Mountains are contiguous blobs where every tile shares the same height (1..20m)
// - Target ratio: flat : mountain ≈ 4 : 1
export function generateElevationMap({ tileWidth, tileHeight, seed, mountainFraction }) {
  const tw = Math.max(1, Math.floor(tileWidth));
  const th = Math.max(1, Math.floor(tileHeight));
  const s = (Number(seed) || 0) >>> 0;
  const rng = mulberry32(s || 0x12345678);

  const area = tw * th;
  const fraction = clamp01(Number.isFinite(Number(mountainFraction)) ? Number(mountainFraction) : 0.2);
  const targetTiles = Math.max(0, Math.min(area, Math.round(area * fraction)));

  const tiles = new Uint8Array(area); // 0..20
  const labels = []; // { tx, ty, height, radiusTiles }
  const clusters = []; // { tx, ty, r }

  const span = Math.sqrt(area);
  const minR = clampInt(Math.round(span / 72) + 2, 3, 10);
  const maxR = clampInt(Math.round(span / 28) + 3, Math.max(minR + 2, 9), 26);
  const gap = clampInt(Math.round(span / 90) + 3, 3, 10);

  // Keep mountains more spread out by limiting how many separate blobs we place.
  const maxClusters = clampInt(Math.round(area / 420), 8, 420);

  const pickHeight = () => {
    // Mostly 1..15, but sometimes 16..20.
    if (rng() < 0.12) return seededInt(rng, 16, 20);
    const u = Math.pow(rng(), 1.25); // bias to lower values
    return clampInt(1 + Math.floor(u * 15), 1, 15);
  };

  const farEnough = (tx, ty, r) => {
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      const dx = torusDelta(tx, c.tx, tw);
      const dy = torusDelta(ty, c.ty, th);
      const min = r + c.r + gap;
      if (dx * dx + dy * dy <= min * min) return false;
    }
    return true;
  };

  let filled = 0;
  for (let ci = 0; ci < maxClusters && filled < targetTiles; ci++) {
    const r = seededInt(rng, minR, maxR);
    const height = pickHeight();

    let cx = 0;
    let cy = 0;
    let found = false;
    for (let tries = 0; tries < 14000; tries++) {
      const tx = seededInt(rng, 0, tw - 1);
      const ty = seededInt(rng, 0, th - 1);
      const idx = ty * tw + tx;
      if (tiles[idx] !== 0) continue;
      if (!farEnough(tx, ty, r)) continue;
      cx = tx;
      cy = ty;
      found = true;
      break;
    }
    if (!found) break;

    clusters.push({ tx: cx, ty: cy, r });
    labels.push({ tx: cx, ty: cy, height, radiusTiles: r });

    // Ensure the center tile is always part of the mountain.
    {
      const idx = cy * tw + cx;
      if (tiles[idx] === 0) {
        tiles[idx] = height;
        filled++;
      }
    }

    // Fill a slightly irregular blob around the center.
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > r + 0.45) continue;
        const t = r > 0 ? d / r : 1;

        // Keep almost everything in the interior, randomize only near the edge.
        let keep = true;
        if (t > 0.7) {
          const edgeT = (t - 0.7) / 0.3; // 0..1
          const p = 1 - edgeT * 0.75; // 1..0.25
          keep = rng() < p;
        }
        if (!keep) continue;

        const tx = wrapIndex(cx + dx, tw);
        const ty = wrapIndex(cy + dy, th);
        const idx = ty * tw + tx;
        if (tiles[idx] !== 0) continue;
        tiles[idx] = height;
        filled++;
        if (filled >= targetTiles) break;
      }
      if (filled >= targetTiles) break;
    }
  }

  return { tileWidth: tw, tileHeight: th, tiles, seed: s, labels };
}
