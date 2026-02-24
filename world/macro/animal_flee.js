import { clamp } from "../../core/utils.js";
import { FLEE_LOCK_SECONDS } from "./constants.js";
import { wrapDelta } from "./geom.js";
import { isMacroNonAnimalKind } from "./kinds.js";
import { dietTypeForEntity } from "./diet.js";
import { findNearest } from "./spatial.js";

export function computeFleeGoal({
  entity,
  dietNow,
  entities,
  gridState,
  fleeRangePx,
  w,
  h,
  tile,
  hasGoal,
  setAiState,
}) {
  const fearActive = (entity.fearSeconds ?? 0) > 0;
  const canFleeLearned = fearActive && (dietNow === "herbivore" || dietNow === "omnivore");

  let threat = null;
  if (canFleeLearned) {
    threat = findNearest({
      entities,
      gridState,
      from: entity,
      radiusPx: fleeRangePx,
      world: { width: w, height: h },
      filter: (o) => o && !o._dead && !isMacroNonAnimalKind(o.kind) && dietTypeForEntity(o) === "carnivore",
    });

    if (threat) {
      entity.fleeLockSeconds = Math.max(entity.fleeLockSeconds ?? 0, FLEE_LOCK_SECONDS);
      entity.lastThreatId = threat.id;
      entity.lastThreatX = threat.x;
      entity.lastThreatY = threat.y;
    }
  }

  let goal = null;
  let fleeing = false;
  if (!hasGoal && canFleeLearned && (threat || (entity.fleeLockSeconds ?? 0) > 0)) {
    const tx = threat?.x ?? entity.lastThreatX;
    const ty = threat?.y ?? entity.lastThreatY;
    if (tx != null && ty != null) {
      setAiState?.("逃走", 10);
      fleeing = true;
      const dx = wrapDelta(tx, entity.x, w);
      const dy = wrapDelta(ty, entity.y, h);
      const d = Math.hypot(dx, dy);
      if (d > 0.001) {
        const ux = dx / d;
        const uy = dy / d;
        const dist = clamp(tile * 12 + (fleeRangePx - d) * 0.2, tile * 10, tile * 18);
        goal = { x: entity.x + ux * dist, y: entity.y + uy * dist };
      } else {
        goal = { x: entity.x + tile * 10, y: entity.y };
      }
    }
  }

  return { goal, fleeing };
}

