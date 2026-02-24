export const SETTINGS_PRESETS = {
  population: {
    few: { target: 60, spawnPerSecond: 12 },
    normal: { target: 120, spawnPerSecond: 18 },
    many: { target: 220, spawnPerSecond: 26 },
  },
};

export const DEFAULT_SETTINGS = {
  populationPreset: "normal",
  reincarnationIndividuals: 15,
  microMergeCooldownSeconds: 10,
  microMergeRitualSeconds: 1.0,
  microStarScale: 1.0,
  microVisualRadiusSmoothing: 2.7,
  microGalaxyStrength: 0.85,
  microGalaxyStartPct: 0.4,
  microDebug: false,
  macroAnimalCap: 30,
  macroMapSize: "large",
  macroPopCapPlant: 500,
  macroPopCapHerbivore: 500,
  macroPopCapOmnivore: 500,
  macroPopCapCarnivore: 500,
  macroGroupMaxSize: 4,
  macroHerbReproPreset: "normal",
  macroHerbBirthPreset: "normal",
  macroOmniReproPreset: "normal",
  macroOmniBirthPreset: "normal",
  macroCarnReproPreset: "normal",
  macroCarnBirthPreset: "normal",
  macroPlantReproMax: 2,
  macroMeatHungerRecoverPct: 40,
  macroPlantHungerRecoverMul: 1.5,
  macroPlantStaminaMul: 1.0,
  macroPlantLifeMinutes: 0,
  macroHerbStaminaMul: 1.0,
  macroHerbLifeMinutes: 5,
  macroHerbHungerDecayMul: 1.0,
  macroOmniStaminaMul: 1.0,
  macroOmniLifeMinutes: 5,
  macroOmniHungerDecayMul: 1.0,
  macroCarnStaminaMul: 1.0,
  macroCarnLifeMinutes: 5,
  macroCarnHungerDecayMul: 1.0,
  macroCarnAttackMul: 2.0,
  macroMeatRotEnabled: true,
  macroEvolutionMode: "natural",
  fitnessChildWeight: 60,
  macroNnVizBlinkMode: "flash", // "always" | "flash"
  macroNnVizOutputsMode: "compact", // "compact" | "full"
};

export const MICRO_CONFIG = {
  boundsPadding: 10,
  mergeChance: 1 / 3,
  mergeCooldownSeconds: 10,
  maxIndividuals: 15,
  randomGeneOptions: ["stamina", "health", "attack"],
  baseSpeedPxPerSecond: { min: 18, max: 48 },
  chaseRadius: 420,
  steering: 0.12,
  collisionGridCellSize: 80,
};

export const MACRO_CONFIG = {
  tileSize: 64,
  worldSize: { width: 4096, height: 3072 },
  cameraSpeedPxPerSecond: 900,
  cameraDragSpeed: 1.0,
  minimapSize: { width: 220, height: 160 },
};
