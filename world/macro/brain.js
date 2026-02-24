import { clamp } from "../../core/utils.js";
import { seededFloat } from "./random.js";
import { clamp01 } from "./math.js";

// Tiny MLP policy ("brain") used for simple learning via genome + GA selection.
// - Input: normalized state features (Float32Array)
// - Hidden: ReLU
// - Output: mode scores + 4 continuous heads (pace, danger-avoid, commit, temperature preference)

export const BRAIN_INPUTS = 20;
export const BRAIN_HIDDEN = 10;
export const BRAIN_MODES = ["rest", "wander", "food", "flee", "mate", "hunt", "parenting"];
export const BRAIN_MODE_COUNT = BRAIN_MODES.length;
export const BRAIN_OUTPUTS = BRAIN_MODE_COUNT + 4;
export const BRAIN_OUT_PACE = BRAIN_MODE_COUNT + 0; // 0..1 (sigmoid)
export const BRAIN_OUT_DANGER = BRAIN_MODE_COUNT + 1; // 0..1 (sigmoid)
export const BRAIN_OUT_COMMIT = BRAIN_MODE_COUNT + 2; // 0..1 (sigmoid)
export const BRAIN_OUT_TEMP_BIAS = BRAIN_MODE_COUNT + 3; // 0..1 (sigmoid) -> (-1..+1) preference

function relu(x) {
  return x > 0 ? x : 0;
}

function sigmoid01(x) {
  const z = clamp(Number(x) || 0, -10, 10);
  return 1 / (1 + Math.exp(-z));
}

export function decodeBrain01(raw) {
  return clamp01(sigmoid01(raw));
}

export function createBrain(rng) {
  const p = typeof rng === "function" ? rng : Math.random;
  const w1 = new Float32Array(BRAIN_INPUTS * BRAIN_HIDDEN);
  const b1 = new Float32Array(BRAIN_HIDDEN);
  const w2 = new Float32Array(BRAIN_HIDDEN * BRAIN_OUTPUTS);
  const b2 = new Float32Array(BRAIN_OUTPUTS);

  // Small initial weights so the heuristic base policy remains dominant.
  for (let i = 0; i < w1.length; i++) w1[i] = seededFloat(p, -0.25, 0.25);
  for (let i = 0; i < w2.length; i++) w2[i] = seededFloat(p, -0.25, 0.25);
  for (let i = 0; i < b1.length; i++) b1[i] = seededFloat(p, -0.05, 0.05);
  for (let i = 0; i < b2.length; i++) b2[i] = seededFloat(p, -0.05, 0.05);

  // Mild bias toward wandering as a safe default.
  b2[1] = (b2[1] || 0) + 0.15;
  // Mild bias toward "commit" so switching isn't too frequent at start.
  b2[BRAIN_OUT_COMMIT] = (b2[BRAIN_OUT_COMMIT] || 0) + 0.2;

  return { w1, b1, w2, b2 };
}

export function ensureBrain(genome, rng) {
  if (!genome || typeof genome !== "object") return null;
  const b = genome.brain;
  if (
    b &&
    b.w1 instanceof Float32Array &&
    b.b1 instanceof Float32Array &&
    b.w2 instanceof Float32Array &&
    b.b2 instanceof Float32Array &&
    b.w1.length === BRAIN_INPUTS * BRAIN_HIDDEN &&
    b.b1.length === BRAIN_HIDDEN &&
    b.w2.length === BRAIN_HIDDEN * BRAIN_OUTPUTS &&
    b.b2.length === BRAIN_OUTPUTS
  ) {
    return b;
  }
  const next = createBrain(rng);
  genome.brain = next;
  return next;
}

export function cloneBrain(brain) {
  const b = brain && typeof brain === "object" ? brain : null;
  if (
    !b ||
    !(b.w1 instanceof Float32Array) ||
    !(b.b1 instanceof Float32Array) ||
    !(b.w2 instanceof Float32Array) ||
    !(b.b2 instanceof Float32Array)
  )
    return null;
  return {
    w1: new Float32Array(b.w1),
    b1: new Float32Array(b.b1),
    w2: new Float32Array(b.w2),
    b2: new Float32Array(b.b2),
  };
}

export function forwardBrain({ brain, inputs, hiddenOut, outputsOut }) {
  if (!brain || !inputs || !hiddenOut || !outputsOut) return false;
  const w1 = brain.w1;
  const b1 = brain.b1;
  const w2 = brain.w2;
  const b2 = brain.b2;

  if (
    !(w1 instanceof Float32Array) ||
    !(b1 instanceof Float32Array) ||
    !(w2 instanceof Float32Array) ||
    !(b2 instanceof Float32Array)
  )
    return false;
  if (inputs.length !== BRAIN_INPUTS) return false;
  if (hiddenOut.length !== BRAIN_HIDDEN) return false;
  if (outputsOut.length !== BRAIN_OUTPUTS) return false;

  // hidden = ReLU(W1*in + b1)
  for (let h = 0; h < BRAIN_HIDDEN; h++) {
    let sum = b1[h] || 0;
    const row = h * BRAIN_INPUTS;
    for (let i = 0; i < BRAIN_INPUTS; i++) sum += (inputs[i] || 0) * (w1[row + i] || 0);
    hiddenOut[h] = relu(sum);
  }

  // out = W2*hidden + b2
  for (let o = 0; o < BRAIN_OUTPUTS; o++) {
    let sum = b2[o] || 0;
    const row = o * BRAIN_HIDDEN;
    for (let h = 0; h < BRAIN_HIDDEN; h++) sum += (hiddenOut[h] || 0) * (w2[row + h] || 0);
    outputsOut[o] = sum;
  }
  return true;
}

// One-step policy gradient update (REINFORCE) for a small discrete action set.
// - Uses the brain's mode logits at `actionOutIdxs` (typically 3 actions).
// - `baseLogits` are added to logits for sampling, but are not learnable.
// - Updates are done in-place on `brain` weights (lamarckism: affects offspring genome).
export function policyGradientUpdate({
  brain,
  inputs,
  hiddenOut,
  outputsOut,
  actionOutIdxs,
  chosenAction,
  baseLogits,
  advantage,
  logitScale = 1,
  learningRate = 0.03,
  temperature = 0.85,
  l2 = 0.00025,
  advClip = 2.5,
  headOutIdxs = null,
  headSamples = null,
  headSigmas = null,
  headLearningRateMul = 0.2,
  debugOut = null,
}) {
  if (!brain || !inputs || !hiddenOut || !outputsOut) return false;
  if (!Array.isArray(actionOutIdxs) || actionOutIdxs.length !== 3) return false;
  const a0 = actionOutIdxs[0] | 0;
  const a1 = actionOutIdxs[1] | 0;
  const a2 = actionOutIdxs[2] | 0;
  const c = chosenAction | 0;
  if (!(c === 0 || c === 1 || c === 2)) return false;
  if (!Array.isArray(baseLogits) || baseLogits.length !== 3) return false;

  const ok = forwardBrain({ brain, inputs, hiddenOut, outputsOut });
  if (!ok) return false;

  const ls = clamp(Number(logitScale) || 1, 0.01, 10);
  const z0 = (Number(baseLogits[0]) || 0) + (Number(outputsOut[a0]) || 0) * ls;
  const z1 = (Number(baseLogits[1]) || 0) + (Number(outputsOut[a1]) || 0) * ls;
  const z2 = (Number(baseLogits[2]) || 0) + (Number(outputsOut[a2]) || 0) * ls;

  const t = Math.max(1e-3, Number(temperature) || 1);
  const x0 = z0 / t;
  const x1 = z1 / t;
  const x2 = z2 / t;
  const m = Math.max(x0, x1, x2);
  const e0 = Math.exp(x0 - m);
  const e1 = Math.exp(x1 - m);
  const e2 = Math.exp(x2 - m);
  const s0 = e0 + e1 + e2;
  const p0 = s0 > 0 ? e0 / s0 : 1 / 3;
  const p1 = s0 > 0 ? e1 / s0 : 1 / 3;
  const p2 = s0 > 0 ? e2 / s0 : 1 / 3;

  const adv = clamp(Number(advantage) || 0, -advClip, advClip);
  const lr = clamp(Number(learningRate) || 0, 0, 1);
  if (!(lr > 0) || !(adv !== 0)) return true;

  // d(log pi)/d(logit) = (onehot - p) / temperature
  const invT = 1 / Math.max(1e-3, Number(temperature) || 1);
  const s = lr * adv * invT * ls;
  const d0 = ((c === 0 ? 1 : 0) - p0) * s;
  const d1 = ((c === 1 ? 1 : 0) - p1) * s;
  const d2 = ((c === 2 ? 1 : 0) - p2) * s;

  // Optional: continuous heads as Normal(mean=logit, sigma) in logit space.
  // Adds REINFORCE gradients for those outputs: d(logp)/d(mean) = (sample - mean) / sigma^2.
  const headOuts = Array.isArray(headOutIdxs) ? headOutIdxs : null;
  const headSamps = headSamples && typeof headSamples === "object" ? headSamples : null;
  const headCount = headOuts ? Math.max(0, headOuts.length | 0) : 0;
  const dh =
    headCount > 0
      ? brain._scratchDHead instanceof Float32Array && brain._scratchDHead.length === headCount
        ? brain._scratchDHead
        : (brain._scratchDHead = new Float32Array(headCount))
      : null;

  if (dh) {
    for (let i = 0; i < headCount; i++) dh[i] = 0;
    const headMul = clamp(Number(headLearningRateMul) || 0, 0, 1);
    if (headMul > 0 && headSamps && Number(headSamps.length) === headCount) {
      const hs = lr * adv * headMul;
      const hasSigmas = headSigmas && typeof headSigmas === "object" && Number.isFinite(Number(headSigmas.length));
      for (let i = 0; i < headCount; i++) {
        const outIdx = headOuts[i] | 0;
        const samp = Number(headSamps[i]) || 0;
        const mean = Number(outputsOut[outIdx]) || 0;
        const sigRaw = hasSigmas ? headSigmas[i] : headSigmas;
        const sig = clamp(Number(sigRaw) || 0, 0.05, 5);
        dh[i] = hs * (samp - mean) / (sig * sig);
      }
    }
  }

  if (debugOut && typeof debugOut === "object") {
    const m =
      Array.isArray(debugOut.modeStep) && debugOut.modeStep.length === 3 ? debugOut.modeStep : (debugOut.modeStep = [0, 0, 0]);
    m[0] = d0;
    m[1] = d1;
    m[2] = d2;

    if (dh) {
      const h =
        Array.isArray(debugOut.headStep) && debugOut.headStep.length === headCount
          ? debugOut.headStep
          : (debugOut.headStep = new Array(headCount).fill(0));
      for (let i = 0; i < headCount; i++) h[i] = dh[i] || 0;
    } else {
      debugOut.headStep = null;
    }
  }

  const w1 = brain.w1;
  const b1 = brain.b1;
  const w2 = brain.w2;
  const b2 = brain.b2;
  if (
    !(w1 instanceof Float32Array) ||
    !(b1 instanceof Float32Array) ||
    !(w2 instanceof Float32Array) ||
    !(b2 instanceof Float32Array)
  )
    return false;

  // Backprop only through the updated outputs (the 3 discrete actions + optional continuous heads).
  const dHidden =
    brain._scratchDHidden instanceof Float32Array && brain._scratchDHidden.length === BRAIN_HIDDEN
      ? brain._scratchDHidden
      : (brain._scratchDHidden = new Float32Array(BRAIN_HIDDEN));

  // dHidden[h] = ReLU'(hidden[h]) * sum_o dOut[o] * W2[o,h]
  for (let h = 0; h < BRAIN_HIDDEN; h++) {
    const hv = hiddenOut[h] || 0;
    if (!(hv > 0)) {
      dHidden[h] = 0;
      continue;
    }
    const base =
      (d0 || 0) * (w2[a0 * BRAIN_HIDDEN + h] || 0) +
      (d1 || 0) * (w2[a1 * BRAIN_HIDDEN + h] || 0) +
      (d2 || 0) * (w2[a2 * BRAIN_HIDDEN + h] || 0);
    let head = 0;
    if (dh && headOuts) {
      for (let i = 0; i < headCount; i++) {
        const outIdx = headOuts[i] | 0;
        head += (dh[i] || 0) * (w2[outIdx * BRAIN_HIDDEN + h] || 0);
      }
    }
    dHidden[h] = base + head;
  }

  // Update W2, b2
  if (d0) {
    const row = a0 * BRAIN_HIDDEN;
    for (let h = 0; h < BRAIN_HIDDEN; h++) w2[row + h] = clamp((w2[row + h] || 0) + d0 * (hiddenOut[h] || 0), -2, 2);
    b2[a0] = clamp((b2[a0] || 0) + d0, -1, 1);
  }
  if (d1) {
    const row = a1 * BRAIN_HIDDEN;
    for (let h = 0; h < BRAIN_HIDDEN; h++) w2[row + h] = clamp((w2[row + h] || 0) + d1 * (hiddenOut[h] || 0), -2, 2);
    b2[a1] = clamp((b2[a1] || 0) + d1, -1, 1);
  }
  if (d2) {
    const row = a2 * BRAIN_HIDDEN;
    for (let h = 0; h < BRAIN_HIDDEN; h++) w2[row + h] = clamp((w2[row + h] || 0) + d2 * (hiddenOut[h] || 0), -2, 2);
    b2[a2] = clamp((b2[a2] || 0) + d2, -1, 1);
  }
  if (dh && headOuts) {
    for (let i = 0; i < headCount; i++) {
      const outIdx = headOuts[i] | 0;
      const g = dh[i] || 0;
      if (!(g !== 0)) continue;
      const row = outIdx * BRAIN_HIDDEN;
      for (let h = 0; h < BRAIN_HIDDEN; h++) w2[row + h] = clamp((w2[row + h] || 0) + g * (hiddenOut[h] || 0), -2, 2);
      b2[outIdx] = clamp((b2[outIdx] || 0) + g, -1, 1);
    }
  }

  // Update W1, b1
  for (let h = 0; h < BRAIN_HIDDEN; h++) {
    const dh = dHidden[h] || 0;
    if (!(dh !== 0)) continue;
    const row = h * BRAIN_INPUTS;
    for (let i = 0; i < BRAIN_INPUTS; i++) {
      w1[row + i] = clamp((w1[row + i] || 0) + dh * (inputs[i] || 0), -2, 2);
    }
    b1[h] = clamp((b1[h] || 0) + dh, -1, 1);
  }

  // L2 weight decay (very mild, keeps weights from drifting too far).
  const decay = 1 - clamp(Number(l2) || 0, 0, 0.05) * lr;
  if (decay < 0.999999) {
    for (let i = 0; i < w1.length; i++) w1[i] *= decay;
    for (let i = 0; i < w2.length; i++) w2[i] *= decay;
  }

  return true;
}

export function mutateBrain(brain, rng, rate = 0.06, amount = 0.12) {
  const b = brain && typeof brain === "object" ? brain : null;
  if (!b) return;
  const p = typeof rng === "function" ? rng : Math.random;

  const mutArr = (arr, min, max) => {
    if (!(arr instanceof Float32Array)) return;
    for (let i = 0; i < arr.length; i++) {
      if (p() >= rate) continue;
      const v = Number(arr[i]) || 0;
      arr[i] = clamp(v + seededFloat(p, -amount, amount), min, max);
    }
  };

  mutArr(b.w1, -2, 2);
  mutArr(b.b1, -1, 1);
  mutArr(b.w2, -2, 2);
  mutArr(b.b2, -1, 1);
}

export function blendBrains(a, b) {
  const A = a && typeof a === "object" ? a : null;
  const B = b && typeof b === "object" ? b : null;
  if (!A && !B) return null;
  if (!A) return cloneBrain(B);
  if (!B) return cloneBrain(A);
  if (
    !(A.w1 instanceof Float32Array) ||
    !(A.b1 instanceof Float32Array) ||
    !(A.w2 instanceof Float32Array) ||
    !(A.b2 instanceof Float32Array)
  )
    return cloneBrain(B);
  if (
    !(B.w1 instanceof Float32Array) ||
    !(B.b1 instanceof Float32Array) ||
    !(B.w2 instanceof Float32Array) ||
    !(B.b2 instanceof Float32Array)
  )
    return cloneBrain(A);

  const out = {
    w1: new Float32Array(A.w1.length),
    b1: new Float32Array(A.b1.length),
    w2: new Float32Array(A.w2.length),
    b2: new Float32Array(A.b2.length),
  };
  for (let i = 0; i < out.w1.length; i++) out.w1[i] = ((A.w1[i] || 0) + (B.w1[i] || 0)) * 0.5;
  for (let i = 0; i < out.b1.length; i++) out.b1[i] = ((A.b1[i] || 0) + (B.b1[i] || 0)) * 0.5;
  for (let i = 0; i < out.w2.length; i++) out.w2[i] = ((A.w2[i] || 0) + (B.w2[i] || 0)) * 0.5;
  for (let i = 0; i < out.b2.length; i++) out.b2[i] = ((A.b2[i] || 0) + (B.b2[i] || 0)) * 0.5;
  return out;
}
