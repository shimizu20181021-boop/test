import { MICRO_CONFIG } from "../core/config.js";
import { MicroEntity, createSpawnEntity, resolveRandomGeneKind } from "../logic/entities.js";

const MERGE_RITUAL_SECONDS = 1.0;
const MERGE_FAIL_RETURN_START = 0.9;
const MERGE_MAX_ACTIVE_RITUALS = 4;
const REINCARNATE_RITUAL_SECONDS = 1.0;

function splitByKindAndResolveRandom(genes) {
  const out = [];
  for (const g of genes) {
    if (g.kind === "random") out.push({ kind: resolveRandomGeneKind(), value: g.value });
    else out.push(g);
  }
  return out;
}

function computeReincarnationTraits({ staminaPct, healthPct, attackPct }) {
  const speedTrait = (() => {
    if (staminaPct >= 90) return { label: "超速", code: "S5" };
    if (staminaPct >= 70) return { label: "速", code: "S4" };
    if (staminaPct >= 30) return { label: "普", code: "S3" };
    if (staminaPct >= 10) return { label: "遅", code: "S2" };
    return { label: "鈍", code: "S1" };
  })();

  const bodyTrait = (() => {
    if (healthPct >= 90) return { label: "巨大", code: "B5" };
    if (healthPct >= 70) return { label: "大", code: "B4" };
    if (healthPct >= 30) return { label: "普", code: "B3" };
    if (healthPct >= 10) return { label: "小", code: "B2" };
    return { label: "極小", code: "B1" };
  })();

  const attackTrait = (() => {
    if (attackPct >= 90) return { label: "常攻", code: "A5" };
    if (attackPct >= 70) return { label: "空腹", code: "A4" };
    if (attackPct >= 30) return { label: "瀕40", code: "A3" };
    if (attackPct >= 10) return { label: "瀕20", code: "A2" };
    return { label: "不攻", code: "A1" };
  })();

  return { speedTrait, bodyTrait, attackTrait };
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeInOutCubic(t) {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function easeOutQuad(t) {
  const x = clamp01(t);
  return 1 - (1 - x) * (1 - x);
}

export class MicroWorld {
  constructor() {
    this.entities = [];
    this._collidingPairs = new Set();
    this._tickRate = 30;
    this._accumulatorSeconds = 0;
    this._bounds = { width: 800, height: 600 };
    this._reincarnationSeq = 0;
    this._mergeChance = MICRO_CONFIG.mergeChance;
    this._mergeCooldownSeconds = MICRO_CONFIG.mergeCooldownSeconds;
    this._mergeRitualSeconds = MERGE_RITUAL_SECONDS;
    this._visualRadiusSmoothing = 2.7;
    this._reincarnationIndividuals = MICRO_CONFIG.maxIndividuals;
    this._geneWeights = { stamina: 1, health: 1, attack: 1, random: 1 };
    this._mergeEnabled = true;

    this._populationTarget = 120;
    this._spawnPerSecond = 18;
    this._spawnBudget = 0;
    this._despawnBudget = 0;

    this._mergeRituals = [];
    this._reincarnateRituals = [];
    this._microFx = [];

    this._reincarnations = [];
  }

  setPopulationTarget(target, spawnPerSecond) {
    this._populationTarget = Math.max(0, Math.floor(target));
    this._spawnPerSecond = Math.max(0, spawnPerSecond);
    const deficit = this._populationTarget - this.entities.length;
    if (deficit > 0) this._spawnBudget = Math.max(this._spawnBudget, deficit);
  }

  setBounds({ width, height }) {
    this._bounds = {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height)),
    };
  }

  setTickRate(updatesPerSecond) {
    this._tickRate = Math.max(1, Math.floor(updatesPerSecond));
  }

  setMergeChance(chance) {
    const n = Number(chance);
    if (Number.isFinite(n)) this._mergeChance = Math.max(0, Math.min(1, n));
  }

  setMergeCooldownSeconds(seconds) {
    const n = Number(seconds);
    if (!Number.isFinite(n)) return;
    this._mergeCooldownSeconds = Math.max(1, Math.min(30, n));
  }

  setMergeRitualSeconds(seconds) {
    const n = Number(seconds);
    if (!Number.isFinite(n)) return;
    this._mergeRitualSeconds = Math.max(0.3, Math.min(2.0, n));
  }

  setVisualRadiusSmoothing(rate) {
    const n = Number(rate);
    if (!Number.isFinite(n)) return;
    this._visualRadiusSmoothing = Math.max(0.5, Math.min(8.0, n));
  }

  setReincarnationIndividuals(count) {
    const n = Number.parseInt(String(count), 10);
    if (!Number.isFinite(n)) return;
    this._reincarnationIndividuals = Math.max(5, Math.min(100, n));
  }

  setGeneSpawnWeights(weights) {
    if (!weights || typeof weights !== "object") return;
    this._geneWeights = {
      stamina: Number(weights.stamina) || 0,
      health: Number(weights.health) || 0,
      attack: Number(weights.attack) || 0,
      random: Number(weights.random) || 0,
    };
  }

  getTickRate() {
    return this._tickRate;
  }

  getEntityCount() {
    return this.entities.length;
  }

  getPopulationTarget() {
    return this._populationTarget;
  }

  getMergeChance() {
    return this._mergeChance;
  }

  getMergeCooldownSeconds() {
    return this._mergeCooldownSeconds;
  }

  getMergeRitualSeconds() {
    return this._mergeRitualSeconds;
  }

  getVisualRadiusSmoothing() {
    return this._visualRadiusSmoothing;
  }

  getReincarnationIndividuals() {
    return this._reincarnationIndividuals;
  }

  setMergeEnabled(enabled) {
    this._mergeEnabled = Boolean(enabled);
  }

  isMergeEnabled() {
    return this._mergeEnabled;
  }

  getRecentReincarnations(max = 5) {
    return this._reincarnations.slice(0, max);
  }

  getMergeRituals() {
    return this._mergeRituals;
  }

  getReincarnateRituals() {
    return this._reincarnateRituals;
  }

  getMicroFx() {
    return this._microFx;
  }

  update(dt) {
    const { width, height } = this._bounds;

    this._spawnBudget += this._spawnPerSecond * dt;
    while (this.entities.length < this._populationTarget && this._spawnBudget >= 1) {
      this.entities.push(createSpawnEntity({ width, height, geneWeights: this._geneWeights }));
      this._spawnBudget -= 1;
    }

    const over = this.entities.length - this._populationTarget;
    if (over > 0) {
      this._despawnBudget += over * dt * 0.35;
      while (this.entities.length > this._populationTarget && this._despawnBudget >= 1) {
        const locked = new Set();
        for (const r of this._mergeRituals) {
          locked.add(r.aId);
          locked.add(r.bId);
        }
        let removed = false;
        for (let i = this.entities.length - 1; i >= 0; i--) {
          const e = this.entities[i];
          if (!e || locked.has(e.id)) continue;
          this.entities.splice(i, 1);
          removed = true;
          break;
        }
        if (!removed) break;
        this._despawnBudget -= 1;
      }
    } else {
      this._despawnBudget = 0;
    }

    this._accumulatorSeconds += dt;
    const step = 1 / this._tickRate;
    const maxSteps = 8;
    let steps = 0;
    while (this._accumulatorSeconds >= step && steps < maxSteps) {
      this._step(step);
      this._accumulatorSeconds -= step;
      steps++;
    }
    if (steps >= maxSteps) this._accumulatorSeconds = 0;
  }

  _step(dt) {
    for (const e of this.entities) e.tickCooldown(dt);

    // Smooth visual size changes (so merges feel like stars grow gradually).
    // This does not affect logic/collision, only rendering.
    const sizeEase = 1 - Math.exp(-this._visualRadiusSmoothing * dt);
    for (const e of this.entities) {
      const target = Number(e?.radius) || 0;
      const current = Number(e?._visualRadius);
      if (!Number.isFinite(current) || current <= 0) e._visualRadius = target;
      else e._visualRadius = current + (target - current) * sizeEase;
    }

    const byId = new Map(this.entities.map((e) => [e.id, e]));

    // Micro FX (merge flash/rings etc).
    if (this._microFx.length) {
      const nextFx = [];
      for (const fx of this._microFx) {
        fx.t = (fx.t ?? 0) + dt;
        if ((fx.t ?? 0) < (fx.duration ?? 0.35)) nextFx.push(fx);
      }
      this._microFx = nextFx;
    }

    // Update active merge rituals (animate positions + apply outcome at the end).
    if (this._mergeRituals.length) {
      const active = [];
      for (const r of this._mergeRituals) {
        const a = byId.get(r.aId);
        const b = byId.get(r.bId);
        if (!a || !b) continue;

        const dur = Math.max(0.05, Number(r.duration) || this._mergeRitualSeconds || MERGE_RITUAL_SECONDS);
        r.t = (r.t ?? 0) + dt;
        const tt = clamp01((r.t ?? 0) / dur);

        if (r.success) {
          const e = easeInOutCubic(tt);
          a.x = lerp(r.ax0, r.mx, e);
          a.y = lerp(r.ay0, r.my, e);
          b.x = lerp(r.bx0, r.mx, e);
          b.y = lerp(r.by0, r.my, e);
        } else {
          if (tt <= MERGE_FAIL_RETURN_START) {
            const u = tt / MERGE_FAIL_RETURN_START;
            const e = easeInOutCubic(u);
            a.x = lerp(r.ax0, r.mx, e);
            a.y = lerp(r.ay0, r.my, e);
            b.x = lerp(r.bx0, r.mx, e);
            b.y = lerp(r.by0, r.my, e);
          } else {
            const u = (tt - MERGE_FAIL_RETURN_START) / (1 - MERGE_FAIL_RETURN_START);
            const e = easeOutQuad(u);
            a.x = lerp(r.mx, r.ax0, e);
            a.y = lerp(r.my, r.ay0, e);
            b.x = lerp(r.mx, r.bx0, e);
            b.y = lerp(r.my, r.by0, e);
          }
        }

        if ((r.t ?? 0) >= dur) {
          if (r.success) {
            const mergedGenes = r.mergedGenes || splitByKindAndResolveRandom([...a.genes, ...b.genes]);
            byId.delete(a.id);
            byId.delete(b.id);

            const merged = new MicroEntity({ x: r.mx, y: r.my, vx: 0, vy: 0, genes: mergedGenes });
            const av = Number(a?._visualRadius) || Number(a.radius) || 0;
            const bv = Number(b?._visualRadius) || Number(b.radius) || 0;
            if (av > 0 && bv > 0) merged._visualRadius = (av + bv) / 2;
            this._microFx.push({ type: "mergeSuccess", x: r.mx, y: r.my, t: 0, duration: 0.35 });

            if (merged.individualCount === this._reincarnationIndividuals) {
              this._startReincarnateRitual(merged, { x: r.mx, y: r.my });
            } else {
              byId.set(merged.id, merged);
            }
          } else {
            a.x = r.ax0;
            a.y = r.ay0;
            b.x = r.bx0;
            b.y = r.by0;
            a.setCooldown(this._mergeCooldownSeconds);
            b.setCooldown(this._mergeCooldownSeconds);
            this._microFx.push({ type: "mergeFail", x: r.mx, y: r.my, t: 0, duration: 0.28 });
          }
        } else {
          active.push(r);
        }
      }
      this._mergeRituals = active;
    }

    // Reincarnation birth ritual (special "hatching" moment when reaching 30).
    if (this._reincarnateRituals.length) {
      const next = [];
      for (const rr of this._reincarnateRituals) {
        rr.t = (rr.t ?? 0) + dt;
        if ((rr.t ?? 0) >= REINCARNATE_RITUAL_SECONDS) {
          if (rr.entity) this._reincarnate(rr.entity);
          this._microFx.push({ type: "reincarnate", x: rr.x, y: rr.y, t: 0, duration: 0.65 });
        } else {
          next.push(rr);
        }
      }
      this._reincarnateRituals = next;
    }

    if (this._mergeEnabled) this._attemptNearestMerge(byId);

    this.entities = Array.from(byId.values());
  }

  _startReincarnateRitual(entity, { x, y }) {
    const ex = Number(x) || Number(entity?.x) || 0;
    const ey = Number(y) || Number(entity?.y) || 0;
    if (entity) {
      entity.x = ex;
      entity.y = ey;
      entity._visualRadius = Number(entity.radius) || entity._visualRadius || 0;
    }

    const points = [];
    const count = 14;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const dist = 42 + Math.random() * 120;
      points.push({ dx: Math.cos(a) * dist, dy: Math.sin(a) * dist, w: 0.4 + Math.random() * 0.8 });
    }

    this._reincarnateRituals.push({
      x: ex,
      y: ey,
      t: 0,
      entity,
      points,
    });
  }

  _attemptNearestMerge(byId) {
    if (this._mergeRituals.length >= MERGE_MAX_ACTIVE_RITUALS) return;
    if (byId.size < 2) return;

    const cellSize = MICRO_CONFIG.collisionGridCellSize;
    const grid = new Map();
    for (const e of byId.values()) {
      const cx = Math.floor(e.x / cellSize);
      const cy = Math.floor(e.y / cellSize);
      const key = `${cx},${cy}`;
      const cell = grid.get(key) || [];
      cell.push(e.id);
      grid.set(key, cell);
    }

    let bestPair = null;
    let bestD2 = Infinity;
    const scanRange = 4;

    const locked = new Set();
    for (const r of this._mergeRituals) {
      locked.add(r.aId);
      locked.add(r.bId);
    }

    for (const e of byId.values()) {
      if (e.isOnCooldown()) continue;
      if (locked.has(e.id)) continue;
      const cx = Math.floor(e.x / cellSize);
      const cy = Math.floor(e.y / cellSize);

      for (let dy = -scanRange; dy <= scanRange; dy++) {
        for (let dx = -scanRange; dx <= scanRange; dx++) {
          const key = `${cx + dx},${cy + dy}`;
          const cell = grid.get(key);
          if (!cell) continue;
          for (const otherId of cell) {
            if (otherId <= e.id) continue;
            const o = byId.get(otherId);
            if (!o || o.isOnCooldown()) continue;
            if (locked.has(o.id)) continue;
            const dxp = o.x - e.x;
            const dyp = o.y - e.y;
            const d2 = dxp * dxp + dyp * dyp;
            if (d2 < bestD2) {
              bestD2 = d2;
              bestPair = [e.id, otherId];
            }
          }
        }
      }
    }

    if (!bestPair) return;
    const a = byId.get(bestPair[0]);
    const b = byId.get(bestPair[1]);
    if (!a || !b) return;
    this._handleNearestPair(a, b);
  }

  _handleNearestPair(a, b) {
    if (a.isOnCooldown() || b.isOnCooldown()) return;

    const combinedIndividuals = a.individualCount + b.individualCount;
    const canMerge = combinedIndividuals <= this._reincarnationIndividuals;
    const success = canMerge && Math.random() < this._mergeChance;

    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    this._mergeRituals.push({
      aId: a.id,
      bId: b.id,
      ax0: a.x,
      ay0: a.y,
      bx0: b.x,
      by0: b.y,
      mx,
      my,
      t: 0,
      duration: this._mergeRitualSeconds,
      success,
      mergedGenes: success ? splitByKindAndResolveRandom([...a.genes, ...b.genes]) : null,
    });
  }

  _buildGrid(cellSize) {
    const grid = new Map();
    for (const e of this.entities) {
      const cx = Math.floor(e.x / cellSize);
      const cy = Math.floor(e.y / cellSize);
      const key = `${cx},${cy}`;
      const cell = grid.get(key) || [];
      cell.push(e.id);
      grid.set(key, cell);
    }
    return { grid, cellSize };
  }

  // (collision-based merging was replaced by nearest-pair merging)

  _reincarnate(entity) {
    let stamina = 0;
    let health = 0;
    let attack = 0;
    let total = 0;
    for (const g of entity.genes) {
      total += g.value;
      if (g.kind === "stamina") stamina += g.value;
      else if (g.kind === "health") health += g.value;
      else if (g.kind === "attack") attack += g.value;
    }

    if (total <= 0) total = 1;
    const staminaPct = Math.round((stamina / total) * 100);
    const healthPct = Math.round((health / total) * 100);
    const attackPct = Math.max(0, 100 - staminaPct - healthPct);

    const traits = computeReincarnationTraits({ staminaPct, healthPct, attackPct });
    const summary = `転生#${this._reincarnationSeq + 1}  スタ${staminaPct}% 体${healthPct}% 攻${attackPct}%  |  速:${traits.speedTrait.label}  体:${traits.bodyTrait.label}  攻:${traits.attackTrait.label}`;

    this._reincarnations.unshift({
      id: ++this._reincarnationSeq,
      at: Date.now(),
      staminaPct,
      healthPct,
      attackPct,
      traits,
      summary,
    });
  }
}
