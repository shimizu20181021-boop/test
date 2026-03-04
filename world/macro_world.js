import { MACRO_CONFIG } from "../core/config.js";
import { clamp, randFloat } from "../core/utils.js";
import { BIOMES, generateBiomeMap } from "./biome.js";
import { generateElevationMap } from "./elevation.js";
import { generateSunExposureMap } from "./insolation.js";
import { generateGeothermalMap } from "./geothermal.js";
import {
  ATTACK_RANGE_TILES,
  BASE_ANIMAL_LIFESPAN_SECONDS,
  BASE_STAT,
  DIET_IMPRINT_BASE_STRENGTH,
  DIET_IMPRINT_CHILD_ADD,
  DIET_IMPRINT_MAX_STRENGTH,
  EVOLUTION_MODE,
  FLEE_RANGE_TILES,
  HEAT_CYCLE_SECONDS,
  MEAT_HUNGER_RECOVER_FRACTION,
  MEAT_LIFESPAN_SECONDS,
  NEST_OBJECT_RADIUS_TILES,
  POP_CAP_PLANT,
  setPopulationCaps as setGlobalPopulationCaps,
  REPRO_RANGE_TILES,
  TERRITORY_LIFE_MUL_BY_LEVEL,
  TERRITORY_MATE_MUL_BY_LEVEL,
  TERRITORY_SPEED_MUL_BY_LEVEL,
  WEATHER_KIND,
  WEATHER_STEP_SECONDS,
} from "./macro/constants.js";
import { mulberry32, seededFloat, seededInt } from "./macro/random.js";
import { wrapCoord, wrapDelta } from "./macro/geom.js";
import { clampInt } from "./macro/math.js";
import { buildGrid } from "./macro/spatial.js";
import { isMacroNonAnimalKind } from "./macro/kinds.js";
import {
  computePopulationTypeCounts,
  dietTypeForEntity,
  dietTypeFromKind,
  dietTypeFromReincarnation,
  populationCapForDietType,
  scaledAttackDamage,
} from "./macro/diet.js";
import {
  cloneVariantTemplate,
  createChildVariant,
  createCoatStyle,
  createDietCoatStyle,
  createRandomVariant,
  ensureVariantBases,
  refreshVariantBases,
} from "./macro/variant.js";
import { blendGenomes, cloneGenome, createRandomGenome } from "./macro/genome.js";
import {
  applyLifeStageScaling,
  applyPlantStageScaling,
  computeStatsForEntity,
  kindFromPercents,
  radiusForEntity,
  radiusFromKind,
} from "./macro/stats.js";
import { stepEggEntity, stepMeatEntity, stepNestEntity, stepPlantEntity } from "./macro/non_animals.js";
import { stepNestIncubationAndParenting } from "./macro/nest_system.js";
import { separationPass } from "./macro/separation.js";
import { computeSocialGroups } from "./macro/social.js";
import { pickGenomeForReincarnation } from "./macro/evolution_pool.js";
import { stepAnimalVitals } from "./macro/animal_vitals.js";
import { stepAnimalAi } from "./macro/animal_ai.js";
import { ensureTerritoryPaintState, pickTerritoryGroupColor, stepTerritoryPaint } from "./macro/territory.js";

let nextMacroId = 1;

const DAY_LENGTH_SECONDS = 60;
const SEASON_CYCLE = [
  { kind: "autumn", label: "秋", icon: "🍂", days: 20, baseTempC: 20 },
  { kind: "winter", label: "冬", icon: "❄️", days: 16, baseTempC: 4 },
  { kind: "spring", label: "春", icon: "🌸", days: 20, baseTempC: 18 },
  { kind: "summer", label: "夏", icon: "🌞", days: 16, baseTempC: 30 },
];
const YEAR_DAYS = SEASON_CYCLE.reduce((a, s) => a + (Number(s.days) || 0), 0) || 72;

function clamp01(n) {
  const v = Number(n) || 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function wrapTile(v, max) {
  const m = max | 0;
  if (m <= 0) return 0;
  const n = v | 0;
  return ((n % m) + m) % m;
}

function calendarFromElapsedSeconds(elapsedSeconds) {
  const s = Math.max(0, Number(elapsedSeconds) || 0);
  const dayIndex = Math.floor(s / DAY_LENGTH_SECONDS); // 0-based
  const day = dayIndex + 1;
  const year = Math.floor(dayIndex / YEAR_DAYS) + 1;
  const dayOfYear = dayIndex % YEAR_DAYS;
  const dayProgress01 = (s % DAY_LENGTH_SECONDS) / DAY_LENGTH_SECONDS;

  let seasonKind = SEASON_CYCLE[0].kind;
  let seasonLabel = SEASON_CYCLE[0].label;
  let seasonIcon = SEASON_CYCLE[0].icon;
  let dayInSeason = dayOfYear + 1;
  let seasonBaseTempC = Number(SEASON_CYCLE[0].baseTempC) || 20;

  let acc = 0;
  for (const seg of SEASON_CYCLE) {
    const len = Math.max(1, Number(seg.days) || 0);
    if (dayOfYear < acc + len) {
      seasonKind = seg.kind;
      seasonLabel = seg.label;
      seasonIcon = seg.icon;
      dayInSeason = dayOfYear - acc + 1;
      seasonBaseTempC = Number(seg.baseTempC) || seasonBaseTempC;
      break;
    }
    acc += len;
  }

  return { day, year, dayOfYear, seasonKind, seasonLabel, seasonIcon, dayInSeason, seasonBaseTempC, dayProgress01 };
}

const CREATURE_DESIGN_IDS_BY_DIET = {
  herbivore: { mammal: ["herb_pig", "herb_horse", "herb_zebra"], bird: ["herb_pigeon"] },
  omnivore: { mammal: ["omn_mouse", "omn_boar", "omn_bear"], bird: ["omn_crow"] },
  carnivore: { mammal: ["pred_wolf", "pred_cat", "pred_raccoon", "pred_lion"], bird: ["pred_owl"] },
};

const CREATURE_TAXON = { mammal: "mammal", bird: "bird" };
const BIRD_DESIGN_ID_SET = new Set(["herb_pigeon", "omn_crow", "pred_owl"]);
function taxonFromDesignId(designId) {
  const id = String(designId || "");
  return BIRD_DESIGN_ID_SET.has(id) ? CREATURE_TAXON.bird : CREATURE_TAXON.mammal;
}

function isAdultAnimal(e) {
  if (!e || e._dead) return false;
  if (isMacroNonAnimalKind(e.kind)) return false;
  return e.lifeStage === "adult";
}

function pickReincarnationSpawnTaxon(entities, rng) {
  let birdAdults = 0;
  let mammalAdults = 0;
  for (const e of entities) {
    if (!isAdultAnimal(e)) continue;
    const t = e.taxon === CREATURE_TAXON.bird || e.taxon === CREATURE_TAXON.mammal ? e.taxon : taxonFromDesignId(e.designId);
    if (t === CREATURE_TAXON.bird) birdAdults++;
    else mammalAdults++;
  }
  if (birdAdults < mammalAdults) return CREATURE_TAXON.bird;
  if (mammalAdults < birdAdults) return CREATURE_TAXON.mammal;
  const r = typeof rng === "function" ? rng() : Math.random();
  return r < 0.5 ? CREATURE_TAXON.bird : CREATURE_TAXON.mammal;
}

function designIdsForDietType(dietType, taxon) {
  const key = String(dietType || "").toLowerCase();
  const group = key === "herbivore" || key === "omnivore" || key === "carnivore" ? CREATURE_DESIGN_IDS_BY_DIET[key] : CREATURE_DESIGN_IDS_BY_DIET.herbivore;
  const t = String(taxon || "").toLowerCase();
  if (t === CREATURE_TAXON.bird || t === CREATURE_TAXON.mammal) return group[t] || group.mammal;
  return group.mammal;
}

function pickGroupDesignId(dietType, taxon, rng) {
  const list = designIdsForDietType(dietType, taxon);
  if (!list?.length) return "herb_pig";
  const idx = seededInt(typeof rng === "function" ? rng : Math.random, 0, list.length - 1);
  return list[idx] || list[0] || "herb_pig";
}

function pickNextWeather(current, seasonKind) {
  const season = String(seasonKind || "").toLowerCase();
  let options = [WEATHER_KIND.sunny, WEATHER_KIND.rainy, WEATHER_KIND.cloudy];
  if (season === "winter") {
    // Winter: no rain/cloudy. Use snow instead.
    options = [WEATHER_KIND.sunny, WEATHER_KIND.snowy];
  } else if (season === "summer") {
    // Summer: rain is rare; drought can happen.
    options = [
      WEATHER_KIND.sunny,
      WEATHER_KIND.sunny,
      WEATHER_KIND.sunny,
      WEATHER_KIND.cloudy,
      WEATHER_KIND.cloudy,
      WEATHER_KIND.drought,
      WEATHER_KIND.drought,
      WEATHER_KIND.rainy,
    ];
  }
  let next = current;
  for (let i = 0; i < 6; i++) {
    next = options[Math.floor(Math.random() * options.length)] ?? WEATHER_KIND.sunny;
    if (next !== current) break;
  }
  return next;
}

export class MacroWorld {
  constructor() {
    this.entities = [];
    this._world = { width: 4096, height: 3072 };
    this._animalCap = 30;
    this._groupMaxSize = 4;
    this._birthMax = 6;
    this._coupleReproMax = 3;
    this._dietReproductionConfig = {
      herbivore: { birthMin: 3, birthMax: 5, reproMin: 2, reproMax: 3 },
      omnivore: { birthMin: 3, birthMax: 5, reproMin: 2, reproMax: 3 },
      carnivore: { birthMin: 3, birthMax: 5, reproMin: 2, reproMax: 3 },
    };
    this._plantReproMax = 1;
    this._meatHungerRecoverFraction = MEAT_HUNGER_RECOVER_FRACTION;
    this._plantHungerRecoverMul = 1.0;
    this._meatRotEnabled = true;
    this._plantStaminaMul = 1.0;
    this._plantLifeMaxSeconds = 0;
    this._herbStaminaMul = 1.0;
    this._herbLifeMaxSeconds = BASE_ANIMAL_LIFESPAN_SECONDS;
    this._herbHungerDecayMul = 1.0;
    this._omniStaminaMul = 1.0;
    this._omniLifeMaxSeconds = BASE_ANIMAL_LIFESPAN_SECONDS;
    this._omniHungerDecayMul = 1.0;
    this._carnStaminaMul = 1.0;
    this._carnLifeMaxSeconds = BASE_ANIMAL_LIFESPAN_SECONDS;
    this._carnHungerDecayMul = 1.0;
    this._carnAttackMul = 2.0;
    this._weatherKind = WEATHER_KIND.sunny;
    this._weatherTimerSeconds = 0;
    this._elapsedSeconds = 0;
    this._biomeSeed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    this._biomes = null;
    this._ensureBiomes();

    this._elevationSeed = (this._biomeSeed ^ 0x7f4a7c15) >>> 0;
    this._elevations = null;
    this._ensureElevations();

    this._mountainCool = null;
    this._ensureMountainCool();

    this._sunSeed = (this._biomeSeed ^ 0x2c1b3c6d) >>> 0;
    this._sun = null;
    this._ensureSunExposure();

    this._geothermalSeed = (this._biomeSeed ^ 0x1b873593) >>> 0;
    this._geothermal = null;
    this._ensureGeothermal();

    this._calendar = calendarFromElapsedSeconds(this._elapsedSeconds);
    this._climate = null;
    this._updateClimateState();

    this._evolutionMode = EVOLUTION_MODE.natural;
    this._fitnessChildWeight = 60;
    this._naturalGenomePool = new Map(); // dietType -> genome[] (weighted by duplicates)
    this._gaGenomePool = new Map(); // dietType -> { genome, fitness }[] (sorted desc by fitness)
    this._nnVizFocusId = null;

    // Territory paint (group color) state.
    this._territoryPaint = null;
    this._territoryGroupIdToIndex = new Map();
    this._territoryGroupColorHex = [];
    this._territoryGroupColorNameJa = [];
    this._territoryGroupColorR = [];
    this._territoryGroupColorG = [];
    this._territoryGroupColorB = [];
    this._territoryGroupCharge01Total = [];
    this._territoryGroupTileCount = [];
    this._territoryGroupAnimalCounts = [];

    // Unified look per reincarnation group.
    this._groupCreatureDesignId = new Map(); // groupId -> designId
  }

  getWeatherKind() {
    return this._weatherKind;
  }

  getElapsedSeconds() {
    return Number(this._elapsedSeconds) || 0;
  }

  getCalendar() {
    const cal = calendarFromElapsedSeconds(this._elapsedSeconds);
    this._calendar = cal;
    return cal;
  }

  getEnvironmentTempAtWorld(x, y) {
    const tile = MACRO_CONFIG.tileSize;
    const w = this._world.width;
    const h = this._world.height;
    const tw = Math.max(1, Math.floor(w / tile));
    const th = Math.max(1, Math.floor(h / tile));
    const px = wrapCoord(Number(x) || 0, w);
    const py = wrapCoord(Number(y) || 0, h);
    const tx = clampInt(Math.floor(px / tile), 0, tw - 1);
    const ty = clampInt(Math.floor(py / tile), 0, th - 1);
    return this.getEnvironmentTempAtTile(tx, ty);
  }

  getEnvironmentTempAtTile(tx, ty) {
    if (!this._climate) this._updateClimateState();
    const tile = MACRO_CONFIG.tileSize;
    const w = this._world.width;
    const h = this._world.height;
    const tw = Math.max(1, Math.floor(w / tile));
    const th = Math.max(1, Math.floor(h / tile));
    const x = wrapTile(tx, tw);
    const y = wrapTile(ty, th);
    const idx = y * tw + x;

    const sun = this._sun?.tiles ? Number(this._sun.tiles[idx]) || 0.5 : 0.5;
    const geo = this._geothermal?.tiles ? Number(this._geothermal.tiles[idx]) || 0 : 0;
    const cool = this._mountainCool?.tiles ? Number(this._mountainCool.tiles[idx]) || 0 : 0;

    const c = this._climate || {};
    const base = Number(c.baseTempC) || 0;
    const diurnal = Number(c.diurnalTempC) || 0;
    const wAdj = Number(c.weatherTempC) || 0;
    const daylight01 = clamp01(c.daylight01);
    const sunMax = Number(c.sunHeatMaxC) || 0;
    const geoMax = Number(c.geoHeatMaxC) || 0;
    const coolMax = Number(c.mountainCoolMaxC) || 0;

    const sunTerm = (sun - 0.5) * 2 * sunMax * daylight01;
    const geoTerm = geo * geoMax;
    const coolTerm = cool * coolMax;
    return base + diurnal + wAdj + sunTerm + geoTerm - coolTerm;
  }

  setNnVizFocusId(id) {
    const n = Number(id);
    this._nnVizFocusId = Number.isFinite(n) ? n : null;
  }

  _stepWeather(dt) {
    this._weatherTimerSeconds = (this._weatherTimerSeconds ?? 0) + dt;
    if ((this._weatherTimerSeconds ?? 0) < WEATHER_STEP_SECONDS) return;
    this._weatherTimerSeconds = (this._weatherTimerSeconds ?? 0) % WEATHER_STEP_SECONDS;
    const cal = calendarFromElapsedSeconds(this._elapsedSeconds);
    this._weatherKind = pickNextWeather(this._weatherKind, cal?.seasonKind);
  }

  _updateClimateState() {
    const cal = calendarFromElapsedSeconds(this._elapsedSeconds);
    this._calendar = cal;

    const dp = clamp01(cal?.dayProgress01);
    const diurnal = 8 * Math.cos(2 * Math.PI * (dp - 0.5));
    const daylight01 = clamp01(0.5 - 0.5 * Math.cos(2 * Math.PI * dp));

    const wk = this._weatherKind;
    const weatherTempC =
      wk === WEATHER_KIND.sunny
        ? 3
        : wk === WEATHER_KIND.cloudy
          ? 0
          : wk === WEATHER_KIND.rainy
            ? -4
            : wk === WEATHER_KIND.snowy
              ? -10
              : wk === WEATHER_KIND.drought
                ? 14
                : 0;

    const sunHeatMaxC =
      wk === WEATHER_KIND.drought ? 8 : wk === WEATHER_KIND.sunny ? 4 : wk === WEATHER_KIND.cloudy ? 2 : wk === WEATHER_KIND.rainy ? 1 : 0.5;

    this._climate = {
      baseTempC: Number(cal?.seasonBaseTempC) || 0,
      diurnalTempC: diurnal,
      weatherTempC,
      daylight01,
      sunHeatMaxC,
      geoHeatMaxC: 8,
      mountainCoolMaxC: 6,
    };
  }

  setWorldSize({ width, height }) {
    this._world = {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height)),
    };
    this._ensureBiomes();
    this._ensureElevations();
    this._mountainCool = null;
    this._ensureMountainCool();
    this._ensureSunExposure();
    this._ensureGeothermal();
    this._updateClimateState();
  }

  reset() {
    this.entities = [];
    this._elapsedSeconds = 0;
    this._weatherKind = WEATHER_KIND.sunny;
    this._weatherTimerSeconds = 0;
    this._naturalGenomePool = new Map();
    this._gaGenomePool = new Map();
    this._territoryPaint = null;
    this._territoryGroupIdToIndex = new Map();
    this._territoryGroupColorHex = [];
    this._territoryGroupColorNameJa = [];
    this._territoryGroupColorR = [];
    this._territoryGroupColorG = [];
    this._territoryGroupColorB = [];
    this._territoryGroupCharge01Total = [];
    this._territoryGroupTileCount = [];
    this._territoryGroupAnimalCounts = [];
    this._ensureBiomes();
    this._ensureElevations();
    this._mountainCool = null;
    this._sun = null;
    this._geothermal = null;
    this._ensureMountainCool();
    this._ensureSunExposure();
    this._ensureGeothermal();
    this._calendar = calendarFromElapsedSeconds(this._elapsedSeconds);
    this._updateClimateState();

    this._groupCreatureDesignId = new Map();
  }

  _getOrAssignGroupDesignId(groupId, dietType, taxon, rng) {
    const gid = String(groupId || "");
    if (!gid) return pickGroupDesignId(dietType, taxon, rng);
    const existing = this._groupCreatureDesignId.get(gid);
    if (existing) return existing;
    const picked = pickGroupDesignId(dietType, taxon, rng);
    this._groupCreatureDesignId.set(gid, picked);
    return picked;
  }

  _ensureBiomes() {
    const tile = MACRO_CONFIG.tileSize;
    const tw = Math.max(1, Math.floor(this._world.width / tile));
    const th = Math.max(1, Math.floor(this._world.height / tile));
    if (this._biomes && this._biomes.tileWidth === tw && this._biomes.tileHeight === th) return;
    this._biomes = generateBiomeMap({ tileWidth: tw, tileHeight: th, seed: this._biomeSeed });
  }

  _ensureElevations() {
    const tile = MACRO_CONFIG.tileSize;
    const tw = Math.max(1, Math.floor(this._world.width / tile));
    const th = Math.max(1, Math.floor(this._world.height / tile));
    if (this._elevations && this._elevations.tileWidth === tw && this._elevations.tileHeight === th) return;
    this._elevations = generateElevationMap({ tileWidth: tw, tileHeight: th, seed: this._elevationSeed, mountainFraction: 0.2 });
  }

  _ensureMountainCool() {
    const tile = MACRO_CONFIG.tileSize;
    const tw = Math.max(1, Math.floor(this._world.width / tile));
    const th = Math.max(1, Math.floor(this._world.height / tile));
    if (this._mountainCool && this._mountainCool.tileWidth === tw && this._mountainCool.tileHeight === th) return;

    const heights = this._elevations?.tiles;
    const out = new Float32Array(tw * th);
    if (!(heights instanceof Uint8Array) || heights.length !== tw * th) {
      this._mountainCool = { tileWidth: tw, tileHeight: th, tiles: out, seed: this._elevationSeed };
      return;
    }

    const maxR = 6;
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        let best = 0;
        for (let dy = -maxR; dy <= maxR; dy++) {
          for (let dx = -maxR; dx <= maxR; dx++) {
            const nx = wrapTile(tx + dx, tw);
            const ny = wrapTile(ty + dy, th);
            const hm = heights[ny * tw + nx] || 0;
            if (hm <= 8) continue;
            const r = hm > 15 ? 6 : 3;
            const d = Math.hypot(dx, dy);
            if (d > r) continue;
            const t = r > 0 ? 1 - d / r : 0;
            const v = ((hm - 8) / 12) * t;
            if (v > best) best = v;
          }
        }
        out[ty * tw + tx] = clamp01(best);
      }
    }

    this._mountainCool = { tileWidth: tw, tileHeight: th, tiles: out, seed: this._elevationSeed };
  }

  _ensureSunExposure() {
    const tile = MACRO_CONFIG.tileSize;
    const tw = Math.max(1, Math.floor(this._world.width / tile));
    const th = Math.max(1, Math.floor(this._world.height / tile));
    if (this._sun && this._sun.tileWidth === tw && this._sun.tileHeight === th) return;
    this._sun = generateSunExposureMap({ tileWidth: tw, tileHeight: th, seed: this._sunSeed });
  }

  _ensureGeothermal() {
    const tile = MACRO_CONFIG.tileSize;
    const tw = Math.max(1, Math.floor(this._world.width / tile));
    const th = Math.max(1, Math.floor(this._world.height / tile));
    if (this._geothermal && this._geothermal.tileWidth === tw && this._geothermal.tileHeight === th) return;
    this._geothermal = generateGeothermalMap({ tileWidth: tw, tileHeight: th, seed: this._geothermalSeed, clusterFraction: 0.02 });
  }

  _ensureTerritoryPaint(tw, th) {
    const tileWidth = Math.max(1, Number(tw) | 0);
    const tileHeight = Math.max(1, Number(th) | 0);
    const prev = this._territoryPaint;
    const next = ensureTerritoryPaintState(this._territoryPaint, tileWidth, tileHeight);
    this._territoryPaint = next;
    if (next !== prev) {
      for (let i = 0; i < this._territoryGroupCharge01Total.length; i++) this._territoryGroupCharge01Total[i] = 0;
      for (let i = 0; i < this._territoryGroupTileCount.length; i++) this._territoryGroupTileCount[i] = 0;
    }
  }

  _getOrAssignTerritoryGroupIndex(groupId) {
    const key = String(groupId || "");
    if (!key) return -1;
    const existing = this._territoryGroupIdToIndex.get(key);
    if (typeof existing === "number" && existing >= 0) return existing;

    const idx = this._territoryGroupColorHex.length;
    const color = pickTerritoryGroupColor(key);
    this._territoryGroupIdToIndex.set(key, idx);
    this._territoryGroupColorHex[idx] = color.hex;
    this._territoryGroupColorNameJa[idx] = color.nameJa || null;
    this._territoryGroupColorR[idx] = color.r;
    this._territoryGroupColorG[idx] = color.g;
    this._territoryGroupColorB[idx] = color.b;
    this._territoryGroupCharge01Total[idx] = Number(this._territoryGroupCharge01Total[idx]) || 0;
    this._territoryGroupTileCount[idx] = Number(this._territoryGroupTileCount[idx]) || 0;
    return idx;
  }

  getGroupColorHex(groupId) {
    const key = String(groupId || "");
    if (!key) return null;
    const idx = this._getOrAssignTerritoryGroupIndex(key);
    return this._territoryGroupColorHex[idx] || null;
  }

  getGroupColorNameJa(groupId) {
    const key = String(groupId || "");
    if (!key) return null;
    const idx = this._getOrAssignTerritoryGroupIndex(key);
    return this._territoryGroupColorNameJa[idx] || null;
  }

  _applyTerritoryTileUpdate({ oldOwner, oldSeconds, newOwner, newSeconds }) {
    const oOwner = Number(oldOwner);
    const nOwner = Number(newOwner);
    const oSeconds = Math.max(0, Number(oldSeconds) || 0);
    const nSeconds = Math.max(0, Number(newSeconds) || 0);

    if (Number.isFinite(oOwner) && oOwner >= 0) {
      this._territoryGroupCharge01Total[oOwner] = (Number(this._territoryGroupCharge01Total[oOwner]) || 0) - oSeconds / 60;
      if (this._territoryGroupCharge01Total[oOwner] < 0) this._territoryGroupCharge01Total[oOwner] = 0;
    }
    if (Number.isFinite(nOwner) && nOwner >= 0) {
      this._territoryGroupCharge01Total[nOwner] = (Number(this._territoryGroupCharge01Total[nOwner]) || 0) + nSeconds / 60;
    }

    if (oOwner !== nOwner) {
      if (Number.isFinite(oOwner) && oOwner >= 0) {
        this._territoryGroupTileCount[oOwner] = Math.max(0, (Number(this._territoryGroupTileCount[oOwner]) || 0) - 1);
      }
      if (Number.isFinite(nOwner) && nOwner >= 0) {
        this._territoryGroupTileCount[nOwner] = (Number(this._territoryGroupTileCount[nOwner]) || 0) + 1;
      }
    }
  }

  getTerritoryGroupCharge01ForEntity(entity) {
    if (!entity || entity._dead) return 0;
    if (isMacroNonAnimalKind(entity.kind)) return 0;
    const gid = entity.groupId || `id:${entity.id}`;
    const idx = this._getOrAssignTerritoryGroupIndex(gid);
    return Number(this._territoryGroupCharge01Total[idx]) || 0;
  }

  getTerritoryGroupTileCountForEntity(entity) {
    if (!entity || entity._dead) return 0;
    if (isMacroNonAnimalKind(entity.kind)) return 0;
    const gid = entity.groupId || `id:${entity.id}`;
    const idx = this._getOrAssignTerritoryGroupIndex(gid);
    return Number(this._territoryGroupTileCount[idx]) || 0;
  }

  getTerritoryGroupAnimalCountForEntity(entity) {
    if (!entity || entity._dead) return 1;
    if (isMacroNonAnimalKind(entity.kind)) return 1;
    const gid = entity.groupId || `id:${entity.id}`;
    const idx = this._getOrAssignTerritoryGroupIndex(gid);
    const n = Number(this._territoryGroupAnimalCounts?.[idx]);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
  }

  getTerritoryStatsForEntity(entity, radiusTiles, out) {
    const dst = out && typeof out === "object" ? out : { avg01: 0, max01: 0 };
    const r = clampInt(radiusTiles, 1, 8);
    dst.avg01 = 0;
    dst.max01 = 0;
    if (!entity || entity._dead) return dst;
    if (isMacroNonAnimalKind(entity.kind)) return dst;

    const terr = this._territoryPaint;
    if (!terr || !terr.owner || !terr.level) return dst;
    const tw = terr.tileWidth | 0;
    const th = terr.tileHeight | 0;
    if (!(tw > 0 && th > 0)) return dst;

    const gid = entity.groupId || `id:${entity.id}`;
    const groupIdx = this._getOrAssignTerritoryGroupIndex(gid);
    if (!(groupIdx >= 0)) return dst;

    const tile = MACRO_CONFIG.tileSize;
    const w = this._world.width;
    const h = this._world.height;
    const px = wrapCoord(entity.x, w);
    const py = wrapCoord(entity.y, h);
    const cx = Math.floor(px / tile);
    const cy = Math.floor(py / tile);

    const groundBound = entity.taxon !== "bird";

    let sumLevel = 0;
    let maxLevel = 0;
    let paintableCount = 0;

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = ((cx + dx) % tw + tw) % tw;
        const ty = ((cy + dy) % th + th) % th;
        const idx = ty * tw + tx;
        if (terr.plantMask && terr.plantMask[idx]) continue;
        if (groundBound && this.getElevationAtTile(tx, ty) > 15) continue;
        paintableCount++;
        if (terr.owner[idx] !== groupIdx) continue;
        const lvl = terr.level[idx] | 0;
        sumLevel += lvl;
        if (lvl > maxLevel) maxLevel = lvl;
      }
    }

    const denom = paintableCount > 0 ? paintableCount * 4 : 1;
    dst.avg01 = clamp(sumLevel / denom, 0, 1);
    dst.max01 = clamp(maxLevel / 4, 0, 1);
    return dst;
  }

  _getTerritoryLevelForEntity(entity) {
    if (!entity || entity._dead) return 0;
    if (isMacroNonAnimalKind(entity.kind)) return 0;
    const gid = entity.groupId || `id:${entity.id}`;
    const groupIdx = this._getOrAssignTerritoryGroupIndex(gid);
    if (!(groupIdx >= 0)) return 0;

    const terr = this._territoryPaint;
    if (!terr) return 0;

    const tile = MACRO_CONFIG.tileSize;
    const w = this._world.width;
    const h = this._world.height;
    const tw = terr.tileWidth | 0;
    const th = terr.tileHeight | 0;
    const px = wrapCoord(entity.x, w);
    const py = wrapCoord(entity.y, h);
    const tx = clampInt(Math.floor(px / tile), 0, tw - 1);
    const ty = clampInt(Math.floor(py / tile), 0, th - 1);
    const idx = ty * tw + tx;
    if (terr.plantMask && terr.plantMask[idx]) return 0;
    if (terr.owner && terr.owner[idx] !== groupIdx) return 0;
    return (terr.level && terr.level[idx]) | 0;
  }

  getTerritorySpeedMulForEntity(entity) {
    const level = this._getTerritoryLevelForEntity(entity);
    return TERRITORY_SPEED_MUL_BY_LEVEL[level] ?? 1;
  }

  getTerritoryLifeDtForEntity(entity, dt) {
    const level = this._getTerritoryLevelForEntity(entity);
    if (level >= 4) return 0;
    const mul = TERRITORY_LIFE_MUL_BY_LEVEL[level] ?? 1;
    if (!(mul > 0)) return dt;
    return dt / mul;
  }

  getTerritoryThermalProtection01ForEntity(entity) {
    const level = this._getTerritoryLevelForEntity(entity);
    return clamp01(level / 4);
  }

  getTerritoryMateSuccessMulForPair(female, male) {
    const lf = this._getTerritoryLevelForEntity(female);
    const lm = this._getTerritoryLevelForEntity(male);
    if (!(lf > 0 && lm > 0)) return 1;
    const level = Math.min(lf, lm);
    return TERRITORY_MATE_MUL_BY_LEVEL[level] ?? 1;
  }

  getBiomeAtTile(tx, ty) {
    this._ensureBiomes();
    const m = this._biomes;
    if (!m) return 0;
    const tw = m.tileWidth | 0;
    const th = m.tileHeight | 0;
    const x = ((Number(tx) | 0) % tw + tw) % tw;
    const y = ((Number(ty) | 0) % th + th) % th;
    return m.tiles[y * tw + x] | 0;
  }

  getElevationAtTile(tx, ty) {
    this._ensureElevations();
    const m = this._elevations;
    if (!m) return 0;
    const tw = m.tileWidth | 0;
    const th = m.tileHeight | 0;
    const x = ((Number(tx) | 0) % tw + tw) % tw;
    const y = ((Number(ty) | 0) % th + th) % th;
    return m.tiles[y * tw + x] | 0;
  }

  getMountainLabels() {
    this._ensureElevations();
    const m = this._elevations;
    if (!m || !Array.isArray(m.labels)) return [];
    return m.labels;
  }

  setAnimalCap(cap) {
    const n = Number.parseInt(String(cap), 10);
    if (!Number.isFinite(n)) return;
    this._animalCap = Math.max(10, Math.min(100, n));
  }

  setGroupMaxSize(size) {
    const n = Number.parseInt(String(size), 10);
    if (!Number.isFinite(n)) return;
    if (n === 4 || n === 8 || n === 12) this._groupMaxSize = n;
  }

  setPopulationCaps({ plant, herbivore, omnivore, carnivore } = {}) {
    setGlobalPopulationCaps({ plant, herbivore, omnivore, carnivore });
  }

  getGroupMaxSize() {
    return this._groupMaxSize;
  }

  setBirthMax(max) {
    this._birthMax = clampInt(max, 2, 10);
  }

  getBirthMax() {
    return this._birthMax;
  }

  setCoupleReproMax(max) {
    this._coupleReproMax = clampInt(max, 1, 10);
    for (const e of this.entities) {
      if (!e || e._dead) continue;
      if (isMacroNonAnimalKind(e.kind)) continue;
      // Apply this "global" cap only to diets without their own min/max config.
      const diet = dietTypeForEntity(e);
      if (this._getDietReproConfig(diet)) continue;
      if (e.reproSuccessMax != null) e.reproSuccessMax = clampInt(e.reproSuccessMax, 1, this._coupleReproMax);
      if (e.reproSuccessMax != null && (Number(e.reproSuccessCount) || 0) >= e.reproSuccessMax) e.hasReproduced = true;
    }
  }

  getCoupleReproMax() {
    return this._coupleReproMax;
  }

  _getDietReproConfig(dietType) {
    const d = String(dietType || "").toLowerCase();
    if (d === "herbivore") return this._dietReproductionConfig?.herbivore || null;
    if (d === "omnivore") return this._dietReproductionConfig?.omnivore || null;
    if (d === "carnivore") return this._dietReproductionConfig?.carnivore || null;
    return null;
  }

  setDietReproductionConfig(config) {
    const normalize = (input, defaults) => {
      const birthMin = clampInt(input?.birthMin ?? defaults.birthMin, 2, 10);
      let birthMax = clampInt(input?.birthMax ?? defaults.birthMax, 2, 10);
      if (birthMax < birthMin) birthMax = birthMin;

      const reproMin = clampInt(input?.reproMin ?? defaults.reproMin, 1, 10);
      let reproMax = clampInt(input?.reproMax ?? defaults.reproMax, 1, 10);
      if (reproMax < reproMin) reproMax = reproMin;

      return { birthMin, birthMax, reproMin, reproMax };
    };

    const prev = this._dietReproductionConfig || {
      herbivore: { birthMin: 3, birthMax: 5, reproMin: 2, reproMax: 3 },
      omnivore: { birthMin: 3, birthMax: 5, reproMin: 2, reproMax: 3 },
      carnivore: { birthMin: 3, birthMax: 5, reproMin: 2, reproMax: 3 },
    };

    this._dietReproductionConfig = {
      herbivore: normalize(config?.herbivore, prev.herbivore),
      omnivore: normalize(config?.omnivore, prev.omnivore),
      carnivore: normalize(config?.carnivore, prev.carnivore),
    };

    for (const e of this.entities) {
      if (!e || e._dead) continue;
      if (isMacroNonAnimalKind(e.kind)) continue;
      if (e.reproSuccessMax == null) continue;

      const diet = dietTypeForEntity(e);
      const cfg = this._getDietReproConfig(diet);
      const min = cfg?.reproMin ?? 1;
      const max = cfg?.reproMax ?? this._coupleReproMax;
      e.reproSuccessMax = clampInt(e.reproSuccessMax, min, max);
      if (e.reproSuccessMax != null && (Number(e.reproSuccessCount) || 0) >= e.reproSuccessMax) e.hasReproduced = true;
    }
  }

  setPlantReproMax(max) {
    this._plantReproMax = clampInt(max, 1, 5);
    for (const e of this.entities) {
      if (!e || e._dead) continue;
      if (e.kind !== "plant") continue;
      if (e.plantReproSuccessCount == null) {
        e.plantReproSuccessCount = e.plantSeededOnce ? 1 : 0;
      }
    }
  }

  getPlantReproMax() {
    return this._plantReproMax;
  }

  setMeatHungerRecoverPct(pct) {
    const n = Number(pct);
    if (!Number.isFinite(n)) return;
    this._meatHungerRecoverFraction = clamp(n, 0, 100) / 100;
  }

  getMeatHungerRecoverPct() {
    return clamp(Number(this._meatHungerRecoverFraction) || 0, 0, 1) * 100;
  }

  setMeatRotEnabled(enabled) {
    this._meatRotEnabled = Boolean(enabled);
  }

  getMeatRotEnabled() {
    return Boolean(this._meatRotEnabled);
  }

  setPlantHungerRecoverMul(multiplier) {
    const n = Number(multiplier);
    if (!Number.isFinite(n)) return;
    this._plantHungerRecoverMul = clamp(n, 0, 10);
  }

  getPlantHungerRecoverMul() {
    return this._plantHungerRecoverMul;
  }

  getPlantLifeMaxSeconds() {
    return Math.max(0, Number(this._plantLifeMaxSeconds) || 0);
  }

  getAdultLifeMaxSecondsForDietType(dietType) {
    const d = String(dietType || "").toLowerCase();
    if (d === "herbivore") return Math.max(1, Number(this._herbLifeMaxSeconds) || BASE_ANIMAL_LIFESPAN_SECONDS);
    if (d === "omnivore") return Math.max(1, Number(this._omniLifeMaxSeconds) || BASE_ANIMAL_LIFESPAN_SECONDS);
    if (d === "carnivore") return Math.max(1, Number(this._carnLifeMaxSeconds) || BASE_ANIMAL_LIFESPAN_SECONDS);
    return BASE_ANIMAL_LIFESPAN_SECONDS;
  }

  getStaminaMulForDietType(dietType) {
    const d = String(dietType || "").toLowerCase();
    if (d === "herbivore") return clamp(Number(this._herbStaminaMul) || 1, 0.1, 10);
    if (d === "omnivore") return clamp(Number(this._omniStaminaMul) || 1, 0.1, 10);
    if (d === "carnivore") return clamp(Number(this._carnStaminaMul) || 1, 0.1, 10);
    return 1;
  }

  getHungerDecayMulForDietType(dietType) {
    const d = String(dietType || "").toLowerCase();
    if (d === "herbivore") return clamp(Number(this._herbHungerDecayMul) || 1, 0.1, 10);
    if (d === "omnivore") return clamp(Number(this._omniHungerDecayMul) || 1, 0.1, 10);
    if (d === "carnivore") return clamp(Number(this._carnHungerDecayMul) || 1, 0.1, 10);
    return 1;
  }

  getCarnAttackMul() {
    return clamp(Number(this._carnAttackMul) || 2, 0.1, 10);
  }

  setPlantStaminaMul(multiplier) {
    const n = Number(multiplier);
    if (!Number.isFinite(n)) return;
    this._plantStaminaMul = clamp(n, 0.5, 3.0);
    for (const e of this.entities) {
      if (!e || e._dead) continue;
      if (e.kind !== "plant") continue;
      e.hpMul = this._plantStaminaMul;
      applyPlantStageScaling(e);
    }
  }

  setPlantLifeMinutes(minutes) {
    const mins = clampInt(minutes, 0, 120);
    this._plantLifeMaxSeconds = mins * 60;
    for (const e of this.entities) {
      if (!e || e._dead) continue;
      if (e.kind !== "plant") continue;
      if (this._plantLifeMaxSeconds <= 0) {
        e.lifeMaxSeconds = 0;
        e.lifeSeconds = 0;
        continue;
      }
      e.lifeMaxSeconds = this._plantLifeMaxSeconds;
      if (!Number.isFinite(e.lifeSeconds) || (e.lifeSeconds ?? 0) <= 0) e.lifeSeconds = e.lifeMaxSeconds;
      if ((e.lifeSeconds ?? 0) > e.lifeMaxSeconds) e.lifeSeconds = e.lifeMaxSeconds;
    }
  }

  _refreshAnimalTuning() {
    for (const e of this.entities) {
      if (!e || e._dead) continue;
      if (isMacroNonAnimalKind(e.kind)) continue;

      const diet = e.dietType || dietTypeForEntity(e);
      e.staminaMul = this.getStaminaMulForDietType(diet);
      applyLifeStageScaling(e);

      if (e.attackDamageBase == null) e.attackDamageBase = e.attackDamage ?? 1;
      e.attackDamage = scaledAttackDamage(e.attackDamageBase, diet, this.getCarnAttackMul());

      if ((e.lifeMaxSeconds ?? 0) > 0) {
        const maxLife = this.getAdultLifeMaxSecondsForDietType(diet);
        e.lifeMaxSeconds = maxLife;
        if ((e.lifeSeconds ?? 0) > maxLife) e.lifeSeconds = maxLife;
      }
    }
  }

  setOmniStaminaMul(multiplier) {
    const n = Number(multiplier);
    if (!Number.isFinite(n)) return;
    this._omniStaminaMul = clamp(n, 0.5, 3.0);
    this._refreshAnimalTuning();
  }

  setOmniLifeMinutes(minutes) {
    const mins = clampInt(minutes, 1, 120);
    this._omniLifeMaxSeconds = mins * 60;
    this._refreshAnimalTuning();
  }

  setOmniHungerDecayMul(multiplier) {
    const n = Number(multiplier);
    if (!Number.isFinite(n)) return;
    this._omniHungerDecayMul = clamp(n, 0.1, 3.0);
  }

  setHerbStaminaMul(multiplier) {
    const n = Number(multiplier);
    if (!Number.isFinite(n)) return;
    this._herbStaminaMul = clamp(n, 0.5, 3.0);
    this._refreshAnimalTuning();
  }

  setHerbLifeMinutes(minutes) {
    const mins = clampInt(minutes, 1, 120);
    this._herbLifeMaxSeconds = mins * 60;
    this._refreshAnimalTuning();
  }

  setHerbHungerDecayMul(multiplier) {
    const n = Number(multiplier);
    if (!Number.isFinite(n)) return;
    this._herbHungerDecayMul = clamp(n, 0.1, 3.0);
  }

  setCarnStaminaMul(multiplier) {
    const n = Number(multiplier);
    if (!Number.isFinite(n)) return;
    this._carnStaminaMul = clamp(n, 0.5, 3.0);
    this._refreshAnimalTuning();
  }

  setCarnLifeMinutes(minutes) {
    const mins = clampInt(minutes, 1, 120);
    this._carnLifeMaxSeconds = mins * 60;
    this._refreshAnimalTuning();
  }

  setCarnHungerDecayMul(multiplier) {
    const n = Number(multiplier);
    if (!Number.isFinite(n)) return;
    this._carnHungerDecayMul = clamp(n, 0.1, 3.0);
  }

  setCarnAttackMul(multiplier) {
    const n = Number(multiplier);
    if (!Number.isFinite(n)) return;
    this._carnAttackMul = clamp(n, 0.5, 10);
    this._refreshAnimalTuning();
  }

  setEvolutionMode(mode) {
    const m = String(mode || "").toLowerCase();
    if (m === EVOLUTION_MODE.ga || m === "gaselect") this._evolutionMode = EVOLUTION_MODE.ga;
    else if (m === EVOLUTION_MODE.both || m === "natural+ga" || m === "hybrid") this._evolutionMode = EVOLUTION_MODE.both;
    else this._evolutionMode = EVOLUTION_MODE.natural;
  }

  getEvolutionMode() {
    return this._evolutionMode;
  }

  setFitnessChildWeight(weight) {
    this._fitnessChildWeight = clampInt(weight, 0, 300);
  }

  getFitnessChildWeight() {
    return this._fitnessChildWeight;
  }

  getAnimalCap() {
    return this._animalCap;
  }

  getAnimalHerdCount() {
    const groups = new Set();
    for (const e of this.entities) {
      if (isMacroNonAnimalKind(e.kind)) continue;
      groups.add(e.groupId || `id:${e.id}`);
    }
    return groups.size;
  }

  getReincarnationGroupCount() {
    const groups = new Set();
    for (const e of this.entities) {
      if (!e || e._dead) continue;
      const gid = String(e.groupId || "");
      if (!gid.startsWith("rec:")) continue;
      groups.add(gid);
    }
    return groups.size;
  }

  getAnimalEntityCount() {
    let count = 0;
    for (const e of this.entities) {
      if (isMacroNonAnimalKind(e.kind)) continue;
      count++;
    }
    return count;
  }

  getEntityCounts() {
    const counts = { plant: 0, smallHerbivore: 0, largeHerbivore: 0, predator: 0, total: 0 };
    for (const e of this.entities) {
      if (counts[e.kind] == null) continue;
      counts[e.kind]++;
      counts.total++;
    }
    return counts;
  }

  addFromReincarnation(reincarnation) {
    const baseSeed = (reincarnation?.id ?? Date.now()) * 2654435761;
    const rng = mulberry32(baseSeed);
    const kind = kindFromPercents(reincarnation);
    const initialDiet = dietTypeFromReincarnation(reincarnation);
    const popCounts = computePopulationTypeCounts(this.entities);
    const { width, height } = this._world;
    const groupId = `rec:${reincarnation?.id ?? Date.now()}`;

    // Unified appearance per reincarnation spawn group (male/female may differ).
    const appearanceSeed = (baseSeed + 0x9e3779b9) >>> 0;
    const commonRng = mulberry32(appearanceSeed ^ 0x6d2b79f5);
    const commonVariant = createRandomVariant({ kind, sex: "male", rng: commonRng });
    const maleRng = mulberry32(appearanceSeed ^ 0x13579bdf);
    const femaleRng = mulberry32(appearanceSeed ^ 0x2468ace0);

    const variantForSex = (sex) => {
      const v = cloneVariantTemplate(commonVariant);
      // Parts (horn/wing/tail) are disabled in the main game.
      v.hornCount = 0;
      v.tailCount = 0;
      v.wingCount = 0;
      if (sex === "female") v.coat = createDietCoatStyle({ sex, dietType: initialDiet, rng: femaleRng });
      else if (sex === "male") v.coat = createDietCoatStyle({ sex, dietType: initialDiet, rng: maleRng });
      else if (kind === "plant") v.coat = createCoatStyle(kind, sex, commonRng);
      ensureVariantBases(v);
      refreshVariantBases(v);
      return v;
    };

    const center = this._pickSpawnPoint({
      width,
      height,
      radius: radiusForEntity(kind, reincarnation),
      groupRadius: kind === "plant" ? 95 : 70,
    });

    if (kind === "plant") {
      const remaining = Math.max(0, POP_CAP_PLANT - (popCounts.plant || 0));
      const count = Math.min(6, remaining);
      if (count <= 0) return;
      const r = radiusFromKind(kind) * seededFloat(rng, 0.75, 1.15);
      const plantVariant = variantForSex("none");
      for (let i = 0; i < count; i++) {
        const placed = this._placeNear(center, r, 140, 40, seededFloat(rng, 0, Math.PI * 2), seededFloat(rng, 0, 1));
        this.entities.push(
          this._makeEntity({
            x: placed.x,
            y: placed.y,
            kind,
            radius: r,
            sex: "none",
            groupId,
            reincarnation,
            rng,
            variantOverride: plantVariant,
          }),
        );
      }
      return;
    }

    if (this.getReincarnationGroupCount() >= this._animalCap) return;

    const animalCap = populationCapForDietType(initialDiet);
    const animalCount =
      initialDiet === "herbivore"
        ? popCounts.herbivore
        : initialDiet === "omnivore"
          ? popCounts.omnivore
          : initialDiet === "carnivore"
            ? popCounts.carnivore
            : 0;
    const remainingAnimals = Math.max(0, animalCap - animalCount);
    if (remainingAnimals <= 0) return;

    const commonGenome = pickGenomeForReincarnation({ world: this, kind, initialDietType: initialDiet, reincarnation, rng });

    const sexes = ["male", "male", "female", "female"];
    const baseR = radiusForEntity(kind, reincarnation);
    const groupR = clamp(baseR * seededFloat(rng, 0.95, 1.05), baseR * 0.85, baseR * 1.05);
    const maleVariant = variantForSex("male");
    const femaleVariant = variantForSex("female");
    const spawnCount = Math.min(sexes.length, remainingAnimals);
    const spawnTaxon = pickReincarnationSpawnTaxon(this.entities, rng);
    const designId = this._getOrAssignGroupDesignId(groupId, initialDiet, spawnTaxon, rng);
    for (let i = 0; i < spawnCount; i++) {
      const sex = sexes[i];
      const placed = this._placeNear(center, groupR, 150, 60, seededFloat(rng, 0, Math.PI * 2), seededFloat(rng, 0, 1));
      const e = this._makeEntity({
        x: placed.x,
        y: placed.y,
        kind,
        radius: groupR,
        sex,
        groupId,
        reincarnation,
        rng,
        variantOverride: sex === "female" ? femaleVariant : maleVariant,
        genomeOverride: commonGenome,
      });
      e.designId = designId;
      e.taxon = spawnTaxon;
      if (initialDiet === "herbivore") {
        e.foodPlantEaten = 5;
        e.foodMeatEaten = 0;
      } else if (initialDiet === "carnivore") {
        e.foodPlantEaten = 0;
        e.foodMeatEaten = 5;
      } else if (initialDiet === "omnivore") {
        e.foodPlantEaten = 5;
        e.foodMeatEaten = 5;
      }
      if (initialDiet === "herbivore" || initialDiet === "carnivore" || initialDiet === "omnivore") {
        e.dietType = initialDiet;
        e.dietImprintType = initialDiet;
        e.dietImprintStrength = DIET_IMPRINT_BASE_STRENGTH;
        e.staminaMul = this.getStaminaMulForDietType(initialDiet);
        applyLifeStageScaling(e);
        e.stamina = e.staminaMax;
        const lifeMaxSeconds = this.getAdultLifeMaxSecondsForDietType(initialDiet);
        e.lifeMaxSeconds = lifeMaxSeconds;
        e.lifeSeconds = lifeMaxSeconds;
        e.attackDamage = scaledAttackDamage(e.attackDamageBase, initialDiet, this.getCarnAttackMul());
      }
      this.entities.push(e);
    }
  }

  _makeEntity({ x, y, kind, radius, sex, groupId, reincarnation, rng, variantOverride, genomeOverride }) {
    const variant = variantOverride ? cloneVariantTemplate(variantOverride) : createRandomVariant({ kind, sex, rng });
    if (variant) {
      if (!Number.isFinite(Number(variant.hornScale))) variant.hornScale = 1;
      if (!Number.isFinite(Number(variant.tailScale))) variant.tailScale = 1;
      if (!Number.isFinite(Number(variant.wingScale))) variant.wingScale = 1;
      if (variant.bodyStyle !== "angular" && variant.bodyStyle !== "round") variant.bodyStyle = "round";
      if (kind === "plant" && (variant.plantSpriteIndex == null || !Number.isFinite(Number(variant.plantSpriteIndex)))) {
        variant.plantSpriteIndex = seededInt(rng, 1, 15);
      }
      ensureVariantBases(variant);
      refreshVariantBases(variant);
    }

    const stats = computeStatsForEntity({ kind, reincarnation });
    const heatOffset = seededFloat(rng, 0, HEAT_CYCLE_SECONDS);

    const lifeStage = kind === "plant" || kind === "meat" ? "none" : "adult";
    const dietType = dietTypeFromKind(kind);
    const attackDamageBase = stats.attackDamage ?? 0;
    const staminaMul = this.getStaminaMulForDietType(dietType);
    const hpMul = kind === "plant" ? clamp(Number(this._plantStaminaMul) || 1, 0.1, 10) : 1;
    const hpMax = kind === "plant" ? Math.max(1, Math.round((stats.hpMax ?? BASE_STAT) * hpMul)) : stats.hpMax;
    const staminaMax =
      kind === "plant" || kind === "meat" ? stats.staminaMax : Math.max(0, Math.round((stats.staminaMax ?? 0) * staminaMul));
    const lifeMaxSeconds =
      kind === "plant"
        ? this.getPlantLifeMaxSeconds()
        : kind === "meat"
          ? stats.lifeMaxSeconds
          : this.getAdultLifeMaxSecondsForDietType(dietType);

    const genome =
      kind === "plant" || kind === "meat"
        ? null
        : genomeOverride
          ? cloneGenome(genomeOverride)
          : createRandomGenome({ kind, initialDietType: dietType, reincarnation, rng });

    const e = {
      id: nextMacroId++,
      x,
      y,
      kind,
      taxon: kind === "plant" || kind === "meat" ? null : CREATURE_TAXON.mammal,
      radius,
      sex,
      groupId,
      variant,
      reincarnation,
      genome,
      generation: 1,
      lifeStage,
      born: false,
      motherId: null,
      fatherId: null,
      hasReproduced: false,
      reproSuccessCount: 0,
      reproSuccessMax: null,
      pairedWithId: null,
      pregnant: false,
      pregnancySeconds: 0,
      pregnancyBabies: 0,
      pregnancyFatherSnapshot: null,
      parentingNestId: null,
      parentingNestX: null,
      parentingNestY: null,
      parentingMode: null,
      parentingPartnerId: null,
      nestId: null,
      dietType,
      dietImprintType: dietType === "herbivore" || dietType === "omnivore" || dietType === "carnivore" ? dietType : null,
      dietImprintStrength:
        dietType === "herbivore" || dietType === "omnivore" || dietType === "carnivore" ? DIET_IMPRINT_BASE_STRENGTH : 0,
      staminaMul,
      hpMul,
      baseHpMax: stats.hpMax,
      baseHungerMax: stats.hungerMax,
      baseStaminaMax: stats.staminaMax,
      baseRadius: radius,
      hpMax,
      hp: hpMax,
      hungerMax: stats.hungerMax,
      hunger: stats.hungerMax,
      staminaMax,
      stamina: staminaMax,
      lifeMaxSeconds,
      lifeSeconds: lifeMaxSeconds,
      ambientTempC: null,
      bodyTempC: null,
      fur01: genome ? clamp01(Number.isFinite(Number(genome.fur01)) ? Number(genome.fur01) : 0.45) : null,
      ageSeconds: 0,
      offspringCount: 0,
      attackCount: 0,
      attackImpulse: 0,
      moveImpulse: 0,
      exploreImpulse: 0,
      hornDev: 0,
      tailDev: 0,
      wingDev: 0,
      biomeSeconds: new Float32Array(BIOMES.length),
      biomeTotalSeconds: 0,
      visitedTileBits: null,
      visitedTileCount: 0,
      _lastVisitedTileIndex: null,
      socialSeconds: 0,
      socialMode: "lone",
      attackDamageBase,
      attackDamage:
        kind === "plant" || kind === "meat"
          ? 0
          : scaledAttackDamage(attackDamageBase, dietType, this.getCarnAttackMul()),
      attackCooldownSeconds: 0,
      eatCooldownSeconds: 0,
      reproCooldownSeconds: 0,
      heatCycleSeconds: heatOffset,
      heatActive: false,
      eatFxSeconds: 0,
      eatFxType: null,
      hitFxSeconds: 0,
      wanderAngle: seededFloat(rng, 0, Math.PI * 2),
      wanderTimeLeft: seededFloat(rng, 1.5, 4.0),
      foodPlantEaten: 0,
      foodMeatEaten: 0,
      foodSeekActive: false,
      milkSeekActive: false,
      followMotherActive: false,
      fleeLockSeconds: 0,
      lastThreatId: null,
      lastThreatX: null,
      lastThreatY: null,
      foodTargetId: null,
      foodTargetLockSeconds: 0,
      reserveRestActive: false,
      reserveRestLockSeconds: 0,
    };
    if (kind === "plant") applyPlantStageScaling(e);
    return e;
  }

  _makeMeat({ x, y, groupId }) {
    return {
      id: nextMacroId++,
      x,
      y,
      kind: "meat",
      radius: 10,
      sex: "none",
      groupId: groupId || `meat:${Date.now()}`,
      variant: { rotation: randFloat(-0.5, 0.5) },
      reincarnation: null,
      hpMax: 1,
      hp: 1,
      hungerMax: 0,
      hunger: 0,
      staminaMax: 0,
      stamina: 0,
      lifeMaxSeconds: MEAT_LIFESPAN_SECONDS,
      lifeSeconds: MEAT_LIFESPAN_SECONDS,
      ageSeconds: 0,
      attackDamage: 0,
      attackCooldownSeconds: 0,
      eatCooldownSeconds: 0,
      reproCooldownSeconds: 0,
      heatCycleSeconds: 0,
      heatActive: false,
      eatFxSeconds: 0,
      eatFxType: null,
      hitFxSeconds: 0,
      wanderAngle: 0,
      wanderTimeLeft: 0,
      foodPlantEaten: 0,
      foodMeatEaten: 0,
      nutrition: 1,
    };
  }

  _makeNest({ x, y, motherId, fatherId, groupId }) {
    const seed = (Date.now() + nextMacroId * 2654435761 + Math.floor((x + y) * 13)) >>> 0;
    const rng = mulberry32(seed);
    return {
      id: nextMacroId++,
      x,
      y,
      kind: "nest",
      radius: MACRO_CONFIG.tileSize * NEST_OBJECT_RADIUS_TILES,
      sex: "none",
      groupId: groupId || `nest:${motherId ?? "?"}:${fatherId ?? "?"}:${Date.now()}`,
      variant: {
        rotation: seededFloat(rng, -0.5, 0.5),
        nestStyle: seededInt(rng, 0, 2),
      },
      reincarnation: null,
      hpMax: 1,
      hp: 1,
      hungerMax: 0,
      hunger: 0,
      staminaMax: 0,
      stamina: 0,
      lifeMaxSeconds: 0,
      lifeSeconds: 0,
      ageSeconds: 0,
      nestMotherId: motherId ?? null,
      nestFatherId: fatherId ?? null,
    };
  }

  _makeEgg({ x, y, nestId, motherSnapshot, fatherSnapshot, groupId }) {
    const seed = (Date.now() + nextMacroId * 2654435761 + (nestId ?? 0) * 1013904223 + Math.floor((x + y) * 17)) >>> 0;
    const rng = mulberry32(seed);
    return {
      id: nextMacroId++,
      x,
      y,
      kind: "egg",
      radius: 9,
      sex: "none",
      groupId: groupId || `egg:${nestId ?? "?"}:${Date.now()}`,
      variant: {
        rotation: seededFloat(rng, -0.4, 0.4),
      },
      reincarnation: null,
      hpMax: 1,
      hp: 1,
      hungerMax: 0,
      hunger: 0,
      staminaMax: 0,
      stamina: 0,
      lifeMaxSeconds: 0,
      lifeSeconds: 0,
      ageSeconds: 0,
      nestId: nestId ?? null,
      warmSeconds: 0,
      unwarmedSeconds: 0,
      motherSnapshot: motherSnapshot || null,
      fatherSnapshot: fatherSnapshot || null,
    };
  }

  _spawnMeatFromCorpse(entity, out) {
    const count = Math.max(1, Math.floor((entity.hpMax || BASE_STAT) / 50));
    for (let i = 0; i < count; i++) {
      const ang = randFloat(0, Math.PI * 2);
      const dist = randFloat(6, 22);
      const w = this._world.width;
      const h = this._world.height;
      out.push(
        this._makeMeat({
          x: wrapCoord(entity.x + Math.cos(ang) * dist, w),
          y: wrapCoord(entity.y + Math.sin(ang) * dist, h),
          groupId: entity.groupId,
        }),
      );
    }
  }

  _makeChildFromParents({ x, y, father, mother }) {
    const pA = father?.reincarnation;
    const pB = mother?.reincarnation;
    const base = {
      staminaPct: clamp(((pA?.staminaPct ?? 0) + (pB?.staminaPct ?? 0)) / 2, 0, 100),
      healthPct: clamp(((pA?.healthPct ?? 0) + (pB?.healthPct ?? 0)) / 2, 0, 100),
      attackPct: clamp(((pA?.attackPct ?? 0) + (pB?.attackPct ?? 0)) / 2, 0, 100),
      traits: mother?.reincarnation?.traits || father?.reincarnation?.traits || null,
      id: Date.now() + Math.floor(Math.random() * 100000),
    };

    const mutate = (v) => clamp(v + randFloat(-3, 3), 0, 100);
    base.staminaPct = mutate(base.staminaPct);
    base.healthPct = mutate(base.healthPct);
    if (base.staminaPct + base.healthPct > 100) {
      const sum = base.staminaPct + base.healthPct;
      base.staminaPct = (base.staminaPct / sum) * 100;
      base.healthPct = (base.healthPct / sum) * 100;
    }
    base.attackPct = clamp(100 - base.staminaPct - base.healthPct, 0, 100);

    const kind = kindFromPercents(base);
    const sex = Math.random() < 0.5 ? "male" : "female";
    const rng = mulberry32((base.id ?? Date.now()) * 2654435761);
    const parentDiet = dietTypeForEntity(mother) || dietTypeForEntity(father) || dietTypeFromKind(kind);
    const parentImprintA = clamp(
      Number(father?.dietImprintStrength) || DIET_IMPRINT_BASE_STRENGTH,
      0,
      DIET_IMPRINT_MAX_STRENGTH,
    );
    const parentImprintB = clamp(
      Number(mother?.dietImprintStrength) || DIET_IMPRINT_BASE_STRENGTH,
      0,
      DIET_IMPRINT_MAX_STRENGTH,
    );
    const childDietImprintStrength = clamp(
      (parentImprintA + parentImprintB) / 2 + DIET_IMPRINT_CHILD_ADD,
      DIET_IMPRINT_BASE_STRENGTH,
      DIET_IMPRINT_MAX_STRENGTH,
    );
    const childGenome = blendGenomes(father?.genome, mother?.genome, rng);
    if (childGenome) {
      childGenome.kind = String(kind || childGenome.kind || "unknown");
      childGenome.diet = String(parentDiet || childGenome.diet || "unknown");
    }
    const baseR = radiusForEntity(kind, base);
    const r = clamp(baseR * seededFloat(rng, 0.55, 0.75), 8, baseR);

    const child = this._makeEntity({
      x,
      y,
      kind,
      radius: r,
      sex,
      groupId: mother?.groupId || father?.groupId || `child:${Date.now()}`,
      reincarnation: base,
      rng,
      variantOverride: createChildVariant({
        fatherVariant: father?.variant,
        motherVariant: mother?.variant,
        sex,
        kind,
        dietType: parentDiet,
        rng,
      }),
      genomeOverride: childGenome,
    });
    child.born = true;
    child.motherId = mother?.id ?? null;
    child.fatherId = father?.id ?? null;
    const genA = Number(father?.generation);
    const genB = Number(mother?.generation);
    const baseGen = Math.max(Number.isFinite(genA) && genA > 0 ? genA : 1, Number.isFinite(genB) && genB > 0 ? genB : 1);
    child.generation = clampInt(baseGen + 1, 1, 9999);
    child.lifeStage = "baby";
    child.dietType = parentDiet;
    child.dietImprintType = parentDiet;
    child.dietImprintStrength = childDietImprintStrength;
    child.staminaMul = this.getStaminaMulForDietType(parentDiet);
    applyLifeStageScaling(child);
    child.hp = child.hpMax;
    child.hunger = child.hungerMax;
    child.stamina = child.staminaMax;
    child.attackDamage = scaledAttackDamage(child.attackDamageBase, parentDiet, this.getCarnAttackMul());
    child.hasReproduced = false;
    child.pairedWithId = null;

    const childTaxon =
      mother?.taxon === CREATURE_TAXON.bird || mother?.taxon === CREATURE_TAXON.mammal
        ? mother.taxon
        : father?.taxon === CREATURE_TAXON.bird || father?.taxon === CREATURE_TAXON.mammal
          ? father.taxon
          : null;
    child.designId =
      mother?.designId ||
      father?.designId ||
      this._getOrAssignGroupDesignId(child.groupId, child.dietType, childTaxon || CREATURE_TAXON.mammal, rng);
    child.taxon = childTaxon || taxonFromDesignId(child.designId);
    return child;
  }

  update(dt) {
    this._elapsedSeconds = (this._elapsedSeconds ?? 0) + (Number(dt) || 0);
    this._stepWeather(dt);
    this._updateClimateState();
    const tile = MACRO_CONFIG.tileSize;
    const w = this._world.width;
    const h = this._world.height;
    const plantReproMax = clampInt(this._plantReproMax ?? 1, 1, 5);
    const meatRotEnabled = this._meatRotEnabled !== false;
    const meatHungerRecoverFraction = clamp(
      Number.isFinite(Number(this._meatHungerRecoverFraction))
        ? Number(this._meatHungerRecoverFraction)
        : MEAT_HUNGER_RECOVER_FRACTION,
      0,
      1,
    );
    const plantHungerRecoverMul = clamp(
      Number.isFinite(Number(this._plantHungerRecoverMul)) ? Number(this._plantHungerRecoverMul) : 1.0,
      0,
      10,
    );
    const tw = Math.max(1, Math.floor(w / tile));
    const th = Math.max(1, Math.floor(h / tile));
    this._ensureTerritoryPaint(tw, th);
    const spawned = [];
    const popCounts = computePopulationTypeCounts(this.entities);

    const plantTileCounts = new Map();
    for (const e of this.entities) {
      if (!e || e._dead) continue;
      if (e.kind !== "plant") continue;
      const px = wrapCoord(e.x, w);
      const py = wrapCoord(e.y, h);
      const tx = clampInt(Math.floor(px / tile), 0, tw - 1);
      const ty = clampInt(Math.floor(py / tile), 0, th - 1);
      const key = `${tx},${ty}`;
      plantTileCounts.set(key, (plantTileCounts.get(key) || 0) + 1);
    }

    for (const e of this.entities) {
      e._dead = false;
      if (e.kind === "plant") {
        stepPlantEntity({
          world: this,
          entity: e,
          dt,
          tile,
          w,
          h,
          tw,
          th,
          weatherKind: this._weatherKind,
          plantReproMax,
          popCounts,
          plantTileCounts,
          spawned,
        });
        continue;
      }

      if (e.kind === "meat") {
        stepMeatEntity({
          world: this,
          entity: e,
          dt,
          tile,
          w,
          h,
          tw,
          th,
          meatRotEnabled,
          popCounts,
          plantTileCounts,
          spawned,
        });
        continue;
      }

      if (e.kind === "nest") {
        stepNestEntity({ entity: e, dt });
        continue;
      }

      if (e.kind === "egg") {
        stepEggEntity({ entity: e, dt });
        continue;
      }

      stepAnimalVitals({ world: this, entity: e, dt, tile, w, h, spawned, popCounts });
      if (e._dead) continue;
    }

    let entities = this.entities.filter((e) => !e._dead);
    const byId = new Map();
    for (const e of entities) byId.set(e.id, e);

    // Territory learning helpers: per-group animal counts (used to normalize shared territory progress).
    this._territoryGroupAnimalCounts = [];
    for (const e of entities) {
      if (!e || e._dead) continue;
      if (isMacroNonAnimalKind(e.kind)) continue;
      const gid = e.groupId || `id:${e.id}`;
      const idx = this._getOrAssignTerritoryGroupIndex(gid);
      this._territoryGroupAnimalCounts[idx] = (Number(this._territoryGroupAnimalCounts[idx]) || 0) + 1;
    }

    const gridState = buildGrid(entities, tile * 4);
    const attackRangePx = ATTACK_RANGE_TILES * tile;
    const reproRangePx = REPRO_RANGE_TILES * tile;
    const foodSearchPx = 32 * tile;
    const fleeRangePx = FLEE_RANGE_TILES * tile;

    const { socialGroupCenters, socialGroupCenterList } = computeSocialGroups({
      entities,
      gridState,
      tile,
      dt,
      w,
      h,
      groupMaxSize: this._groupMaxSize,
    });

    for (const e of entities) {
      if (!e || e._dead) continue;
      if (isMacroNonAnimalKind(e.kind)) continue;
      stepAnimalAi({
        world: this,
        entity: e,
        entities,
        byId,
        gridState,
        socialGroupCenters,
        socialGroupCenterList,
        dt,
        tile,
        w,
        h,
        tw,
        th,
        attackRangePx,
        reproRangePx,
        foodSearchPx,
        fleeRangePx,
        popCounts,
        spawned,
        plantHungerRecoverMul,
        meatHungerRecoverFraction,
        nnVizFocusId: this._nnVizFocusId,
      });
    }

    // separation pass (after movement)
    entities = separationPass({ entities, tile, w, h });

    // Nest incubation + hatching (eggs), and parenting mode transitions.
    stepNestIncubationAndParenting({ world: this, entities, spawned, dt, tile, w, h, popCounts });

    entities = entities.filter((e) => !e._dead);
    entities.push(...spawned.filter((e) => !e._dead));
    this.entities = entities;

    // Territory paint (group color) is updated after all movements/spawns for this tick.
    stepTerritoryPaint({ world: this, territory: this._territoryPaint, entities: this.entities, dt, tile, w, h });
  }

  _pickSpawnPoint({ width, height, radius, groupRadius }) {
    const pad = 30 + radius + groupRadius;
    const attempts = 50;
    let x = randFloat(pad, Math.max(pad + 1, width - pad));
    let y = randFloat(pad, Math.max(pad + 1, height - pad));

    for (let i = 0; i < attempts; i++) {
      const tx = randFloat(pad, Math.max(pad + 1, width - pad));
      const ty = randFloat(pad, Math.max(pad + 1, height - pad));
      if (!this._overlaps(tx, ty, radius + groupRadius)) {
        x = tx;
        y = ty;
        break;
      }
    }

    return { x, y };
  }

  _placeNear(center, radius, maxDist, attempts, startAngle, startT) {
    const { width, height } = this._world;
    const pad = 20 + radius;
    let best = { x: clamp(center.x, pad, width - pad), y: clamp(center.y, pad, height - pad) };

    for (let i = 0; i < attempts; i++) {
      const t = (startT + i / attempts) % 1;
      const ang = startAngle + t * Math.PI * 2;
      const dist = (0.15 + t) * maxDist;
      const x = clamp(center.x + Math.cos(ang) * dist, pad, width - pad);
      const y = clamp(center.y + Math.sin(ang) * dist, pad, height - pad);
      if (!this._overlaps(x, y, radius)) return { x, y };
      best = { x, y };
    }

    return best;
  }

  _overlaps(x, y, r) {
    const w = this._world.width;
    const h = this._world.height;
    for (const e of this.entities) {
      const rr = r + e.radius + 22;
      const dx = wrapDelta(x, e.x, w);
      const dy = wrapDelta(y, e.y, h);
      if (dx * dx + dy * dy <= rr * rr) return true;
    }
    return false;
  }
}
