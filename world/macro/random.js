export function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function seededFloat(rng, min, max) {
  return rng() * (max - min) + min;
}

