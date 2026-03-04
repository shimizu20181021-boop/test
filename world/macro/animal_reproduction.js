import { clamp, randFloat } from "../../core/utils.js";
import { BASE_STAT, NEST_OBJECT_RADIUS_TILES, REPRO_COOLDOWN_SECONDS } from "./constants.js";
import { dist2Wrapped, wrapCoord } from "./geom.js";
import { isMacroNonAnimalKind } from "./kinds.js";
import { dietTypeForEntity, populationCapForDietType } from "./diet.js";
import { snapshotParentForRepro } from "./genome.js";
import { clamp01, clampInt } from "./math.js";
import { findNearest } from "./spatial.js";
import { childrenCountFromRoundness01, coupleReproMaxFromRoundness01, roundness01FromAppearance } from "./stats.js";

export function tryReproduce({
  world,
  entity,
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
}) {
  const e = entity;
  if (!e || e._dead) return;
  if (e.sex !== "female") return;
  if (!e.heatActive) return;
  if (e.lifeStage !== "adult") return;
  if (e.hasReproduced) return;
  if ((e.reproCooldownSeconds ?? 0) > 0) return;

  const hpMax = Math.max(1, e.hpMax ?? BASE_STAT);
  if ((e.hp ?? 0) < hpMax * 0.5) return;

  const mateEligible = (o) =>
    o.sex === "male" &&
    o.kind !== "plant" &&
    o.kind !== "meat" &&
    !o._dead &&
    (o.taxon === "bird") === (e.taxon === "bird") &&
    canReachByTerrain(o) &&
    o.lifeStage === "adult" &&
    !o.hasReproduced &&
    dietTypeForEntity(o) === dietTypeForEntity(e) &&
    o.heatActive &&
    (o.reproCooldownSeconds ?? 0) <= 0 &&
    (o.hp ?? 0) >= (o.hpMax ?? BASE_STAT) * 0.5 &&
    // Monogamy: if either side already paired, only allow that partner.
    (o.pairedWithId == null || o.pairedWithId === e.id);

  let mate = null;
  if (e.pairedWithId != null) {
    const locked = byId.get(e.pairedWithId);
    if (locked && mateEligible(locked)) {
      if (dist2Wrapped(e, locked, w, h) <= reproRangePx * reproRangePx) mate = locked;
    }
  } else {
    mate = findNearest({
      entities,
      gridState,
      from: e,
      radiusPx: reproRangePx,
      world: { width: w, height: h },
      filter: (o) => mateEligible(o) && o.pairedWithId == null,
    });
  }

  if (!mate) return;

  const mid = { x: (e.x + mate.x) / 2, y: (e.y + mate.y) / 2 };
  const dietKey = dietTypeForEntity(e);

  const cap = populationCapForDietType(dietKey);
  const curCount =
    dietKey === "herbivore"
      ? popCounts.herbivore
      : dietKey === "omnivore"
        ? popCounts.omnivore
        : dietKey === "carnivore"
          ? popCounts.carnivore
          : 0;
  const underCap = curCount < cap;
  e.reproCooldownSeconds = REPRO_COOLDOWN_SECONDS;
  mate.reproCooldownSeconds = REPRO_COOLDOWN_SECONDS;

  // When the population cap is reached, don't start reproduction (including nest creation).
  // Nests/eggs created before reaching the cap will still hatch normally (may exceed the cap).
  if (!underCap) return;

  let sameDietNearby = 0;
  const crowdRadiusPx = tile * 3;
  const crowdRadius2 = crowdRadiusPx * crowdRadiusPx;
  const spawnPoint = { x: mid.x, y: mid.y };
  for (const o of entities) {
    if (!o || o._dead) continue;
    if (isMacroNonAnimalKind(o.kind)) continue;
    if (dietTypeForEntity(o) !== dietKey) continue;
    if (dist2Wrapped(spawnPoint, o, w, h) > crowdRadius2) continue;
    sameDietNearby++;
    if (sameDietNearby >= 30) break;
  }

  let successProb = 0.3;
  if (typeof world?.getTerritoryMateSuccessMulForPair === "function") {
    const mul = Number(world.getTerritoryMateSuccessMulForPair(e, mate));
    if (Number.isFinite(mul) && mul > 0) successProb *= mul;
  }
  successProb = clamp(successProb, 0, 0.98);

  const success = sameDietNearby < 30 && Math.random() < successProb;
  if (!success) return;

  const coupleRoundness = clamp01((roundness01FromAppearance(e) + roundness01FromAppearance(mate)) / 2);
  const cfg = world._getDietReproConfig(dietKey);
  const birthMin = cfg?.birthMin ?? 2;
  const birthMax = cfg?.birthMax ?? world._birthMax;
  const reproMin = cfg?.reproMin ?? 1;
  const reproMax = cfg?.reproMax ?? world._coupleReproMax;

  const babies = childrenCountFromRoundness01(coupleRoundness, birthMin, birthMax);
  const desiredMax = coupleReproMaxFromRoundness01(coupleRoundness, reproMin, reproMax);

  const existingA = Number(e.reproSuccessMax);
  const existingB = Number(mate.reproSuccessMax);
  let coupleMax = null;
  if (Number.isFinite(existingA) && existingA > 0) coupleMax = existingA;
  if (Number.isFinite(existingB) && existingB > 0) coupleMax = coupleMax == null ? existingB : Math.min(coupleMax, existingB);
  if (coupleMax == null) coupleMax = desiredMax;
  coupleMax = clampInt(coupleMax, reproMin, reproMax);
  e.reproSuccessMax = coupleMax;
  mate.reproSuccessMax = coupleMax;

  const usesEggs = e.taxon === "bird";
  if (!usesEggs) {
    // Pregnancy: no wings -> mother becomes pregnant, babies spawn after gestation.
    e.pregnant = true;
    e.pregnancySeconds = 0;
    e.pregnancyBabies = babies;
    e.pregnancyFatherSnapshot = snapshotParentForRepro(mate);
  } else {
    // Egg-laying: has wings -> build nest + lay eggs, then incubate.
    const nestPlaced = world._placeNear(
      mid,
      tile * NEST_OBJECT_RADIUS_TILES,
      tile * 2.2,
      60,
      randFloat(0, Math.PI * 2),
      Math.random(),
    );
    const nestGroupId = `nest:${e.id}:${mate.id}:${Date.now()}`;
    const nest = world._makeNest({
      x: nestPlaced.x,
      y: nestPlaced.y,
      motherId: e.id,
      fatherId: mate.id,
      groupId: nestGroupId,
    });
    spawned.push(nest);

    e.parentingNestId = nest.id;
    e.parentingNestX = nest.x;
    e.parentingNestY = nest.y;
    e.parentingMode = "incubate";
    e.parentingPartnerId = mate.id;

    mate.parentingNestId = nest.id;
    mate.parentingNestX = nest.x;
    mate.parentingNestY = nest.y;
    mate.parentingMode = "incubate";
    mate.parentingPartnerId = e.id;

    const motherSnap = snapshotParentForRepro(e);
    const fatherSnap = snapshotParentForRepro(mate);
    for (let i = 0; i < babies; i++) {
      const ang = randFloat(0, Math.PI * 2);
      const dist = randFloat(0, tile * 0.55);
      const egg = world._makeEgg({
        x: wrapCoord(nest.x + Math.cos(ang) * dist, w),
        y: wrapCoord(nest.y + Math.sin(ang) * dist, h),
        nestId: nest.id,
        motherSnapshot: motherSnap,
        fatherSnapshot: fatherSnap,
        groupId: nestGroupId,
      });
      spawned.push(egg);
    }
  }

  if (e.pairedWithId == null && mate.pairedWithId == null) {
    e.pairedWithId = mate.id;
    mate.pairedWithId = e.id;
  }

  const currentCount = Math.max(Number(e.reproSuccessCount) || 0, Number(mate.reproSuccessCount) || 0);
  const nextCount = currentCount + 1;
  e.reproSuccessCount = nextCount;
  mate.reproSuccessCount = nextCount;

  if (nextCount >= coupleMax) {
    e.hasReproduced = true;
    mate.hasReproduced = true;
  }
}
