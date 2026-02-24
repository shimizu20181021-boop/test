import { clamp } from "../../core/utils.js";
import { blendBrains, cloneBrain, createBrain, ensureBrain, mutateBrain } from "./brain.js";
import { clamp01 } from "./math.js";
import { seededFloat } from "./random.js";
import { speedMultiplierFromTraitCode } from "./traits.js";
import { cloneVariantTemplate } from "./variant.js";

export function cloneGenome(genome) {
  if (!genome || typeof genome !== "object") return null;
  const out = { ...genome };
  if (genome.brain) out.brain = cloneBrain(genome.brain);
  return out;
}

export function snapshotParentForRepro(parent) {
  if (!parent || typeof parent !== "object") return null;
  const reinc = parent.reincarnation && typeof parent.reincarnation === "object" ? { ...parent.reincarnation } : null;
  if (reinc && reinc.traits && typeof reinc.traits === "object") reinc.traits = { ...reinc.traits };
  return {
    id: parent.id ?? null,
    kind: parent.kind ?? null,
    sex: parent.sex ?? null,
    groupId: parent.groupId ?? null,
    generation: parent.generation ?? 1,
    dietType: parent.dietType ?? null,
    dietImprintType: parent.dietImprintType ?? parent.dietType ?? null,
    dietImprintStrength: parent.dietImprintStrength ?? null,
    reincarnation: reinc,
    variant: parent.variant ? cloneVariantTemplate(parent.variant) : null,
    genome: cloneGenome(parent.genome),
  };
}

export function createRandomGenome({ kind, initialDietType, reincarnation, rng }) {
  const stamina01 = clamp(Number(reincarnation?.staminaPct) || 0, 0, 100) / 100;
  const attack01 = clamp(Number(reincarnation?.attackPct) || 0, 0, 100) / 100;
  const speedCode = reincarnation?.traits?.speedTrait?.code;
  const speedMul = speedMultiplierFromTraitCode(speedCode);
  const speed01 = clamp01((speedMul - 0.72) / (1.35 - 0.72));

  const p = typeof rng === "function" ? rng : Math.random;
  const jitter = (a) => seededFloat(p, -a, a);

  const hornPotential = clamp01(attack01 + jitter(0.18));
  const tailPotential = clamp01(0.35 + speed01 * 0.55 + jitter(0.22));
  const wingPotential = clamp01(0.25 + stamina01 * 0.5 + jitter(0.25));

  const reserveBase = seededFloat(p, 0.15, 0.55) + (0.35 - stamina01) * 0.18;
  const staminaReservePct = clamp(reserveBase, 0.08, 0.7);

  // "Pacing" traits (how aggressively the animal spends stamina for speed in each action).
  // These are learned via evolution (and can mutate) rather than fixed by reincarnation.
  const wanderPaceMul = clamp(0.92 + stamina01 * 0.1 + jitter(0.06), 0.85, 1.08);
  const foodSprintMul = clamp(1.08 + stamina01 * 0.18 + jitter(0.08), 1.0, 1.32);
  const mateSprintMul = clamp(1.03 + speed01 * 0.12 + jitter(0.07), 1.0, 1.22);

  const biomeTintStrength = clamp(seededFloat(p, 0.2, 0.6), 0, 0.85);
  const fur01 = clamp01(0.45 + jitter(0.28));

  return {
    kind: String(kind || "unknown"),
    diet: String(initialDietType || "unknown"),
    staminaReservePct,
    wanderPaceMul,
    foodSprintMul,
    mateSprintMul,
    biomeTintStrength,
    hornPotential,
    tailPotential,
    wingPotential,
    fur01,
    brain: createBrain(p),
  };
}

export function mutateGenome(genome, rng, rate = 0.25, amount = 0.08) {
  if (!genome || typeof genome !== "object") return genome;
  const p = typeof rng === "function" ? rng : Math.random;
  const mut = (v, min, max) => {
    if (p() < rate) return clamp(Number(v) + seededFloat(p, -amount, amount), min, max);
    return clamp(Number(v), min, max);
  };

  genome.staminaReservePct = mut(genome.staminaReservePct, 0.05, 0.8);
  genome.wanderPaceMul = mut(genome.wanderPaceMul, 0.8, 1.15);
  genome.foodSprintMul = mut(genome.foodSprintMul, 1.0, 1.45);
  genome.mateSprintMul = mut(genome.mateSprintMul, 1.0, 1.3);
  genome.biomeTintStrength = mut(genome.biomeTintStrength, 0, 0.9);
  genome.hornPotential = mut(genome.hornPotential, 0, 1);
  genome.tailPotential = mut(genome.tailPotential, 0, 1);
  genome.wingPotential = mut(genome.wingPotential, 0, 1);
  genome.fur01 = mut(genome.fur01, 0, 1);

  // Brain mutation is intentionally gentler than scalar traits to avoid unstable behaviors.
  const brain = ensureBrain(genome, p);
  if (brain) {
    const brainRate = clamp(rate * 0.12, 0.01, 0.08);
    const brainAmount = clamp(amount * 0.9, 0.02, 0.12);
    mutateBrain(brain, p, brainRate, brainAmount);
  }
  return genome;
}

export function blendGenomes(a, b, rng) {
  const gA = a && typeof a === "object" ? a : null;
  const gB = b && typeof b === "object" ? b : null;
  const avg = (x, y, fallback = 0) => {
    const nx = Number(x);
    const ny = Number(y);
    const xOk = Number.isFinite(nx);
    const yOk = Number.isFinite(ny);
    if (xOk && yOk) return (nx + ny) / 2;
    if (xOk) return nx;
    if (yOk) return ny;
    return fallback;
  };

  const out = {
    kind: String(gA?.kind || gB?.kind || "unknown"),
    diet: String(gA?.diet || gB?.diet || "unknown"),
    staminaReservePct: avg(gA?.staminaReservePct, gB?.staminaReservePct, 0.3),
    wanderPaceMul: avg(gA?.wanderPaceMul, gB?.wanderPaceMul, 1.0),
    foodSprintMul: avg(gA?.foodSprintMul, gB?.foodSprintMul, 1.18),
    mateSprintMul: avg(gA?.mateSprintMul, gB?.mateSprintMul, 1.08),
    biomeTintStrength: avg(gA?.biomeTintStrength, gB?.biomeTintStrength, 0.35),
    hornPotential: avg(gA?.hornPotential, gB?.hornPotential, 0.3),
    tailPotential: avg(gA?.tailPotential, gB?.tailPotential, 0.4),
    wingPotential: avg(gA?.wingPotential, gB?.wingPotential, 0.35),
    fur01: avg(gA?.fur01, gB?.fur01, 0.45),
    brain: blendBrains(gA?.brain, gB?.brain),
  };

  return mutateGenome(out, rng, 0.35, 0.09);
}
