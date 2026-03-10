import { clampInt } from "./math.js";
import { seededInt } from "./random.js";

export const PLANT_LEVEL_SPECS = [
  { level: 1, hpMax: 100, weight: 70, visualIds: ["1", "2", "3", "4", "5"] },
  { level: 2, hpMax: 200, weight: 50, visualIds: ["6", "7", "8", "9", "10"] },
  { level: 3, hpMax: 300, weight: 30, visualIds: ["11", "12", "13", "14", "15"] },
  { level: 4, hpMax: 500, weight: 15, visualIds: ["500"] },
  { level: 5, hpMax: 1000, weight: 10, visualIds: ["1000"] },
];

const DEFAULT_PLANT_LEVEL = 1;
const DEFAULT_PLANT_VISUAL_ID = "1";

const PLANT_SPEC_BY_LEVEL = new Map(PLANT_LEVEL_SPECS.map((spec) => [spec.level, spec]));
const PLANT_SPEC_BY_VISUAL_ID = new Map();
for (const spec of PLANT_LEVEL_SPECS) {
  for (const visualId of spec.visualIds) {
    PLANT_SPEC_BY_VISUAL_ID.set(String(visualId), spec);
  }
}

function rng01(rng) {
  const value = typeof rng === "function" ? Number(rng()) : Math.random();
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 0.999999;
  return value;
}

export function normalizePlantLevel(level) {
  const n = clampInt(level, DEFAULT_PLANT_LEVEL, PLANT_LEVEL_SPECS.length);
  return PLANT_SPEC_BY_LEVEL.has(n) ? n : DEFAULT_PLANT_LEVEL;
}

export function plantSpecForLevel(level) {
  return PLANT_SPEC_BY_LEVEL.get(normalizePlantLevel(level)) || PLANT_SPEC_BY_LEVEL.get(DEFAULT_PLANT_LEVEL);
}

export function normalizePlantVisualId(visualId) {
  const key = String(visualId ?? "").trim();
  if (PLANT_SPEC_BY_VISUAL_ID.has(key)) return key;
  const asNum = Number(key);
  if (Number.isFinite(asNum)) {
    const numKey = String(Math.round(asNum));
    if (PLANT_SPEC_BY_VISUAL_ID.has(numKey)) return numKey;
  }
  return DEFAULT_PLANT_VISUAL_ID;
}

export function plantSpecForVisualId(visualId) {
  return PLANT_SPEC_BY_VISUAL_ID.get(normalizePlantVisualId(visualId)) || plantSpecForLevel(DEFAULT_PLANT_LEVEL);
}

export function plantLevelFromVisualId(visualId) {
  return plantSpecForVisualId(visualId)?.level || DEFAULT_PLANT_LEVEL;
}

export function plantHpMaxForLevel(level) {
  return Math.max(1, Number(plantSpecForLevel(level)?.hpMax) || 100);
}

export function pickWeightedPlantLevel(rng) {
  const total = PLANT_LEVEL_SPECS.reduce((sum, spec) => sum + Math.max(0, Number(spec.weight) || 0), 0) || 1;
  let threshold = rng01(rng) * total;
  for (const spec of PLANT_LEVEL_SPECS) {
    threshold -= Math.max(0, Number(spec.weight) || 0);
    if (threshold <= 0) return spec.level;
  }
  return DEFAULT_PLANT_LEVEL;
}

export function pickPlantVisualIdForLevel(level, rng) {
  const spec = plantSpecForLevel(level);
  const ids = Array.isArray(spec?.visualIds) ? spec.visualIds : [DEFAULT_PLANT_VISUAL_ID];
  if (ids.length <= 1) return String(ids[0] || DEFAULT_PLANT_VISUAL_ID);
  const index = seededInt(typeof rng === "function" ? rng : Math.random, 0, ids.length - 1);
  return String(ids[index] || ids[0] || DEFAULT_PLANT_VISUAL_ID);
}

export function plantStillFileForVisualId(visualId) {
  return `植物${normalizePlantVisualId(visualId)}.png`;
}

export function plantAnimFileForVisualId(visualId) {
  const normalized = normalizePlantVisualId(visualId);
  const level = plantLevelFromVisualId(normalized);
  if (level === 4) return "Lv_4_植物500.png";
  if (level === 5) return "Lv_5_植物1000.png";
  return `Lv${level}_植物_${normalized}.png`;
}
