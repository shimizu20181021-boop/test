import { clamp, randFloat } from "../../core/utils.js";
import {
  BASE_STAT,
  CHILD_MILK_START_HUNGER_PCT,
  CHILD_MILK_STOP_HUNGER_PCT,
  DEV_DECAY_ATTACK_TAU,
  DEV_DECAY_EXPLORE_TAU,
  DEV_DECAY_MOVE_TAU,
  ELEVATION_WINGLESS_MAX_CLIMB_METERS,
  EXPEDITION_FAILSAFE_SECONDS,
  EXPEDITION_RESOURCE_SCAN_TILES,
  EXPEDITION_SAMPLE_MAX_TILES,
  EXPEDITION_SAMPLE_MIN_TILES,
  FEAR_MAX_SECONDS,
  FOLLOW_MOTHER_ENTER_TILES,
  FOLLOW_MOTHER_EXIT_TILES,
  FOOD_RESERVE_OVERRIDE_HUNGER_PCT,
  FOOD_SEEK_START_HUNGER_PCT,
  FOOD_SEEK_STOP_HUNGER_PCT,
  NEST_WARM_RANGE_TILES,
  PARENTING_FEED_IDLE_BREAK_SECONDS,
  PARENTING_FEED_IDLE_VISIT_SECONDS,
  PARENTING_INCUBATE_BREAK_SECONDS,
  PARENTING_INCUBATE_STAY_SECONDS,
  RESERVE_REST_EXIT_MULT,
  RESERVE_REST_MIN_SECONDS,
  TURN_SPEED_TILES_PER_SECOND,
} from "./constants.js";
import { dist2Wrapped, wrapCoord, wrapDelta } from "./geom.js";
import { clamp01, clampInt, decayExp } from "./math.js";
import { findNearest, forEachInRadius } from "./spatial.js";
import { isMacroNonAnimalKind } from "./kinds.js";
import { dietTypeForEntity, isCloseSpecies, scaledAttackDamage } from "./diet.js";
import { speedMultiplierFromTraitCode } from "./traits.js";
import { applyDietAppearanceShift } from "./variant.js";
import { applyLifeStageScaling } from "./stats.js";
import { evolutionStepEntity } from "./evolution_step.js";
import { stepAnimalMovement } from "./animal_move.js";
import { computeFoodAndCreateTryEat, createTryMilk, createTryNestFeed } from "./animal_feed.js";
import { computeAttackTargetAndCreateTryStrike } from "./animal_attack.js";
import { tryReproduce } from "./animal_reproduction.js";
import { computeParentingContext } from "./animal_parenting.js";
import { computeFleeGoal } from "./animal_flee.js";
import { computeWanderGoal } from "./animal_wander.js";
import {
  BRAIN_HIDDEN,
  BRAIN_INPUTS,
  BRAIN_MODE_COUNT,
  BRAIN_MODES,
  BRAIN_OUT_COMMIT,
  BRAIN_OUT_DANGER,
  BRAIN_OUT_PACE,
  BRAIN_OUT_TEMP_BIAS,
  BRAIN_OUTPUTS,
  decodeBrain01,
  ensureBrain,
  policyGradientUpdate,
  forwardBrain,
} from "./brain.js";

const MODE_REST = Math.max(0, BRAIN_MODES.indexOf("rest"));
const MODE_WANDER = Math.max(0, BRAIN_MODES.indexOf("wander"));
const MODE_FOOD = Math.max(0, BRAIN_MODES.indexOf("food"));
const MODE_FLEE = Math.max(0, BRAIN_MODES.indexOf("flee"));
const MODE_MATE = Math.max(0, BRAIN_MODES.indexOf("mate"));
const MODE_HUNT = Math.max(0, BRAIN_MODES.indexOf("hunt"));
const MODE_EXPEDITION = Math.max(0, BRAIN_MODES.indexOf("expedition"));
const MODE_PARENTING = Math.max(0, BRAIN_MODES.indexOf("parenting"));
const LEARNED_ACTION_MODE_IDXS = [MODE_REST, MODE_WANDER, MODE_FOOD, MODE_HUNT, MODE_EXPEDITION];

const RL_BRAIN_LOGIT_SCALE = 0.85;
const RL_DECISION_MIN_SECONDS = 0.5;
const RL_DECISION_MAX_SECONDS = 1.0;
const RL_TEMPERATURE = 0.85;
const RL_EPSILON = 0.02;
const RL_LEARNING_RATE = 0.03;
const RL_BASELINE_ALPHA = 0.05;
const RL_MOVE_REWARD_PER_TILE = 0.015;
const RL_PHI_STAMINA_W = 0.35;
const RL_PHI_HP_W = 0.6;
const RL_PHI_THERMAL_W = 0.25;
const RL_TERRITORY_TILE_REWARD_W = 0.0015;
const RL_TERRITORY_ACTIVITY_TILES = 0.9;
const RL_HEAD_SIGMA_PACE_LOGIT = 0.35;
const RL_HEAD_SIGMA_DANGER_LOGIT = 0.35;
const RL_HEAD_SIGMA_COMMIT_LOGIT = 0.25;
const RL_HEAD_SIGMA_TEMP_LOGIT = 0.35;
const RL_HEAD_LEARNING_RATE_MUL = 0.2;
const RL_FOOD_PROGRESS_REWARD_W = 0.28;
const RL_HUNT_PROGRESS_REWARD_W = 0.28;
const RL_URGENT_PROGRESS_BONUS_W = 0.2;
const RL_LOST_TARGET_PENALTY_W = 0.18;
const RL_URGENT_IDLE_PENALTY_W = 0.08;
const RL_EXPEDITION_RESOURCE_REWARD_W = 0.32;
const RL_EXPEDITION_DEFICIT_REWARD_W = 0.26;
const RL_EXPEDITION_SUCCESS_BONUS_W = 0.18;
const RL_EXPEDITION_STALL_PENALTY_W = 0.08;

let _randnSpare = null;
function randNormal() {
  if (Number.isFinite(_randnSpare)) {
    const v = _randnSpare;
    _randnSpare = null;
    return v;
  }
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const mag = Math.sqrt(-2 * Math.log(u));
  const z0 = mag * Math.cos(2 * Math.PI * v);
  const z1 = mag * Math.sin(2 * Math.PI * v);
  _randnSpare = z1;
  return z0;
}

function forEachNearbyWrapped({ gridState, x, y, radiusPx, w, h, cb }) {
  const seen = new Set();
  const shiftsX = [0];
  const shiftsY = [0];
  if (x - radiusPx < 0) shiftsX.push(w);
  if (x + radiusPx > w) shiftsX.push(-w);
  if (y - radiusPx < 0) shiftsY.push(h);
  if (y + radiusPx > h) shiftsY.push(-h);
  for (const sx of shiftsX) {
    for (const sy of shiftsY) {
      forEachInRadius(gridState, x + sx, y + sy, radiusPx, (idx) => {
        if (seen.has(idx)) return;
        seen.add(idx);
        cb(idx);
      });
    }
  }
}

function canReachTerrainPoint({ world, x, y, tile, tw, th, currentElevationMeters, isBird }) {
  if (isBird) return true;
  const tx = clampInt(Math.floor(wrapCoord(x, tw * tile) / tile), 0, tw - 1);
  const ty = clampInt(Math.floor(wrapCoord(y, th * tile) / tile), 0, th - 1);
  const targetElevation = world.getElevationAtTile(tx, ty);
  if (targetElevation > ELEVATION_WINGLESS_MAX_CLIMB_METERS && currentElevationMeters <= ELEVATION_WINGLESS_MAX_CLIMB_METERS)
    return false;
  return true;
}

function getGroupResourceThresholds(dietNow, groupSize) {
  const size = Math.max(1, Number(groupSize) || 1);
  if (dietNow === "carnivore") return { start: 150 * size, end: 220 * size };
  if (dietNow === "omnivore") return { start: 130 * size, end: 190 * size };
  return { start: 120 * size, end: 180 * size };
}

function scoreResourceTotals(dietNow, totals) {
  const plantHp = Math.max(0, Number(totals?.plantHp) || 0);
  const meatHp = Math.max(0, Number(totals?.meatHp) || 0);
  const preyHp = Math.max(0, Number(totals?.preyHp) || 0);
  if (dietNow === "carnivore") return meatHp + preyHp * 0.6;
  if (dietNow === "omnivore") return plantHp * 0.7 + (meatHp + preyHp * 0.6) * 0.3;
  return plantHp;
}

function computeResourceTotalsAt({
  world,
  entity,
  entities,
  gridState,
  x,
  y,
  radiusPx,
  dietNow,
  canReachByTerrain,
  w,
  h,
}) {
  const r2 = radiusPx * radiusPx;
  let plantHp = 0;
  let meatHp = 0;
  let preyHp = 0;
  forEachNearbyWrapped({
    gridState,
    x,
    y,
    radiusPx,
    w,
    h,
    cb: (idx) => {
      const other = entities[idx];
      if (!other || other._dead) return;
      const d2 = dist2Wrapped({ x, y }, other, w, h);
      if (d2 > r2) return;
      if (other.kind === "plant") {
        plantHp += Math.max(0, Number(other.hp) || Number(other.baseHpMax) || 0);
        return;
      }
      if (other.kind === "meat") {
        meatHp += Math.max(0, Number(other.hp) || Number(other.baseHp) || 0);
        return;
      }
      if (isMacroNonAnimalKind(other.kind)) return;
      if (other.id === entity.id) return;
      if (!canReachByTerrain(other)) return;
      if (isCloseSpecies(entity, other)) return;
      preyHp += Math.max(0, Number(other.hp) || Number(other.hpMax) || 0);
    },
  });
  return {
    plantHp,
    meatHp,
    preyHp,
    score: scoreResourceTotals(dietNow, { plantHp, meatHp, preyHp }),
  };
}

function pickExpeditionTarget({
  world,
  entity,
  entities,
  gridState,
  originX,
  originY,
  dietNow,
  canReachByTerrain,
  currentElevationMeters,
  isBird,
  tile,
  tw,
  th,
  w,
  h,
  radiusPx,
}) {
  const minDistPx = tile * EXPEDITION_SAMPLE_MIN_TILES;
  const maxDistPx = tile * EXPEDITION_SAMPLE_MAX_TILES;
  const startAngle = randFloat(0, Math.PI * 2);
  let best = null;
  for (let i = 0; i < 8; i++) {
    const angle = startAngle + (Math.PI * 2 * i) / 8;
    const distPx = randFloat(minDistPx, maxDistPx);
    const x = wrapCoord(originX + Math.cos(angle) * distPx, w);
    const y = wrapCoord(originY + Math.sin(angle) * distPx, h);
    if (
      !canReachTerrainPoint({
        world,
        x,
        y,
        tile,
        tw,
        th,
        currentElevationMeters,
        isBird,
      })
    )
      continue;
    const totals = computeResourceTotalsAt({
      world,
      entity,
      entities,
      gridState,
      x,
      y,
      radiusPx,
      dietNow,
      canReachByTerrain,
      w,
      h,
    });
    const score = totals.score + randFloat(0, 0.01);
    if (!best || score > best.score) best = { x, y, score };
  }
  return best;
}

export function stepAnimalAi({
  world,
  entity,
  entities,
  byId,
  gridState,
  socialGroupCenters,
  socialGroupCenterList,
  socialGroups,
  dt,
  tile,
  w,
  h,
  tw,
  th,
  attackRangePx,
  reproRangePx,
  foodSearchPx,
  fleeRangePx,
  popCounts,
  spawned,
  plantHungerRecoverMul,
  meatHungerRecoverFraction,
  nnVizFocusId,
}) {
  const e = entity;
  if (!e || e._dead) return;
  if (isMacroNonAnimalKind(e.kind)) return;

  e.attackImpulse = decayExp(e.attackImpulse ?? 0, dt, DEV_DECAY_ATTACK_TAU);
  e.moveImpulse = decayExp(e.moveImpulse ?? 0, dt, DEV_DECAY_MOVE_TAU);
  e.exploreImpulse = decayExp(e.exploreImpulse ?? 0, dt, DEV_DECAY_EXPLORE_TAU);

  const dietNow = e._dietNow || dietTypeForEntity(e);

  const staminaMax = Math.max(0, e.staminaMax ?? 0);
  if (e._resting) {
    e.stamina = clamp((e.stamina ?? 0) + 8 * dt, 0, staminaMax);
    if (staminaMax > 0 && e.stamina >= staminaMax * 0.25) e._resting = false;
  }

  const hpMax = Math.max(1, e.hpMax ?? BASE_STAT);
  const hungerPct = clamp((e.hungerMax ?? 0) > 0 ? (e.hunger ?? 0) / e.hungerMax : 1, 0, 1);

  const isBirdForTargeting = e.taxon === "bird";
  const curTx = clampInt(Math.floor(wrapCoord(e.x, w) / tile), 0, tw - 1);
  const curTy = clampInt(Math.floor(wrapCoord(e.y, h) / tile), 0, th - 1);
  const curH = !isBirdForTargeting ? world.getElevationAtTile(curTx, curTy) : 0;
  const canReachByTerrain = (o) => {
    if (isBirdForTargeting) return true;
    if (!o || o._dead) return false;
    const px = wrapCoord(o.x, w);
    const py = wrapCoord(o.y, h);
    const tx = clampInt(Math.floor(px / tile), 0, tw - 1);
    const ty = clampInt(Math.floor(py / tile), 0, th - 1);
    const h2 = world.getElevationAtTile(tx, ty);
    // Wingless animals cannot climb onto mountains higher than 15m, so avoid targeting them.
    if (h2 > ELEVATION_WINGLESS_MAX_CLIMB_METERS) return curH > ELEVATION_WINGLESS_MAX_CLIMB_METERS;
    return true;
  };

  if (e.fleeLockSeconds == null) e.fleeLockSeconds = 0;
  e.fleeLockSeconds = Math.max(0, (e.fleeLockSeconds ?? 0) - dt);

  if (e.foodTargetLockSeconds == null) e.foodTargetLockSeconds = 0;
  e.foodTargetLockSeconds = Math.max(0, (e.foodTargetLockSeconds ?? 0) - dt);

  if (e.reserveRestLockSeconds == null) e.reserveRestLockSeconds = 0;
  e.reserveRestLockSeconds = Math.max(0, (e.reserveRestLockSeconds ?? 0) - dt);
  if (e.reserveRestActive == null) e.reserveRestActive = false;

  if (e.foodSeekActive == null) e.foodSeekActive = false;
  if (!e.foodSeekActive && hungerPct <= FOOD_SEEK_START_HUNGER_PCT) e.foodSeekActive = true;
  if (e.foodSeekActive && hungerPct >= FOOD_SEEK_STOP_HUNGER_PCT) e.foodSeekActive = false;

  const stage = e.lifeStage || "adult";
  const isBaby = stage === "baby";
  const isChild = stage === "child";
  const isNestling = e.nestId != null && (isBaby || isChild);
  const homeNest = e.nestId != null ? byId.get(e.nestId) : null;
  if (e.nestId != null && (!homeNest || homeNest._dead || homeNest.kind !== "nest")) {
    e.nestId = null;
  }
  if (isNestling) e.foodSeekActive = false;

  const { parentingNest, parentingPos } = computeParentingContext({ entity: e, byId, dt });

  const mother = e.motherId ? byId.get(e.motherId) : null;
  const hasMother =
    !isNestling &&
    Boolean(mother) &&
    !mother._dead &&
    mother.kind !== "plant" &&
    mother.kind !== "meat" &&
    mother.sex === "female";

  const socialGroup = e.socialGroupId ? socialGroups?.get(e.socialGroupId) : null;
  const socialCenter = e.socialGroupId ? socialGroupCenters?.get(e.socialGroupId) : null;
  const isGrouped = e.socialMode === "group" && Boolean(socialGroup);
  const groupSize = Math.max(1, Number(socialGroup?.size) || 1);
  const groupLeaderId = socialGroup?.leaderId ?? e.id;
  const isGroupLeader = isGrouped && groupLeaderId === e.id;
  const groupLeader = isGrouped ? (groupLeaderId === e.id ? e : byId.get(groupLeaderId)) : null;
  const memberIds = Array.isArray(socialGroup?.memberIds) && socialGroup.memberIds.length > 0 ? socialGroup.memberIds : [e.id];
  const groupAvgHungerPct = clamp01(
    memberIds.reduce((sum, memberId) => {
      const member = byId.get(memberId);
      if (!member || member._dead || (member.hungerMax ?? 0) <= 0) return sum;
      return sum + clamp((member.hunger ?? 0) / member.hungerMax, 0, 1);
    }, 0) / Math.max(1, memberIds.length),
  );
  const resourceScanPx = EXPEDITION_RESOURCE_SCAN_TILES * tile;
  const resourceOriginX = socialCenter?.x ?? e.x;
  const resourceOriginY = socialCenter?.y ?? e.y;
  const expeditionPreEligible =
    isGrouped && isGroupLeader && !isBaby && !isChild && !isNestling && !hasMother && !parentingPos && !e.pregnant;
  const localResourceTotals = isGrouped
    ? computeResourceTotalsAt({
        world,
        entity: e,
        entities,
        gridState,
        x: resourceOriginX,
        y: resourceOriginY,
        radiusPx: resourceScanPx,
        dietNow,
        canReachByTerrain,
        w,
        h,
      })
    : { plantHp: 0, meatHp: 0, preyHp: 0, score: 0 };
  const expeditionThresholds = getGroupResourceThresholds(dietNow, groupSize);
  const localResourceScore = localResourceTotals.score;
  const localResourceScore01 = clamp01(localResourceScore / Math.max(1, expeditionThresholds.end));
  const groupAvgHungerNeed01 = clamp01(1 - groupAvgHungerPct);
  const resourceDeficit01 = clamp01(
    (expeditionThresholds.start - localResourceScore) / Math.max(1, expeditionThresholds.start),
  );
  const groupSize01 = clamp01(groupSize / 12);

  let expeditionCandidate = null;
  if (expeditionPreEligible) {
    expeditionCandidate = pickExpeditionTarget({
      world,
      entity: e,
      entities,
      gridState,
      originX: resourceOriginX,
      originY: resourceOriginY,
      dietNow,
      canReachByTerrain,
      currentElevationMeters: curH,
      isBird: isBirdForTargeting,
      tile,
      tw,
      th,
      w,
      h,
      radiusPx: resourceScanPx,
    });
  }
  const bestCandidateScore = Math.max(localResourceScore, Number(expeditionCandidate?.score) || 0);
  const bestCandidateScore01 = clamp01(bestCandidateScore / Math.max(1, expeditionThresholds.end));

  if (isGroupLeader) {
    if (e.expeditionFailSafeSeconds == null) e.expeditionFailSafeSeconds = 0;
    e.expeditionFailSafeSeconds = Math.max(0, (e.expeditionFailSafeSeconds ?? 0) - dt);
    e.expeditionLocalScore = localResourceScore;
    e.expeditionBestCandidateScore = bestCandidateScore;
    e.expeditionStartThreshold = expeditionThresholds.start;
    e.expeditionEndThreshold = expeditionThresholds.end;
    e.expeditionGroupAvgHungerPct = groupAvgHungerPct;
    e.expeditionGroupSize = groupSize;
    if (
      e.expeditionActive &&
      (localResourceScore >= expeditionThresholds.end || (e.expeditionFailSafeSeconds ?? 0) <= 0)
    ) {
      e.expeditionActive = false;
      e.expeditionFailSafeSeconds = 0;
      e.expeditionTargetX = null;
      e.expeditionTargetY = null;
    }
  }

  const leaderExpeditionActive = Boolean(groupLeader?.expeditionActive);
  const leaderExpeditionTarget =
    leaderExpeditionActive &&
    Number.isFinite(Number(groupLeader?.expeditionTargetX)) &&
    Number.isFinite(Number(groupLeader?.expeditionTargetY))
      ? { x: Number(groupLeader.expeditionTargetX), y: Number(groupLeader.expeditionTargetY) }
      : null;
  const expeditionEligible = expeditionPreEligible && groupAvgHungerPct <= 0.55;

  let aiState = "徘徊";
  let aiPriority = 0;
  const setAiState = (label, priority) => {
    if (!label) return;
    if (priority >= aiPriority) {
      aiState = label;
      aiPriority = priority;
    }
  };

  if (e._resting) setAiState("休憩", 2);

  if (hasMother && isChild) {
    if (e.milkSeekActive == null) e.milkSeekActive = false;
    if (!e.milkSeekActive && hungerPct < CHILD_MILK_START_HUNGER_PCT) e.milkSeekActive = true;
    if (e.milkSeekActive && hungerPct > CHILD_MILK_STOP_HUNGER_PCT) e.milkSeekActive = false;
  } else {
    e.milkSeekActive = false;
  }

  // attack (only carnivores)
  const { attackTarget, tryStrike } = computeAttackTargetAndCreateTryStrike({
    world,
    entity: e,
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
  });

  // reproduction (female initiates)
  tryReproduce({
    world,
    entity: e,
    entities,
    gridState,
    byId,
    canReachByTerrain,
    reproRangePx,
    w,
    h,
    tile,
    popCounts,
    spawned,
  });

  // nursing (milk)
  const milkMode = hasMother && (isBaby || (isChild && Boolean(e.milkSeekActive)));
  const tryMilk = createTryMilk({ entity: e, mother, isBaby, isChild, milkMode, tile, w, h });

  if (milkMode && mother && !mother._dead) {
    const reach = (e.radius ?? 0) + (mother.radius ?? 0) + tile * 0.15;
    if (dist2Wrapped(e, mother, w, h) <= reach * reach) setAiState("授乳", 9);
    else setAiState("授乳へ移動", 8);
  }

  // eating
  const { food, tryEat } = computeFoodAndCreateTryEat({
    entity: e,
    dietNow,
    hungerPct,
    isBaby,
    canReachByTerrain,
    entities,
    gridState,
    byId,
    foodSearchPx,
    tile,
    w,
    h,
    hpMax,
    plantHungerRecoverMul,
    meatHungerRecoverFraction,
  });

  // Parenting feed (egg-laying): parents feed nestlings so babies/children don't need to roam.
  const tryNestFeed = createTryNestFeed({
    entity: e,
    parentingNest,
    entities,
    gridState,
    tile,
    w,
    h,
    setAiState,
  });

  // If already in reach at the start of the step, eat immediately.
  tryMilk();
  tryEat();
  tryNestFeed();

  // movement
  const speedTraitCode = e.reincarnation?.traits?.speedTrait?.code;
  const speedTraitMul = speedMultiplierFromTraitCode(speedTraitCode);
  const speedPxPerSec = tile * TURN_SPEED_TILES_PER_SECOND * speedTraitMul;

  let goal = null;
  let stayingForFood = false;
  let stayingForNest = false;
  let fleeing = false;
  let seekingFood = false;
  let seekingMate = false;
  let mateSearchActive = false;
  let attacking = false;

  const motherTarget = () => {
    if (!hasMother || !mother) return null;
    const reach = (e.radius ?? 0) + (mother.radius ?? 0) + tile * 0.45;
    const dx = wrapDelta(mother.x, e.x, w);
    const dy = wrapDelta(mother.y, e.y, h);
    const d = Math.hypot(dx, dy);
    if (d > 0.001) {
      const k = reach * 0.92;
      return { x: mother.x + (dx / d) * k, y: mother.y + (dy / d) * k };
    }
    return { x: mother.x + reach, y: mother.y };
  };

  if (hasMother && isBaby) {
    goal = motherTarget();
  } else if (hasMother && isChild && mother) {
    const dx = wrapDelta(mother.x, e.x, w);
    const dy = wrapDelta(mother.y, e.y, h);
    const d = Math.hypot(dx, dy);
    const dTiles = tile > 0 ? d / tile : d;

    if (milkMode) e.followMotherActive = true;
    else {
      if (e.followMotherActive == null) e.followMotherActive = false;
      if (!e.followMotherActive && dTiles > FOLLOW_MOTHER_ENTER_TILES) e.followMotherActive = true;
      if (e.followMotherActive && dTiles < FOLLOW_MOTHER_EXIT_TILES) e.followMotherActive = false;
    }

    if (e.followMotherActive) goal = motherTarget();
  }

  const { goal: fleeGoal, fleeing: fleeActive } = computeFleeGoal({
    entity: e,
    dietNow,
    entities,
    gridState,
    fleeRangePx,
    w,
    h,
    tile,
    hasGoal: Boolean(goal),
    setAiState,
  });
  if (!goal && fleeGoal) goal = fleeGoal;
  if (fleeActive) fleeing = true;
  const expeditionFollowActive = !fleeing && !isGroupLeader && leaderExpeditionActive && Boolean(leaderExpeditionTarget);

  // RL policy ("brain"): learns among rest / wander / food / hunt via policy gradient + backprop (lamarckism).
  let nnModeIdx = MODE_WANDER;
  let nnPaceMul = 1;
  let nnDangerWeight = 1;
  let nnTempBias = 0;

  if (e.nnModeLockSeconds == null) e.nnModeLockSeconds = 0;
  e.nnModeLockSeconds = Math.max(0, (e.nnModeLockSeconds ?? 0) - dt);

  const prevModeRaw = Number(e.nnModeIdx);
  const prevModeIdx =
    Number.isFinite(prevModeRaw) && prevModeRaw >= 0 && prevModeRaw < BRAIN_MODE_COUNT ? prevModeRaw : MODE_WANDER;
  nnModeIdx = prevModeIdx;

  const wantsNnViz = nnVizFocusId != null && e.id === nnVizFocusId;
  if (e.genome && typeof e.genome === "object" && (!goal || wantsNnViz) && !isBaby && !isNestling) {
    if (!Array.isArray(e._rlLearnAbsMode) || e._rlLearnAbsMode.length !== 5) e._rlLearnAbsMode = [0, 0, 0, 0, 0];
    if (!Array.isArray(e._rlLearnAbsHead) || e._rlLearnAbsHead.length !== 4) e._rlLearnAbsHead = [0, 0, 0, 0];
    if (!Number.isFinite(Number(e._rlUpdateCounter))) e._rlUpdateCounter = 0;
    const brain = ensureBrain(e.genome, Math.random);
    const inputs =
      e._nnInputs instanceof Float32Array && e._nnInputs.length === BRAIN_INPUTS
        ? e._nnInputs
        : (e._nnInputs = new Float32Array(BRAIN_INPUTS));
    const hidden =
      e._nnHidden instanceof Float32Array && e._nnHidden.length === BRAIN_HIDDEN
        ? e._nnHidden
        : (e._nnHidden = new Float32Array(BRAIN_HIDDEN));
    const outputs =
      e._nnOutputs instanceof Float32Array && e._nnOutputs.length === BRAIN_OUTPUTS
        ? e._nnOutputs
        : (e._nnOutputs = new Float32Array(BRAIN_OUTPUTS));

    const hungerNeed01 = clamp01(1 - hungerPct);
    const stamina01 = staminaMax > 0 ? clamp01((Number(e.stamina) || 0) / staminaMax) : 1;
    const fear01 = FEAR_MAX_SECONDS > 0 ? clamp01((Number(e.fearSeconds) || 0) / FEAR_MAX_SECONDS) : 0;
    const heat01 = e.heatActive ? 1 : 0;
    const female01 = e.sex === "female" ? 1 : 0;
    const hasFood01 = food && !food._dead ? 1 : 0;
    const hasPrey01 = dietNow === "carnivore" && attackTarget && !attackTarget._dead ? 1 : 0;
    const parenting01 = !fleeing && parentingPos && e.parentingMode && (e.parentingBreakSeconds ?? 0) <= 0 ? 1 : 0;

    const hp01 = hpMax > 0 ? clamp01((Number(e.hp) || hpMax) / hpMax) : 1;
    const foodDist01 =
      food && !food._dead && (Number(foodSearchPx) || 0) > 0
        ? clamp01(Math.sqrt(dist2Wrapped(e, food, w, h)) / foodSearchPx)
        : 1;
    const preyDist01 =
      attackTarget && !attackTarget._dead && (Number(fleeRangePx) || 0) > 0
        ? clamp01(Math.sqrt(dist2Wrapped(e, attackTarget, w, h)) / fleeRangePx)
        : 1;

    const envTempC = Number.isFinite(Number(e.ambientTempC))
      ? Number(e.ambientTempC)
      : typeof world?.getEnvironmentTempAtWorld === "function"
        ? Number(world.getEnvironmentTempAtWorld(e.x, e.y))
        : 20;
    const bodyTempC = Number.isFinite(Number(e.bodyTempC)) ? Number(e.bodyTempC) : envTempC;
    const fur01 = Number.isFinite(Number(e.fur01)) ? clamp01(e.fur01) : 0.45;
    const thermalProtection01 =
      typeof world?.getTerritoryThermalProtection01ForEntity === "function"
        ? clamp01(world.getTerritoryThermalProtection01ForEntity(e))
        : 0;

    const tempMinC = -20;
    const tempSpanC = 80;
    const envTemp01 = clamp01((envTempC - tempMinC) / tempSpanC);
    const bodyTemp01 = clamp01((bodyTempC - tempMinC) / tempSpanC);

    const coldExcessC = Math.max(0, 0 - bodyTempC);
    const heatExcessC = Math.max(0, bodyTempC - 50);
    const thermalRisk01 = clamp01((coldExcessC + heatExcessC) / 15);
    const thermalSafety01 = 1 - thermalRisk01;

    const terrScratch =
      e._terrScratch && typeof e._terrScratch === "object" ? e._terrScratch : (e._terrScratch = { avg01: 0, max01: 0 });
    if (typeof world?.getTerritoryStatsForEntity === "function") world.getTerritoryStatsForEntity(e, 2, terrScratch);
    else {
      terrScratch.avg01 = 0;
      terrScratch.max01 = 0;
    }
    const terrAvg2 = clamp01(terrScratch.avg01);
    const terrMax2 = clamp01(terrScratch.max01);

    if (typeof world?.getTerritoryStatsForEntity === "function") world.getTerritoryStatsForEntity(e, 3, terrScratch);
    else {
      terrScratch.avg01 = 0;
      terrScratch.max01 = 0;
    }
    const terrAvg3 = clamp01(terrScratch.avg01);
    const terrMax3 = clamp01(terrScratch.max01);

    // Inputs (0..1):
    // hp, hungerNeed, stamina, fear, heat, female, hasFood, foodDist, hasPrey, preyDist, parenting, bias,
    // terrAvg2, terrMax2, terrAvg3, terrMax3,
    // envTemp, bodyTemp, fur, territoryThermalProtection,
    // localResource, bestCandidateResource, resourceDeficit, groupAvgHungerNeed, groupSize.
    inputs[0] = hp01;
    inputs[1] = hungerNeed01;
    inputs[2] = stamina01;
    inputs[3] = fear01;
    inputs[4] = heat01;
    inputs[5] = female01;
    inputs[6] = hasFood01;
    inputs[7] = foodDist01;
    inputs[8] = hasPrey01;
    inputs[9] = preyDist01;
    inputs[10] = parenting01;
    inputs[11] = 1;
    inputs[12] = terrAvg2;
    inputs[13] = terrMax2;
    inputs[14] = terrAvg3;
    inputs[15] = terrMax3;
    inputs[16] = envTemp01;
    inputs[17] = bodyTemp01;
    inputs[18] = fur01;
    inputs[19] = thermalProtection01;
    inputs[20] = localResourceScore01;
    inputs[21] = bestCandidateScore01;
    inputs[22] = resourceDeficit01;
    inputs[23] = groupAvgHungerNeed01;
    inputs[24] = groupSize01;

    forwardBrain({ brain, inputs, hiddenOut: hidden, outputsOut: outputs });

    if (!goal) {
      // Heads (pace/danger/commit) are sampled once per decision interval and kept fixed until the next decision.
      nnPaceMul = Number(e.nnPaceMul) || 1;
      nnDangerWeight = Number(e.nnDangerWeight) || 1;
      nnTempBias = Number(e.nnTempBias) || 0;

      const phiCur = hungerPct + RL_PHI_STAMINA_W * stamina01 + RL_PHI_HP_W * hp01 + RL_PHI_THERMAL_W * thermalSafety01;

      const needDecision = (e.nnModeLockSeconds ?? 0) <= 0 || !Number.isFinite(prevModeRaw);
      if (needDecision) {
        // 1) Learn from the previous decision interval (if not interrupted by forced behavior).
        const lastInputs =
          e._rlLastInputs instanceof Float32Array && e._rlLastInputs.length === BRAIN_INPUTS ? e._rlLastInputs : null;
        const lastAction = Number(e._rlLastAction);
        const lastHeadSamples =
          e._rlLastHeadSamples instanceof Float32Array && e._rlLastHeadSamples.length === 4 ? e._rlLastHeadSamples : null;
        const lastPhi = Number(e._rlLastPhi);
        const lastX = Number(e._rlLastX);
        const lastY = Number(e._rlLastY);
        const lastFoodAllowed = Boolean(e._rlLastFoodAllowed);
        const lastHuntAllowed = Boolean(e._rlLastHuntAllowed);
        const interrupted = Boolean(e._rlInterrupted);

        if (
          lastInputs &&
          Number.isFinite(lastAction) &&
          (lastAction === 0 || lastAction === 1 || lastAction === 2 || lastAction === 3 || lastAction === 4) &&
          Number.isFinite(lastPhi) &&
          Number.isFinite(lastX) &&
          Number.isFinite(lastY) &&
          !interrupted
        ) {
          const dxm = wrapDelta(lastX, e.x, w);
          const dym = wrapDelta(lastY, e.y, h);
          const moveTiles = tile > 0 ? Math.hypot(dxm, dym) / tile : 0;
          let reward = (phiCur - lastPhi) + RL_MOVE_REWARD_PER_TILE * moveTiles;

          const curTerritoryTiles =
            typeof world?.getTerritoryGroupTileCountForEntity === "function"
              ? Number(world.getTerritoryGroupTileCountForEntity(e)) || 0
              : 0;
          const lastTerritoryTiles = Number(e._rlLastTerritoryTiles);
          const deltaTerritoryTiles = Math.max(
            0,
            curTerritoryTiles - (Number.isFinite(lastTerritoryTiles) ? lastTerritoryTiles : curTerritoryTiles),
          );
          const groupCount =
            typeof world?.getTerritoryGroupAnimalCountForEntity === "function"
              ? Math.max(1, Number(world.getTerritoryGroupAnimalCountForEntity(e)) || 1)
              : 1;
          const activity01 = clamp01(moveTiles / RL_TERRITORY_ACTIVITY_TILES);
          reward += RL_TERRITORY_TILE_REWARD_W * (deltaTerritoryTiles / groupCount) * activity01;

          const lastHungerNeed01 = clamp01(lastInputs[1]);
          const lastStamina01 = clamp01(lastInputs[2]);
          const lastHasFood01 = clamp01(lastInputs[6]);
          const lastFoodDist01 = clamp01(lastInputs[7]);
          const lastHasPrey01 = clamp01(lastInputs[8]);
          const lastPreyDist01 = clamp01(lastInputs[9]);
          const lastHeat01 = clamp01(lastInputs[4]);
          const lastFemale01 = clamp01(lastInputs[5]);
          const lastLocalResource01 = clamp01(lastInputs[20]);
          const lastBestCandidate01 = clamp01(lastInputs[21]);
          const lastResourceDeficit01 = clamp01(lastInputs[22]);
          const lastGroupHungerNeed01 = clamp01(lastInputs[23]);
          const urgentHunger01 = clamp01((lastHungerNeed01 - 0.6) / 0.35);
          const foodProgress01 = lastHasFood01 > 0.5 && hasFood01 > 0.5 ? clamp(lastFoodDist01 - foodDist01, -1, 1) : 0;
          const huntProgress01 = lastHasPrey01 > 0.5 && hasPrey01 > 0.5 ? clamp(lastPreyDist01 - preyDist01, -1, 1) : 0;
          const expeditionResourceGain01 = clamp(localResourceScore01 - lastLocalResource01, -1, 1);
          const expeditionDeficitGain01 = clamp(lastResourceDeficit01 - resourceDeficit01, -1, 1);
          const likelyMissedFood =
            lastHasFood01 > 0.5 && hasFood01 < 0.5 && hungerNeed01 >= Math.max(0, lastHungerNeed01 - 0.04);
          const likelyMissedPrey =
            lastHasPrey01 > 0.5 && hasPrey01 < 0.5 && hungerNeed01 >= Math.max(0, lastHungerNeed01 - 0.04);

          if (lastAction === 2 && lastFoodAllowed) {
            reward += foodProgress01 * (RL_FOOD_PROGRESS_REWARD_W + RL_URGENT_PROGRESS_BONUS_W * urgentHunger01);
            if (likelyMissedFood) reward -= RL_LOST_TARGET_PENALTY_W * (0.6 + urgentHunger01);
          } else if (lastAction === 3 && lastHuntAllowed) {
            reward += huntProgress01 * (RL_HUNT_PROGRESS_REWARD_W + RL_URGENT_PROGRESS_BONUS_W * urgentHunger01);
            if (likelyMissedPrey) reward -= RL_LOST_TARGET_PENALTY_W * (0.5 + urgentHunger01);
          } else if (lastAction === 4) {
            reward += expeditionResourceGain01 * (RL_EXPEDITION_RESOURCE_REWARD_W + 0.12 * lastGroupHungerNeed01);
            reward += expeditionDeficitGain01 * (RL_EXPEDITION_DEFICIT_REWARD_W + 0.1 * lastGroupHungerNeed01);
            if (resourceDeficit01 <= 0.001) reward += RL_EXPEDITION_SUCCESS_BONUS_W * (0.5 + 0.5 * lastGroupHungerNeed01);
            if (expeditionResourceGain01 < 0.01 && expeditionDeficitGain01 < 0.01)
              reward -= RL_EXPEDITION_STALL_PENALTY_W * (0.5 + 0.5 * lastGroupHungerNeed01);
          }
          if (urgentHunger01 > 0 && lastAction !== 0 && moveTiles < 0.08) {
            reward -= RL_URGENT_IDLE_PENALTY_W * urgentHunger01;
          }

          let baseline = Number(e._rlBaseline);
          if (!Number.isFinite(baseline)) baseline = 0;
          baseline = baseline * (1 - RL_BASELINE_ALPHA) + reward * RL_BASELINE_ALPHA;
          e._rlBaseline = baseline;
          const advantage = reward - baseline;
          const restAllowed = !(lastHeat01 > 0.5 && lastFemale01 > 0.5);

          const baseRest = restAllowed ? 0.2 + (0.25 - lastStamina01) * 4 - lastHungerNeed01 * 2 : -1e9;
          const baseWander = 0.4;
          const baseFood =
            lastFoodAllowed ? 0.2 + lastHungerNeed01 * 5 + lastHasFood01 * 0.7 + (1 - lastFoodDist01) * 0.75 : -1e9;
          const baseHunt =
            lastHuntAllowed ? 0.15 + lastHungerNeed01 * 5.2 + lastHasPrey01 * 0.8 + (1 - lastPreyDist01) * 0.85 : -1e9;
          const baseExpedition =
            expeditionEligible
              ? 0.15 + lastResourceDeficit01 * 4.5 + lastGroupHungerNeed01 * 2 + Math.max(0, lastBestCandidate01 - lastLocalResource01) * 2
              : -1e9;

          const debugOut =
            e._rlLastUpdateDebug && typeof e._rlLastUpdateDebug === "object" ? e._rlLastUpdateDebug : (e._rlLastUpdateDebug = {});
          const ok = policyGradientUpdate({
            brain,
            inputs: lastInputs,
            hiddenOut: hidden,
            outputsOut: outputs,
            actionOutIdxs: [MODE_REST, MODE_WANDER, MODE_FOOD, MODE_HUNT, MODE_EXPEDITION],
            chosenAction: lastAction,
            baseLogits: [baseRest, baseWander, baseFood, baseHunt, baseExpedition],
            advantage,
            logitScale: RL_BRAIN_LOGIT_SCALE,
            learningRate: RL_LEARNING_RATE,
            temperature: RL_TEMPERATURE,
            headOutIdxs: [BRAIN_OUT_PACE, BRAIN_OUT_DANGER, BRAIN_OUT_COMMIT, BRAIN_OUT_TEMP_BIAS],
            headSamples: lastHeadSamples,
            headSigmas: [
              RL_HEAD_SIGMA_PACE_LOGIT,
              RL_HEAD_SIGMA_DANGER_LOGIT,
              RL_HEAD_SIGMA_COMMIT_LOGIT,
              RL_HEAD_SIGMA_TEMP_LOGIT,
            ],
            headLearningRateMul: RL_HEAD_LEARNING_RATE_MUL,
            debugOut,
          });

          if (ok && Math.abs(advantage) > 1e-4) {
            e._rlUpdateCounter = (Number(e._rlUpdateCounter) || 0) + 1;
            e._rlLastUpdateAction = lastAction;
            e._rlLastUpdateReward = reward;
            e._rlLastUpdateBaseline = baseline;
            e._rlLastUpdateAdvantage = advantage;
            e._rlLastUpdateModeStep = Array.isArray(debugOut.modeStep) ? debugOut.modeStep : null;
            e._rlLastUpdateHeadStep = Array.isArray(debugOut.headStep) ? debugOut.headStep : null;

            // Cumulative learning magnitude (how much each head/action has been updated over time).
            const absMode =
              Array.isArray(e._rlLearnAbsMode) && e._rlLearnAbsMode.length === 5
                ? e._rlLearnAbsMode
                : (e._rlLearnAbsMode = [0, 0, 0, 0, 0]);
            if (Array.isArray(debugOut.modeStep) && debugOut.modeStep.length === 5) {
              for (let i = 0; i < 5; i++) absMode[i] += Math.abs(Number(debugOut.modeStep[i]) || 0);
            }

            const absHead =
              Array.isArray(e._rlLearnAbsHead) && e._rlLearnAbsHead.length === 4
                ? e._rlLearnAbsHead
                : (e._rlLearnAbsHead = [0, 0, 0, 0]);
            if (Array.isArray(debugOut.headStep) && debugOut.headStep.length === 4) {
              absHead[0] += Math.abs(Number(debugOut.headStep[0]) || 0);
              absHead[1] += Math.abs(Number(debugOut.headStep[1]) || 0);
              absHead[2] += Math.abs(Number(debugOut.headStep[2]) || 0);
              absHead[3] += Math.abs(Number(debugOut.headStep[3]) || 0);
            }
          }

          // Recompute outputs for current state after the weight update.
          forwardBrain({ brain, inputs, hiddenOut: hidden, outputsOut: outputs });
        }

        // 2) Pick the next action among {rest, wander, food, hunt, expedition}.
        const foodAllowedNow = Boolean(e.foodSeekActive);
        const huntAllowedNow = dietNow === "carnivore" && hasPrey01 > 0.5;
        const restAllowedNow = !(heat01 > 0.5 && female01 > 0.5);
        const expeditionAllowedNow =
          expeditionEligible &&
          resourceDeficit01 > 0.001 &&
          bestCandidateScore > localResourceScore + Math.max(10, expeditionThresholds.start * 0.04);

        const baseRest = restAllowedNow ? 0.2 + (0.25 - stamina01) * 4 - hungerNeed01 * 2 : -1e9;
        const baseWander = 0.4;
        const baseFood = foodAllowedNow ? 0.2 + hungerNeed01 * 5 + hasFood01 * 0.7 + (1 - foodDist01) * 0.75 : -1e9;
        const baseHunt = huntAllowedNow ? 0.15 + hungerNeed01 * 5.2 + hasPrey01 * 0.8 + (1 - preyDist01) * 0.85 : -1e9;
        const baseExpedition = expeditionAllowedNow
          ? 0.15 + resourceDeficit01 * 4.5 + groupAvgHungerNeed01 * 2 + Math.max(0, bestCandidateScore01 - localResourceScore01) * 2.25
          : -1e9;
        const baseLogits = [baseRest, baseWander, baseFood, baseHunt, baseExpedition];

        const t = Math.max(1e-3, RL_TEMPERATURE);
        const exps = new Array(LEARNED_ACTION_MODE_IDXS.length).fill(0);
        const available = baseLogits.map((v) => Number.isFinite(v) && v > -1e8);
        let maxX = -Infinity;
        for (let i = 0; i < LEARNED_ACTION_MODE_IDXS.length; i++) {
          if (!available[i]) continue;
          const x = (baseLogits[i] + (Number(outputs[LEARNED_ACTION_MODE_IDXS[i]]) || 0) * RL_BRAIN_LOGIT_SCALE) / t;
          exps[i] = x;
          if (x > maxX) maxX = x;
        }
        let sumExp = 0;
        for (let i = 0; i < exps.length; i++) {
          if (!available[i]) {
            exps[i] = 0;
            continue;
          }
          exps[i] = Math.exp(exps[i] - maxX);
          sumExp += exps[i];
        }
        const probs = exps.map((v, i) => (available[i] && sumExp > 0 ? v / sumExp : 0));

        // Epsilon exploration (respecting availability).
        const nAvail = available.reduce((sum, ok) => sum + (ok ? 1 : 0), 0);
        const eps = clamp(RL_EPSILON, 0, 0.25);
        if (nAvail > 0 && eps > 0) {
          const add = eps / nAvail;
          for (let i = 0; i < probs.length; i++) probs[i] = available[i] ? probs[i] * (1 - eps) + add : 0;
          const ss = probs.reduce((sum, v) => sum + v, 0);
          if (ss > 0) {
            for (let i = 0; i < probs.length; i++) probs[i] /= ss;
          }
        }

        let action = probs.length - 1;
        if (isGroupLeader && e.expeditionActive) {
          action = 4;
        } else {
          const r = Math.random();
          let accum = 0;
          for (let i = 0; i < probs.length; i++) {
            accum += probs[i];
            if (r <= accum) {
              action = i;
              break;
            }
          }
        }
        nnModeIdx = LEARNED_ACTION_MODE_IDXS[action] ?? MODE_WANDER;
        e.nnModeIdx = nnModeIdx;

        if (isGroupLeader) {
          if (nnModeIdx === MODE_EXPEDITION) {
            let nextTarget =
              Number.isFinite(Number(e.expeditionTargetX)) && Number.isFinite(Number(e.expeditionTargetY))
                ? { x: Number(e.expeditionTargetX), y: Number(e.expeditionTargetY) }
                : null;
            const reachedCurrentTarget =
              nextTarget != null && dist2Wrapped(e, nextTarget, w, h) <= Math.pow(tile * 2, 2);
            if (!nextTarget || reachedCurrentTarget) {
              nextTarget =
                expeditionCandidate ||
                pickExpeditionTarget({
                  world,
                  entity: e,
                  entities,
                  gridState,
                  originX: resourceOriginX,
                  originY: resourceOriginY,
                  dietNow,
                  canReachByTerrain,
                  currentElevationMeters: curH,
                  isBird: isBirdForTargeting,
                  tile,
                  tw,
                  th,
                  w,
                  h,
                  radiusPx: resourceScanPx,
                });
            }
            if (nextTarget) {
              e.expeditionActive = true;
              if ((e.expeditionFailSafeSeconds ?? 0) <= 0) e.expeditionFailSafeSeconds = EXPEDITION_FAILSAFE_SECONDS;
              e.expeditionTargetX = nextTarget.x;
              e.expeditionTargetY = nextTarget.y;
            } else {
              e.expeditionActive = false;
              e.expeditionTargetX = null;
              e.expeditionTargetY = null;
              action = 1;
              nnModeIdx = MODE_WANDER;
              e.nnModeIdx = nnModeIdx;
            }
          } else if (!e.expeditionActive) {
            e.expeditionTargetX = null;
            e.expeditionTargetY = null;
          }
        }

        // Sample continuous heads in logit space and keep them fixed until the next decision interval.
        const meanPaceLogit = Number(outputs[BRAIN_OUT_PACE]) || 0;
        const meanDangerLogit = Number(outputs[BRAIN_OUT_DANGER]) || 0;
        const meanCommitLogit = Number(outputs[BRAIN_OUT_COMMIT]) || 0;
        const meanTempLogit = Number(outputs[BRAIN_OUT_TEMP_BIAS]) || 0;
        const paceLogit = meanPaceLogit + randNormal() * RL_HEAD_SIGMA_PACE_LOGIT;
        const dangerLogit = meanDangerLogit + randNormal() * RL_HEAD_SIGMA_DANGER_LOGIT;
        const commitLogit = meanCommitLogit + randNormal() * RL_HEAD_SIGMA_COMMIT_LOGIT;
        const tempLogit = meanTempLogit + randNormal() * RL_HEAD_SIGMA_TEMP_LOGIT;
        const pace01 = decodeBrain01(paceLogit);
        const danger01 = decodeBrain01(dangerLogit);
        const commit01 = decodeBrain01(commitLogit);
        const temp01 = decodeBrain01(tempLogit);
        nnPaceMul = 0.85 + 0.45 * pace01;
        nnDangerWeight = 0.25 + 2.75 * danger01;
        nnTempBias = clamp((temp01 - 0.5) * 2, -1, 1);

        // Decision lock: 0.5..1.0 sec (scaled by commit) + jitter.
        const lockBase =
          RL_DECISION_MIN_SECONDS + (RL_DECISION_MAX_SECONDS - RL_DECISION_MIN_SECONDS) * clamp01(commit01);
        e.nnModeLockSeconds = clamp(lockBase * randFloat(0.85, 1.15), 0.25, 2.5);

        // Snapshot for the next learning step.
        const store =
          e._rlLastInputs instanceof Float32Array && e._rlLastInputs.length === BRAIN_INPUTS
            ? e._rlLastInputs
            : (e._rlLastInputs = new Float32Array(BRAIN_INPUTS));
        for (let i = 0; i < BRAIN_INPUTS; i++) store[i] = inputs[i] || 0;
        e._rlLastAction = action;
        const headStore =
          e._rlLastHeadSamples instanceof Float32Array && e._rlLastHeadSamples.length === 4
            ? e._rlLastHeadSamples
            : (e._rlLastHeadSamples = new Float32Array(4));
        headStore[0] = paceLogit;
        headStore[1] = dangerLogit;
        headStore[2] = commitLogit;
        headStore[3] = tempLogit;
        e._rlLastPhi = phiCur;
        e._rlLastX = e.x;
        e._rlLastY = e.y;
        e._rlLastFoodAllowed = foodAllowedNow ? 1 : 0;
        e._rlLastHuntAllowed = huntAllowedNow ? 1 : 0;
        e._rlLastTerritoryTiles =
          typeof world?.getTerritoryGroupTileCountForEntity === "function"
            ? Number(world.getTerritoryGroupTileCountForEntity(e)) || 0
            : 0;
        e._rlInterrupted = false;
      }

      e.nnPaceMul = nnPaceMul;
      e.nnDangerWeight = nnDangerWeight;
      e.nnTempBias = nnTempBias;
    }
  }

  const expeditionLeaderNow = isGroupLeader ? e : groupLeader;
  let expeditionActiveNow = !fleeing && Boolean(expeditionLeaderNow?.expeditionActive);
  let expeditionTargetNow =
    expeditionActiveNow &&
    Number.isFinite(Number(expeditionLeaderNow?.expeditionTargetX)) &&
    Number.isFinite(Number(expeditionLeaderNow?.expeditionTargetY))
      ? { x: Number(expeditionLeaderNow.expeditionTargetX), y: Number(expeditionLeaderNow.expeditionTargetY) }
      : null;

  if (!goal && !stayingForFood && !stayingForNest && expeditionActiveNow) {
    if (isGroupLeader && (!expeditionTargetNow || dist2Wrapped(e, expeditionTargetNow, w, h) <= Math.pow(tile * 2, 2))) {
      const refreshedTarget =
        expeditionCandidate ||
        pickExpeditionTarget({
          world,
          entity: e,
          entities,
          gridState,
          originX: resourceOriginX,
          originY: resourceOriginY,
          dietNow,
          canReachByTerrain,
          currentElevationMeters: curH,
          isBird: isBirdForTargeting,
          tile,
          tw,
          th,
          w,
          h,
          radiusPx: resourceScanPx,
        });
      if (refreshedTarget) {
        e.expeditionTargetX = refreshedTarget.x;
        e.expeditionTargetY = refreshedTarget.y;
        expeditionTargetNow = { x: refreshedTarget.x, y: refreshedTarget.y };
      }
    }
    if (expeditionTargetNow) {
      goal = expeditionTargetNow;
      setAiState("大遠征", 7);
    } else if (isGroupLeader) {
      e.expeditionActive = false;
      e.expeditionFailSafeSeconds = 0;
      expeditionActiveNow = false;
    }
  }

  if (!goal && nnModeIdx === MODE_FOOD && e.foodSeekActive && food && !food._dead) {
    const reach = (e.radius ?? 0) + (food.radius ?? 0) + tile * 0.15;
    const inReach = dist2Wrapped(e, food, w, h) <= reach * reach;
    if (inReach) {
      setAiState(food.kind === "plant" ? "食事中（植物）" : "食事中（肉）", 7);
      stayingForFood = true;
    } else {
      setAiState(food.kind === "plant" ? "食事へ移動（植物）" : "食事へ移動（肉）", 6);
      seekingFood = true;
      const k = reach * 0.92;
      const seed = (e.id * 2654435761 + (food.id ?? 0) * 1013904223) >>> 0;
      const ang = ((seed % 6283) / 1000) || 0;
      goal = { x: food.x + Math.cos(ang) * k, y: food.y + Math.sin(ang) * k };
    }
  }

  if (!goal && !stayingForFood && nnModeIdx === MODE_HUNT && dietNow === "carnivore" && attackTarget && !attackTarget._dead) {
    attacking = true;
    if (!tryStrike?.()) {
      goal = { x: attackTarget.x, y: attackTarget.y };
      setAiState("攻撃へ移動", 8);
    }
  }

  if (
    !goal &&
    !stayingForFood &&
    e.heatActive &&
    e.sex === "female" &&
    (e.reproCooldownSeconds ?? 0) <= 0
  ) {
    mateSearchActive = true;
    let mate = null;
    const mateDesired = (o) =>
      o &&
      !o._dead &&
      o.sex === "male" &&
      o.kind !== "plant" &&
      o.kind !== "meat" &&
      canReachByTerrain(o) &&
      !o.hasReproduced &&
      dietTypeForEntity(o) === dietTypeForEntity(e) &&
      o.heatActive;

    if (e.pairedWithId != null) {
      const locked = byId.get(e.pairedWithId);
      if (mateDesired(locked)) mate = locked;
    } else {
      mate = findNearest({
        entities,
        gridState,
        from: e,
        radiusPx: 14 * tile,
        world: { width: w, height: h },
        filter: (o) => mateDesired(o) && o.pairedWithId == null,
      });
    }
    if (mate) {
      goal = { x: mate.x, y: mate.y };
      setAiState("繁殖へ移動", 5);
      seekingMate = true;
    } else {
      setAiState("繁殖相手探索", 4);
    }
  }

  // Parenting: return to nest (incubate/feed) when not fleeing/eating/attacking.
  if (!goal && !stayingForFood && !fleeing && parentingPos && e.parentingMode) {
    if ((e.parentingBreakSeconds ?? 0) > 0) {
      setAiState("子育て（休憩）", 1);
    } else {
      const mode = e.parentingMode;
      const rangePx = NEST_WARM_RANGE_TILES * tile;
      const dx = wrapDelta(parentingPos.x, e.x, w);
      const dy = wrapDelta(parentingPos.y, e.y, h);
      const d2 = dx * dx + dy * dy;

      if (!goal) {
        if (d2 > rangePx * rangePx) {
          goal = { x: parentingPos.x, y: parentingPos.y };
          setAiState("子育て（巣へ移動）", 6);
        } else {
          stayingForNest = true;
          setAiState(mode === "incubate" ? "子育て（温め）" : "子育て（子守り）", 6);
        }
      }
    }
  }

  // When staying at the nest, occasionally take a break (incubate) / leave after a while (feed idle).
  if (stayingForNest && parentingPos && e.parentingMode && (e.parentingBreakSeconds ?? 0) <= 0) {
    e.parentingVisitSeconds = (e.parentingVisitSeconds ?? 0) + dt;
    if (e.parentingMode === "incubate") {
      const target = Number(e.parentingVisitTargetSeconds) || PARENTING_INCUBATE_STAY_SECONDS;
      if ((e.parentingVisitSeconds ?? 0) >= target) {
        e.parentingBreakSeconds = randFloat(PARENTING_INCUBATE_BREAK_SECONDS * 0.85, PARENTING_INCUBATE_BREAK_SECONDS * 1.15);
        e.parentingVisitSeconds = 0;
        e.parentingVisitTargetSeconds = randFloat(
          PARENTING_INCUBATE_STAY_SECONDS * 0.85,
          PARENTING_INCUBATE_STAY_SECONDS * 1.15,
        );
      }
    } else if (e.parentingMode === "feed") {
      const target = Number(e.parentingVisitTargetSeconds) || PARENTING_FEED_IDLE_VISIT_SECONDS;
      if (!e.parentingFedThisVisit && (e.parentingVisitSeconds ?? 0) >= target) {
        e.parentingBreakSeconds = randFloat(PARENTING_FEED_IDLE_BREAK_SECONDS * 0.85, PARENTING_FEED_IDLE_BREAK_SECONDS * 1.15);
        e.parentingVisitSeconds = 0;
        e.parentingFedThisVisit = false;
        e.parentingVisitTargetSeconds = randFloat(
          PARENTING_FEED_IDLE_VISIT_SECONDS * 0.85,
          PARENTING_FEED_IDLE_VISIT_SECONDS * 1.15,
        );
      }
    }
  } else if (parentingPos && e.parentingMode) {
    // Reset visit bookkeeping when away from the nest.
    e.parentingVisitSeconds = 0;
    if ((e.parentingBreakSeconds ?? 0) <= 0) e.parentingFedThisVisit = false;
  }

  if (!goal && !stayingForFood && !stayingForNest && nnModeIdx === MODE_REST && !mateSearchActive) {
    e._resting = true;
    setAiState("REST", 3);
  }

  if (!goal && !stayingForFood && !stayingForNest && nnModeIdx !== MODE_REST) {
    if (e.heatActive) setAiState("発情期", 1);
    const forageFar = Boolean(e.foodSeekActive && !food && !isBaby && !isNestling);
    if (forageFar) setAiState("食事探索（遠出）", 2);
    goal = computeWanderGoal({
      entity: e,
      world,
      tile,
      w,
      h,
      tw,
      th,
      wanderDistanceTiles: forageFar ? 20 : 9,
      dangerWeight: nnDangerWeight,
      tempBias: nnTempBias,
      envTempC: Number.isFinite(Number(e.ambientTempC)) ? Number(e.ambientTempC) : null,
      socialGroupCenters,
      socialGroupCenterList,
      hasMother,
      isChild,
      mother,
    });
  }

  if (hasMother && isBaby) setAiState("母親追従", 4);
  else if (hasMother && isChild && Boolean(e.followMotherActive)) setAiState("親についていく", 4);

  // Nestlings stay near the nest until they fledge (young adult).
  if (isNestling && homeNest && !homeNest._dead && homeNest.kind === "nest") {
    stayingForNest = true;
    const dx = wrapDelta(homeNest.x, e.x, w);
    const dy = wrapDelta(homeNest.y, e.y, h);
    const d = Math.hypot(dx, dy);
    const stayPx = tile * 0.25;
    if (d > stayPx) goal = { x: homeNest.x, y: homeNest.y };
    else goal = null;
    setAiState("巣で待機", 12);
  }

  // RL bookkeeping: if forced behaviors took control, don't credit the RL action for this interval.
  if (e._rlLastAction != null) {
    const forced =
      fleeing || attacking || seekingMate || milkMode || stayingForNest || hasMother || isNestling || expeditionFollowActive;
    if (forced) e._rlInterrupted = true;
  }

  const stamina = clamp(e.stamina ?? staminaMax, 0, staminaMax);
  e.stamina = stamina;

  const reservePct = clamp(Number(e.genome?.staminaReservePct) || 0.3, 0.05, 0.8);
  const reserve = staminaMax * reservePct;
  const foodMoveActive = (seekingFood || e.foodSeekActive) && !stayingForFood;
  const mateMoveActive = (seekingMate || mateSearchActive) && !stayingForFood;
  const urgentFood = foodMoveActive && hungerPct <= FOOD_RESERVE_OVERRIDE_HUNGER_PCT;
  const parentingMoveActive = Boolean(parentingPos) && Boolean(e.parentingMode) && (e.parentingBreakSeconds ?? 0) <= 0;
  const parentingFar = parentingMoveActive
    ? (() => {
        const rangePx = NEST_WARM_RANGE_TILES * tile;
        const dx = wrapDelta(parentingPos.x, e.x, w);
        const dy = wrapDelta(parentingPos.y, e.y, h);
        return dx * dx + dy * dy > rangePx * rangePx;
      })()
    : false;
  const urgentMove = fleeing || milkMode || attacking || urgentFood || parentingFar;
  if (urgentMove) {
    e.reserveRestActive = false;
    e.reserveRestLockSeconds = 0;
  } else if (!e._resting && staminaMax > 0) {
    const exitThreshold = reserve * RESERVE_REST_EXIT_MULT;
    if (!e.reserveRestActive && stamina < reserve) {
      e.reserveRestActive = true;
      e.reserveRestLockSeconds = Math.max(e.reserveRestLockSeconds ?? 0, RESERVE_REST_MIN_SECONDS);
    } else if (e.reserveRestActive && stamina >= exitThreshold && (e.reserveRestLockSeconds ?? 0) <= 0) {
      e.reserveRestActive = false;
    }
  }
  if (e.reserveRestActive) {
    goal = null;
    setAiState("休息（温存）", 3);
  }

  const territorySpeedMul =
    typeof world?.getTerritorySpeedMulForEntity === "function" ? Number(world.getTerritorySpeedMulForEntity(e)) || 1 : 1;

  stepAnimalMovement({
    world,
    entity: e,
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
  });

  const nextDiet = dietTypeForEntity(e);
  if (nextDiet !== e.dietType) {
    applyDietAppearanceShift(e, nextDiet);
    e.dietType = nextDiet;
    if (typeof world?.getStaminaMulForDietType === "function") {
      e.staminaMul = world.getStaminaMulForDietType(nextDiet);
      applyLifeStageScaling(e);
    }
  } else if (e.staminaMul == null && typeof world?.getStaminaMulForDietType === "function") {
    e.staminaMul = world.getStaminaMulForDietType(nextDiet);
    applyLifeStageScaling(e);
  }
  if (!isMacroNonAnimalKind(e.kind)) {
    if (e.attackDamageBase == null) e.attackDamageBase = e.attackDamage ?? 1;
    const carnAttackMul = typeof world?.getCarnAttackMul === "function" ? world.getCarnAttackMul() : undefined;
    e.attackDamage = scaledAttackDamage(e.attackDamageBase, e.dietType, carnAttackMul);
  }

  evolutionStepEntity({ world, entity: e, dt, tileSizePx: tile, tileWidth: tw, tileHeight: th });
  if (fleeing) e.fleeFxSeconds = Math.max(Number(e.fleeFxSeconds) || 0, 0.35);
  e.aiState = aiState;
}
