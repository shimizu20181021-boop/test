import { DEFAULT_SETTINGS } from "../core/config.js";

function selectRadio(name, value) {
  const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (el) el.checked = true;
}

function getSelectedRadio(name, fallback) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  if (!el) return fallback;
  return el.value;
}

function clampInt(value, min, max) {
  const n = Number.parseInt(String(value), 10);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function clampFloat(value, min, max) {
  const n = Number.parseFloat(String(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function bindSettingsUI({ getSettings, getViewMode, setPaused, applySettings }) {
  const FITNESS_WEIGHT_LEVEL = { low: 30, medium: 60, high: 120 };
  const POP_CAP_OPTIONS = new Set([300, 500, 800, 1000]);
  const normalizePopCap = (value, fallback) => {
    const n = clampInt(value, 1, 10000);
    return POP_CAP_OPTIONS.has(n) ? n : fallback;
  };
  const openButton = document.getElementById("settings-open");
  const openEnvButton = document.getElementById("settings-open-env");
  const openLifeButton = document.getElementById("settings-open-life");
  const openLearningButton = document.getElementById("settings-open-learning");
  const modal = document.getElementById("settings-modal");
  const panel = document.getElementById("settings-panel");
  const title = document.getElementById("settings-title");
  const applyButton = document.getElementById("settings-apply");
  const backdrop = document.getElementById("settings-backdrop");
  const reincarnationRange = document.getElementById("reincarnation-count");
  const reincarnationValue = document.getElementById("reincarnation-count-value");
  const microMergeCooldownRange = document.getElementById("micro-merge-cooldown");
  const microMergeCooldownValue = document.getElementById("micro-merge-cooldown-value");
  const microStarScaleRange = document.getElementById("micro-star-scale");
  const microStarScaleValue = document.getElementById("micro-star-scale-value");
  const microGrowthSpeedRange = document.getElementById("micro-growth-speed");
  const microGrowthSpeedValue = document.getElementById("micro-growth-speed-value");
  const microMergeRitualRange = document.getElementById("micro-merge-ritual");
  const microMergeRitualValue = document.getElementById("micro-merge-ritual-value");
  const microGalaxyStrengthRange = document.getElementById("micro-galaxy-strength");
  const microGalaxyStrengthValue = document.getElementById("micro-galaxy-strength-value");
  const microGalaxyStartRange = document.getElementById("micro-galaxy-start");
  const microGalaxyStartValue = document.getElementById("micro-galaxy-start-value");
  const microDebugCheckbox = document.getElementById("micro-debug");
  const macroAnimalCapRange = document.getElementById("macro-animal-cap");
  const macroAnimalCapValue = document.getElementById("macro-animal-cap-value");
  const macroPlantReproMaxRange = document.getElementById("macro-plant-repro-max");
  const macroPlantReproMaxValue = document.getElementById("macro-plant-repro-max-value");
  const macroMeatHungerRecoverRange = document.getElementById("macro-meat-hunger-recover");
  const macroMeatHungerRecoverValue = document.getElementById("macro-meat-hunger-recover-value");
  const macroPlantHungerRecoverMulRange = document.getElementById("macro-plant-hunger-recover-mul");
  const macroPlantHungerRecoverMulValue = document.getElementById("macro-plant-hunger-recover-mul-value");
  const macroPlantStaminaMulRange = document.getElementById("macro-plant-stamina-mul");
  const macroPlantStaminaMulValue = document.getElementById("macro-plant-stamina-mul-value");
  const macroPlantLifeMinutesRange = document.getElementById("macro-plant-life-minutes");
  const macroPlantLifeMinutesValue = document.getElementById("macro-plant-life-minutes-value");
  const macroHerbStaminaMulRange = document.getElementById("macro-herb-stamina-mul");
  const macroHerbStaminaMulValue = document.getElementById("macro-herb-stamina-mul-value");
  const macroHerbLifeMinutesRange = document.getElementById("macro-herb-life-minutes");
  const macroHerbLifeMinutesValue = document.getElementById("macro-herb-life-minutes-value");
  const macroHerbHungerDecayMulRange = document.getElementById("macro-herb-hunger-decay-mul");
  const macroHerbHungerDecayMulValue = document.getElementById("macro-herb-hunger-decay-mul-value");
  const macroOmniStaminaMulRange = document.getElementById("macro-omni-stamina-mul");
  const macroOmniStaminaMulValue = document.getElementById("macro-omni-stamina-mul-value");
  const macroOmniLifeMinutesRange = document.getElementById("macro-omni-life-minutes");
  const macroOmniLifeMinutesValue = document.getElementById("macro-omni-life-minutes-value");
  const macroOmniHungerDecayMulRange = document.getElementById("macro-omni-hunger-decay-mul");
  const macroOmniHungerDecayMulValue = document.getElementById("macro-omni-hunger-decay-mul-value");
  const macroCarnStaminaMulRange = document.getElementById("macro-carn-stamina-mul");
  const macroCarnStaminaMulValue = document.getElementById("macro-carn-stamina-mul-value");
  const macroCarnLifeMinutesRange = document.getElementById("macro-carn-life-minutes");
  const macroCarnLifeMinutesValue = document.getElementById("macro-carn-life-minutes-value");
  const macroCarnHungerDecayMulRange = document.getElementById("macro-carn-hunger-decay-mul");
  const macroCarnHungerDecayMulValue = document.getElementById("macro-carn-hunger-decay-mul-value");
  const macroCarnAttackMulRange = document.getElementById("macro-carn-attack-mul");
  const macroCarnAttackMulValue = document.getElementById("macro-carn-attack-mul-value");
  const fitnessWeightFieldset = document.getElementById("fitness-weight-fieldset");
  const sectionMicro = document.getElementById("settings-section-micro");
  const sectionMacro = document.getElementById("settings-section-macro");
  const macroEnvSection = document.getElementById("settings-macro-env");
  const macroLifeSection = document.getElementById("settings-macro-life");
  const macroLearningSection = document.getElementById("settings-macro-learning");

  let macroTab = "env";

  function setMacroTab(next) {
    const t = next === "env" || next === "life" || next === "learning" ? next : "env";
    macroTab = t;
    if (macroEnvSection) macroEnvSection.classList.toggle("hidden", t !== "env");
    if (macroLifeSection) macroLifeSection.classList.toggle("hidden", t !== "life");
    if (macroLearningSection) macroLearningSection.classList.toggle("hidden", t !== "learning");

    if (title) {
      if (t === "env") title.textContent = "設定（環境設定）";
      else if (t === "life") title.textContent = "設定（生物・植物設定）";
      else title.textContent = "設定（学習設定）";
    }
  }

  function fitnessLevelFromWeight(weight) {
    const w = Number(weight);
    if (!Number.isFinite(w)) return "medium";
    let best = "medium";
    let bestDiff = Infinity;
    for (const [level, x] of Object.entries(FITNESS_WEIGHT_LEVEL)) {
      const diff = Math.abs(w - Number(x));
      if (diff < bestDiff) {
        best = level;
        bestDiff = diff;
      }
    }
    return best;
  }

  function syncRangeLabel() {
    if (!reincarnationRange || !reincarnationValue) return;
    reincarnationValue.textContent = String(reincarnationRange.value);
  }

  function syncMicroMergeCooldownLabel() {
    if (!microMergeCooldownRange || !microMergeCooldownValue) return;
    const v = clampInt(microMergeCooldownRange.value, 1, 30);
    microMergeCooldownValue.textContent = `${v}秒`;
  }

  function syncMicroStarScaleLabel() {
    if (!microStarScaleRange || !microStarScaleValue) return;
    const v = clampFloat(microStarScaleRange.value, 0.6, 3.0);
    microStarScaleValue.textContent = `×${v.toFixed(1)}`;
  }

  function syncMicroGrowthSpeedLabel() {
    if (!microGrowthSpeedRange || !microGrowthSpeedValue) return;
    const v = clampFloat(microGrowthSpeedRange.value, 0.5, 8.0);
    microGrowthSpeedValue.textContent = v.toFixed(1);
  }

  function syncMicroMergeRitualLabel() {
    if (!microMergeRitualRange || !microMergeRitualValue) return;
    const v = clampFloat(microMergeRitualRange.value, 0.3, 2.0);
    microMergeRitualValue.textContent = `${v.toFixed(1)}秒`;
  }

  function syncMicroGalaxyStrengthLabel() {
    if (!microGalaxyStrengthRange || !microGalaxyStrengthValue) return;
    const v = clampFloat(microGalaxyStrengthRange.value, 0, 1);
    microGalaxyStrengthValue.textContent = `${Math.round(v * 100)}%`;
  }

  function syncMicroGalaxyStartLabel() {
    if (!microGalaxyStartRange || !microGalaxyStartValue) return;
    const v = clampInt(microGalaxyStartRange.value, 10, 90);
    microGalaxyStartValue.textContent = `${v}%`;
  }

  function syncMacroCapLabel() {
    if (!macroAnimalCapRange || !macroAnimalCapValue) return;
    macroAnimalCapValue.textContent = String(macroAnimalCapRange.value);
  }

  function syncMacroPlantReproMaxLabel() {
    if (!macroPlantReproMaxRange || !macroPlantReproMaxValue) return;
    macroPlantReproMaxValue.textContent = String(macroPlantReproMaxRange.value);
  }

  function syncMacroMeatHungerRecoverLabel() {
    if (!macroMeatHungerRecoverRange || !macroMeatHungerRecoverValue) return;
    macroMeatHungerRecoverValue.textContent = `${macroMeatHungerRecoverRange.value}%`;
  }

  function syncMacroPlantHungerRecoverMulLabel() {
    if (!macroPlantHungerRecoverMulRange || !macroPlantHungerRecoverMulValue) return;
    const v = clampFloat(macroPlantHungerRecoverMulRange.value, 0.2, 3.0);
    macroPlantHungerRecoverMulValue.textContent = `×${v.toFixed(1)}`;
  }

  function syncMacroPlantStaminaMulLabel() {
    if (!macroPlantStaminaMulRange || !macroPlantStaminaMulValue) return;
    const v = clampFloat(macroPlantStaminaMulRange.value, 0.5, 3.0);
    macroPlantStaminaMulValue.textContent = `×${v.toFixed(1)}`;
  }

  function syncMacroPlantLifeMinutesLabel() {
    if (!macroPlantLifeMinutesRange || !macroPlantLifeMinutesValue) return;
    const v = clampInt(macroPlantLifeMinutesRange.value, 0, 30);
    macroPlantLifeMinutesValue.textContent = v <= 0 ? "なし" : `${v}分`;
  }

  function syncMacroHerbStaminaMulLabel() {
    if (!macroHerbStaminaMulRange || !macroHerbStaminaMulValue) return;
    const v = clampFloat(macroHerbStaminaMulRange.value, 0.5, 3.0);
    macroHerbStaminaMulValue.textContent = `×${v.toFixed(1)}`;
  }

  function syncMacroHerbLifeMinutesLabel() {
    if (!macroHerbLifeMinutesRange || !macroHerbLifeMinutesValue) return;
    const v = clampInt(macroHerbLifeMinutesRange.value, 1, 30);
    macroHerbLifeMinutesValue.textContent = `${v}分`;
  }

  function syncMacroHerbHungerDecayMulLabel() {
    if (!macroHerbHungerDecayMulRange || !macroHerbHungerDecayMulValue) return;
    const v = clampFloat(macroHerbHungerDecayMulRange.value, 0.1, 3.0);
    macroHerbHungerDecayMulValue.textContent = `×${v.toFixed(1)}`;
  }

  function syncMacroOmniStaminaMulLabel() {
    if (!macroOmniStaminaMulRange || !macroOmniStaminaMulValue) return;
    const v = clampFloat(macroOmniStaminaMulRange.value, 0.5, 3.0);
    macroOmniStaminaMulValue.textContent = `×${v.toFixed(1)}`;
  }

  function syncMacroOmniLifeMinutesLabel() {
    if (!macroOmniLifeMinutesRange || !macroOmniLifeMinutesValue) return;
    const v = clampInt(macroOmniLifeMinutesRange.value, 1, 30);
    macroOmniLifeMinutesValue.textContent = `${v}分`;
  }

  function syncMacroOmniHungerDecayMulLabel() {
    if (!macroOmniHungerDecayMulRange || !macroOmniHungerDecayMulValue) return;
    const v = clampFloat(macroOmniHungerDecayMulRange.value, 0.1, 3.0);
    macroOmniHungerDecayMulValue.textContent = `×${v.toFixed(1)}`;
  }

  function syncMacroCarnStaminaMulLabel() {
    if (!macroCarnStaminaMulRange || !macroCarnStaminaMulValue) return;
    const v = clampFloat(macroCarnStaminaMulRange.value, 0.5, 3.0);
    macroCarnStaminaMulValue.textContent = `×${v.toFixed(1)}`;
  }

  function syncMacroCarnLifeMinutesLabel() {
    if (!macroCarnLifeMinutesRange || !macroCarnLifeMinutesValue) return;
    const v = clampInt(macroCarnLifeMinutesRange.value, 1, 30);
    macroCarnLifeMinutesValue.textContent = `${v}分`;
  }

  function syncMacroCarnHungerDecayMulLabel() {
    if (!macroCarnHungerDecayMulRange || !macroCarnHungerDecayMulValue) return;
    const v = clampFloat(macroCarnHungerDecayMulRange.value, 0.1, 3.0);
    macroCarnHungerDecayMulValue.textContent = `×${v.toFixed(1)}`;
  }

  function syncMacroCarnAttackMulLabel() {
    if (!macroCarnAttackMulRange || !macroCarnAttackMulValue) return;
    const v = clampFloat(macroCarnAttackMulRange.value, 1.0, 10.0);
    macroCarnAttackMulValue.textContent = `×${v.toFixed(1)}`;
  }

  function syncFitnessEnabled() {
    const mode = getSelectedRadio("evolution-mode", DEFAULT_SETTINGS.macroEvolutionMode);
    const enabled = mode !== "natural";
    if (fitnessWeightFieldset) fitnessWeightFieldset.disabled = !enabled;
  }

  if (reincarnationRange) {
    reincarnationRange.addEventListener("input", syncRangeLabel);
    syncRangeLabel();
  }
  if (microMergeCooldownRange) {
    microMergeCooldownRange.addEventListener("input", syncMicroMergeCooldownLabel);
    syncMicroMergeCooldownLabel();
  }
  if (microStarScaleRange) {
    microStarScaleRange.addEventListener("input", syncMicroStarScaleLabel);
    syncMicroStarScaleLabel();
  }
  if (microGrowthSpeedRange) {
    microGrowthSpeedRange.addEventListener("input", syncMicroGrowthSpeedLabel);
    syncMicroGrowthSpeedLabel();
  }
  if (microMergeRitualRange) {
    microMergeRitualRange.addEventListener("input", syncMicroMergeRitualLabel);
    syncMicroMergeRitualLabel();
  }
  if (microGalaxyStrengthRange) {
    microGalaxyStrengthRange.addEventListener("input", syncMicroGalaxyStrengthLabel);
    syncMicroGalaxyStrengthLabel();
  }
  if (microGalaxyStartRange) {
    microGalaxyStartRange.addEventListener("input", syncMicroGalaxyStartLabel);
    syncMicroGalaxyStartLabel();
  }
  if (macroAnimalCapRange) {
    macroAnimalCapRange.addEventListener("input", syncMacroCapLabel);
    syncMacroCapLabel();
  }
  if (macroPlantReproMaxRange) {
    macroPlantReproMaxRange.addEventListener("input", syncMacroPlantReproMaxLabel);
    syncMacroPlantReproMaxLabel();
  }
  if (macroMeatHungerRecoverRange) {
    macroMeatHungerRecoverRange.addEventListener("input", syncMacroMeatHungerRecoverLabel);
    syncMacroMeatHungerRecoverLabel();
  }
  if (macroPlantHungerRecoverMulRange) {
    macroPlantHungerRecoverMulRange.addEventListener("input", syncMacroPlantHungerRecoverMulLabel);
    syncMacroPlantHungerRecoverMulLabel();
  }
  if (macroPlantStaminaMulRange) {
    macroPlantStaminaMulRange.addEventListener("input", syncMacroPlantStaminaMulLabel);
    syncMacroPlantStaminaMulLabel();
  }
  if (macroPlantLifeMinutesRange) {
    macroPlantLifeMinutesRange.addEventListener("input", syncMacroPlantLifeMinutesLabel);
    syncMacroPlantLifeMinutesLabel();
  }
  if (macroHerbStaminaMulRange) {
    macroHerbStaminaMulRange.addEventListener("input", syncMacroHerbStaminaMulLabel);
    syncMacroHerbStaminaMulLabel();
  }
  if (macroHerbLifeMinutesRange) {
    macroHerbLifeMinutesRange.addEventListener("input", syncMacroHerbLifeMinutesLabel);
    syncMacroHerbLifeMinutesLabel();
  }
  if (macroHerbHungerDecayMulRange) {
    macroHerbHungerDecayMulRange.addEventListener("input", syncMacroHerbHungerDecayMulLabel);
    syncMacroHerbHungerDecayMulLabel();
  }
  if (macroOmniStaminaMulRange) {
    macroOmniStaminaMulRange.addEventListener("input", syncMacroOmniStaminaMulLabel);
    syncMacroOmniStaminaMulLabel();
  }
  if (macroOmniLifeMinutesRange) {
    macroOmniLifeMinutesRange.addEventListener("input", syncMacroOmniLifeMinutesLabel);
    syncMacroOmniLifeMinutesLabel();
  }
  if (macroOmniHungerDecayMulRange) {
    macroOmniHungerDecayMulRange.addEventListener("input", syncMacroOmniHungerDecayMulLabel);
    syncMacroOmniHungerDecayMulLabel();
  }
  if (macroCarnStaminaMulRange) {
    macroCarnStaminaMulRange.addEventListener("input", syncMacroCarnStaminaMulLabel);
    syncMacroCarnStaminaMulLabel();
  }
  if (macroCarnLifeMinutesRange) {
    macroCarnLifeMinutesRange.addEventListener("input", syncMacroCarnLifeMinutesLabel);
    syncMacroCarnLifeMinutesLabel();
  }
  if (macroCarnHungerDecayMulRange) {
    macroCarnHungerDecayMulRange.addEventListener("input", syncMacroCarnHungerDecayMulLabel);
    syncMacroCarnHungerDecayMulLabel();
  }
  if (macroCarnAttackMulRange) {
    macroCarnAttackMulRange.addEventListener("input", syncMacroCarnAttackMulLabel);
    syncMacroCarnAttackMulLabel();
  }
  const evolutionRadios = document.querySelectorAll('input[name="evolution-mode"]');
  for (const el of evolutionRadios) el.addEventListener("change", syncFitnessEnabled);

  function open({ macroTab: macroTabOverride } = {}) {
    const mode = getViewMode ? getViewMode() : "micro";
    const isMicro = mode === "micro";
    if (sectionMicro) sectionMicro.classList.toggle("hidden", !isMicro);
    if (sectionMacro) sectionMacro.classList.toggle("hidden", isMicro);
    if (!isMicro) setMacroTab(macroTabOverride || macroTab);
    if (isMicro && title) title.textContent = "設定（ミクロ）";

    const current = getSettings();
    if (isMicro) {
      selectRadio("population", current.populationPreset || DEFAULT_SETTINGS.populationPreset);
      if (reincarnationRange) {
        reincarnationRange.value = String(
          clampInt(current.reincarnationIndividuals ?? DEFAULT_SETTINGS.reincarnationIndividuals, 5, 100),
        );
        syncRangeLabel();
      }
      if (microMergeCooldownRange) {
        microMergeCooldownRange.value = String(
          clampInt(current.microMergeCooldownSeconds ?? DEFAULT_SETTINGS.microMergeCooldownSeconds, 1, 30),
        );
        syncMicroMergeCooldownLabel();
      }
      if (microStarScaleRange) {
        microStarScaleRange.value = String(
          clampFloat(current.microStarScale ?? DEFAULT_SETTINGS.microStarScale, 0.6, 3.0),
        );
        syncMicroStarScaleLabel();
      }
      if (microGrowthSpeedRange) {
        microGrowthSpeedRange.value = String(
          clampFloat(current.microVisualRadiusSmoothing ?? DEFAULT_SETTINGS.microVisualRadiusSmoothing, 0.5, 8.0),
        );
        syncMicroGrowthSpeedLabel();
      }
      if (microMergeRitualRange) {
        microMergeRitualRange.value = String(
          clampFloat(current.microMergeRitualSeconds ?? DEFAULT_SETTINGS.microMergeRitualSeconds, 0.3, 2.0),
        );
        syncMicroMergeRitualLabel();
      }
      if (microGalaxyStrengthRange) {
        microGalaxyStrengthRange.value = String(
          clampFloat(current.microGalaxyStrength ?? DEFAULT_SETTINGS.microGalaxyStrength, 0, 1),
        );
        syncMicroGalaxyStrengthLabel();
      }
      if (microGalaxyStartRange) {
        const pct = clampFloat(current.microGalaxyStartPct ?? DEFAULT_SETTINGS.microGalaxyStartPct, 0.1, 0.9);
        microGalaxyStartRange.value = String(clampInt(Math.round(pct * 100), 10, 90));
        syncMicroGalaxyStartLabel();
      }
      if (microDebugCheckbox) microDebugCheckbox.checked = Boolean(current.microDebug ?? DEFAULT_SETTINGS.microDebug);
    }
    selectRadio("macro-map-size", current.macroMapSize || DEFAULT_SETTINGS.macroMapSize);
    selectRadio(
      "macro-pop-cap-plant",
      String(normalizePopCap(current.macroPopCapPlant ?? DEFAULT_SETTINGS.macroPopCapPlant, DEFAULT_SETTINGS.macroPopCapPlant)),
    );
    selectRadio(
      "macro-pop-cap-herb",
      String(
        normalizePopCap(current.macroPopCapHerbivore ?? DEFAULT_SETTINGS.macroPopCapHerbivore, DEFAULT_SETTINGS.macroPopCapHerbivore),
      ),
    );
    selectRadio(
      "macro-pop-cap-omni",
      String(
        normalizePopCap(current.macroPopCapOmnivore ?? DEFAULT_SETTINGS.macroPopCapOmnivore, DEFAULT_SETTINGS.macroPopCapOmnivore),
      ),
    );
    selectRadio(
      "macro-pop-cap-carn",
      String(
        normalizePopCap(current.macroPopCapCarnivore ?? DEFAULT_SETTINGS.macroPopCapCarnivore, DEFAULT_SETTINGS.macroPopCapCarnivore),
      ),
    );
    if (macroAnimalCapRange) {
      macroAnimalCapRange.value = String(clampInt(current.macroAnimalCap ?? DEFAULT_SETTINGS.macroAnimalCap, 10, 100));
      syncMacroCapLabel();
    }
    const groupSizeRaw = clampInt(
      current.macroGroupMaxSize ?? DEFAULT_SETTINGS.macroGroupMaxSize,
      4,
      12,
    );
    const groupSize = groupSizeRaw === 4 || groupSizeRaw === 8 || groupSizeRaw === 12 ? groupSizeRaw : DEFAULT_SETTINGS.macroGroupMaxSize;
    selectRadio("macro-group-max-size", String(groupSize));
    selectRadio("macro-herb-repro-preset", current.macroHerbReproPreset || DEFAULT_SETTINGS.macroHerbReproPreset);
    selectRadio("macro-omni-repro-preset", current.macroOmniReproPreset || DEFAULT_SETTINGS.macroOmniReproPreset);
    selectRadio("macro-carn-repro-preset", current.macroCarnReproPreset || DEFAULT_SETTINGS.macroCarnReproPreset);
    if (macroPlantReproMaxRange) {
      macroPlantReproMaxRange.value = String(
        clampInt(current.macroPlantReproMax ?? DEFAULT_SETTINGS.macroPlantReproMax, 1, 5),
      );
      syncMacroPlantReproMaxLabel();
    }
    if (macroMeatHungerRecoverRange) {
      macroMeatHungerRecoverRange.value = String(
        clampInt(current.macroMeatHungerRecoverPct ?? DEFAULT_SETTINGS.macroMeatHungerRecoverPct, 5, 100),
      );
      syncMacroMeatHungerRecoverLabel();
    }
    selectRadio(
      "macro-meat-rot",
      (current.macroMeatRotEnabled ?? DEFAULT_SETTINGS.macroMeatRotEnabled) ? "on" : "off",
    );
    if (macroPlantHungerRecoverMulRange) {
      macroPlantHungerRecoverMulRange.value = String(
        clampFloat(current.macroPlantHungerRecoverMul ?? DEFAULT_SETTINGS.macroPlantHungerRecoverMul, 0.2, 3.0),
      );
      syncMacroPlantHungerRecoverMulLabel();
    }
    if (macroPlantStaminaMulRange) {
      macroPlantStaminaMulRange.value = String(
        clampFloat(current.macroPlantStaminaMul ?? DEFAULT_SETTINGS.macroPlantStaminaMul, 0.5, 3.0),
      );
      syncMacroPlantStaminaMulLabel();
    }
    if (macroPlantLifeMinutesRange) {
      macroPlantLifeMinutesRange.value = String(
        clampInt(current.macroPlantLifeMinutes ?? DEFAULT_SETTINGS.macroPlantLifeMinutes, 0, 30),
      );
      syncMacroPlantLifeMinutesLabel();
    }
    if (macroHerbStaminaMulRange) {
      macroHerbStaminaMulRange.value = String(
        clampFloat(current.macroHerbStaminaMul ?? DEFAULT_SETTINGS.macroHerbStaminaMul, 0.5, 3.0),
      );
      syncMacroHerbStaminaMulLabel();
    }
    if (macroHerbLifeMinutesRange) {
      macroHerbLifeMinutesRange.value = String(
        clampInt(current.macroHerbLifeMinutes ?? DEFAULT_SETTINGS.macroHerbLifeMinutes, 1, 30),
      );
      syncMacroHerbLifeMinutesLabel();
    }
    if (macroHerbHungerDecayMulRange) {
      macroHerbHungerDecayMulRange.value = String(
        clampFloat(current.macroHerbHungerDecayMul ?? DEFAULT_SETTINGS.macroHerbHungerDecayMul, 0.1, 3.0),
      );
      syncMacroHerbHungerDecayMulLabel();
    }
    if (macroOmniStaminaMulRange) {
      macroOmniStaminaMulRange.value = String(
        clampFloat(current.macroOmniStaminaMul ?? DEFAULT_SETTINGS.macroOmniStaminaMul, 0.5, 3.0),
      );
      syncMacroOmniStaminaMulLabel();
    }
    if (macroOmniLifeMinutesRange) {
      macroOmniLifeMinutesRange.value = String(
        clampInt(current.macroOmniLifeMinutes ?? DEFAULT_SETTINGS.macroOmniLifeMinutes, 1, 30),
      );
      syncMacroOmniLifeMinutesLabel();
    }
    if (macroOmniHungerDecayMulRange) {
      macroOmniHungerDecayMulRange.value = String(
        clampFloat(current.macroOmniHungerDecayMul ?? DEFAULT_SETTINGS.macroOmniHungerDecayMul, 0.1, 3.0),
      );
      syncMacroOmniHungerDecayMulLabel();
    }
    if (macroCarnStaminaMulRange) {
      macroCarnStaminaMulRange.value = String(
        clampFloat(current.macroCarnStaminaMul ?? DEFAULT_SETTINGS.macroCarnStaminaMul, 0.5, 3.0),
      );
      syncMacroCarnStaminaMulLabel();
    }
    if (macroCarnLifeMinutesRange) {
      macroCarnLifeMinutesRange.value = String(
        clampInt(current.macroCarnLifeMinutes ?? DEFAULT_SETTINGS.macroCarnLifeMinutes, 1, 30),
      );
      syncMacroCarnLifeMinutesLabel();
    }
    if (macroCarnHungerDecayMulRange) {
      macroCarnHungerDecayMulRange.value = String(
        clampFloat(current.macroCarnHungerDecayMul ?? DEFAULT_SETTINGS.macroCarnHungerDecayMul, 0.1, 3.0),
      );
      syncMacroCarnHungerDecayMulLabel();
    }
    if (macroCarnAttackMulRange) {
      macroCarnAttackMulRange.value = String(
        clampFloat(current.macroCarnAttackMul ?? DEFAULT_SETTINGS.macroCarnAttackMul, 1.0, 10.0),
      );
      syncMacroCarnAttackMulLabel();
    }
    selectRadio("evolution-mode", current.macroEvolutionMode || DEFAULT_SETTINGS.macroEvolutionMode);
    selectRadio("fitness-weight", fitnessLevelFromWeight(current.fitnessChildWeight ?? DEFAULT_SETTINGS.fitnessChildWeight));
    selectRadio("macro-nn-viz-blink", current.macroNnVizBlinkMode || DEFAULT_SETTINGS.macroNnVizBlinkMode);
    selectRadio("macro-nn-viz-outputs", current.macroNnVizOutputsMode || DEFAULT_SETTINGS.macroNnVizOutputsMode);
    syncFitnessEnabled();
    modal.classList.remove("hidden");
    if (panel) panel.scrollTop = 0;
    setPaused(true);
  }

  function close() {
    modal.classList.add("hidden");
    setPaused(false);
  }

  openButton.addEventListener("click", () => open());
  if (openEnvButton) openEnvButton.addEventListener("click", () => open({ macroTab: "env" }));
  if (openLifeButton) openLifeButton.addEventListener("click", () => open({ macroTab: "life" }));
  if (openLearningButton) openLearningButton.addEventListener("click", () => open({ macroTab: "learning" }));
  backdrop.addEventListener("click", close);

  applyButton.addEventListener("click", () => {
    const mode = getViewMode ? getViewMode() : "micro";
    if (mode === "macro") {
      const macroMapSize = getSelectedRadio("macro-map-size", DEFAULT_SETTINGS.macroMapSize);
      const macroAnimalCap = macroAnimalCapRange
        ? clampInt(macroAnimalCapRange.value, 10, 100)
        : DEFAULT_SETTINGS.macroAnimalCap;
      const macroPopCapPlant = normalizePopCap(
        getSelectedRadio("macro-pop-cap-plant", String(DEFAULT_SETTINGS.macroPopCapPlant)),
        DEFAULT_SETTINGS.macroPopCapPlant,
      );
      const macroPopCapHerbivore = normalizePopCap(
        getSelectedRadio("macro-pop-cap-herb", String(DEFAULT_SETTINGS.macroPopCapHerbivore)),
        DEFAULT_SETTINGS.macroPopCapHerbivore,
      );
      const macroPopCapOmnivore = normalizePopCap(
        getSelectedRadio("macro-pop-cap-omni", String(DEFAULT_SETTINGS.macroPopCapOmnivore)),
        DEFAULT_SETTINGS.macroPopCapOmnivore,
      );
      const macroPopCapCarnivore = normalizePopCap(
        getSelectedRadio("macro-pop-cap-carn", String(DEFAULT_SETTINGS.macroPopCapCarnivore)),
        DEFAULT_SETTINGS.macroPopCapCarnivore,
      );
      const macroGroupMaxSize = (() => {
        const raw = getSelectedRadio("macro-group-max-size", String(DEFAULT_SETTINGS.macroGroupMaxSize));
        const n = Number.parseInt(String(raw), 10);
        if (n === 4 || n === 8 || n === 12) return n;
        return DEFAULT_SETTINGS.macroGroupMaxSize;
      })();
      const macroHerbReproPreset = getSelectedRadio("macro-herb-repro-preset", DEFAULT_SETTINGS.macroHerbReproPreset);
      const macroOmniReproPreset = getSelectedRadio("macro-omni-repro-preset", DEFAULT_SETTINGS.macroOmniReproPreset);
      const macroCarnReproPreset = getSelectedRadio("macro-carn-repro-preset", DEFAULT_SETTINGS.macroCarnReproPreset);
      const macroPlantReproMax = macroPlantReproMaxRange
        ? clampInt(macroPlantReproMaxRange.value, 1, 5)
        : DEFAULT_SETTINGS.macroPlantReproMax;
      const macroMeatHungerRecoverPct = macroMeatHungerRecoverRange
        ? clampInt(macroMeatHungerRecoverRange.value, 5, 100)
        : DEFAULT_SETTINGS.macroMeatHungerRecoverPct;
      const macroMeatRotEnabled =
        getSelectedRadio("macro-meat-rot", DEFAULT_SETTINGS.macroMeatRotEnabled ? "on" : "off") !== "off";
      const macroPlantHungerRecoverMul = macroPlantHungerRecoverMulRange
        ? clampFloat(macroPlantHungerRecoverMulRange.value, 0.2, 3.0)
        : DEFAULT_SETTINGS.macroPlantHungerRecoverMul;
      const macroPlantStaminaMul = macroPlantStaminaMulRange
        ? clampFloat(macroPlantStaminaMulRange.value, 0.5, 3.0)
        : DEFAULT_SETTINGS.macroPlantStaminaMul;
      const macroPlantLifeMinutes = macroPlantLifeMinutesRange
        ? clampInt(macroPlantLifeMinutesRange.value, 0, 30)
        : DEFAULT_SETTINGS.macroPlantLifeMinutes;
      const macroHerbStaminaMul = macroHerbStaminaMulRange
        ? clampFloat(macroHerbStaminaMulRange.value, 0.5, 3.0)
        : DEFAULT_SETTINGS.macroHerbStaminaMul;
      const macroHerbLifeMinutes = macroHerbLifeMinutesRange
        ? clampInt(macroHerbLifeMinutesRange.value, 1, 30)
        : DEFAULT_SETTINGS.macroHerbLifeMinutes;
      const macroHerbHungerDecayMul = macroHerbHungerDecayMulRange
        ? clampFloat(macroHerbHungerDecayMulRange.value, 0.1, 3.0)
        : DEFAULT_SETTINGS.macroHerbHungerDecayMul;
      const macroOmniStaminaMul = macroOmniStaminaMulRange
        ? clampFloat(macroOmniStaminaMulRange.value, 0.5, 3.0)
        : DEFAULT_SETTINGS.macroOmniStaminaMul;
      const macroOmniLifeMinutes = macroOmniLifeMinutesRange
        ? clampInt(macroOmniLifeMinutesRange.value, 1, 30)
        : DEFAULT_SETTINGS.macroOmniLifeMinutes;
      const macroOmniHungerDecayMul = macroOmniHungerDecayMulRange
        ? clampFloat(macroOmniHungerDecayMulRange.value, 0.1, 3.0)
        : DEFAULT_SETTINGS.macroOmniHungerDecayMul;
      const macroCarnStaminaMul = macroCarnStaminaMulRange
        ? clampFloat(macroCarnStaminaMulRange.value, 0.5, 3.0)
        : DEFAULT_SETTINGS.macroCarnStaminaMul;
      const macroCarnLifeMinutes = macroCarnLifeMinutesRange
        ? clampInt(macroCarnLifeMinutesRange.value, 1, 30)
        : DEFAULT_SETTINGS.macroCarnLifeMinutes;
      const macroCarnHungerDecayMul = macroCarnHungerDecayMulRange
        ? clampFloat(macroCarnHungerDecayMulRange.value, 0.1, 3.0)
        : DEFAULT_SETTINGS.macroCarnHungerDecayMul;
      const macroCarnAttackMul = macroCarnAttackMulRange
        ? clampFloat(macroCarnAttackMulRange.value, 1.0, 10.0)
        : DEFAULT_SETTINGS.macroCarnAttackMul;
      const macroEvolutionMode = getSelectedRadio("evolution-mode", DEFAULT_SETTINGS.macroEvolutionMode);
      const level = getSelectedRadio("fitness-weight", fitnessLevelFromWeight(DEFAULT_SETTINGS.fitnessChildWeight));
      const fitnessChildWeight = FITNESS_WEIGHT_LEVEL[level] ?? DEFAULT_SETTINGS.fitnessChildWeight;
      const macroNnVizBlinkMode = getSelectedRadio("macro-nn-viz-blink", DEFAULT_SETTINGS.macroNnVizBlinkMode);
      const macroNnVizOutputsMode = getSelectedRadio("macro-nn-viz-outputs", DEFAULT_SETTINGS.macroNnVizOutputsMode);
      applySettings({
        macroMapSize,
        macroAnimalCap,
        macroPopCapPlant,
        macroPopCapHerbivore,
        macroPopCapOmnivore,
        macroPopCapCarnivore,
        macroGroupMaxSize,
        macroHerbReproPreset,
        macroOmniReproPreset,
        macroCarnReproPreset,
        macroPlantReproMax,
        macroMeatHungerRecoverPct,
        macroMeatRotEnabled,
        macroPlantHungerRecoverMul,
        macroPlantStaminaMul,
        macroPlantLifeMinutes,
        macroHerbStaminaMul,
        macroHerbLifeMinutes,
        macroHerbHungerDecayMul,
        macroOmniStaminaMul,
        macroOmniLifeMinutes,
        macroOmniHungerDecayMul,
        macroCarnStaminaMul,
        macroCarnLifeMinutes,
        macroCarnHungerDecayMul,
        macroCarnAttackMul,
        macroEvolutionMode,
        fitnessChildWeight,
        macroNnVizBlinkMode,
        macroNnVizOutputsMode,
      });
      close();
      return;
    }

    const populationPreset = getSelectedRadio("population", DEFAULT_SETTINGS.populationPreset);
    const reincarnationIndividuals = reincarnationRange
      ? clampInt(reincarnationRange.value, 5, 100)
      : DEFAULT_SETTINGS.reincarnationIndividuals;
    const microMergeCooldownSeconds = microMergeCooldownRange
      ? clampInt(microMergeCooldownRange.value, 1, 30)
      : DEFAULT_SETTINGS.microMergeCooldownSeconds;
    const microStarScale = microStarScaleRange
      ? clampFloat(microStarScaleRange.value, 0.6, 3.0)
      : DEFAULT_SETTINGS.microStarScale;
    const microVisualRadiusSmoothing = microGrowthSpeedRange
      ? clampFloat(microGrowthSpeedRange.value, 0.5, 8.0)
      : DEFAULT_SETTINGS.microVisualRadiusSmoothing;
    const microMergeRitualSeconds = microMergeRitualRange
      ? clampFloat(microMergeRitualRange.value, 0.3, 2.0)
      : DEFAULT_SETTINGS.microMergeRitualSeconds;
    const microGalaxyStrength = microGalaxyStrengthRange
      ? clampFloat(microGalaxyStrengthRange.value, 0, 1)
      : DEFAULT_SETTINGS.microGalaxyStrength;
    const microGalaxyStartPct = microGalaxyStartRange
      ? clampFloat(clampInt(microGalaxyStartRange.value, 10, 90) / 100, 0.1, 0.9)
      : DEFAULT_SETTINGS.microGalaxyStartPct;
    const microDebug = microDebugCheckbox ? Boolean(microDebugCheckbox.checked) : DEFAULT_SETTINGS.microDebug;
    applySettings({
      populationPreset,
      reincarnationIndividuals,
      microMergeCooldownSeconds,
      microStarScale,
      microVisualRadiusSmoothing,
      microMergeRitualSeconds,
      microGalaxyStrength,
      microGalaxyStartPct,
      microDebug,
    });
    close();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) close();
  });
}
