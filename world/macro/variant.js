import { clamp } from "../../core/utils.js";
import { dietTypeFromKind } from "./diet.js";
import { clampInt } from "./math.js";
import { mulberry32, seededFloat, seededInt } from "./random.js";

export function cloneVariantTemplate(variant) {
  if (!variant || typeof variant !== "object") return variant;
  const coat = variant.coat;
  const nextCoat =
    coat && typeof coat === "object"
      ? {
          ...coat,
          stops: Array.isArray(coat.stops) ? [...coat.stops] : coat.stops,
        }
      : coat;
  return { ...variant, coat: nextCoat };
}

export function hornCountForSex(sex, rng) {
  const p = typeof rng === "function" ? rng() : Math.random();
  if (sex === "female") {
    if (p < 0.65) return 0;
    if (p < 0.92) return 1;
    return 2;
  }
  if (p < 0.35) return 0;
  if (p < 0.75) return 1;
  if (p < 0.93) return 2;
  return 3;
}

export function createCoatStyle(kind, sex, rng) {
  if (kind === "plant") {
    const greens = ["#2f6b3e", "#3d7a4a", "#2a5f3a", "#4a8a3f", "#6fa84f", "#7bbf6a"];
    const accents = ["#9bd67e", "#c6e57a", "#6fb8b2", "#88c8ff", "#e6d97a"];
    const count = rng() < 0.55 ? 1 : rng() < 0.85 ? 2 : 3;
    const stops = [];
    for (let i = 0; i < count; i++) {
      const pool = i === 0 ? greens : rng() < 0.25 ? accents : greens;
      stops.push(pool[seededInt(rng, 0, pool.length - 1)]);
    }
    return { stops, angle: seededFloat(rng, 0, Math.PI * 2) };
  }

  if (!sex || sex === "none") return { stops: ["#111"], angle: 0 };

  const darkPalette = ["#0e0e0e", "#1a1a1a", "#2b1b0f", "#3a2615", "#40291a", "#1b2a3a", "#2b2433"];
  const lightPalette = ["#f09ab0", "#f2a65a", "#f7b7d2", "#f5c26b", "#f2d1a0", "#f3b1a0", "#f2b7a6"];
  const palette = sex === "female" ? lightPalette : darkPalette;

  const count = rng() < 0.5 ? 1 : rng() < 0.8 ? 2 : 3;
  const stops = [];
  for (let i = 0; i < count; i++) {
    stops.push(palette[seededInt(rng, 0, palette.length - 1)]);
  }

  return { stops, angle: seededFloat(rng, 0, Math.PI * 2) };
}

export function createDietCoatStyle({ sex, dietType, rng, existing }) {
  const malePalettes = {
    herbivore: ["#0e0e0e", "#1a1a1a", "#2f6b3e", "#3a2615", "#4a3b1a", "#1b2a3a"],
    omnivore: ["#0e0e0e", "#2b2433", "#2f6b3e", "#3a2615", "#5b2b2b", "#1b2a3a"],
    carnivore: ["#0e0e0e", "#1a1a1a", "#3a0f14", "#2b1b0f", "#1b2a3a", "#6b1e1e"],
  };
  const femalePalettes = {
    herbivore: ["#f7b7d2", "#f2d1a0", "#cfe9c9", "#b8e0d2", "#f5c26b", "#f2a65a"],
    omnivore: ["#f09ab0", "#f2a65a", "#d7b4f3", "#cfe9c9", "#f3b1a0", "#f5c26b"],
    carnivore: ["#f7b7d2", "#f4a7a7", "#d7b4f3", "#ffd1a6", "#f09ab0", "#f2a65a"],
  };

  const palettes = sex === "female" ? femalePalettes : malePalettes;
  const palette = palettes[dietType] || palettes.omnivore;
  const count = rng() < 0.55 ? 1 : rng() < 0.85 ? 2 : 3;
  const stops = [];
  for (let i = 0; i < count; i++) {
    stops.push(palette[seededInt(rng, 0, palette.length - 1)]);
  }

  const oldStops = existing?.stops;
  if (Array.isArray(oldStops) && oldStops.length && rng() < 0.55) {
    stops[0] = oldStops[seededInt(rng, 0, oldStops.length - 1)];
  }

  return { stops, angle: seededFloat(rng, 0, Math.PI * 2) };
}

export function createRandomVariant({ kind, sex, rng }) {
  const speciesVariant = (() => {
    if (kind === "plant") return seededInt(rng, 0, 2);
    if (kind === "predator") return seededInt(rng, 0, 2);
    return seededInt(rng, 0, 3);
  })();

  const limbCount = (() => {
    const p = rng();
    if (p < 0.4) return 4;
    if (p < 0.6) return 6;
    if (p < 0.72) return 2;
    if (p < 0.82) return 8;
    return seededInt(rng, 3, 10);
  })();

  const eyeCount = (() => {
    const p = rng();
    if (p < 0.12) return 0;
    if (p < 0.62) return seededInt(rng, 1, 2);
    if (p < 0.85) return seededInt(rng, 3, 4);
    return seededInt(rng, 5, 8);
  })();

  // Parts (horn/wing/tail) are disabled in the main game:
  // - Birds are represented by dedicated design IDs (taxon = bird) instead of dynamic wings.
  // - Horns/tails are not attached or evolved.
  const tailCount = 0;
  const hornCount = 0;
  const wingCount = 0;

  return {
    flip: rng() < 0.5,
    rotation: seededFloat(rng, -0.35, 0.35),
    bodyScaleX: seededFloat(rng, 0.85, 1.3),
    bodyScaleY: seededFloat(rng, 0.75, 1.35),
    headScale: seededFloat(rng, 0.65, 1.35),
    headAspect: seededFloat(rng, 0.75, 1.35),
    bodyStyle: rng() < 0.25 ? "angular" : "round",
    hornStyle: seededInt(rng, 0, 2),
    hornCount,
    hornScale: seededFloat(rng, 0.75, 1.35),
    tailCount,
    tailScale: seededFloat(rng, 0.75, 1.35),
    wingCount,
    wingStyle: seededInt(rng, 0, 2),
    wingScale: seededFloat(rng, 0.75, 1.35),
    limbCount,
    eyeCount,
    eyeScale: seededFloat(rng, 0.75, 1.35),
    petals: seededInt(rng, 5, 8),
    petalRoundness: seededFloat(rng, 0.6, 1.2),
    filled: rng() < 0.25,
    speciesVariant,
    coat: createCoatStyle(kind, sex, rng),
  };
}

export function applyDietAppearanceShift(entity, nextDietType) {
  if (!entity || !entity.variant) return;
  const seed =
    (entity.id * 2654435761 + (Number(entity.foodPlantEaten) || 0) * 31 + (Number(entity.foodMeatEaten) || 0) * 131) >>> 0;
  const rng = mulberry32(seed);

  const v = entity.variant;
  v.rotation = clamp((v.rotation ?? 0) + seededFloat(rng, -0.12, 0.12), -0.6, 0.6);

  if (nextDietType === "herbivore") {
    v.bodyScaleX = clamp((v.bodyScaleX ?? 1) * seededFloat(rng, 0.96, 1.06), 0.85, 1.3);
    v.bodyScaleY = clamp((v.bodyScaleY ?? 1) * seededFloat(rng, 1.02, 1.12), 0.85, 1.35);
    v.headScale = clamp((v.headScale ?? 1) * seededFloat(rng, 0.98, 1.12), 0.7, 1.35);
    v.hornStyle = seededInt(rng, 0, 1);
    v.filled = rng() < 0.2;
  } else if (nextDietType === "carnivore") {
    v.bodyScaleX = clamp((v.bodyScaleX ?? 1) * seededFloat(rng, 1.03, 1.14), 0.85, 1.3);
    v.bodyScaleY = clamp((v.bodyScaleY ?? 1) * seededFloat(rng, 0.9, 1.02), 0.75, 1.35);
    v.headScale = clamp((v.headScale ?? 1) * seededFloat(rng, 0.88, 1.02), 0.65, 1.35);
    v.hornStyle = seededInt(rng, 1, 2);
    v.filled = rng() < 0.55;
  } else {
    v.bodyScaleX = clamp((v.bodyScaleX ?? 1) * seededFloat(rng, 0.96, 1.1), 0.85, 1.3);
    v.bodyScaleY = clamp((v.bodyScaleY ?? 1) * seededFloat(rng, 0.92, 1.1), 0.75, 1.35);
    v.headScale = clamp((v.headScale ?? 1) * seededFloat(rng, 0.9, 1.08), 0.65, 1.35);
    v.hornStyle = seededInt(rng, 0, 2);
    v.filled = rng() < 0.35;
  }

  if (entity.kind !== "plant" && entity.kind !== "meat" && entity.sex !== "none") {
    const existing = Array.isArray(v.coatBaseStops) && v.coatBaseStops.length ? { stops: v.coatBaseStops } : v.coat;
    v.coat = createDietCoatStyle({ sex: entity.sex, dietType: nextDietType, rng, existing });
  }
  refreshVariantBases(v);
}

export function ensureVariantBases(variant) {
  if (!variant || typeof variant !== "object") return;
  if (variant._baseBodyScaleX == null) variant._baseBodyScaleX = Number(variant.bodyScaleX) || 1;
  if (variant._baseBodyScaleY == null) variant._baseBodyScaleY = Number(variant.bodyScaleY) || 1;
  if (variant._baseHeadScale == null) variant._baseHeadScale = Number(variant.headScale) || 1;
  if (variant._baseHeadAspect == null) variant._baseHeadAspect = Number(variant.headAspect) || 1;
  if (variant._baseHornScale == null) variant._baseHornScale = Number(variant.hornScale) || 1;
  if (variant._baseTailScale == null) variant._baseTailScale = Number(variant.tailScale) || 1;
  if (variant._baseWingScale == null) variant._baseWingScale = Number(variant.wingScale) || 1;
  if (variant._baseWingCount == null) variant._baseWingCount = clampInt(variant.wingCount ?? 0, 0, 4);

  if (!variant.coat || typeof variant.coat !== "object") variant.coat = { stops: ["#111"], angle: 0 };
  const stops = Array.isArray(variant.coat.stops) && variant.coat.stops.length ? variant.coat.stops : ["#111"];
  if (!Array.isArray(variant.coatBaseStops) || !variant.coatBaseStops.length) variant.coatBaseStops = [...stops];
  if (variant.coatBaseAngle == null) variant.coatBaseAngle = typeof variant.coat.angle === "number" ? variant.coat.angle : 0;
  if (!Array.isArray(variant.coat.stops) || !variant.coat.stops.length) variant.coat.stops = [...variant.coatBaseStops];
  if (typeof variant.coat.angle !== "number") variant.coat.angle = Number(variant.coatBaseAngle) || 0;
}

export function refreshVariantBases(variant) {
  if (!variant || typeof variant !== "object") return;
  variant._baseBodyScaleX = Number(variant.bodyScaleX) || 1;
  variant._baseBodyScaleY = Number(variant.bodyScaleY) || 1;
  variant._baseHeadScale = Number(variant.headScale) || 1;
  variant._baseHeadAspect = Number(variant.headAspect) || 1;
  variant._baseHornScale = Number(variant.hornScale) || 1;
  variant._baseTailScale = Number(variant.tailScale) || 1;
  variant._baseWingScale = Number(variant.wingScale) || 1;
  variant._baseWingCount = clampInt(variant.wingCount ?? 0, 0, 4);

  if (!variant.coat || typeof variant.coat !== "object") variant.coat = { stops: ["#111"], angle: 0 };
  const stops = Array.isArray(variant.coat.stops) && variant.coat.stops.length ? variant.coat.stops : ["#111"];
  variant.coatBaseStops = [...stops];
  variant.coatBaseAngle = typeof variant.coat.angle === "number" ? variant.coat.angle : 0;
}

export function createChildVariant({ fatherVariant, motherVariant, sex, kind, dietType, rng }) {
  const vA = fatherVariant && typeof fatherVariant === "object" ? fatherVariant : null;
  const vB = motherVariant && typeof motherVariant === "object" ? motherVariant : null;
  const p = typeof rng === "function" ? rng : Math.random;

  const avg = (x, y, fallback) => {
    const nx = Number(x);
    const ny = Number(y);
    const xOk = Number.isFinite(nx);
    const yOk = Number.isFinite(ny);
    if (xOk && yOk) return (nx + ny) / 2;
    if (xOk) return nx;
    if (yOk) return ny;
    return fallback;
  };

  const choose = (x, y, fallback) => {
    if (x != null && y != null) return p() < 0.5 ? x : y;
    if (x != null) return x;
    if (y != null) return y;
    return fallback;
  };

  const jitter = (a) => seededFloat(p, -a, a);

  const limbCount = clampInt(Math.round(avg(vA?.limbCount, vB?.limbCount, 4) + jitter(1.1)), 2, 10);
  const eyeCount = clampInt(Math.round(avg(vA?.eyeCount, vB?.eyeCount, 1) + jitter(1.25)), 0, 8);
  // Parts are disabled (see createRandomVariant above).
  const tailCount = 0;
  const hornCount = 0;
  const wingCount = 0;

  const out = {
    flip: Boolean(choose(vA?.flip, vB?.flip, p() < 0.5)),
    rotation: clamp(avg(vA?.rotation, vB?.rotation, 0) + jitter(0.12), -0.6, 0.6),
    bodyScaleX: clamp(avg(vA?.bodyScaleX, vB?.bodyScaleX, 1) + jitter(0.06), 0.85, 1.3),
    bodyScaleY: clamp(avg(vA?.bodyScaleY, vB?.bodyScaleY, 1) + jitter(0.08), 0.75, 1.35),
    headScale: clamp(avg(vA?.headScale, vB?.headScale, 1) + jitter(0.08), 0.65, 1.35),
    headAspect: clamp(avg(vA?.headAspect, vB?.headAspect, 1) + jitter(0.12), 0.75, 1.35),
    bodyStyle: choose(vA?.bodyStyle, vB?.bodyStyle, "round"),
    hornStyle: clampInt(choose(vA?.hornStyle, vB?.hornStyle, 0), 0, 2),
    hornCount,
    hornScale: clamp(avg(vA?.hornScale, vB?.hornScale, 1) + jitter(0.12), 0.6, 1.6),
    tailCount,
    tailScale: clamp(avg(vA?.tailScale, vB?.tailScale, 1) + jitter(0.12), 0.6, 1.6),
    wingCount,
    wingStyle: clampInt(choose(vA?.wingStyle, vB?.wingStyle, 0), 0, 2),
    wingScale: clamp(avg(vA?.wingScale, vB?.wingScale, 1) + jitter(0.12), 0.6, 1.8),
    limbCount,
    eyeCount,
    eyeScale: clamp(avg(vA?.eyeScale, vB?.eyeScale, 1) + jitter(0.12), 0.6, 1.8),
    petals: clampInt(Math.round(avg(vA?.petals, vB?.petals, 6) + jitter(1.0)), 3, 10),
    petalRoundness: clamp(avg(vA?.petalRoundness, vB?.petalRoundness, 1) + jitter(0.18), 0.5, 1.4),
    filled: Boolean(choose(vA?.filled, vB?.filled, p() < 0.35)),
    speciesVariant: clampInt(choose(vA?.speciesVariant, vB?.speciesVariant, 0), 0, kind === "plant" ? 2 : 3),
    coat: createCoatStyle(kind, sex, p),
  };

  if (kind !== "plant" && kind !== "meat" && sex !== "none") {
    out.coat = createDietCoatStyle({
      sex,
      dietType: dietType || dietTypeFromKind(kind),
      rng: p,
      existing: choose(vA?.coat, vB?.coat, null),
    });
  }

  ensureVariantBases(out);
  refreshVariantBases(out);
  return out;
}
