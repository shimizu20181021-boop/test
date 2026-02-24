// Biome generation and palette utilities for the macro world.

export const BIOME_KIND = {
  gray: "gray",
  desert: "desert",
  red: "red",
  green: "green",
  lightCyan: "lightCyan",
  brown: "brown",
};

export const BIOMES = [
  {
    kind: BIOME_KIND.gray,
    label: "灰色",
    light: "#b6b6b6",
    dark: "#a8a8a8",
  },
  {
    kind: BIOME_KIND.desert,
    label: "砂漠色",
    light: "#d6c477",
    dark: "#cbb96c",
  },
  {
    kind: BIOME_KIND.red,
    label: "赤",
    light: "#c98a7a",
    dark: "#bc7f70",
  },
  {
    kind: BIOME_KIND.green,
    label: "緑",
    light: "#a7d5a6",
    dark: "#99c999",
  },
  {
    kind: BIOME_KIND.lightCyan,
    label: "薄い水色",
    light: "#9ad6d9",
    dark: "#8dcad0",
  },
  {
    kind: BIOME_KIND.brown,
    label: "茶色",
    light: "#b08a5a",
    dark: "#a47f52",
  },
];

export function biomeTileColor(biomeId, isEven) {
  const b = BIOMES[Number(biomeId) | 0] || BIOMES[0];
  return isEven ? b.light : b.dark;
}

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

export function generateBiomeMap({ tileWidth, tileHeight, seed, centerCount }) {
  const tw = Math.max(1, Math.floor(tileWidth));
  const th = Math.max(1, Math.floor(tileHeight));
  const s = (Number(seed) || 0) >>> 0;
  const rng = mulberry32(s || 0x12345678);

  const centersN = Math.max(10, Math.floor(centerCount ?? (tw * th) / 220));
  const centers = [];
  for (let i = 0; i < centersN; i++) {
    centers.push({
      x: seededFloat(rng, 0, tw),
      y: seededFloat(rng, 0, th),
      biomeId: i < BIOMES.length ? i : seededInt(rng, 0, BIOMES.length - 1),
    });
  }

  let tiles = new Uint8Array(tw * th);
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      let best = 0;
      let bestD2 = Infinity;
      const px = tx + 0.5;
      const py = ty + 0.5;
      for (let i = 0; i < centers.length; i++) {
        const c = centers[i];
        const dx = torusDelta(px, c.x, tw);
        const dy = torusDelta(py, c.y, th);
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = c.biomeId;
        }
      }
      tiles[ty * tw + tx] = best;
    }
  }

  // Smooth jagged borders a bit (majority filter, torus-wrapped).
  const counts = new Int16Array(BIOMES.length);
  let scratch = new Uint8Array(tiles.length);
  const iterations = 2;
  for (let iter = 0; iter < iterations; iter++) {
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        counts.fill(0);
        const idx = ty * tw + tx;
        const self = tiles[idx] | 0;
        counts[self] += 2; // slight bias to keep current tile

        for (let ny = -1; ny <= 1; ny++) {
          for (let nx = -1; nx <= 1; nx++) {
            if (nx === 0 && ny === 0) continue;
            const xx = wrapIndex(tx + nx, tw);
            const yy = wrapIndex(ty + ny, th);
            const v = tiles[yy * tw + xx] | 0;
            counts[v] += 1;
          }
        }

        let best = self;
        let bestC = -1;
        for (let b = 0; b < counts.length; b++) {
          const c = counts[b];
          if (c > bestC) {
            bestC = c;
            best = b;
          }
        }
        scratch[idx] = best;
      }
    }

    const prev = tiles;
    tiles = scratch;
    scratch = prev;
  }

  return { tileWidth: tw, tileHeight: th, tiles, seed: s };
}
