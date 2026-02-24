export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function randFloat(min, max) {
  return min + Math.random() * (max - min);
}

export function randIntInclusive(min, max) {
  return Math.floor(randFloat(min, max + 1));
}

export function chooseOne(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export function lengthSquared(dx, dy) {
  return dx * dx + dy * dy;
}

export function pairKey(a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return `${lo}:${hi}`;
}

