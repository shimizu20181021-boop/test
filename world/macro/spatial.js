import { dist2, dist2Wrapped } from "./geom.js";

export function buildGrid(entities, cellSize) {
  const grid = new Map();
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!e || e._dead) continue;
    const cx = Math.floor(e.x / cellSize);
    const cy = Math.floor(e.y / cellSize);
    const key = `${cx},${cy}`;
    const cell = grid.get(key);
    if (cell) cell.push(i);
    else grid.set(key, [i]);
  }
  return { grid, cellSize };
}

export function forEachInRadius({ grid, cellSize }, x, y, radiusPx, cb) {
  const minCx = Math.floor((x - radiusPx) / cellSize);
  const maxCx = Math.floor((x + radiusPx) / cellSize);
  const minCy = Math.floor((y - radiusPx) / cellSize);
  const maxCy = Math.floor((y + radiusPx) / cellSize);

  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const cell = grid.get(`${cx},${cy}`);
      if (!cell) continue;
      for (const idx of cell) cb(idx);
    }
  }
}

export function findNearest({ entities, gridState, from, radiusPx, filter, world }) {
  let best = null;
  let bestD2 = radiusPx * radiusPx;

  const w = world?.width;
  const h = world?.height;
  const useWrap = Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0;
  const shiftsX = [0];
  const shiftsY = [0];

  if (useWrap) {
    if (from.x - radiusPx < 0) shiftsX.push(w);
    if (from.x + radiusPx > w) shiftsX.push(-w);
    if (from.y - radiusPx < 0) shiftsY.push(h);
    if (from.y + radiusPx > h) shiftsY.push(-h);
  }

  for (const sx of shiftsX) {
    for (const sy of shiftsY) {
      forEachInRadius(gridState, from.x + sx, from.y + sy, radiusPx, (idx) => {
        const e = entities[idx];
        if (!e || e._dead) return;
        if (e.id === from.id) return;
        if (filter && !filter(e)) return;
        const d2 = useWrap ? dist2Wrapped(from, e, w, h) : dist2(from, e);
        if (d2 < bestD2) {
          bestD2 = d2;
          best = e;
        }
      });
    }
  }

  return best;
}

