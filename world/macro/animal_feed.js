import { clamp, randFloat } from "../../core/utils.js";
import {
  CHILD_MILK_STOP_HUNGER_PCT,
  EAT_COOLDOWN_SECONDS,
  EAT_HP_RECOVER_FRACTION,
  FOOD_TARGET_LOCK_SECONDS,
  NEST_PARENTING_RANGE_TILES,
  NEST_WARM_RANGE_TILES,
  PARENTING_FEED_BREAK_SECONDS,
  PARENTING_FEED_IDLE_VISIT_SECONDS,
} from "./constants.js";
import { dist2Wrapped, wrapDelta } from "./geom.js";
import { findNearest } from "./spatial.js";
import { isMacroNonAnimalKind } from "./kinds.js";

const SAME_DIET_MEAT_HUNGER_RECOVER_FRACTION = 0.3;

export function createTryMilk({ entity, mother, isBaby, isChild, milkMode, tile, w, h }) {
  return () => {
    if (!milkMode) return;
    if (!mother || mother._dead) return;
    if ((entity.eatCooldownSeconds ?? 0) > 0) return;

    const hMax = Math.max(0, entity.hungerMax ?? 0);
    const hunger = clamp(entity.hunger ?? hMax, 0, hMax);
    const hungerPct = hMax > 0 ? hunger / hMax : 1;
    if (isBaby && hungerPct >= 0.999) return;
    if (isChild && hungerPct >= CHILD_MILK_STOP_HUNGER_PCT) return;

    const reach = (entity.radius ?? 0) + (mother.radius ?? 0) + tile * 0.15;
    if (dist2Wrapped(entity, mother, w, h) > reach * reach) return;

    const milkAmount = Math.max(1, Math.round(hMax * 0.35));
    entity.hunger = clamp(hunger + milkAmount, 0, hMax);
    entity.eatCooldownSeconds = EAT_COOLDOWN_SECONDS;
    entity.eatFxSeconds = 0.45;
    entity.eatFxType = "milk";
  };
}

export function computeFoodAndCreateTryEat({
  entity,
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
}) {
  let food = null;
  let tryEat = () => {};

  if (isBaby) return { food, tryEat };

  const isCarnivore = dietNow === "carnivore";
  const isHerbivore = dietNow === "herbivore";
  const isOmnivore = dietNow === "omnivore";
  const emergencyMeat = isHerbivore && hungerPct < 0.3;

  const isFood = (o) => {
    if (!o || o._dead) return false;
    if (o.kind !== "plant" && o.kind !== "meat") return false;
    if (!canReachByTerrain(o)) return false;
    return true;
  };

  const matchesPlant = (o) => isFood(o) && o.kind === "plant";
  const matchesMeat = (o) => isFood(o) && o.kind === "meat";

  const matchesPrimaryDiet = (o) => {
    if (!isFood(o)) return false;
    if (isCarnivore) return o.kind === "meat";
    if (isHerbivore) return o.kind === "plant";
    return o.kind === "plant" || o.kind === "meat";
  };

  const matchesSecondaryDiet = (o) => emergencyMeat && matchesMeat(o);

  if (entity.foodTargetId != null && (entity.foodTargetLockSeconds ?? 0) > 0) {
    const locked = byId.get(entity.foodTargetId);
    if (matchesPrimaryDiet(locked) || matchesSecondaryDiet(locked)) food = locked;
  }

  if (!food) {
    if (isCarnivore) {
      food = findNearest({
        entities,
        gridState,
        from: entity,
        radiusPx: foodSearchPx,
        world: { width: w, height: h },
        filter: matchesMeat,
      });
    } else if (isHerbivore) {
      food = findNearest({
        entities,
        gridState,
        from: entity,
        radiusPx: foodSearchPx,
        world: { width: w, height: h },
        filter: matchesPlant,
      });
      if (!food && emergencyMeat) {
        // Herbivores can also eat meat if starving (<30% hunger).
        food = findNearest({
          entities,
          gridState,
          from: entity,
          radiusPx: foodSearchPx,
          world: { width: w, height: h },
          filter: matchesMeat,
        });
      }
    } else if (isOmnivore) {
      // Omnivores: plant 70% / meat 30% preference (fallback to the other if not found).
      const preferPlant = randFloat(0, 1) < 0.7;
      const primary = preferPlant ? matchesPlant : matchesMeat;
      const secondary = preferPlant ? matchesMeat : matchesPlant;
      food = findNearest({
        entities,
        gridState,
        from: entity,
        radiusPx: foodSearchPx,
        world: { width: w, height: h },
        filter: primary,
      });
      if (!food) {
        food = findNearest({
          entities,
          gridState,
          from: entity,
          radiusPx: foodSearchPx,
          world: { width: w, height: h },
          filter: secondary,
        });
      }
    } else {
      food = findNearest({
        entities,
        gridState,
        from: entity,
        radiusPx: foodSearchPx,
        world: { width: w, height: h },
        filter: matchesPrimaryDiet,
      });
    }
    if (food) {
      entity.foodTargetId = food.id;
      entity.foodTargetLockSeconds = FOOD_TARGET_LOCK_SECONDS;
    } else {
      entity.foodTargetId = null;
    }
  }

  if (!entity.foodSeekActive) {
    entity.foodTargetId = null;
    entity.foodTargetLockSeconds = 0;
  }

  tryEat = () => {
    if (!entity.foodSeekActive) return;
    if (!food) return;
    if ((entity.eatCooldownSeconds ?? 0) > 0) return;
    if (food._dead) return;
    const reach = (entity.radius ?? 0) + (food.radius ?? 0) + tile * 0.15;
    if (dist2Wrapped(entity, food, w, h) > reach * reach) return;

    const hpGain = Math.max(1, Math.round(hpMax * EAT_HP_RECOVER_FRACTION));
    entity.hp = clamp((entity.hp ?? 0) + hpGain, 0, hpMax);
    entity.eatCooldownSeconds = EAT_COOLDOWN_SECONDS;
    entity.eatFxSeconds = 0.45;

    if (food.kind === "plant") {
      const bite = clamp(Math.min(hpGain, food.hp ?? 0), 0, hpGain);
      food.hp = (food.hp ?? 0) - bite;
      const hungerGain = bite * plantHungerRecoverMul;
      entity.hunger = clamp((entity.hunger ?? 0) + hungerGain, 0, entity.hungerMax ?? 0);
      entity.foodPlantEaten = (entity.foodPlantEaten ?? 0) + 1;
      entity.eatFxType = "plant";
      if ((food.hp ?? 0) <= 0) food._dead = true;
      return;
    }

    const eaterDiet = String(dietNow || "").toLowerCase();
    const meatDiet = String(food.meatDietType || "").toLowerCase();
    const sameDietMeat =
      (meatDiet === "herbivore" || meatDiet === "omnivore" || meatDiet === "carnivore") &&
      meatDiet === eaterDiet;
    const hungerRecoverFraction = clamp(
      sameDietMeat ? SAME_DIET_MEAT_HUNGER_RECOVER_FRACTION : meatHungerRecoverFraction,
      0,
      1,
    );

    entity.hunger = clamp(
      (entity.hunger ?? 0) + (entity.hungerMax ?? 0) * hungerRecoverFraction,
      0,
      entity.hungerMax ?? 0,
    );
    entity.foodMeatEaten = (entity.foodMeatEaten ?? 0) + 1;
    entity.eatFxType = "meat";
    food.nutrition = (food.nutrition ?? 1) - 1;
    if ((food.nutrition ?? 0) <= 0) food._dead = true;
  };

  return { food, tryEat };
}

export function createTryNestFeed({ entity, parentingNest, entities, gridState, tile, w, h, setAiState }) {
  return () => {
    if (entity.parentingMode !== "feed") return;
    if (entity.parentingNestId == null) return;
    if ((entity.parentingBreakSeconds ?? 0) > 0) return;
    if (entity.parentingFedThisVisit) return;
    if ((entity.eatCooldownSeconds ?? 0) > 0) return;
    const nid = entity.parentingNestId;

    const nx = parentingNest?.x ?? entity.parentingNestX;
    const ny = parentingNest?.y ?? entity.parentingNestY;
    if (nx == null || ny == null) return;

    const touchPx = NEST_WARM_RANGE_TILES * tile;
    const dxn = wrapDelta(nx, entity.x, w);
    const dyn = wrapDelta(ny, entity.y, h);
    if (dxn * dxn + dyn * dyn > touchPx * touchPx) return;

    const searchPx = NEST_PARENTING_RANGE_TILES * tile;
    const chick = findNearest({
      entities,
      gridState,
      from: { x: nx, y: ny },
      radiusPx: searchPx,
      world: { width: w, height: h },
      filter: (o) => {
        if (!o || o._dead) return false;
        if (isMacroNonAnimalKind(o.kind)) return false;
        if (o.nestId !== nid) return false;
        const st = o.lifeStage || "adult";
        if (st !== "baby" && st !== "child") return false;
        const hMax = Math.max(0, o.hungerMax ?? 0);
        if (!(hMax > 0)) return false;
        const hh = clamp(o.hunger ?? hMax, 0, hMax);
        const hPct = hMax > 0 ? hh / hMax : 1;
        if (st === "baby") return hPct < 0.999;
        return hPct < CHILD_MILK_STOP_HUNGER_PCT;
      },
    });
    if (!chick) return;

    const hMax = Math.max(0, chick.hungerMax ?? 0);
    const hunger = clamp(chick.hunger ?? hMax, 0, hMax);
    const feedAmount = Math.max(1, Math.round(hMax * 0.35));
    chick.hunger = clamp(hunger + feedAmount, 0, hMax);
    chick.eatFxSeconds = 0.45;
    chick.eatFxType = "plant";

    entity.eatCooldownSeconds = EAT_COOLDOWN_SECONDS;
    entity.eatFxSeconds = 0.45;
    entity.eatFxType = "plant";
    entity.parentingFedThisVisit = true;
    entity.parentingBreakSeconds = randFloat(PARENTING_FEED_BREAK_SECONDS * 0.85, PARENTING_FEED_BREAK_SECONDS * 1.15);
    entity.parentingVisitSeconds = 0;
    entity.parentingVisitTargetSeconds = randFloat(
      PARENTING_FEED_IDLE_VISIT_SECONDS * 0.85,
      PARENTING_FEED_IDLE_VISIT_SECONDS * 1.15,
    );
    setAiState?.("子育て（給餌）", 9);
  };
}
