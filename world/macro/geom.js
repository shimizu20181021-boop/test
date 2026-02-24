export function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function wrapCoord(v, span) {
  const s = Number(span) || 0;
  if (s <= 0) return 0;
  let x = v % s;
  if (x < 0) x += s;
  return x;
}

export function wrapDelta(from, to, span) {
  const s = Number(span) || 0;
  if (s <= 0) return (Number(to) || 0) - (Number(from) || 0);
  const half = s / 2;
  const raw = (Number(to) || 0) - (Number(from) || 0);
  return ((((raw + half) % s) + s) % s) - half;
}

export function dist2Wrapped(a, b, w, h) {
  const dx = wrapDelta(a.x, b.x, w);
  const dy = wrapDelta(a.y, b.y, h);
  return dx * dx + dy * dy;
}

