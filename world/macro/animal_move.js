import { clamp } from "../../core/utils.js";
import {
  CLIMB_SPEED_PENALTY_AT_MAX,
  CLIMB_STAMINA_COST_AT_MAX,
  ELEVATION_MAX_METERS,
  ELEVATION_WINGLESS_MAX_CLIMB_METERS,
  FOOD_SPRINT_FULL_HUNGER_PCT,
  FOOD_SPRINT_START_HUNGER_PCT,
  PREGNANT_MOVE_SPEED_MUL,
} from "./constants.js";
import { wrapCoord, wrapDelta } from "./geom.js";
import { clamp01, smoothstep01 } from "./math.js";

export function stepAnimalMovement({
  world,
  entity,
  dt,
  tile,
  w,
  h,
  goal,
  staminaMax,
  stamina,
  hungerPct,
  reservePct,
  nnPaceMul,
  fleeing,
  attacking,
  foodMoveActive,
  mateMoveActive,
  territorySpeedMul,
  speedTraitMul,
  speedPxPerSec,
  tryMilk,
  tryEat,
  tryNestFeed,
}) {
  const e = entity;
  const moving = Boolean(goal) && !e._resting && staminaMax > 0 && stamina > 0.01;

  const brainPaceMul = clamp(Number(nnPaceMul) || 1, 0.8, 1.3);
  const basePaceMul = clamp((Number(e.genome?.wanderPaceMul) || 1) * brainPaceMul, 0.65, 1.3);
  const foodSprintMul = clamp((Number(e.genome?.foodSprintMul) || 1.18) * brainPaceMul, 0.95, 1.6);
  const mateSprintMul = clamp((Number(e.genome?.mateSprintMul) || 1.08) * brainPaceMul, 0.95, 1.45);

  const foodUrgencyT =
    FOOD_SPRINT_START_HUNGER_PCT > FOOD_SPRINT_FULL_HUNGER_PCT
      ? clamp01(
          (FOOD_SPRINT_START_HUNGER_PCT - hungerPct) / (FOOD_SPRINT_START_HUNGER_PCT - FOOD_SPRINT_FULL_HUNGER_PCT),
        )
      : 0;
  const foodUrgency01 = smoothstep01(foodUrgencyT);
  const stamina01 = staminaMax > 0 ? clamp01(stamina / staminaMax) : 1;

  let moveSpeedMul = basePaceMul;
  if (fleeing) {
    const base = Math.max(1, basePaceMul);
    const sprint01 = smoothstep01(clamp01((stamina01 - 0.1) / 0.3));
    moveSpeedMul = base + (2.5 - base) * sprint01;
  } else if (attacking) {
    const base = Math.max(1, basePaceMul);
    const sprint01 = smoothstep01(clamp01((stamina01 - 0.1) / 0.3));
    moveSpeedMul = base + (3.5 - base) * sprint01;
  } else if (foodMoveActive) {
    // When hunger is urgent, allow dipping into the stamina reserve to keep moving faster.
    const effectiveReservePct = clamp01(reservePct * (1 - foodUrgency01 * 0.75));
    const headroom01 = clamp01((stamina01 - effectiveReservePct) / Math.max(1e-6, 1 - effectiveReservePct));
    const t = clamp01(foodUrgency01 * (0.25 + 0.75 * headroom01));
    moveSpeedMul = basePaceMul + (foodSprintMul - basePaceMul) * t;
  } else if (mateMoveActive) {
    const headroom01 = clamp01((stamina01 - reservePct) / Math.max(1e-6, 1 - reservePct));
    moveSpeedMul = basePaceMul + (mateSprintMul - basePaceMul) * headroom01;
  }
  if (e.pregnant) moveSpeedMul *= PREGNANT_MOVE_SPEED_MUL;

  const terrMul = clamp(Number(territorySpeedMul) || 1, 1, 3);
  moveSpeedMul *= terrMul;

  if (!moving) {
    e.stamina = clamp((e.stamina ?? 0) + 7 * dt, 0, staminaMax);
    return;
  }

  let gx = wrapCoord(goal.x, w);
  let gy = wrapCoord(goal.y, h);
  let dx = wrapDelta(e.x, gx, w);
  let dy = wrapDelta(e.y, gy, h);
  let d = Math.hypot(dx, dy);

  const wingless = (Number(e.variant?.wingCount) || 0) <= 0;
  let terrainSpeedMul = 1;
  let terrainStaminaMul = 1;

  if (d > 0.001 && wingless) {
    const cx = Math.floor((Number(e.x) || 0) / tile);
    const cy = Math.floor((Number(e.y) || 0) / tile);
    const curH = world.getElevationAtTile(cx, cy);

    const ux0 = dx / d;
    const uy0 = dy / d;
    const look = Math.min(d, tile * 0.9);
    const lx0 = wrapCoord((Number(e.x) || 0) + ux0 * look, w);
    const ly0 = wrapCoord((Number(e.y) || 0) + uy0 * look, h);
    const ntx0 = Math.floor(lx0 / tile);
    const nty0 = Math.floor(ly0 / tile);
    let nextH = world.getElevationAtTile(ntx0, nty0);

    // If the next step is too high (>15m climb), steer locally around it (no full pathfinding).
    if (nextH - curH > ELEVATION_WINGLESS_MAX_CLIMB_METERS) {
      const ang0 = Math.atan2(uy0, ux0);
      const offsets = [
        Math.PI / 2,
        -Math.PI / 2,
        Math.PI / 4,
        -Math.PI / 4,
        (Math.PI * 3) / 4,
        (-Math.PI * 3) / 4,
        Math.PI,
      ];
      let best = null;
      for (const off of offsets) {
        const ang = ang0 + off;
        const vx = Math.cos(ang);
        const vy = Math.sin(ang);
        const lx = wrapCoord((Number(e.x) || 0) + vx * look, w);
        const ly = wrapCoord((Number(e.y) || 0) + vy * look, h);
        const ntx = Math.floor(lx / tile);
        const nty = Math.floor(ly / tile);
        const h2 = world.getElevationAtTile(ntx, nty);
        if (h2 - curH > ELEVATION_WINGLESS_MAX_CLIMB_METERS) continue;

        const dot = vx * ux0 + vy * uy0; // alignment with desired direction
        const climb = Math.max(0, h2 - curH);
        const score = dot - climb * 0.06 - (h2 / ELEVATION_MAX_METERS) * 0.03;
        if (!best || score > best.score) best = { vx, vy, h: h2, score };
      }

      if (best) {
        gx = wrapCoord((Number(e.x) || 0) + best.vx * tile * 1.2, w);
        gy = wrapCoord((Number(e.y) || 0) + best.vy * tile * 1.2, h);
        dx = wrapDelta(e.x, gx, w);
        dy = wrapDelta(e.y, gy, h);
        d = Math.hypot(dx, dy);
        nextH = best.h;
      } else {
        // Completely boxed in (should be rare): re-roll wander next tick and don't spend stamina here.
        e.wanderTimeLeft = 0;
        d = 0;
      }
    }

    const climbM = Math.max(0, nextH - curH);
    const t = clamp01(climbM / ELEVATION_WINGLESS_MAX_CLIMB_METERS);
    terrainSpeedMul = 1 - CLIMB_SPEED_PENALTY_AT_MAX * t;
    terrainStaminaMul = 1 + CLIMB_STAMINA_COST_AT_MAX * t;
  }

  if (!(d > 0.001)) {
    e.stamina = clamp((e.stamina ?? 0) + 7 * dt, 0, staminaMax);
    return;
  }

  e.stamina = clamp((e.stamina ?? 0) - 3 * speedTraitMul * moveSpeedMul * terrainStaminaMul * dt, 0, staminaMax);
  if ((e.stamina ?? 0) <= 0.01) e._resting = true;

  const stepDist = speedPxPerSec * moveSpeedMul * terrainSpeedMul * dt;
  const moved = Math.min(d, stepDist);
  e.moveImpulse = (e.moveImpulse ?? 0) + (tile > 0 ? moved / tile : moved);
  if (d <= stepDist) {
    e.x = gx;
    e.y = gy;
    tryMilk?.();
    tryEat?.();
    tryNestFeed?.();
  } else {
    const ux = dx / d;
    const uy = dy / d;
    e.x = wrapCoord(e.x + ux * stepDist, w);
    e.y = wrapCoord(e.y + uy * stepDist, h);
    tryMilk?.();
    tryEat?.();
    tryNestFeed?.();
  }

  e.x = wrapCoord(e.x, w);
  e.y = wrapCoord(e.y, h);
}
