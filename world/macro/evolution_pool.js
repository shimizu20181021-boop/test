import { EVOLUTION_GA_LIMIT, EVOLUTION_MODE, EVOLUTION_POOL_LIMIT } from "./constants.js";
import { dietTypeForEntity, dietTypeFromReincarnation } from "./diet.js";
import { cloneGenome, createRandomGenome, mutateGenome } from "./genome.js";

function dietKey(dietType) {
  const d = String(dietType || "").toLowerCase();
  if (d === "herbivore" || d === "omnivore" || d === "carnivore") return d;
  return null;
}

function pickWeightedIndex(rng, weights) {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += Math.max(0, Number(weights[i]) || 0);
  if (!(total > 0)) return 0;
  let r = (typeof rng === "function" ? rng() : Math.random()) * total;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, Number(weights[i]) || 0);
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

export function pushNaturalGenome({ world, dietType, genome }) {
  const key = dietKey(dietType);
  if (!key) return;
  const g = cloneGenome(genome);
  if (!g) return;

  const arr = world?._naturalGenomePool?.get(key) || [];
  arr.push(g);
  if (arr.length > EVOLUTION_POOL_LIMIT) arr.splice(0, arr.length - EVOLUTION_POOL_LIMIT);
  world?._naturalGenomePool?.set(key, arr);
}

export function pushGaGenome({ world, dietType, genome, fitness }) {
  const key = dietKey(dietType);
  if (!key) return;
  const g = cloneGenome(genome);
  if (!g) return;

  const f = Number(fitness) || 0;
  const arr = world?._gaGenomePool?.get(key) || [];
  arr.push({ genome: g, fitness: f });
  arr.sort((a, b) => (b.fitness ?? 0) - (a.fitness ?? 0));
  if (arr.length > EVOLUTION_GA_LIMIT) arr.splice(EVOLUTION_GA_LIMIT);
  world?._gaGenomePool?.set(key, arr);
}

function pickGenomeFromNatural(world, dietType, rng) {
  const key = dietKey(dietType);
  if (!key) return null;
  const arr = world?._naturalGenomePool?.get(key);
  if (!arr || !arr.length) return null;
  const i = Math.floor((typeof rng === "function" ? rng() : Math.random()) * arr.length);
  return cloneGenome(arr[Math.max(0, Math.min(arr.length - 1, i))]);
}

function pickGenomeFromGa(world, dietType, rng) {
  const key = dietKey(dietType);
  if (!key) return null;
  const arr = world?._gaGenomePool?.get(key);
  if (!arr || !arr.length) return null;

  // Rank-weighted selection: higher fitness (earlier) is more likely.
  const weights = [];
  for (let i = 0; i < arr.length; i++) weights.push(1 / (i + 1));
  const idx = pickWeightedIndex(rng, weights);
  return cloneGenome(arr[idx]?.genome);
}

export function pickGenomeForReincarnation({ world, kind, initialDietType, reincarnation, rng }) {
  if (kind === "plant" || kind === "meat") return null;

  const baseDiet = dietKey(initialDietType) || dietTypeFromReincarnation(reincarnation);
  const diet = dietKey(baseDiet) || "herbivore";

  let genome = null;
  if (world?._evolutionMode === EVOLUTION_MODE.ga) genome = pickGenomeFromGa(world, diet, rng);
  else if (world?._evolutionMode === EVOLUTION_MODE.both) {
    const a = pickGenomeFromNatural(world, diet, rng);
    const b = pickGenomeFromGa(world, diet, rng);
    if (a && b) genome = (typeof rng === "function" ? rng() : Math.random()) < 0.5 ? a : b;
    else genome = a || b;
  } else {
    genome = pickGenomeFromNatural(world, diet, rng);
  }

  if (!genome) genome = createRandomGenome({ kind, initialDietType: diet, reincarnation, rng });

  genome.kind = String(kind || genome.kind || "unknown");
  genome.diet = String(diet || genome.diet || "unknown");

  // Small mutation on reincarnation so the pool doesn't stagnate.
  return mutateGenome(genome, rng, 0.18, 0.05);
}

export function recordDeathForEvolution({ world, entity }) {
  if (!entity || entity.kind === "plant" || entity.kind === "meat") return;
  const diet = dietKey(dietTypeForEntity(entity)) || dietKey(entity.dietType) || "herbivore";
  const life = Number(entity.ageSeconds) || 0;
  const babies = Number(entity.offspringCount) || 0;
  const fitness = life + babies * (Number(world?._fitnessChildWeight) || 0);
  pushGaGenome({ world, dietType: diet, genome: entity.genome, fitness });
}

