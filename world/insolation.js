// Sun exposure ("insolation") map generation for the macro world (tile-based).
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

export function generateSunExposureMap({ tileWidth, tileHeight, seed }) {
  const tw = Math.max(1, Math.floor(tileWidth));
  const th = Math.max(1, Math.floor(tileHeight));
  const s = (Number(seed) || 0) >>> 0;
  const rng = mulberry32(s || 0x12345678);

  const area = tw * th;
  let tiles = new Float32Array(area);
  for (let i = 0; i < tiles.length; i++) {
    // Slight bias to "sunny" tiles so the map isn't too uniform.
    tiles[i] = clamp01(Math.pow(rng(), 0.8));
  }

  // Smooth via repeated 3x3 weighted blur (torus wrapped).
  let scratch = new Float32Array(area);
  const iterations = 3;
  for (let iter = 0; iter < iterations; iter++) {
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        const idx = ty * tw + tx;
        let sum = (tiles[idx] || 0) * 4;

        const xL = wrapIndex(tx - 1, tw);
        const xR = wrapIndex(tx + 1, tw);
        const yU = wrapIndex(ty - 1, th);
        const yD = wrapIndex(ty + 1, th);

        sum += (tiles[ty * tw + xL] || 0) * 1;
        sum += (tiles[ty * tw + xR] || 0) * 1;
        sum += (tiles[yU * tw + tx] || 0) * 1;
        sum += (tiles[yD * tw + tx] || 0) * 1;

        // Diagonals (lighter weight).
        sum += (tiles[yU * tw + xL] || 0) * 0.5;
        sum += (tiles[yU * tw + xR] || 0) * 0.5;
        sum += (tiles[yD * tw + xL] || 0) * 0.5;
        sum += (tiles[yD * tw + xR] || 0) * 0.5;

        scratch[idx] = clamp01(sum / 10);
      }
    }
    const prev = tiles;
    tiles = scratch;
    scratch = prev;
  }

  return { tileWidth: tw, tileHeight: th, tiles, seed: s };
}

