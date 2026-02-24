import { randFloat } from "../../core/utils.js";
import { PARENTING_FEED_IDLE_VISIT_SECONDS, PARENTING_INCUBATE_STAY_SECONDS } from "./constants.js";

export function computeParentingContext({ entity, byId, dt }) {
  const parentingNest =
    entity.parentingNestId != null
      ? (() => {
          const n = byId.get(entity.parentingNestId);
          return n && !n._dead && n.kind === "nest" ? n : null;
        })()
      : null;
  if (parentingNest) {
    entity.parentingNestX = parentingNest.x;
    entity.parentingNestY = parentingNest.y;
  }
  const parentingPos =
    entity.parentingNestId != null && entity.parentingNestX != null && entity.parentingNestY != null
      ? { x: entity.parentingNestX, y: entity.parentingNestY }
      : null;

  // Parenting schedule: alternate between nest care and roaming.
  if (entity.parentingBreakSeconds == null) entity.parentingBreakSeconds = 0;
  {
    const prev = entity.parentingBreakSeconds ?? 0;
    entity.parentingBreakSeconds = Math.max(0, prev - dt);
    if (prev > 0 && (entity.parentingBreakSeconds ?? 0) <= 0) {
      // New "visit" starts after a break ends.
      entity.parentingVisitSeconds = 0;
      entity.parentingFedThisVisit = false;
    }
  }
  if (entity.parentingVisitSeconds == null) entity.parentingVisitSeconds = 0;

  const parentingModeNow = entity.parentingMode ?? null;
  const parentingModePrev = entity._parentingModePrev ?? null;
  if (parentingModeNow !== parentingModePrev) {
    entity._parentingModePrev = parentingModeNow;
    entity.parentingBreakSeconds = 0;
    entity.parentingVisitSeconds = 0;
    entity.parentingFedThisVisit = false;
    if (parentingModeNow === "incubate") {
      entity.parentingVisitTargetSeconds = randFloat(
        PARENTING_INCUBATE_STAY_SECONDS * 0.85,
        PARENTING_INCUBATE_STAY_SECONDS * 1.15,
      );
    } else if (parentingModeNow === "feed") {
      entity.parentingVisitTargetSeconds = randFloat(
        PARENTING_FEED_IDLE_VISIT_SECONDS * 0.85,
        PARENTING_FEED_IDLE_VISIT_SECONDS * 1.15,
      );
    } else {
      entity.parentingVisitTargetSeconds = 0;
    }
  }

  return { parentingNest, parentingPos };
}

