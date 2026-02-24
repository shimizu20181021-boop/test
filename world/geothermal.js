// Geothermal (hot spring / ground heat) map generation for the macro world (tile-based).
// Values are floats in the range 0..1 and are torus-wrapped (world edges wrap around).

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

function clamp01(n) {
  const v = Number(n) || 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

export function generateGeothermalMap({ tileWidth, tileHeight, seed, clusterFraction }) {
  const tw = Math.max(1, Math.floor(tileWidth));
  const th = Math.max(1, Math.floor(tileHeight));
  const s = (Number(seed) || 0) >>> 0;
  const rng = mulberry32(s || 0x12345678);

  const area = tw * th;
  const frac = clamp01(Number.isFinite(Number(clusterFraction)) ? Number(clusterFraction) : 0.02);
  const targetTiles = Math.max(0, Math.min(area, Math.round(area * frac)));

  const tiles = new Float32Array(area);
  if (!(targetTiles > 0)) return { tileWidth: tw, tileHeight: th, tiles, seed: s };

  const span = Math.sqrt(area);
  const minR = Math.max(3, Math.min(10, Math.round(span / 90) + 3));
  const maxR = Math.max(minR + 2, Math.min(22, Math.round(span / 45) + 7));
  const maxClusters = Math.max(3, Math.min(120, Math.round(area / 5000)));

  let filled = 0;
  for (let ci = 0; ci < maxClusters && filled < targetTiles; ci++) {
    const cx = seededInt(rng, 0, tw - 1);
    const cy = seededInt(rng, 0, th - 1);
    const r = seededInt(rng, minR, maxR);
    const strength = seededFloat(rng, 0.65, 1.0);

    // Fill a soft blob around the center.
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > r + 0.45) continue;
        const t = r > 0 ? d / r : 1;
        const fall = Math.pow(1 - t, 1.35);
        const v = clamp01(strength * fall);
        if (!(v > 0)) continue;

        const tx = wrapIndex(cx + dx, tw);
        const ty = wrapIndex(cy + dy, th);
        const idx = ty * tw + tx;
        const prev = tiles[idx] || 0;
        if (prev < 1e-6 && v > 0.18) filled++;
        tiles[idx] = Math.max(prev, v);
        if (filled >= targetTiles) break;
      }
      if (filled >= targetTiles) break;
    }
  }

  return { tileWidth: tw, tileHeight: th, tiles, seed: s };
}

