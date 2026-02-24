// Macro world simulation constants (kept separate to keep macro_world.js manageable).

export const BASE_STAT = 100;
export const BASE_ANIMAL_LIFESPAN_SECONDS = 60 * 5;
export const MEAT_LIFESPAN_SECONDS = 60 * 3;
export const MEAT_ROT_PLANT_BLOCK_RANGE_TILES = 3;

// Soft population caps: when a type reaches the cap, it stops reproducing/spawning new individuals of that type.
export let POP_CAP_PLANT = 500;
export let POP_CAP_HERBIVORE = 500;
export let POP_CAP_OMNIVORE = 500;
export let POP_CAP_CARNIVORE = 500;

export function setPopulationCaps({ plant, herbivore, omnivore, carnivore } = {}) {
  const clampCap = (value, fallback) => {
    const n = Number.parseInt(String(value), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.min(10000, n));
  };

  POP_CAP_PLANT = clampCap(plant, POP_CAP_PLANT);
  POP_CAP_HERBIVORE = clampCap(herbivore, POP_CAP_HERBIVORE);
  POP_CAP_OMNIVORE = clampCap(omnivore, POP_CAP_OMNIVORE);
  POP_CAP_CARNIVORE = clampCap(carnivore, POP_CAP_CARNIVORE);
}

// Diet inheritance "concentration": newborns inherit an imprint that makes diet harder to change.
// The imprint strength grows every generation.
export const DIET_IMPRINT_BASE_STRENGTH = 5;
export const DIET_IMPRINT_CHILD_ADD = 2;
export const DIET_IMPRINT_MAX_STRENGTH = 200;
// How strongly the imprint affects current diet classification (lower = easier to shift diet during life).
export const DIET_IMPRINT_EFFECT_MUL = 0.5;

export const TURN_SPEED_TILES_PER_SECOND = 0.7;

// Elevation (macro tiles): 0..20 meters. Wingless animals cannot climb steps higher than 15m.
export const ELEVATION_MAX_METERS = 20;
export const ELEVATION_WINGLESS_MAX_CLIMB_METERS = 15;
export const CLIMB_SPEED_PENALTY_AT_MAX = 0.55; // 15m climb -> speed *= (1 - 0.55)
export const CLIMB_STAMINA_COST_AT_MAX = 2.2; // 15m climb -> stamina drain *= (1 + 2.2)

export const HUNGER_DECAY_PER_SECOND = 1 / 2;
export const HUNGER_DAMAGE_BELOW_30P_PER_SECOND = 1 / 3;
export const HUNGER_DAMAGE_ZERO_PER_SECOND = 1;

// Thermal (body temperature) simulation (°C).
// NOTE: This is not a realistic physiology model; it's a simple "survival" temperature that stays near the environment,
// with fur acting as insulation (helps cold, can worsen heat).
export const BODY_TEMP_COLD_DAMAGE_THRESHOLD_C = 0;
export const BODY_TEMP_HEAT_DAMAGE_THRESHOLD_C = 50;
export const BODY_TEMP_META_HEAT_C_PER_SECOND = 2.0;
export const BODY_TEMP_LOSS_COEFF_BASE = 0.12;
export const BODY_TEMP_LOSS_COEFF_ADD = 0.18;
export const BODY_TEMP_DAMAGE_PER_C_PER_SECOND = 0.35;
export const FUR_ADAPT_RATE_PER_SECOND = 0.003;
export const FUR_COLD_TARGET_C = 5;
export const FUR_HEAT_TARGET_C = 40;

export const PLANT_REGEN_PER_SECOND = 1;
export const PLANT_REPRO_COOLDOWN_SECONDS = 15;
export const PLANT_GROWTH_STAGE_SECONDS = 30;

export const WEATHER_KIND = {
  sunny: "sunny",
  rainy: "rainy",
  cloudy: "cloudy",
  snowy: "snowy",
  drought: "drought",
};
export const WEATHER_STEP_SECONDS = 30;

export const ATTACK_RANGE_TILES = 1;
export const ATTACK_COOLDOWN_SECONDS = 2;

export const REPRO_RANGE_TILES = 5;
export const REPRO_COOLDOWN_SECONDS = 30;
export const HEAT_CYCLE_SECONDS = 30;
export const HEAT_DURATION_SECONDS = 10;
export const GROWTH_STEP_SECONDS = 30;
export const BABY_TO_CHILD_SECONDS = GROWTH_STEP_SECONDS * 1;
export const CHILD_TO_YOUNG_ADULT_SECONDS = GROWTH_STEP_SECONDS * 2;
export const YOUNG_ADULT_TO_ADULT_SECONDS = GROWTH_STEP_SECONDS * 3;

export const PREGNANCY_GESTATION_SECONDS = 30;
export const PREGNANT_MOVE_SPEED_MUL = 0.9;

export const NEST_EGG_HATCH_WARM_SECONDS = 30;
export const EGG_WARM_VISUAL_SECONDS = 15;
export const EGG_DESPAWN_IF_NOT_WARMED_SECONDS = 60 * 2;
// NOTE: The request "2/1" is interpreted as "1/2" (half).
export const NEST_SCALE = 0.5;
export const NEST_WARM_RANGE_TILES = 1.5 * NEST_SCALE;
export const NEST_OBJECT_RADIUS_TILES = 1.5 * NEST_SCALE; // radius in tiles (visual size matches interaction range)
export const NEST_CHILD_LEASH_TILES = 2.2;
export const NEST_PARENTING_RANGE_TILES = 1.5 * NEST_SCALE;

// Parenting is not continuous: parents alternate between nest care and other actions.
export const PARENTING_INCUBATE_STAY_SECONDS = 8;
export const PARENTING_INCUBATE_BREAK_SECONDS = 4;
export const PARENTING_FEED_IDLE_VISIT_SECONDS = 2.5;
export const PARENTING_FEED_IDLE_BREAK_SECONDS = 4;
export const PARENTING_FEED_BREAK_SECONDS = 6;

export const EAT_HP_RECOVER_FRACTION = 0.1;
export const MEAT_HUNGER_RECOVER_FRACTION = 0.2;
export const EAT_COOLDOWN_SECONDS = 2;

export const FOOD_SEEK_START_HUNGER_PCT = 0.7;
export const FOOD_SEEK_STOP_HUNGER_PCT = 0.95;
export const FOOD_SPRINT_START_HUNGER_PCT = 0.5;
export const FOOD_SPRINT_FULL_HUNGER_PCT = 0.2;
export const FOOD_RESERVE_OVERRIDE_HUNGER_PCT = 0.3;

export const FLEE_RANGE_TILES = 10;
export const FLEE_LOCK_SECONDS = 1.2;

export const FOOD_TARGET_LOCK_SECONDS = 1.25;

// Learning: fear from being attacked. When fear is active, non-carnivores flee if a carnivore is nearby.
export const FEAR_MAX_SECONDS = 30;
export const FEAR_ADD_ON_HIT_SECONDS = 12;

// Learning: per-individual danger heatmap on tiles (decays over time). Used as a penalty for roaming goals.
export const DANGER_TAU_SECONDS = 60;
export const DANGER_MIN_KEEP = 0.08;
export const DANGER_ADD_ON_HIT = 1.0;
export const DANGER_WANDER_SAMPLE_COUNT = 7;

export const CHILD_MILK_START_HUNGER_PCT = 0.3;
export const CHILD_MILK_STOP_HUNGER_PCT = 0.6;

export const FOLLOW_MOTHER_ENTER_TILES = 10;
export const FOLLOW_MOTHER_EXIT_TILES = 7;

export const EVOLUTION_MODE = {
  natural: "natural",
  ga: "ga",
  both: "both",
};

export const SOCIAL_RANGE_TILES = 5;
export const SOCIAL_THRESHOLD_SECONDS = 10;

export const EVOLUTION_POOL_LIMIT = 240;
export const EVOLUTION_GA_LIMIT = 80;

export const RESERVE_REST_EXIT_MULT = 1.18;
export const RESERVE_REST_MIN_SECONDS = 0.8;

export const DEV_DECAY_ATTACK_TAU = 60;
export const DEV_DECAY_MOVE_TAU = 60;
export const DEV_DECAY_EXPLORE_TAU = 120;
export const DEV_APPROACH_TAU = 30;

// Territory paint (group color) system.
// A tile gains "paint seconds" while animals of a group are within radius 1 tile (9 tiles total).
// Paint is permanent (no decay) but can be overwritten by other groups.
// Multiple individuals accelerate painting by contributing additively per tick.
export const TERRITORY_LEVEL_SECONDS = [0, 5, 15, 30, 60]; // index = level (0..4)
export const TERRITORY_MAX_SECONDS = 60;

// Buff multipliers by territory level (0..4). Level 0 means "no territory buff".
// Level 4 has a special rule: lifespan does not decrease while standing on own MAX territory.
export const TERRITORY_SPEED_MUL_BY_LEVEL = [1, 1.04, 1.08, 1.14, 1.22];
export const TERRITORY_LIFE_MUL_BY_LEVEL = [1, 1.15, 1.35, 1.8, 999999];
export const TERRITORY_MATE_MUL_BY_LEVEL = [1, 1.1, 1.25, 1.45, 1.7];

// Visual alpha for territory overlay (0..4).
export const TERRITORY_ALPHA_BY_LEVEL = [0, 0.12, 0.22, 0.32, 0.45];
