import { clamp } from "../core/utils.js";

const TAU = Math.PI * 2;

function hash32(x) {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

function tileHash(tx, ty, seed, salt) {
  const x = tx | 0;
  const y = ty | 0;
  const s = seed | 0;
  const t = salt | 0;
  return hash32(Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ s ^ t);
}

function rand01FromHash(h) {
  return (h >>> 0) / 4294967296;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function ensureCount(list, target, create) {
  const t = Math.max(0, target | 0);
  while (list.length < t) list.push(create());
  while (list.length > t) list.pop();
}

export class WeatherFx {
  constructor() {
    this.wetness01 = 0;
    this.snowCover01 = 0;
    this._macroSeed = 1;
    this._t = 0;

    this._rainDrops = [];
    this._snowFlakes = [];
    this._steamPuffs = [];
    this._steamSpawnBudget = 0;
  }

  _syncMacroSeed(macroWorld) {
    const raw = Number(macroWorld?._biomeSeed);
    const seed = Number.isFinite(raw) ? (raw | 0) : 1;
    this._macroSeed = seed || 1;
  }

  step(dt, weatherKind, { screenW = 0, screenH = 0, macroWorld = null, viewBoundsWorld = null } = {}) {
    const d = clamp(Number(dt) || 0, 0, 0.2);
    this._t += d;
    this._syncMacroSeed(macroWorld);

    const isRain = weatherKind === "rainy";
    const isSnow = weatherKind === "snowy";
    const isDrought = weatherKind === "drought";

    // Ground wetness: builds up during rain, slowly dries otherwise.
    this.wetness01 = clamp(this.wetness01 + (isRain ? 0.12 : -0.03) * d, 0, 1);

    // Snow cover: accumulates during snow, slowly melts otherwise.
    this.snowCover01 = clamp(this.snowCover01 + (isSnow ? 0.06 : -0.02) * d, 0, 1);

    this._stepRain(d, isRain ? 1 : 0, screenW, screenH);
    this._stepSnow(d, isSnow ? 1 : 0, screenW, screenH);
    this._stepSteam(d, isDrought ? 1 : 0, screenW, screenH, viewBoundsWorld);
  }

  _stepRain(dt, intensity01, screenW, screenH) {
    const w = Math.max(0, Number(screenW) || 0);
    const h = Math.max(0, Number(screenH) || 0);
    const area = Math.max(1, w * h);
    const base = Math.round((area / 9000) * 1.55 * intensity01);
    const target = intensity01 > 0 ? Math.max(40, base) : 0;

    ensureCount(this._rainDrops, target, () => {
      const speed = 760 + Math.random() * 520;
      const slant = 0.22 + Math.random() * 0.18;
      const vx = -speed * slant;
      const vy = speed;
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        vx,
        vy,
        len: 12 + Math.random() * 22,
        a: 0.35 + Math.random() * 0.45,
      };
    });

    for (const d0 of this._rainDrops) {
      d0.x += d0.vx * dt;
      d0.y += d0.vy * dt;
      if (d0.y > h + 80 || d0.x < -160 || d0.x > w + 160) {
        // Respawn across the whole screen (with margin) so rain doesn't bias to one side over time.
        d0.x = Math.random() * (w + 320) - 160;
        d0.y = -Math.random() * 220;
      }
    }
  }

  _stepSnow(dt, intensity01, screenW, screenH) {
    const w = Math.max(0, Number(screenW) || 0);
    const h = Math.max(0, Number(screenH) || 0);
    const area = Math.max(1, w * h);
    const base = Math.round((area / 16000) * 1.25 * intensity01);
    const target = intensity01 > 0 ? Math.max(26, base) : 0;

    ensureCount(this._snowFlakes, target, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      sp: 22 + Math.random() * 55,
      drift: 12 + Math.random() * 50,
      sz: 1 + Math.random() * 2.5,
      a: 0.35 + Math.random() * 0.5,
      phase: Math.random() * TAU,
    }));

    for (const f of this._snowFlakes) {
      const sway = Math.cos(this._t * 0.65 + f.phase) * f.drift;
      f.x += sway * dt;
      f.y += f.sp * dt;
      if (f.y > h + 40) {
        f.y = -Math.random() * 80;
        f.x = Math.random() * w;
      }
      if (f.x < -40) f.x += w + 80;
      if (f.x > w + 40) f.x -= w + 80;
    }
  }

  _stepSteam(dt, intensity01, screenW, screenH, viewBoundsWorld) {
    for (let i = this._steamPuffs.length - 1; i >= 0; i--) {
      const p = this._steamPuffs[i];
      p.t += dt;
      p.x += p.vx * dt + Math.cos(this._t * 0.9 + p.phase) * p.wobble * dt;
      p.y += p.vy * dt;
      if (p.t >= p.ttl) this._steamPuffs.splice(i, 1);
    }

    if (!(intensity01 > 0)) {
      this._steamSpawnBudget = 0;
      return;
    }

    const w = Math.max(0, Number(screenW) || 0);
    const h = Math.max(0, Number(screenH) || 0);
    const area = Math.max(1, w * h);
    const spawnRate = clamp((area / 650000) * 2.0, 0.8, 6.2); // puffs/sec
    this._steamSpawnBudget += spawnRate * dt;

    const b = viewBoundsWorld;
    if (!b) return;

    const left = Number(b.left) || 0;
    const right = Number(b.right) || 0;
    const top = Number(b.top) || 0;
    const bottom = Number(b.bottom) || 0;
    const maxPuffs = 34;

    while (this._steamSpawnBudget >= 1 && this._steamPuffs.length < maxPuffs) {
      this._steamSpawnBudget -= 1;
      const t = Math.random();
      const u = Math.random();
      const x = lerp(left, right, t);
      const y = lerp(top, bottom, u);
      const ttl = 2.2 + Math.random() * 2.3;
      this._steamPuffs.push({
        x,
        y,
        t: 0,
        ttl,
        vx: -8 + Math.random() * 16,
        vy: -18 - Math.random() * 32,
        wobble: 10 + Math.random() * 26,
        phase: Math.random() * TAU,
        size: 14 + Math.random() * 34,
      });
    }
  }

  drawMacroGroundOverlays(ctx, macroWorld, { startX, endX, startY, endY, tileSize, hasElevation } = {}) {
    if (!ctx) return;
    if (!(tileSize > 0)) return;
    if (!macroWorld) return;
    this._syncMacroSeed(macroWorld);

    const wet = clamp(this.wetness01, 0, 1);
    const snow = clamp(this.snowCover01, 0, 1);
    if (wet <= 0.01 && snow <= 0.01) return;

    const sX = startX | 0;
    const eX = endX | 0;
    const sY = startY | 0;
    const eY = endY | 0;

    // Snow cover (draw first so puddles can peek through on warm transitions).
    if (snow > 0.01) {
      ctx.save();
      ctx.fillStyle = "#ffffff";
      for (let ty = sY; ty <= eY; ty++) {
        for (let tx = sX; tx <= eX; tx++) {
          const hm = hasElevation ? Number(macroWorld.getElevationAtTile(tx, ty)) || 0 : 0;
          const seed = rand01FromHash(tileHash(tx, ty, this._macroSeed, 9101));
          const appear = clamp((snow - seed * 0.65) / 0.35, 0, 1);
          if (appear <= 0) continue;

          const x = tx * tileSize;
          const y = ty * tileSize;
          const aBase = hm > 0 ? 0.08 : 0.06;
          ctx.globalAlpha = aBase + 0.24 * appear;
          ctx.fillRect(x, y, tileSize, tileSize);

          // Soft drift at the bottom edge.
          const driftSeed = rand01FromHash(tileHash(tx, ty, this._macroSeed, 9107));
          const dx = (0.18 + 0.6 * driftSeed) * tileSize;
          const dy = (0.68 + 0.22 * rand01FromHash(tileHash(tx, ty, this._macroSeed, 9109))) * tileSize;
          const rx = (0.18 + 0.22 * rand01FromHash(tileHash(tx, ty, this._macroSeed, 9111))) * tileSize;
          const ry = (0.12 + 0.16 * rand01FromHash(tileHash(tx, ty, this._macroSeed, 9113))) * tileSize;
          ctx.globalAlpha = (0.03 + 0.11 * appear) * (0.85 + 0.25 * (1 - hm / 20));
          ctx.beginPath();
          ctx.ellipse(x + dx, y + dy, rx, ry, 0, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // Puddles (ground only).
    if (wet > 0.01) {
      ctx.save();
      ctx.fillStyle = "rgb(90,170,255)";
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      for (let ty = sY; ty <= eY; ty++) {
        for (let tx = sX; tx <= eX; tx++) {
          if (hasElevation) {
            const hm = Number(macroWorld.getElevationAtTile(tx, ty)) || 0;
            if (hm > 0) continue;
          }

          const seed = rand01FromHash(tileHash(tx, ty, this._macroSeed, 4201));
          const appear = clamp((wet - seed * 0.75) / 0.25, 0, 1);
          if (appear <= 0) continue;

          const x = tx * tileSize;
          const y = ty * tileSize;
          const rxSeed = rand01FromHash(tileHash(tx, ty, this._macroSeed, 4211));
          const rySeed = rand01FromHash(tileHash(tx, ty, this._macroSeed, 4213));
          const rot = (rand01FromHash(tileHash(tx, ty, this._macroSeed, 4217)) - 0.5) * 0.35;
          const cx = x + (0.22 + rxSeed * 0.58) * tileSize;
          const cy = y + (0.28 + rySeed * 0.5) * tileSize;
          const rBase = (0.11 + 0.18 * rand01FromHash(tileHash(tx, ty, this._macroSeed, 4221))) * tileSize;
          const r1 = rBase * (0.55 + 0.65 * appear);
          const r2 = r1 * (0.55 + 0.55 * rand01FromHash(tileHash(tx, ty, this._macroSeed, 4223)));

          ctx.globalAlpha = 0.04 + 0.22 * appear;
          ctx.beginPath();
          ctx.ellipse(cx, cy, r1, r2, rot, 0, TAU);
          ctx.fill();

          // Small highlight.
          ctx.globalAlpha = (0.02 + 0.07 * appear) * 0.9;
          ctx.beginPath();
          ctx.ellipse(cx - r1 * 0.18, cy - r2 * 0.18, r1 * 0.55, r2 * 0.45, rot, 0, TAU);
          ctx.fillStyle = "rgb(190,235,255)";
          ctx.fill();
          ctx.fillStyle = "rgb(90,170,255)";

          // Outline.
          ctx.globalAlpha = (0.02 + 0.09 * appear) * 0.8;
          ctx.lineWidth = Math.max(0.8, tileSize * 0.018);
          ctx.beginPath();
          ctx.ellipse(cx, cy, r1, r2, rot, 0, TAU);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  drawMacroWorldOverlay(ctx) {
    if (!ctx) return;
    if (!this._steamPuffs.length) return;

    ctx.save();
    for (const p of this._steamPuffs) {
      const u = clamp(p.t / Math.max(0.01, p.ttl), 0, 1);
      const fade = Math.pow(1 - u, 2);
      const rise = 1 + u * 0.5;
      const a = 0.22 * fade;
      if (a <= 0.001) continue;

      const r = p.size * rise;
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r * 0.9, r * 0.55, 0, 0, TAU);
      ctx.fill();

      ctx.globalAlpha = a * 0.7;
      ctx.beginPath();
      ctx.ellipse(p.x + r * 0.15, p.y + r * 0.1, r * 0.55, r * 0.38, 0.1, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawScreenOverlay(ctx, weatherKind, { screenW = 0, screenH = 0 } = {}) {
    if (!ctx) return;
    const w = Math.max(1, Number(screenW) || 1);
    const h = Math.max(1, Number(screenH) || 1);

    if (weatherKind === "rainy" && this._rainDrops.length) {
      ctx.save();
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(220,240,255,0.55)";
      ctx.lineWidth = 1.25;
      for (const d0 of this._rainDrops) {
        const speed = Math.max(1, Math.hypot(d0.vx, d0.vy));
        const dx = (d0.vx / speed) * d0.len;
        const dy = (d0.vy / speed) * d0.len;
        ctx.globalAlpha = clamp(d0.a, 0, 1) * 0.9;
        ctx.beginPath();
        ctx.moveTo(d0.x, d0.y);
        ctx.lineTo(d0.x - dx, d0.y - dy);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (weatherKind === "snowy" && this._snowFlakes.length) {
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      for (const f of this._snowFlakes) {
        ctx.globalAlpha = clamp(f.a, 0, 1) * 0.9;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.sz, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    if (weatherKind === "drought") {
      // Subtle warm haze overlay.
      ctx.save();
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = "rgb(255,215,160)";
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = "rgb(255,255,255)";
      const bands = 6;
      for (let i = 0; i < bands; i++) {
        const y = ((i + 0.2) / bands) * h + Math.sin(this._t * 0.9 + i * 1.7) * 6;
        ctx.fillRect(0, y, w, 12);
      }
      ctx.restore();
    }
  }
}
