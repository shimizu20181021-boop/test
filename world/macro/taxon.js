export const CREATURE_TAXON = { mammal: "mammal", bird: "bird" };

export const BIRD_DESIGN_IDS = new Set(["herb_pigeon", "omn_crow", "pred_owl"]);

export function taxonFromDesignId(designId) {
  const id = String(designId || "");
  return BIRD_DESIGN_IDS.has(id) ? CREATURE_TAXON.bird : CREATURE_TAXON.mammal;
}

export function taxonForEntity(entity) {
  const t = entity?.taxon;
  if (t === CREATURE_TAXON.bird || t === CREATURE_TAXON.mammal) return t;
  return taxonFromDesignId(entity?.designId);
}

export function isBirdEntity(entity) {
  return taxonForEntity(entity) === CREATURE_TAXON.bird;
}

