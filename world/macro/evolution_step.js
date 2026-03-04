import { clamp } from "../../core/utils.js";
import { clamp01, lerpExp } from "./math.js";
import { ensureVariantBases } from "./variant.js";

export function evolutionStepEntity({ world, entity, dt, tileSizePx, tileWidth, tileHeight }) {
  if (!entity || entity.kind === "plant" || entity.kind === "meat") return;
  const v = entity.variant;
  if (!v) return;

  ensureVariantBases(v);

  // Biome-based color tinting is disabled: keep the coat palette at its base colors.
  if (Array.isArray(v.coatBaseStops) && v.coatBaseStops.length) {
    v.coat = v.coat && typeof v.coat === "object" ? v.coat : { stops: [], angle: 0 };
    v.coat.stops = [...v.coatBaseStops];
    v.coat.angle = Number(v.coatBaseAngle) || 0;
  }

  // Track visited tiles (unique count) -> exploration impulse.
  const tw = Math.max(1, tileWidth | 0);
  const th = Math.max(1, tileHeight | 0);
  const totalTiles = tw * th;
  const words = Math.ceil(totalTiles / 32);
  if (!(entity.visitedTileBits instanceof Uint32Array) || entity.visitedTileBits.length !== words) {
    entity.visitedTileBits = new Uint32Array(words);
    entity.visitedTileCount = 0;
    entity._lastVisitedTileIndex = null;
  }

  const tx0 = Math.floor((Number(entity.x) || 0) / tileSizePx);
  const ty0 = Math.floor((Number(entity.y) || 0) / tileSizePx);
  const tx = ((tx0 % tw) + tw) % tw;
  const ty = ((ty0 % th) + th) % th;
  const tileIndex = ty * tw + tx;

  if (entity._lastVisitedTileIndex !== tileIndex) {
    const word = tileIndex >>> 5;
    const bit = tileIndex & 31;
    const mask = 1 << bit;
    const prev = entity.visitedTileBits[word] >>> 0;
    if ((prev & (mask >>> 0)) === 0) {
      entity.visitedTileBits[word] = (prev | (mask >>> 0)) >>> 0;
      entity.visitedTileCount = (Number(entity.visitedTileCount) || 0) + 1;
      entity.exploreImpulse = (Number(entity.exploreImpulse) || 0) + 1;
    }
    entity._lastVisitedTileIndex = tileIndex;
  }

  const genome = entity.genome || {};

  // Diet-driven shape (plant -> round, meat -> angular).
  const plant = Number(entity.foodPlantEaten) || 0;
  const meat = Number(entity.foodMeatEaten) || 0;
  const totalFood = plant + meat;
  let plantRatio = totalFood > 0 ? plant / totalFood : 0.5;
  if (!(totalFood > 0)) {
    if (entity.dietType === "carnivore") plantRatio = 0;
    else if (entity.dietType === "herbivore") plantRatio = 1;
  }
  plantRatio = clamp01(plantRatio);

  const targetStyle = plantRatio >= 0.65 ? "round" : plantRatio <= 0.35 ? "angular" : v.bodyStyle;
  if (targetStyle === "round" || targetStyle === "angular") v.bodyStyle = targetStyle;

  const baseX = Number(v._baseBodyScaleX) || 1;
  const baseY = Number(v._baseBodyScaleY) || 1;
  const baseHeadAspect = Number(v._baseHeadAspect) || 1;
  const bodyXTarget = clamp(baseX * (1.08 - plantRatio * 0.13), 0.85, 1.3);
  const bodyYTarget = clamp(baseY * (0.95 + plantRatio * 0.15), 0.75, 1.35);
  const headAspectTarget = clamp(baseHeadAspect * (1.12 - plantRatio * 0.22), 0.65, 1.6);

  v.bodyScaleX = lerpExp(v.bodyScaleX ?? 1, bodyXTarget, dt, 18);
  v.bodyScaleY = lerpExp(v.bodyScaleY ?? 1, bodyYTarget, dt, 18);
  v.headAspect = lerpExp(v.headAspect ?? 1, headAspectTarget, dt, 18);

  // Parts (horn/wing/tail) are disabled in the main game: keep them at zero.
  entity.hornDev = 0;
  entity.tailDev = 0;
  entity.wingDev = 0;
  v.hornCount = 0;
  v.tailCount = 0;
  v.wingCount = 0;
  v.hornScale = Number(v._baseHornScale) || 1;
  v.tailScale = Number(v._baseTailScale) || 1;
  v.wingScale = Number(v._baseWingScale) || 1;
}
