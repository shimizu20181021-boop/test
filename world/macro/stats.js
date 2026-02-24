import { MACRO_CONFIG } from "../../core/config.js";
import { clamp } from "../../core/utils.js";
import {
  BABY_TO_CHILD_SECONDS,
  BASE_ANIMAL_LIFESPAN_SECONDS,
  BASE_STAT,
  CHILD_TO_YOUNG_ADULT_SECONDS,
  MEAT_LIFESPAN_SECONDS,
  WEATHER_KIND,
  YOUNG_ADULT_TO_ADULT_SECONDS,
} from "./constants.js";
import { clamp01, clampInt } from "./math.js";
import { isMacroNonAnimalKind } from "./kinds.js";

export function attackDamageFromAttackPct(attackPct) {
  const p = clamp(Number(attackPct) || 0, 0, 100);
  return clamp(Math.round(p / 8), 1, 15);
}

export function kindFromPercents({ staminaPct, healthPct, attackPct }) {
  const attack = clamp(attackPct, 0, 100);
  const health = clamp(healthPct, 0, 100);
  const stamina = clamp(staminaPct, 0, 100);

  if (stamina > 60) return "plant";
  if (attack >= 35) return "predator";
  if (health >= stamina) return "largeHerbivore";
  return "smallHerbivore";
}

export function radiusFromKind(kind) {
  switch (kind) {
    case "largeHerbivore":
      return 22;
    case "predator":
      return 20;
    case "smallHerbivore":
      return 18;
    case "plant":
    default:
      return 16;
  }
}

function bodyRadiusFromTrait(reincarnation) {
  const tile = MACRO_CONFIG.tileSize;
  const code = reincarnation?.traits?.bodyTrait?.code;
  if (code === "B5") return tile / 1.55; // largest (≈ 2x2 tiles)
  if (code === "B4") return tile / 2.2; // large (≈ 2 tiles total)
  if (code === "B3") return tile / 2.5;
  if (code === "B2") return tile / 3.0;
  if (code === "B1") return tile / 3.5;
  return null;
}

function animalKindScale(kind) {
  if (kind === "largeHerbivore") return 1.0;
  if (kind === "predator") return 0.9;
  if (kind === "smallHerbivore") return 0.85;
  return 1.0;
}

export function radiusForEntity(kind, reincarnation) {
  if (kind === "plant") return radiusFromKind(kind);
  const baseFromTrait = bodyRadiusFromTrait(reincarnation);
  const base = baseFromTrait != null ? baseFromTrait : radiusFromKind(kind);
  return base * animalKindScale(kind);
}

export function computeStatsForEntity({ kind, reincarnation }) {
  if (kind === "plant") {
    return {
      hpMax: BASE_STAT,
      hungerMax: 0,
      staminaMax: 0,
      lifeMaxSeconds: 0,
      attackDamage: 0,
    };
  }

  if (kind === "meat") {
    return {
      hpMax: 1,
      hungerMax: 0,
      staminaMax: 0,
      lifeMaxSeconds: MEAT_LIFESPAN_SECONDS,
      attackDamage: 0,
    };
  }

  const staminaPct = clamp(Number(reincarnation?.staminaPct) || 0, 0, 100);
  const healthPct = clamp(Number(reincarnation?.healthPct) || 0, 0, 100);
  const attackPct = clamp(Number(reincarnation?.attackPct) || 0, 0, 100);

  const hpMax = Math.round(BASE_STAT * (1 + healthPct / 100));
  const hungerMax = Math.round(BASE_STAT * (1 + healthPct / 100));
  const staminaMax = Math.round(BASE_STAT * (1 + staminaPct / 100));

  return {
    hpMax,
    hungerMax,
    staminaMax,
    lifeMaxSeconds: BASE_ANIMAL_LIFESPAN_SECONDS,
    attackDamage: attackDamageFromAttackPct(attackPct),
  };
}

export function lifeStageFromAgeSeconds(ageSeconds) {
  const t = Number(ageSeconds) || 0;
  if (t < BABY_TO_CHILD_SECONDS) return "baby";
  if (t < CHILD_TO_YOUNG_ADULT_SECONDS) return "child";
  if (t < YOUNG_ADULT_TO_ADULT_SECONDS) return "youngAdult";
  return "adult";
}

export function lifeStageScale(stage) {
  switch (stage) {
    case "baby":
      return 0.45;
    case "child":
      return 0.65;
    case "youngAdult":
      return 0.85;
    case "adult":
    default:
      return 1.0;
  }
}

export function applyLifeStageScaling(entity) {
  if (!entity || isMacroNonAnimalKind(entity.kind)) return;
  const scale = lifeStageScale(entity.lifeStage);
  const staminaMul = clamp(Number(entity.staminaMul) || 1, 0.1, 10);

  if (entity.baseHpMax == null) entity.baseHpMax = entity.hpMax ?? BASE_STAT;
  if (entity.baseHungerMax == null) entity.baseHungerMax = entity.hungerMax ?? BASE_STAT;
  if (entity.baseStaminaMax == null) entity.baseStaminaMax = entity.staminaMax ?? BASE_STAT;
  if (entity.baseRadius == null) entity.baseRadius = entity.radius ?? radiusFromKind(entity.kind);

  entity.hpMax = Math.max(1, Math.round(entity.baseHpMax * scale));
  entity.hungerMax = Math.max(0, Math.round(entity.baseHungerMax * scale));
  entity.staminaMax = Math.max(0, Math.round(entity.baseStaminaMax * scale * staminaMul));
  entity.radius = Math.max(6, entity.baseRadius * scale);

  entity.hp = clamp(entity.hp ?? entity.hpMax, 0, entity.hpMax);
  entity.hunger = clamp(entity.hunger ?? entity.hungerMax, 0, entity.hungerMax);
  entity.stamina = clamp(entity.stamina ?? entity.staminaMax, 0, entity.staminaMax);
}

export function plantStageScale(stage) {
  if (stage === 0) return 0.45; // bud
  if (stage === 1) return 0.7; // stem
  return 1.0; // adult
}

export function applyPlantStageScaling(entity) {
  if (!entity || entity.kind !== "plant") return;
  const stage = clampInt(entity.plantStage ?? 2, 0, 2);
  entity.plantStage = stage;
  const scale = plantStageScale(stage);
  const hpMul = clamp(Number(entity.hpMul) || 1, 0.1, 10);

  if (entity.baseHpMax == null) entity.baseHpMax = entity.hpMax ?? BASE_STAT;
  if (entity.baseRadius == null) entity.baseRadius = entity.radius ?? radiusFromKind("plant");

  entity.hpMax = Math.max(1, Math.round(entity.baseHpMax * scale * hpMul));
  entity.radius = Math.max(5, entity.baseRadius * scale);
  entity.hp = clamp(entity.hp ?? entity.hpMax, 0, entity.hpMax);
}

export function plantRegenMultiplier(weatherKind) {
  if (weatherKind === WEATHER_KIND.sunny) return 5;
  if (weatherKind === WEATHER_KIND.rainy) return 3;
  if (weatherKind === WEATHER_KIND.drought) return 10;
  if (weatherKind === WEATHER_KIND.snowy) return 0;
  return 1;
}

export function roundness01FromAppearance(entity) {
  if (!entity || isMacroNonAnimalKind(entity.kind)) return 0.5;
  const style = entity.variant?.bodyStyle === "round" ? 1 : entity.variant?.bodyStyle === "angular" ? 0 : 0.5;

  const plant = Number(entity.foodPlantEaten) || 0;
  const meat = Number(entity.foodMeatEaten) || 0;
  const totalFood = plant + meat;
  let plantRatio = totalFood > 0 ? plant / totalFood : 0.5;
  if (!(totalFood > 0)) {
    if (entity.dietType === "herbivore") plantRatio = 1;
    else if (entity.dietType === "carnivore") plantRatio = 0;
  }

  plantRatio = clamp01(plantRatio);
  return clamp01(plantRatio * 0.75 + style * 0.25);
}

export function childrenCountFromRoundness01(roundness01, minChildren, maxChildren) {
  const r = clamp01(roundness01);
  const min = clampInt(minChildren ?? 2, 2, 10);
  let max = clampInt(maxChildren ?? 6, 2, 10);
  if (max < min) max = min;
  if (max <= min) return min;
  return clampInt(Math.round(min + r * (max - min)), min, max);
}

export function coupleReproMaxFromRoundness01(roundness01, minRepro, maxRepro) {
  const r = clamp01(roundness01);
  const min = clampInt(minRepro ?? 1, 1, 10);
  let max = clampInt(maxRepro ?? 3, 1, 10);
  if (max < min) max = min;
  if (max <= min) return min;
  return clampInt(Math.round(min + r * (max - min)), min, max);
}
