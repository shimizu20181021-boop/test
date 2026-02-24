import { clamp, randFloat } from "../../core/utils.js";
import { DANGER_WANDER_SAMPLE_COUNT } from "./constants.js";
import { wrapCoord, wrapDelta } from "./geom.js";
import { clampInt } from "./math.js";

function dangerPenaltyAt({ heat, x, y, w, h, tile, tw, th }) {
  if (!(heat instanceof Map) || heat.size === 0) return 0;
  const px = wrapCoord(x, w);
  const py = wrapCoord(y, h);
  const tx0 = clampInt(Math.floor(px / tile), 0, tw - 1);
  const ty0 = clampInt(Math.floor(py / tile), 0, th - 1);
  let penalty = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = ((tx0 + dx) % tw + tw) % tw;
      const ty = ((ty0 + dy) % th + th) % th;
      const idx = ty * tw + tx;
      const v = Number(heat.get(idx)) || 0;
      if (!(v > 0)) continue;
      const wgt = dx === 0 && dy === 0 ? 1 : dx === 0 || dy === 0 ? 0.35 : 0.25;
      penalty += v * wgt;
    }
  }
  return penalty;
}

export function computeWanderGoal({
  entity,
  world,
  tile,
  w,
  h,
  tw,
  th,
  wanderDistanceTiles,
  dangerWeight,
  tempBias,
  envTempC,
  socialGroupCenters,
  socialGroupCenterList,
  hasMother,
  isChild,
  mother,
}) {
  const distTiles = clamp(Number(wanderDistanceTiles) || 9, 4, 60);
  const distPx = tile * distTiles;
  const dangerMul = clamp(Number(dangerWeight) || 1, 0, 6);

  const tb = clamp(Number(tempBias) || 0, -1, 1);
  const t0Raw = envTempC;
  const t0 = Number(t0Raw);
  const hasT0 = t0Raw != null && Number.isFinite(t0);
  const canTemp =
    tb !== 0 && hasT0 && world && typeof world.getEnvironmentTempAtWorld === "function";
  const tempScaleC = 20;
  const tempWeight = 0.6;

  if ((entity.wanderTimeLeft ?? 0) <= 0) {
    const baseAngle = randFloat(0, Math.PI * 2);
    let bestAngle = baseAngle;
    let bestScore = Infinity;
    const samples = Math.max(1, Math.min(12, clampInt(DANGER_WANDER_SAMPLE_COUNT, 1, 12)));
    for (let i = 0; i < samples; i++) {
      const jitter = randFloat(-0.35, 0.35);
      const ang = baseAngle + (i / samples) * Math.PI * 2 + jitter;
      const gx = entity.x + Math.cos(ang) * distPx;
      const gy = entity.y + Math.sin(ang) * distPx;
      const danger = dangerPenaltyAt({ heat: entity.dangerHeat, x: gx, y: gy, w, h, tile, tw, th });
      let score = danger * dangerMul + randFloat(0, 0.02);
      if (canTemp) {
        const g = Number(world.getEnvironmentTempAtWorld(gx, gy));
        if (Number.isFinite(g)) {
          const d = clamp((g - t0) / tempScaleC, -3, 3);
          score += -tb * d * tempWeight;
        }
      }
      if (score < bestScore) {
        bestScore = score;
        bestAngle = ang;
      }
    }

    entity.wanderAngle = bestAngle;
    const timeMul = clamp(distTiles / 9, 1, 2.6);
    entity.wanderTimeLeft = randFloat(1.8, 4.8) * timeMul;
  }

  const dx = Math.cos(entity.wanderAngle) * distPx;
  const dy = Math.sin(entity.wanderAngle) * distPx;
  const goal = { x: entity.x + dx, y: entity.y + dy };

  const center = entity.socialGroupId ? socialGroupCenters.get(entity.socialGroupId) : null;
  if (center && entity.socialMode === "group") {
    const cohesion = clamp((entity.ageSeconds ?? 0) / 120, 0, 1);
    const mix = cohesion * 0.65;
    goal.x = goal.x * (1 - mix) + center.x * mix;
    goal.y = goal.y * (1 - mix) + center.y * mix;
  }
  // Keep packs separated so large populations don't clump into one blob.
  if (center && entity.socialMode === "group" && socialGroupCenterList.length > 1) {
    const sepRangePx = tile * 12;
    const sepRange2 = sepRangePx * sepRangePx;
    let rx = 0;
    let ry = 0;
    for (const c of socialGroupCenterList) {
      if (!c || c.id === entity.socialGroupId) continue;
      const dx = wrapDelta(c.x, entity.x, w);
      const dy = wrapDelta(c.y, entity.y, h);
      const d2 = dx * dx + dy * dy;
      if (d2 <= 1e-6 || d2 > sepRange2) continue;
      const d = Math.sqrt(d2);
      const t = 1 - d / sepRangePx;
      const strength = t * t;
      rx += (dx / d) * strength;
      ry += (dy / d) * strength;
    }
    const push = tile * 3.2;
    goal.x += rx * push;
    goal.y += ry * push;
  }

  if (hasMother && isChild && mother) {
    const mix = 0.55;
    goal.x = goal.x * (1 - mix) + mother.x * mix;
    goal.y = goal.y * (1 - mix) + mother.y * mix;
  }

  return goal;
}
