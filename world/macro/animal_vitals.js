import { clamp, randFloat } from "../../core/utils.js";
import {
  BASE_ANIMAL_LIFESPAN_SECONDS,
  BODY_TEMP_COLD_DAMAGE_THRESHOLD_C,
  BODY_TEMP_DAMAGE_PER_C_PER_SECOND,
  BODY_TEMP_HEAT_DAMAGE_THRESHOLD_C,
  BODY_TEMP_LOSS_COEFF_ADD,
  BODY_TEMP_LOSS_COEFF_BASE,
  BODY_TEMP_META_HEAT_C_PER_SECOND,
  DANGER_MIN_KEEP,
  DANGER_TAU_SECONDS,
  FEAR_MAX_SECONDS,
  FUR_ADAPT_RATE_PER_SECOND,
  FUR_COLD_TARGET_C,
  FUR_HEAT_TARGET_C,
  HEAT_CYCLE_SECONDS,
  HEAT_DURATION_SECONDS,
  HUNGER_DAMAGE_BELOW_30P_PER_SECOND,
  HUNGER_DAMAGE_ZERO_PER_SECOND,
  HUNGER_DECAY_PER_SECOND,
  PREGNANCY_GESTATION_SECONDS,
  REPRO_COOLDOWN_SECONDS,
  WEATHER_KIND,
  YOUNG_ADULT_TO_ADULT_SECONDS,
} from "./constants.js";
import { wrapCoord } from "./geom.js";
import { isMacroNonAnimalKind } from "./kinds.js";
import { dietTypeForEntity, populationCapForDietType } from "./diet.js";
import { clamp01, clampInt, smoothstep01 } from "./math.js";
import { applyLifeStageScaling, lifeStageFromAgeSeconds } from "./stats.js";
import { pushNaturalGenome, recordDeathForEvolution } from "./evolution_pool.js";

export function stepAnimalVitals({ world, entity, dt, tile, w, h, spawned, popCounts }) {
  if (!entity || entity._dead) return;
  if (entity.kind === "plant" || entity.kind === "meat") return;
  if (entity.kind === "nest" || entity.kind === "egg") return;
  if (entity.kind === "rock" || entity.kind === "tree") return;

  entity.ageSeconds = (entity.ageSeconds ?? 0) + dt;

  if (entity.born == null)
    entity.born = entity.lifeStage === "baby" || entity.lifeStage === "child" || entity.lifeStage === "youngAdult";
  if (!entity.born && (!entity.lifeStage || entity.lifeStage === "none")) entity.lifeStage = "adult";

  if (entity.born) {
    const nextStage = lifeStageFromAgeSeconds(entity.ageSeconds ?? 0);
    if (nextStage !== entity.lifeStage) {
      entity.lifeStage = nextStage;
      if (nextStage === "youngAdult") {
        // Nestlings fledge at young adult stage.
        entity.nestId = null;
      }
      applyLifeStageScaling(entity);
    }
  } else if (entity.baseHpMax == null || entity.baseRadius == null) {
    applyLifeStageScaling(entity);
  }

  const stage = entity.lifeStage || "adult";
  const dietNow = entity.dietType || dietTypeForEntity(entity);
  if (entity.kind !== "plant" && entity.kind !== "meat") {
    // Visual-only maturity factor (0..1) for gradual morphing of baby/child -> adult.
    // Non-born entities spawn fully mature.
    entity.visualMaturity = entity.born ? smoothstep01((entity.ageSeconds ?? 0) / YOUNG_ADULT_TO_ADULT_SECONDS) : 1;
  }

  const hasLife = stage === "adult";
  if (hasLife) {
    const configured =
      typeof world?.getAdultLifeMaxSecondsForDietType === "function"
        ? Number(world.getAdultLifeMaxSecondsForDietType(dietNow))
        : NaN;
    const lifeMaxSeconds =
      Number.isFinite(configured) && configured > 0 ? configured : BASE_ANIMAL_LIFESPAN_SECONDS;

    entity.lifeMaxSeconds = lifeMaxSeconds;
    if (!Number.isFinite(entity.lifeSeconds) || (entity.lifeSeconds ?? 0) <= 0) entity.lifeSeconds = entity.lifeMaxSeconds;
    if ((entity.lifeSeconds ?? 0) > entity.lifeMaxSeconds) entity.lifeSeconds = entity.lifeMaxSeconds;

    let dtLife = dt;
    if (typeof world?.getTerritoryLifeDtForEntity === "function") {
      const v = Number(world.getTerritoryLifeDtForEntity(entity, dt));
      if (Number.isFinite(v) && v >= 0) dtLife = v;
    }
    entity.lifeSeconds = Math.max(0, (entity.lifeSeconds ?? entity.lifeMaxSeconds) - dtLife);
  } else {
    entity.lifeMaxSeconds = 0;
    entity.lifeSeconds = 0;
  }

  entity.hungerMax = entity.hungerMax ?? 0;
  const hungerDecayMul =
    typeof world?.getHungerDecayMulForDietType === "function"
      ? Number(world.getHungerDecayMulForDietType(dietNow))
      : 1;
  const decayMul = Number.isFinite(hungerDecayMul) && hungerDecayMul > 0 ? hungerDecayMul : 1;
  entity.hunger = clamp((entity.hunger ?? entity.hungerMax) - HUNGER_DECAY_PER_SECOND * decayMul * dt, 0, entity.hungerMax);

  const hungerPct = entity.hungerMax > 0 ? entity.hunger / entity.hungerMax : 1;
  if (entity.hunger <= 0) entity.hp = (entity.hp ?? 0) - HUNGER_DAMAGE_ZERO_PER_SECOND * dt;
  else if (hungerPct < 0.3) entity.hp = (entity.hp ?? 0) - HUNGER_DAMAGE_BELOW_30P_PER_SECOND * dt;

  // Thermal: environment temperature + body temperature + fur (insulation).
  // - Fur adapts slowly based on thermal stress and is lamarckian (stored on genome).
  // - Territory levels provide thermal protection (max level = immune).
  const envTempC =
    typeof world?.getEnvironmentTempAtWorld === "function" ? Number(world.getEnvironmentTempAtWorld(entity.x, entity.y)) : NaN;
  if (Number.isFinite(envTempC)) entity.ambientTempC = envTempC;

  const furInit = entity.fur01 ?? entity.genome?.fur01 ?? 0.45;
  let fur01 = clamp01(furInit);
  if (!Number.isFinite(Number(entity.fur01))) entity.fur01 = fur01;
  if (entity.genome && typeof entity.genome === "object" && !Number.isFinite(Number(entity.genome.fur01))) {
    entity.genome.fur01 = fur01;
  }

  const lossCoeff = clamp(
    BODY_TEMP_LOSS_COEFF_BASE + (1 - fur01) * BODY_TEMP_LOSS_COEFF_ADD,
    0.01,
    2,
  );
  const env = Number.isFinite(envTempC) ? envTempC : Number(entity.ambientTempC) || 20;
  if (!Number.isFinite(Number(entity.bodyTempC))) {
    entity.bodyTempC = env + BODY_TEMP_META_HEAT_C_PER_SECOND / Math.max(1e-6, lossCoeff);
  } else {
    const cur = Number(entity.bodyTempC) || env;
    entity.bodyTempC = cur + (BODY_TEMP_META_HEAT_C_PER_SECOND - lossCoeff * (cur - env)) * dt;
  }

  // Rain chill: while raining, body temperature gets pushed down a bit (roughly once per 2 seconds),
  // on top of the ambient temperature shift. This makes rain feel "colder" even in mild seasons.
  const weatherKind = typeof world?.getWeatherKind === "function" ? world.getWeatherKind() : world?._weatherKind;
  if (weatherKind === WEATHER_KIND.rainy) {
    entity.rainChillSeconds = (Number(entity.rainChillSeconds) || 0) + dt;
    const pulseSeconds = 2;
    const chillC = 0.25;
    while ((entity.rainChillSeconds ?? 0) >= pulseSeconds) {
      entity.rainChillSeconds = (entity.rainChillSeconds ?? 0) - pulseSeconds;
      entity.bodyTempC = (Number(entity.bodyTempC) || env) - chillC;
    }
  } else if (entity.rainChillSeconds) {
    entity.rainChillSeconds = 0;
  }

  const bodyTempC = Number(entity.bodyTempC) || env;
  const coldStress01 = bodyTempC < FUR_COLD_TARGET_C ? clamp01((FUR_COLD_TARGET_C - bodyTempC) / 15) : 0;
  const heatStress01 = bodyTempC > FUR_HEAT_TARGET_C ? clamp01((bodyTempC - FUR_HEAT_TARGET_C) / 15) : 0;
  const furDelta = (coldStress01 - heatStress01) * FUR_ADAPT_RATE_PER_SECOND * dt;
  if (furDelta) {
    fur01 = clamp01(fur01 + furDelta);
    entity.fur01 = fur01;
    if (entity.genome && typeof entity.genome === "object") entity.genome.fur01 = fur01;
  }

  const thermalProtection01 =
    typeof world?.getTerritoryThermalProtection01ForEntity === "function"
      ? clamp01(world.getTerritoryThermalProtection01ForEntity(entity))
      : 0;
  const dmgMul = 1 - thermalProtection01;
  if (dmgMul > 0) {
    const coldExcess = Math.max(0, BODY_TEMP_COLD_DAMAGE_THRESHOLD_C - bodyTempC);
    const heatExcess = Math.max(0, bodyTempC - BODY_TEMP_HEAT_DAMAGE_THRESHOLD_C);
    const dmgPerSecond = (coldExcess + heatExcess) * BODY_TEMP_DAMAGE_PER_C_PER_SECOND * dmgMul;
    if (dmgPerSecond > 0) entity.hp = (entity.hp ?? 0) - dmgPerSecond * dt;
  }

  entity.attackCooldownSeconds = Math.max(0, (entity.attackCooldownSeconds ?? 0) - dt);
  entity.eatCooldownSeconds = Math.max(0, (entity.eatCooldownSeconds ?? 0) - dt);
  entity.reproCooldownSeconds = Math.max(0, (entity.reproCooldownSeconds ?? 0) - dt);
  entity.eatFxSeconds = Math.max(0, (entity.eatFxSeconds ?? 0) - dt);
  entity.hitFxSeconds = Math.max(0, (entity.hitFxSeconds ?? 0) - dt);
  entity.wanderTimeLeft = Math.max(0, (entity.wanderTimeLeft ?? 0) - dt);

  entity.fearSeconds = clamp((Number(entity.fearSeconds) || 0) - dt, 0, FEAR_MAX_SECONDS);

  if (entity.dangerHeat instanceof Map && entity.dangerHeat.size > 0) {
    const decay = Math.exp(-dt / Math.max(1e-6, DANGER_TAU_SECONDS));
    for (const [k, v] of entity.dangerHeat) {
      const nv = (Number(v) || 0) * decay;
      if (nv < DANGER_MIN_KEEP) entity.dangerHeat.delete(k);
      else entity.dangerHeat.set(k, nv);
    }
  } else if (entity.dangerHeat != null && !(entity.dangerHeat instanceof Map)) {
    entity.dangerHeat = null;
  }

  const lifeMax = Math.max(1, entity.lifeMaxSeconds ?? BASE_ANIMAL_LIFESPAN_SECONDS);
  const lifeFrac = (entity.lifeSeconds ?? 0) / lifeMax;
  entity.heatCycleSeconds = ((entity.heatCycleSeconds ?? 0) + dt) % HEAT_CYCLE_SECONDS;
  entity.heatActive = Boolean(
    entity.sex !== "none" &&
      !isMacroNonAnimalKind(entity.kind) &&
      entity.lifeStage === "adult" &&
      !entity.hasReproduced &&
      !entity.pregnant &&
      !entity.parentingNestId &&
      lifeFrac >= 0.1 &&
      entity.heatCycleSeconds < HEAT_DURATION_SECONDS,
  );

  // Pregnancy (no wings): after gestation, spawn babies around the mother.
  if (entity.pregnant) {
    entity.pregnancySeconds = (Number(entity.pregnancySeconds) || 0) + dt;
    const babies = clampInt(Number(entity.pregnancyBabies) || 0, 0, 10);
    if (babies > 0 && (entity.pregnancySeconds ?? 0) >= PREGNANCY_GESTATION_SECONDS) {
      const fatherSnap = entity.pregnancyFatherSnapshot || null;
      for (let i = 0; i < babies; i++) {
        const ang = randFloat(0, Math.PI * 2);
        const dist = randFloat(0, tile * 0.9);
        const child = world._makeChildFromParents({
          x: wrapCoord(entity.x + Math.cos(ang) * dist, w),
          y: wrapCoord(entity.y + Math.sin(ang) * dist, h),
          father: fatherSnap,
          mother: entity,
        });
        const childType = child.kind === "plant" ? "plant" : dietTypeForEntity(child);
        const cap = populationCapForDietType(childType);
        if (childType === "plant") {
          if (popCounts.plant >= cap) continue;
          popCounts.plant++;
        } else if (childType === "herbivore") {
          if (popCounts.herbivore >= cap) continue;
          popCounts.herbivore++;
        } else if (childType === "omnivore") {
          if (popCounts.omnivore >= cap) continue;
          popCounts.omnivore++;
        } else if (childType === "carnivore") {
          if (popCounts.carnivore >= cap) continue;
          popCounts.carnivore++;
        }
        child.eatFxSeconds = 0;
        child.hitFxSeconds = 0;
        child.reproCooldownSeconds = REPRO_COOLDOWN_SECONDS;
        spawned.push(child);

        entity.offspringCount = (entity.offspringCount ?? 0) + 1;
        if (fatherSnap && fatherSnap.id != null) {
          const fatherLive = world.entities.find((p) => p && !p._dead && p.id === fatherSnap.id);
          if (fatherLive) fatherLive.offspringCount = (fatherLive.offspringCount ?? 0) + 1;
        }
        pushNaturalGenome({ world, dietType: dietTypeForEntity(entity), genome: child.genome });
      }

      entity.pregnant = false;
      entity.pregnancySeconds = 0;
      entity.pregnancyBabies = 0;
      entity.pregnancyFatherSnapshot = null;
    }
  }

  if ((entity.hp ?? 0) <= 0 || (hasLife && (entity.lifeSeconds ?? 0) <= 0)) {
    entity._dead = true;
    recordDeathForEvolution({ world, entity });
    world._spawnMeatFromCorpse(entity, spawned);
  }
}
