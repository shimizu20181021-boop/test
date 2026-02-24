import { clamp } from "../../core/utils.js";
import {
  DIET_IMPRINT_EFFECT_MUL,
  DIET_IMPRINT_MAX_STRENGTH,
  POP_CAP_CARNIVORE,
  POP_CAP_HERBIVORE,
  POP_CAP_OMNIVORE,
  POP_CAP_PLANT,
} from "./constants.js";
import { isMacroNonAnimalKind } from "./kinds.js";

export function dietTypeFromKind(kind) {
  if (kind === "predator") return "carnivore";
  if (kind === "smallHerbivore" || kind === "largeHerbivore") return "herbivore";
  if (kind === "plant") return "plant";
  if (kind === "meat") return "meat";
  return "unknown";
}

export function dietTypeFromReincarnation(reincarnation) {
  const stamina = clamp(Number(reincarnation?.staminaPct) || 0, 0, 100);
  const attack = clamp(Number(reincarnation?.attackPct) || 0, 0, 100);
  if (stamina > 60) return "plant";
  if (attack >= 35) return "carnivore";
  if (attack >= 20) return "omnivore";
  return "herbivore";
}

export function populationCapForDietType(dietType) {
  switch (String(dietType || "").toLowerCase()) {
    case "plant":
      return POP_CAP_PLANT;
    case "herbivore":
      return POP_CAP_HERBIVORE;
    case "omnivore":
      return POP_CAP_OMNIVORE;
    case "carnivore":
      return POP_CAP_CARNIVORE;
    default:
      return Infinity;
  }
}

export function dietTypeForEntity(entity) {
  if (!entity) return "unknown";
  const base = dietTypeFromKind(entity.kind);
  if (base !== "herbivore" && base !== "carnivore") return base;

  let plant = Number(entity.foodPlantEaten) || 0;
  let meat = Number(entity.foodMeatEaten) || 0;

  // Diet imprint: a growing inherited bias makes diet harder to change across generations.
  const imprintStrength = clamp(Number(entity.dietImprintStrength) || 0, 0, DIET_IMPRINT_MAX_STRENGTH);
  const imprintEffective = imprintStrength * clamp(Number(DIET_IMPRINT_EFFECT_MUL) || 0, 0, 2);
  if (imprintEffective > 0) {
    const imprintType = String(entity.dietImprintType || entity.dietType || base).toLowerCase();
    if (imprintType === "herbivore") plant += imprintEffective;
    else if (imprintType === "carnivore") meat += imprintEffective;
    else if (imprintType === "omnivore") {
      plant += imprintEffective * 0.5;
      meat += imprintEffective * 0.5;
    }
  }

  const total = plant + meat;
  if (total <= 0) {
    const d = String(entity.dietType || "").toLowerCase();
    if (d === "herbivore" || d === "omnivore" || d === "carnivore") return d;
    return base;
  }

  const plantRatio = plant / total;
  if (plantRatio >= 0.8) return "herbivore";
  if (plantRatio <= 0.2) return "carnivore";
  return "omnivore";
}

export function computePopulationTypeCounts(entities) {
  const counts = { plant: 0, herbivore: 0, omnivore: 0, carnivore: 0 };
  for (const e of entities || []) {
    if (!e || e._dead) continue;
    if (e.kind === "plant") {
      counts.plant++;
      continue;
    }
    if (isMacroNonAnimalKind(e.kind)) continue;
    const d = dietTypeForEntity(e);
    if (d === "herbivore") counts.herbivore++;
    else if (d === "omnivore") counts.omnivore++;
    else if (d === "carnivore") counts.carnivore++;
  }
  return counts;
}

export function isCloseSpecies(a, b) {
  return dietTypeForEntity(a) === dietTypeForEntity(b);
}

export function attackMultiplierForDiet(dietType, carnivoreAttackMul) {
  if (dietType === "carnivore") {
    const mul = Number(carnivoreAttackMul);
    if (Number.isFinite(mul) && mul > 0) return mul;
    return 2;
  }
  if (dietType === "herbivore") return 0.5;
  return 1;
}

export function scaledAttackDamage(baseDamage, dietType, carnivoreAttackMul) {
  const base = Math.max(1, Number(baseDamage) || 1);
  const mult = attackMultiplierForDiet(dietType, carnivoreAttackMul);
  return clamp(Math.round(base * mult), 1, 999);
}
