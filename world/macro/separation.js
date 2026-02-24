import { wrapCoord, wrapDelta } from "./geom.js";
import { isMacroNonAnimalKind } from "./kinds.js";
import { buildGrid, forEachInRadius } from "./spatial.js";

export function separationPass({ entities, tile, w, h }) {
  let alive = (entities || []).filter((e) => e && !e._dead);
  const grid = buildGrid(alive, tile * 2);

  for (const e of alive) {
    if (!e || e._dead) continue;
    if (isMacroNonAnimalKind(e.kind)) continue;

    forEachInRadius(grid, e.x, e.y, tile * 1.8, (idx) => {
      const o = alive[idx];
      if (!o || o._dead) return;
      if (o.id === e.id) return;

      if (isMacroNonAnimalKind(o.kind)) return;
      if (o.id <= e.id) return;

      const dx = wrapDelta(e.x, o.x, w);
      const dy = wrapDelta(e.y, o.y, h);
      const d = Math.hypot(dx, dy);
      const min = (e.radius ?? 0) + (o.radius ?? 0) + 10;
      const overlap = min - d;
      if (d > 0 && overlap > 1.2) {
        const push = overlap * 0.25;
        const ux = dx / d;
        const uy = dy / d;
        e.x -= ux * push;
        e.y -= uy * push;
        o.x += ux * push;
        o.y += uy * push;
      }
    });
  }

  for (const e of alive) {
    if (!e || e._dead) continue;
    e.x = wrapCoord(e.x, w);
    e.y = wrapCoord(e.y, h);
  }

  return alive;
}
