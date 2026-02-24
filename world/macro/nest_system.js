import { randFloat } from "../../core/utils.js";
import { EGG_DESPAWN_IF_NOT_WARMED_SECONDS, NEST_EGG_HATCH_WARM_SECONDS, NEST_WARM_RANGE_TILES, REPRO_COOLDOWN_SECONDS } from "./constants.js";
import { dist2Wrapped, wrapCoord } from "./geom.js";
import { dietTypeForEntity } from "./diet.js";
import { pushNaturalGenome } from "./evolution_pool.js";
import { snapshotParentForRepro } from "./genome.js";
import { isMacroNonAnimalKind } from "./kinds.js";

export function stepNestIncubationAndParenting({ world, entities, spawned, dt, tile, w, h, popCounts }) {
  const all = [...entities, ...spawned].filter((e) => e && !e._dead);
  const byIdAll = new Map();
  for (const e of all) byIdAll.set(e.id, e);

  const warmRangePx = NEST_WARM_RANGE_TILES * tile;
  const warmRange2 = warmRangePx * warmRangePx;

  for (const egg of all) {
    if (!egg || egg._dead) continue;
    if (egg.kind !== "egg") continue;
    const nid = egg.nestId;
    const nest = nid != null ? byIdAll.get(nid) : null;
    if (!nest || nest._dead || nest.kind !== "nest") {
      egg._dead = true;
      continue;
    }

    const mother = nest.nestMotherId != null ? byIdAll.get(nest.nestMotherId) : null;
    const father = nest.nestFatherId != null ? byIdAll.get(nest.nestFatherId) : null;
    const warming =
      (mother && !mother._dead && dist2Wrapped(mother, nest, w, h) <= warmRange2) ||
      (father && !father._dead && dist2Wrapped(father, nest, w, h) <= warmRange2);

    if (warming) {
      egg.warmSeconds = (Number(egg.warmSeconds) || 0) + dt;
      egg.unwarmedSeconds = 0;
    } else {
      egg.unwarmedSeconds = (Number(egg.unwarmedSeconds) || 0) + dt;
      if ((egg.unwarmedSeconds ?? 0) >= EGG_DESPAWN_IF_NOT_WARMED_SECONDS) {
        egg._dead = true;
        continue;
      }
    }

    if ((Number(egg.warmSeconds) || 0) >= NEST_EGG_HATCH_WARM_SECONDS) {
      egg._dead = true;

      const motherSnap = egg.motherSnapshot || snapshotParentForRepro(mother) || null;
      const fatherSnap = egg.fatherSnapshot || snapshotParentForRepro(father) || null;
      if (!motherSnap) continue;

      // IMPORTANT: Do not gate egg hatching by population caps.
      // If a nest/egg was created before reaching the cap, it should still hatch normally (may exceed the cap).
      const ang = randFloat(0, Math.PI * 2);
      const dist = randFloat(0, tile * 0.65);
      const child = world._makeChildFromParents({
        x: wrapCoord(nest.x + Math.cos(ang) * dist, w),
        y: wrapCoord(nest.y + Math.sin(ang) * dist, h),
        father: fatherSnap,
        mother: motherSnap,
      });
      const childType = child.kind === "plant" ? "plant" : dietTypeForEntity(child);
      if (childType === "plant") {
        popCounts.plant++;
      } else if (childType === "herbivore") {
        popCounts.herbivore++;
      } else if (childType === "omnivore") {
        popCounts.omnivore++;
      } else if (childType === "carnivore") {
        popCounts.carnivore++;
      }
      child.nestId = nest.id;
      child.eatFxSeconds = 0;
      child.hitFxSeconds = 0;
      child.reproCooldownSeconds = REPRO_COOLDOWN_SECONDS;
      spawned.push(child);

      if (mother && !mother._dead) mother.offspringCount = (mother.offspringCount ?? 0) + 1;
      if (father && !father._dead) father.offspringCount = (father.offspringCount ?? 0) + 1;
      pushNaturalGenome({ world, dietType: dietTypeForEntity(child), genome: child.genome });
    }
  }

  const after = [...entities, ...spawned].filter((e) => e && !e._dead);
  const eggsPerNest = new Map();
  const nestlingsPerNest = new Map();
  for (const e of after) {
    if (e.kind === "egg") {
      if (e.nestId != null) eggsPerNest.set(e.nestId, (eggsPerNest.get(e.nestId) || 0) + 1);
      continue;
    }
    if (isMacroNonAnimalKind(e.kind)) continue;
    const nid = e.nestId;
    if (nid == null) continue;
    const stage = e.lifeStage || "adult";
    if (stage !== "baby" && stage !== "child") continue;
    nestlingsPerNest.set(nid, (nestlingsPerNest.get(nid) || 0) + 1);
  }

  // Remove empty nests after fledging (no eggs + no nestlings).
  for (const e of after) {
    if (!e || e._dead) continue;
    if (e.kind !== "nest") continue;
    const nid = e.id;
    const eggCount = eggsPerNest.get(nid) || 0;
    const chickCount = nestlingsPerNest.get(nid) || 0;
    if (eggCount <= 0 && chickCount <= 0) e._dead = true;
  }

  for (const e of after) {
    if (!e || e._dead) continue;
    if (isMacroNonAnimalKind(e.kind)) continue;
    const nid = e.parentingNestId;
    if (nid == null) continue;
    const nest = byIdAll.get(nid) || null;
    if (!nest || nest._dead || nest.kind !== "nest") {
      e.parentingNestId = null;
      e.parentingNestX = null;
      e.parentingNestY = null;
      e.parentingMode = null;
      e.parentingPartnerId = null;
      e.parentingBreakSeconds = 0;
      e.parentingVisitSeconds = 0;
      e.parentingVisitTargetSeconds = 0;
      e.parentingFedThisVisit = false;
      e._parentingModePrev = null;
      continue;
    }

    const eggCount = eggsPerNest.get(nid) || 0;
    const chickCount = nestlingsPerNest.get(nid) || 0;
    if (eggCount > 0) e.parentingMode = "incubate";
    else if (chickCount > 0) e.parentingMode = "feed";
    else {
      e.parentingNestId = null;
      e.parentingNestX = null;
      e.parentingNestY = null;
      e.parentingMode = null;
      e.parentingPartnerId = null;
      e.parentingBreakSeconds = 0;
      e.parentingVisitSeconds = 0;
      e.parentingVisitTargetSeconds = 0;
      e.parentingFedThisVisit = false;
      e._parentingModePrev = null;
    }
  }
}
