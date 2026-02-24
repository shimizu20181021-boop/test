import { clamp } from "../../core/utils.js";
import {
  BASE_STAT,
  MEAT_LIFESPAN_SECONDS,
  MEAT_ROT_PLANT_BLOCK_RANGE_TILES,
  PLANT_GROWTH_STAGE_SECONDS,
  PLANT_REGEN_PER_SECOND,
  PLANT_REPRO_COOLDOWN_SECONDS,
  POP_CAP_PLANT,
  WEATHER_KIND,
} from "./constants.js";
import { wrapCoord } from "./geom.js";
import { clampInt } from "./math.js";
import { mulberry32, seededFloat } from "./random.js";
import { applyPlantStageScaling, plantRegenMultiplier, plantStageScale, radiusFromKind } from "./stats.js";

export function stepPlantEntity({ world, entity, dt, tile, w, h, tw, th, weatherKind, plantReproMax, popCounts, plantTileCounts, spawned }) {
  const e = entity;
  const plantLifeMaxSeconds =
    typeof world?.getPlantLifeMaxSeconds === "function" ? Number(world.getPlantLifeMaxSeconds()) || 0 : 0;
  if (plantLifeMaxSeconds > 0) {
    e.lifeMaxSeconds = plantLifeMaxSeconds;
    if (!Number.isFinite(e.lifeSeconds) || (e.lifeSeconds ?? 0) <= 0) e.lifeSeconds = plantLifeMaxSeconds;
    if ((e.lifeSeconds ?? 0) > plantLifeMaxSeconds) e.lifeSeconds = plantLifeMaxSeconds;
    e.lifeSeconds = Math.max(0, (e.lifeSeconds ?? plantLifeMaxSeconds) - dt);
  } else {
    e.lifeMaxSeconds = 0;
    e.lifeSeconds = 0;
  }
  e.plantReproCooldownSeconds = Math.max(0, (e.plantReproCooldownSeconds ?? 0) - dt);
  if (e.plantReproSuccessCount == null) {
    e.plantReproSuccessCount = e.plantSeededOnce ? 1 : 0;
  }
  e.plantSeededOnce = (Number(e.plantReproSuccessCount) || 0) > 0;

  if (e.plantStage == null) e.plantStage = 2;
  if ((e.plantStage ?? 2) < 2) {
    e.plantGrowthSeconds = (e.plantGrowthSeconds ?? 0) + dt;
    while ((e.plantGrowthSeconds ?? 0) >= PLANT_GROWTH_STAGE_SECONDS && (e.plantStage ?? 0) < 2) {
      e.plantGrowthSeconds = (e.plantGrowthSeconds ?? 0) - PLANT_GROWTH_STAGE_SECONDS;
      e.plantStage = clampInt((e.plantStage ?? 0) + 1, 0, 2);
    }
  } else {
    e.plantGrowthSeconds = 0;
  }

  applyPlantStageScaling(e);

  const regenMult = plantRegenMultiplier(weatherKind);
  e.hp = clamp((e.hp ?? e.hpMax ?? BASE_STAT) + PLANT_REGEN_PER_SECOND * regenMult * dt, 0, e.hpMax ?? BASE_STAT);

  if (
    weatherKind === WEATHER_KIND.rainy &&
    e.plantStage === 2 &&
    (Number(e.plantReproSuccessCount) || 0) < plantReproMax &&
    (e.plantReproCooldownSeconds ?? 0) <= 0
  ) {
    const px = wrapCoord(e.x, w);
    const py = wrapCoord(e.y, h);
    const tx0 = clampInt(Math.floor(px / tile), 0, tw - 1);
    const ty0 = clampInt(Math.floor(py / tile), 0, th - 1);

    const offsets = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];

    // Rule: reproduction is only impossible if all 8 neighboring tiles are already occupied by plants.
    const emptyNeighbors = [];
    for (const [dx, dy] of offsets) {
      const tx = ((tx0 + dx) % tw + tw) % tw;
      const ty = ((ty0 + dy) % th + th) % th;
      const key = `${tx},${ty}`;
      if ((plantTileCounts.get(key) || 0) <= 0) emptyNeighbors.push({ dx, dy, tx, ty, key });
    }
    const blocked = emptyNeighbors.length === 0;

    if (!blocked) {
      e.plantReproCooldownSeconds = PLANT_REPRO_COOLDOWN_SECONDS;

      if (popCounts.plant >= POP_CAP_PLANT) {
        // Population cap reached: don't spawn new plants, but still consume the reproduction attempt/cooldown.
      } else if (Math.random() < 1 / 3) {
        const picked = emptyNeighbors[Math.floor(Math.random() * emptyNeighbors.length)] ?? emptyNeighbors[0];
        if (picked) {
          const tx = picked.tx;
          const ty = picked.ty;
          const targetKey = picked.key;
          const seed = (e.id * 2654435761 + (tx * 73856093) ^ (ty * 19349663) + Date.now()) >>> 0;
          const rng = mulberry32(seed);
          const adultR = clamp(Number(e.baseRadius) || radiusFromKind("plant"), 10, 26);
          const budR = adultR * plantStageScale(0);

          const baseX = (tx + 0.5) * tile;
          const baseY = (ty + 0.5) * tile;
          const jittered = (v) => v + seededFloat(rng, -tile * 0.25, tile * 0.25);
          let sx = wrapCoord(jittered(baseX), w);
          let sy = wrapCoord(jittered(baseY), h);
          for (let i = 0; i < 10; i++) {
            if (!world._overlaps(sx, sy, budR)) break;
            sx = wrapCoord(jittered(baseX), w);
            sy = wrapCoord(jittered(baseY), h);
          }

          const seedPlant = world._makeEntity({
            x: sx,
            y: sy,
            kind: "plant",
            radius: adultR,
            sex: "none",
            groupId: `plant:seed:${e.id}:${Date.now()}`,
            reincarnation: null,
            rng,
            variantOverride: e.variant,
          });
          seedPlant.generation = clampInt((Number(e.generation) || 1) + 1, 1, 9999);
          seedPlant.plantStage = 0;
          seedPlant.plantGrowthSeconds = 0;
          seedPlant.plantReproCooldownSeconds = 0;
          applyPlantStageScaling(seedPlant);

          spawned.push(seedPlant);
          popCounts.plant++;
          plantTileCounts.set(targetKey, (plantTileCounts.get(targetKey) || 0) + 1);
          e.plantReproSuccessCount = (Number(e.plantReproSuccessCount) || 0) + 1;
          e.plantSeededOnce = (Number(e.plantReproSuccessCount) || 0) > 0;
        }
      }
    }
  }

  if ((e.hp ?? 0) <= 0) e._dead = true;
  if (plantLifeMaxSeconds > 0 && (e.lifeSeconds ?? 0) <= 0) e._dead = true;
}

export function stepMeatEntity({ world, entity, dt, tile, w, h, tw, th, meatRotEnabled, popCounts, plantTileCounts, spawned }) {
  const e = entity;
  if (meatRotEnabled) {
    e.lifeSeconds = Math.max(0, (e.lifeSeconds ?? MEAT_LIFESPAN_SECONDS) - dt);
  } else if ((e.lifeSeconds ?? MEAT_LIFESPAN_SECONDS) <= 0) {
    e.lifeSeconds = MEAT_LIFESPAN_SECONDS;
  }
  if ((e.nutrition ?? 1) <= 0) {
    e._dead = true;
    return;
  }

  if (meatRotEnabled && (e.lifeSeconds ?? 0) <= 0) {
    // Rot -> soil nutrition -> sometimes spawns a plant.
    const px = wrapCoord(e.x, w);
    const py = wrapCoord(e.y, h);
    const tx0 = clampInt(Math.floor(px / tile), 0, tw - 1);
    const ty0 = clampInt(Math.floor(py / tile), 0, th - 1);

    let hasPlantNearby = false;
    for (let dy = -MEAT_ROT_PLANT_BLOCK_RANGE_TILES; dy <= MEAT_ROT_PLANT_BLOCK_RANGE_TILES && !hasPlantNearby; dy++) {
      for (let dx = -MEAT_ROT_PLANT_BLOCK_RANGE_TILES; dx <= MEAT_ROT_PLANT_BLOCK_RANGE_TILES; dx++) {
        if (dx * dx + dy * dy > MEAT_ROT_PLANT_BLOCK_RANGE_TILES * MEAT_ROT_PLANT_BLOCK_RANGE_TILES) continue;
        const tx = ((tx0 + dx) % tw + tw) % tw;
        const ty = ((ty0 + dy) % th + th) % th;
        const key = `${tx},${ty}`;
        if ((plantTileCounts.get(key) || 0) > 0) {
          hasPlantNearby = true;
          break;
        }
      }
    }

    if (!hasPlantNearby && popCounts.plant < POP_CAP_PLANT && Math.random() < 1 / 3) {
      const seed = (e.id * 2654435761 + Math.floor((e.x + e.y) * 31) + Date.now()) >>> 0;
      const rng = mulberry32(seed);
      const baseR = radiusFromKind("plant");
      const r = clamp(baseR * seededFloat(rng, 0.9, 1.12), 10, baseR * 1.25);
      const placed = world._placeNear(
        { x: e.x, y: e.y },
        r,
        140,
        40,
        seededFloat(rng, 0, Math.PI * 2),
        seededFloat(rng, 0, 1),
      );
      const newPlant = world._makeEntity({
        x: placed.x,
        y: placed.y,
        kind: "plant",
        radius: r,
        sex: "none",
        groupId: `plant:soil:${e.id}`,
        reincarnation: null,
        rng,
      });
      spawned.push(newPlant);
      popCounts.plant++;

      const ppx = wrapCoord(newPlant.x, w);
      const ppy = wrapCoord(newPlant.y, h);
      const ptx = clampInt(Math.floor(ppx / tile), 0, tw - 1);
      const pty = clampInt(Math.floor(ppy / tile), 0, th - 1);
      const pkey = `${ptx},${pty}`;
      plantTileCounts.set(pkey, (plantTileCounts.get(pkey) || 0) + 1);
    }
    e._dead = true;
  }
}

export function stepNestEntity({ entity, dt }) {
  const e = entity;
  e.lifeMaxSeconds = 0;
  e.lifeSeconds = 0;
  e.ageSeconds = (e.ageSeconds ?? 0) + dt;
}

export function stepEggEntity({ entity, dt }) {
  const e = entity;
  e.lifeMaxSeconds = 0;
  e.lifeSeconds = 0;
  e.ageSeconds = (e.ageSeconds ?? 0) + dt;
  e.warmSeconds = Math.max(0, Number(e.warmSeconds) || 0);
  e.unwarmedSeconds = Math.max(0, Number(e.unwarmedSeconds) || 0);
}
