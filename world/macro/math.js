import { clamp } from "../../core/utils.js";

export function smoothstep01(t) {
  const x = clamp(Number(t) || 0, 0, 1);
  return x * x * (3 - 2 * x);
}

export function lerpExp(current, target, dt, tauSeconds) {
  const tau = Math.max(1e-6, Number(tauSeconds) || 1);
  const a = 1 - Math.exp(-(Number(dt) || 0) / tau);
  return (Number(current) || 0) + ((Number(target) || 0) - (Number(current) || 0)) * a;
}

export function clamp01(n) {
  return clamp(Number(n) || 0, 0, 1);
}

export function clampInt(value, min, max) {
  const n = Number.parseInt(String(value), 10);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function decayExp(value, dt, tauSeconds) {
  const tau = Math.max(1e-6, Number(tauSeconds) || 1);
  return (Number(value) || 0) * Math.exp(-(Number(dt) || 0) / tau);
}
