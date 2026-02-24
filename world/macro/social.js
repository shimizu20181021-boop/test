import { clamp } from "../../core/utils.js";
import { SOCIAL_RANGE_TILES, SOCIAL_THRESHOLD_SECONDS } from "./constants.js";
import { dietTypeForEntity } from "./diet.js";
import { dist2Wrapped, wrapCoord, wrapDelta } from "./geom.js";
import { isMacroNonAnimalKind } from "./kinds.js";
import { findNearest, forEachInRadius } from "./spatial.js";

export function computeSocialGroups({ entities, gridState, tile, dt, w, h, groupMaxSize }) {
  // Precompute diet + social grouping so "group" animals act as smaller packs that move separately.
  for (const e of entities) {
    if (!e || e._dead) continue;
    if (isMacroNonAnimalKind(e.kind)) continue;
    e._dietNow = dietTypeForEntity(e);
    e.socialGroupId = null;
  }

  // Social mode learning: time near same diet-type within range.
  for (const e of entities) {
    if (!e || e._dead) continue;
    if (isMacroNonAnimalKind(e.kind)) continue;
    const dietNow = e._dietNow;
    if (dietNow !== "herbivore" && dietNow !== "omnivore" && dietNow !== "carnivore") continue;

    const sameDietNeighbor = findNearest({
      entities,
      gridState,
      from: e,
      radiusPx: SOCIAL_RANGE_TILES * tile,
      world: { width: w, height: h },
      filter: (o) =>
        !isMacroNonAnimalKind(o.kind) &&
        !o._dead &&
        o.lifeStage !== "none" &&
        o._dietNow === dietNow,
    });
    const nearSame = Boolean(sameDietNeighbor);
    e.socialSeconds = clamp((e.socialSeconds ?? 0) + (nearSame ? dt : -dt), 0, SOCIAL_THRESHOLD_SECONDS);
    if (e.socialMode == null) e.socialMode = "lone";
    if ((e.socialSeconds ?? 0) >= SOCIAL_THRESHOLD_SECONDS) e.socialMode = "group";
    else if ((e.socialSeconds ?? 0) <= 0) e.socialMode = "lone";
  }

  const socialGroupCenters = new Map(); // socialGroupId -> {x,y}
  const socialGroupCenterList = []; // [{id,x,y}]
  const groupCapRaw = Number.parseInt(String(groupMaxSize ?? 4), 10);
  const groupCap = groupCapRaw === 8 || groupCapRaw === 12 ? groupCapRaw : 4;
  const groupRadiusPx = SOCIAL_RANGE_TILES * tile;
  const groupRadius2 = groupRadiusPx * groupRadiusPx;

  const eligible = [];
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!e || e._dead) continue;
    if (isMacroNonAnimalKind(e.kind)) continue;
    if (e.socialMode !== "group") continue;
    const d = e._dietNow;
    if (d !== "herbivore" && d !== "omnivore" && d !== "carnivore") continue;
    eligible.push(i);
  }
  eligible.sort((a, b) => (entities[a]?.id ?? 0) - (entities[b]?.id ?? 0));

  const assigned = new Uint8Array(entities.length);
  for (const leaderIdx of eligible) {
    if (assigned[leaderIdx]) continue;
    const leader = entities[leaderIdx];
    if (!leader || leader._dead) continue;
    const diet = leader._dietNow;
    if (diet !== "herbivore" && diet !== "omnivore" && diet !== "carnivore") continue;

    const members = [leaderIdx];
    assigned[leaderIdx] = 1;

    const candidates = [];
    forEachInRadius(gridState, leader.x, leader.y, groupRadiusPx, (idx) => {
      if (idx === leaderIdx) return;
      if (assigned[idx]) return;
      const o = entities[idx];
      if (!o || o._dead) return;
      if (isMacroNonAnimalKind(o.kind)) return;
      if (o.socialMode !== "group") return;
      if (o._dietNow !== diet) return;
      const d2 = dist2Wrapped(leader, o, w, h);
      if (d2 > groupRadius2) return;
      candidates.push({ idx, d2 });
    });
    candidates.sort((a, b) => a.d2 - b.d2);
    for (const c of candidates) {
      if (members.length >= groupCap) break;
      assigned[c.idx] = 1;
      members.push(c.idx);
    }

    const gid = `sg:${diet}:${leader.id}`;
    let sumX = 0;
    let sumY = 0;
    for (const mi of members) {
      const o = entities[mi];
      const ox = leader.x + wrapDelta(leader.x, o.x, w);
      const oy = leader.y + wrapDelta(leader.y, o.y, h);
      sumX += ox;
      sumY += oy;
    }
    const cx = wrapCoord(sumX / members.length, w);
    const cy = wrapCoord(sumY / members.length, h);

    socialGroupCenters.set(gid, { x: cx, y: cy });
    socialGroupCenterList.push({ id: gid, x: cx, y: cy });
    for (const mi of members) {
      const o = entities[mi];
      if (!o || o._dead) continue;
      o.socialGroupId = gid;
    }
  }

  // If an entity is in group mode but didn't get clustered, keep it as a "solo group".
  for (const e of entities) {
    if (!e || e._dead) continue;
    if (isMacroNonAnimalKind(e.kind)) continue;
    if (e.socialMode !== "group") continue;
    if (e.socialGroupId) continue;
    const diet = e._dietNow;
    if (diet !== "herbivore" && diet !== "omnivore" && diet !== "carnivore") continue;
    const gid = `sg:${diet}:${e.id}`;
    e.socialGroupId = gid;
    socialGroupCenters.set(gid, { x: e.x, y: e.y });
    socialGroupCenterList.push({ id: gid, x: e.x, y: e.y });
  }

  return { socialGroupCenters, socialGroupCenterList };
}

