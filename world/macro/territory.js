import { wrapCoord } from "./geom.js";
import { isMacroNonAnimalKind } from "./kinds.js";
import { ELEVATION_WINGLESS_MAX_CLIMB_METERS, TERRITORY_LEVEL_SECONDS, TERRITORY_MAX_SECONDS } from "./constants.js";

function wrapTile(v, max) {
  const m = max | 0;
  if (m <= 0) return 0;
  const n = v | 0;
  return ((n % m) + m) % m;
}

function territoryLevelFromSeconds(seconds) {
  const s = Number(seconds) || 0;
  if (s >= (TERRITORY_LEVEL_SECONDS[4] ?? 60)) return 4;
  if (s >= (TERRITORY_LEVEL_SECONDS[3] ?? 30)) return 3;
  if (s >= (TERRITORY_LEVEL_SECONDS[2] ?? 15)) return 2;
  if (s >= (TERRITORY_LEVEL_SECONDS[1] ?? 5)) return 1;
  return 0;
}

function growInt32(oldArr, newLen) {
  const next = new Int32Array(newLen);
  next.set(oldArr);
  return next;
}

function growFloat32(oldArr, newLen) {
  const next = new Float32Array(newLen);
  next.set(oldArr);
  return next;
}

function hashStringToU32(str) {
  const s = String(str || "");
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function u32To01(u) {
  return ((u >>> 0) / 4294967296) % 1;
}

function hslToRgb(h, s, l) {
  const hue2rgb = (p, q, t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  const hh = ((Number(h) || 0) % 1 + 1) % 1;
  const ss = Math.max(0, Math.min(1, Number(s) || 0));
  const ll = Math.max(0, Math.min(1, Number(l) || 0));

  if (ss <= 1e-6) {
    const v = Math.round(ll * 255);
    return [v, v, v];
  }

  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const r = hue2rgb(p, q, hh + 1 / 3);
  const g = hue2rgb(p, q, hh);
  const b = hue2rgb(p, q, hh - 1 / 3);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function rgbToHex(r, g, b) {
  const hex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function territoryColorNameJaFromHueDeg(hueDeg) {
  const h = ((Number(hueDeg) || 0) % 360 + 360) % 360;
  if (h < 15 || h >= 345) return "赤";
  if (h < 35) return "朱色";
  if (h < 55) return "オレンジ";
  if (h < 80) return "黄";
  // 80..160 is skipped (no greens).
  if (h < 190) return "水色";
  if (h < 220) return "青";
  if (h < 245) return "紺";
  if (h < 270) return "紫";
  if (h < 300) return "赤紫";
  if (h < 330) return "ピンク";
  return "赤";
}

export function pickTerritoryGroupColor(groupId) {
  const seedHue = hashStringToU32(groupId);
  const seedSat = hashStringToU32(`${groupId}|s`);
  const seedLit = hashStringToU32(`${groupId}|l`);

  // Spread hues uniformly, while skipping green-ish hues (80..160 degrees) to avoid confusion with plant influence.
  const tHue = u32To01(seedHue);
  const allowedDeg = 280; // [0..80) U [160..360)
  const degInAllowed = tHue * allowedDeg;
  const hueDeg = degInAllowed < 80 ? degInAllowed : degInAllowed + 80;

  // Add a bit of saturation/lightness variety to reduce "similar colors" while keeping visibility on gray map.
  const sat = 0.68 + u32To01(seedSat) * 0.24; // 0.68..0.92
  const lit = 0.48 + u32To01(seedLit) * 0.16; // 0.48..0.64

  const [r, g, b] = hslToRgb(hueDeg / 360, sat, lit);
  return { r, g, b, hex: rgbToHex(r, g, b), nameJa: territoryColorNameJaFromHueDeg(hueDeg) };
}

export function ensureTerritoryPaintState(prev, tileWidth, tileHeight) {
  const tw = Math.max(1, tileWidth | 0);
  const th = Math.max(1, tileHeight | 0);
  if (prev && prev.tileWidth === tw && prev.tileHeight === th) return prev;

  const size = tw * th;
  const owner = new Int32Array(size);
  owner.fill(-1);

  const seconds = new Float32Array(size);
  const level = new Uint8Array(size);
  const plantMask = new Uint8Array(size);

  const mark = new Int32Array(size);
  const head = new Int32Array(size);

  const entryCap = 32768;
  const entryGroup = new Int32Array(entryCap);
  const entryContrib = new Float32Array(entryCap);
  const entryNext = new Int32Array(entryCap);

  return {
    tileWidth: tw,
    tileHeight: th,
    size,
    owner,
    seconds,
    level,
    plantMask,
    mark,
    head,
    epoch: 1,
    touched: [],
    entryGroup,
    entryContrib,
    entryNext,
    entryCount: 0,
  };
}

export function stepTerritoryPaint({ world, territory, entities, dt, tile, w, h }) {
  if (!territory || !entities || !(dt > 0) || !(tile > 0)) return;

  const tw = territory.tileWidth | 0;
  const th = territory.tileHeight | 0;
  if (!(tw > 0 && th > 0)) return;

  // Recompute unpaintable plant influence tiles (green). Matches rendering: flat tiles only.
  territory.plantMask.fill(0);
  const hasElevation = typeof world?.getElevationAtTile === "function";
  for (const p of entities) {
    if (!p || p._dead) continue;
    if (p.kind !== "plant") continue;
    const px = wrapCoord(p.x, w);
    const py = wrapCoord(p.y, h);
    const cx = Math.floor(px / tile);
    const cy = Math.floor(py / tile);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = wrapTile(cx + dx, tw);
        const ty = wrapTile(cy + dy, th);
        if (hasElevation) {
          const hm = Number(world.getElevationAtTile(tx, ty)) || 0;
          if (hm > 0) continue;
        }
        territory.plantMask[ty * tw + tx] = 1;
      }
    }
  }

  // Sparse per-tick contributions: tile -> linked list of (groupIndex, contribSeconds).
  territory.epoch = (Number(territory.epoch) || 0) + 1;
  if (territory.epoch > 0x7fffffff) {
    territory.epoch = 1;
    territory.mark.fill(0);
  }
  const epoch = territory.epoch | 0;
  territory.touched.length = 0;
  territory.entryCount = 0;

  const getGroupIndex = world?._getOrAssignTerritoryGroupIndex;
  if (typeof getGroupIndex !== "function") return;

  const winglessMax = ELEVATION_WINGLESS_MAX_CLIMB_METERS;
  for (const e of entities) {
    if (!e || e._dead) continue;
    if (isMacroNonAnimalKind(e.kind)) continue;

    const groupId = e.groupId || `id:${e.id}`;
    const groupIdx = getGroupIndex.call(world, groupId);
    if (!(groupIdx >= 0)) continue;

    const px = wrapCoord(e.x, w);
    const py = wrapCoord(e.y, h);
    const cx = Math.floor(px / tile);
    const cy = Math.floor(py / tile);

    const groundBound = e.taxon !== "bird";

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = wrapTile(cx + dx, tw);
        const ty = wrapTile(cy + dy, th);
        const tileIdx = ty * tw + tx;

        if (territory.plantMask[tileIdx]) continue;
        if (groundBound && hasElevation) {
          const hm = Number(world.getElevationAtTile(tx, ty)) || 0;
          if (hm > winglessMax) continue;
        }

        if (territory.mark[tileIdx] !== epoch) {
          territory.mark[tileIdx] = epoch;
          territory.head[tileIdx] = -1;
          territory.touched.push(tileIdx);
        }

        let found = false;
        for (let entry = territory.head[tileIdx]; entry !== -1; entry = territory.entryNext[entry]) {
          if (territory.entryGroup[entry] === groupIdx) {
            territory.entryContrib[entry] += dt;
            found = true;
            break;
          }
        }
        if (found) continue;

        if (territory.entryCount >= territory.entryGroup.length) {
          const newLen = Math.max(1024, Math.floor(territory.entryGroup.length * 1.6));
          territory.entryGroup = growInt32(territory.entryGroup, newLen);
          territory.entryContrib = growFloat32(territory.entryContrib, newLen);
          territory.entryNext = growInt32(territory.entryNext, newLen);
        }

        const entryIdx = territory.entryCount++;
        territory.entryGroup[entryIdx] = groupIdx;
        territory.entryContrib[entryIdx] = dt;
        territory.entryNext[entryIdx] = territory.head[tileIdx];
        territory.head[tileIdx] = entryIdx;
      }
    }
  }

  // Apply contributions to persistent paint.
  for (const tileIdx of territory.touched) {
    let bestGroup = -1;
    let bestContrib = 0;
    for (let entry = territory.head[tileIdx]; entry !== -1; entry = territory.entryNext[entry]) {
      const contrib = territory.entryContrib[entry];
      if (contrib > bestContrib) {
        bestContrib = contrib;
        bestGroup = territory.entryGroup[entry];
      }
    }

    if (!(bestGroup >= 0) || !(bestContrib > 0)) continue;

    const oldOwner = territory.owner[tileIdx];
    const oldSeconds = territory.seconds[tileIdx];

    if (territory.owner[tileIdx] !== bestGroup) {
      territory.owner[tileIdx] = bestGroup;
      territory.seconds[tileIdx] = 0;
    }

    const nextSeconds = Math.min(TERRITORY_MAX_SECONDS, (Number(territory.seconds[tileIdx]) || 0) + bestContrib);
    territory.seconds[tileIdx] = nextSeconds;
    territory.level[tileIdx] = territoryLevelFromSeconds(nextSeconds);

    if (typeof world?._applyTerritoryTileUpdate === "function") {
      world._applyTerritoryTileUpdate({
        oldOwner,
        oldSeconds,
        newOwner: territory.owner[tileIdx],
        newSeconds: territory.seconds[tileIdx],
      });
    }
  }
}
