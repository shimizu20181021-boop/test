import { MICRO_CONFIG } from "../core/config.js";
import { chooseOne, randFloat, randIntInclusive } from "../core/utils.js";

export const GENE_KIND = {
  stamina: "stamina",
  health: "health",
  attack: "attack",
  random: "random",
};

const SPAWN_KINDS = [GENE_KIND.stamina, GENE_KIND.health, GENE_KIND.attack, GENE_KIND.random];

let nextEntityId = 1;

function chooseWeighted(pairs) {
  let total = 0;
  for (const [, w] of pairs) total += Math.max(0, w);
  if (total <= 0) return pairs[0]?.[0] ?? GENE_KIND.stamina;
  let r = Math.random() * total;
  for (const [k, w] of pairs) {
    const ww = Math.max(0, w);
    if (r < ww) return k;
    r -= ww;
  }
  return pairs[pairs.length - 1]?.[0] ?? GENE_KIND.stamina;
}

export function createRandomGene(weights) {
  const w = weights || { stamina: 1, health: 1, attack: 1, random: 1 };
  const kind = chooseWeighted([
    [GENE_KIND.stamina, w.stamina ?? 1],
    [GENE_KIND.health, w.health ?? 1],
    [GENE_KIND.attack, w.attack ?? 1],
    [GENE_KIND.random, w.random ?? 1],
  ]);
  const value = randIntInclusive(1, 10);
  return { kind, value };
}

export function resolveRandomGeneKind() {
  return chooseOne(MICRO_CONFIG.randomGeneOptions);
}

export class MicroEntity {
  constructor({ x, y, vx, vy, genes }) {
    this.id = nextEntityId++;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.genes = genes;
    this.cooldownSeconds = 0;
  }

  get individualCount() {
    return this.genes.length;
  }

  get totalValue() {
    let sum = 0;
    for (const g of this.genes) sum += g.value;
    return sum;
  }

  get radius() {
    const count = this.individualCount;
    const avgValue = this.totalValue / Math.max(1, count);
    return 6 + Math.sqrt(count) * 3.2 + avgValue * 0.7;
  }

  getDominantKind() {
    const totals = { stamina: 0, health: 0, attack: 0, random: 0 };
    for (const g of this.genes) totals[g.kind] += g.value;
    let best = "stamina";
    let bestVal = -1;
    for (const k of Object.keys(totals)) {
      if (totals[k] > bestVal) {
        bestVal = totals[k];
        best = k;
      }
    }
    return best;
  }

  tickCooldown(dt) {
    this.cooldownSeconds = Math.max(0, this.cooldownSeconds - dt);
  }

  isOnCooldown() {
    return this.cooldownSeconds > 0;
  }

  setCooldown(seconds) {
    this.cooldownSeconds = Math.max(this.cooldownSeconds, seconds);
  }
}

export function createSpawnEntity({ width, height, geneWeights }) {
  const pad = MICRO_CONFIG.boundsPadding;
  const x = randFloat(pad, Math.max(pad + 1, width - pad));
  const y = randFloat(pad, Math.max(pad + 1, height - pad));
  return new MicroEntity({ x, y, vx: 0, vy: 0, genes: [createRandomGene(geneWeights)] });
}
