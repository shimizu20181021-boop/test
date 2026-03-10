import { clamp } from "../../core/utils.js";
import {
  ATTACK_COOLDOWN_SECONDS,
  ATTACK_ANIM_SECONDS,
  DANGER_ADD_ON_HIT,
  FEAR_ADD_ON_HIT_SECONDS,
  FEAR_MAX_SECONDS,
  FLEE_LOCK_SECONDS,
  FOOD_SEEK_START_HUNGER_PCT,
} from "./constants.js";
import { dist2Wrapped, wrapCoord } from "./geom.js";
import { isMacroNonAnimalKind } from "./kinds.js";
import { isCloseSpecies } from "./diet.js";
import { clampInt } from "./math.js";
import { findNearest } from "./spatial.js";

export function computeAttackTargetAndCreateTryStrike({
  world,
  entity,
  dietNow,
  hungerPct,
  entities,
  gridState,
  fleeRangePx,
  attackRangePx,
  canReachByTerrain,
  w,
  h,
  tile,
  tw,
  th,
  spawned,
  setAiState,
}) {
  let attackTarget = null;
  let tryStrike = () => false;

  if (dietNow !== "carnivore") return { attackTarget, tryStrike };
  const stage = String(entity?.lifeStage || "adult");
  if (stage !== "adult" && stage !== "youngAdult") return { attackTarget, tryStrike };
  const hunger = clamp(Number(hungerPct) || 0, 0, 1);
  if (hunger >= FOOD_SEEK_START_HUNGER_PCT) return { attackTarget, tryStrike };

  attackTarget = findNearest({
    entities,
    gridState,
    from: entity,
    radiusPx: fleeRangePx,
    world: { width: w, height: h },
    filter: (o) => {
      if (!o || o._dead) return false;
      if (isMacroNonAnimalKind(o.kind)) return false;
      if (isCloseSpecies(entity, o)) return false;
      return canReachByTerrain(o);
    },
  });

  if (!attackTarget) return { attackTarget, tryStrike };

  tryStrike = () => {
    if (!attackTarget || attackTarget._dead || entity._dead) return false;
    if ((entity.attackCooldownSeconds ?? 0) > 0) return false;

    const inStrikeRange = dist2Wrapped(entity, attackTarget, w, h) <= attackRangePx * attackRangePx;
    if (!inStrikeRange) return false;

    setAiState?.("攻撃", 11);
    attackTarget.hp = (attackTarget.hp ?? 0) - (entity.attackDamage ?? 1);
    attackTarget.hitFxSeconds = 0.25;

    attackTarget.fearSeconds = clamp((Number(attackTarget.fearSeconds) || 0) + FEAR_ADD_ON_HIT_SECONDS, 0, FEAR_MAX_SECONDS);
    attackTarget.wanderTimeLeft = 0;
    attackTarget.fleeLockSeconds = Math.max(attackTarget.fleeLockSeconds ?? 0, FLEE_LOCK_SECONDS);
    attackTarget.lastThreatId = entity.id;
    attackTarget.lastThreatX = entity.x;
    attackTarget.lastThreatY = entity.y;
    {
      const heat = attackTarget.dangerHeat instanceof Map ? attackTarget.dangerHeat : (attackTarget.dangerHeat = new Map());
      const px = wrapCoord(attackTarget.x, w);
      const py = wrapCoord(attackTarget.y, h);
      const tx0 = clampInt(Math.floor(px / tile), 0, Math.max(0, (tw ?? 0) - 1));
      const ty0 = clampInt(Math.floor(py / tile), 0, Math.max(0, (th ?? 0) - 1));
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = ((tx0 + dx) % tw + tw) % tw;
          const ty = ((ty0 + dy) % th + th) % th;
          const idx = ty * tw + tx;
          const wgt = dx === 0 && dy === 0 ? 1 : dx === 0 || dy === 0 ? 0.55 : 0.4;
          const add = DANGER_ADD_ON_HIT * wgt;
          heat.set(idx, (Number(heat.get(idx)) || 0) + add);
        }
      }
    }

    entity.attackCooldownSeconds = ATTACK_COOLDOWN_SECONDS;
    entity.attackAnimSeconds = ATTACK_ANIM_SECONDS;
    entity.hitFxSeconds = Math.max(entity.hitFxSeconds ?? 0, 0.1);
    entity.attackCount = (entity.attackCount ?? 0) + 1;
    entity.attackImpulse = (entity.attackImpulse ?? 0) + 1;

    if ((attackTarget.hp ?? 0) <= 0 && !attackTarget._dead) {
      attackTarget._dead = true;
      world._spawnMeatFromCorpse(attackTarget, spawned);
    }

    return true;
  };

  return { attackTarget, tryStrike };
}
