import {
  BRAIN_HIDDEN,
  BRAIN_INPUTS,
  BRAIN_MODES,
  BRAIN_OUT_COMMIT,
  BRAIN_OUT_DANGER,
  BRAIN_OUT_PACE,
  BRAIN_OUT_TEMP_BIAS,
  decodeBrain01,
} from "./world/macro/brain.js";

const canvas = document.getElementById("nn-canvas");
const subtitle = document.getElementById("subtitle");
const status = document.getElementById("status");
const ctx = canvas.getContext("2d");

const NODE_R = 8;
const LABEL_FONT = "11px system-ui, -apple-system, Segoe UI, sans-serif";
const OUTPUT_GLOW_SECONDS = 10;
const ACTION_UPDATE_FLASH_EPS = 1e-6;
const HEAD_UPDATE_FLASH_EPS = 1e-6;

const INPUT_LABELS = [
  "体力",
  "空腹必要度",
  "スタミナ",
  "恐怖",
  "暑さ",
  "雌",
  "食料あり",
  "食料距離",
  "獲物あり",
  "獲物距離",
  "子育て",
  "バイアス",
  "自陣地 平均R2",
  "自陣地 最大R2",
  "自陣地 平均R3",
  "自陣地 最大R3",
  "外気温",
  "体温",
  "毛皮",
  "陣地温度耐性",
  "周辺資源",
  "候補地資源",
  "資源不足",
  "群れ空腹必要度",
  "群れ人数",
];

const OUTPUT_LABELS_FULL = [...BRAIN_MODES, "pace", "danger", "commit", "tempBias"];
const OUTPUT_LABELS_FULL_JA = [
  ...BRAIN_MODES.map((m) => {
    if (m === "rest") return "休息";
    if (m === "wander") return "徘徊";
    if (m === "food") return "食事";
    if (m === "flee") return "逃走";
    if (m === "mate") return "交配";
    if (m === "hunt") return "狩り";
    if (m === "expedition") return "遠征";
    if (m === "parenting") return "子育て";
    return String(m || "");
  }),
  "速度",
  "危険回避",
  "決定維持",
  "温度指向",
];
const COMPACT_ACTION_MODE_IDXS = [
  BRAIN_MODES.indexOf("rest"),
  BRAIN_MODES.indexOf("wander"),
  BRAIN_MODES.indexOf("food"),
  BRAIN_MODES.indexOf("hunt"),
  BRAIN_MODES.indexOf("expedition"),
];
const OUTPUT_IDXS_COMPACT = [
  ...COMPACT_ACTION_MODE_IDXS,
  BRAIN_OUT_PACE,
  BRAIN_OUT_DANGER,
  BRAIN_OUT_COMMIT,
  BRAIN_OUT_TEMP_BIAS,
];

function clamp01(v) {
  const n = Number(v) || 0;
  return Math.max(0, Math.min(1, n));
}

function softmax(logits) {
  const arr = Array.isArray(logits) ? logits : [];
  const m = arr.reduce((a, b) => Math.max(a, Number(b) || 0), -Infinity);
  const exps = arr.map((v) => Math.exp((Number(v) || 0) - m));
  const s = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / s);
}

function hiddenTo01(v) {
  const x = Math.max(0, Number(v) || 0);
  return clamp01(1 - Math.exp(-x * 0.9));
}

function rgba(r, g, b, a) {
  const aa = clamp01(a);
  return `rgba(${r},${g},${b},${aa})`;
}

function collectUpdatedOutputMeta(rl, outputsMode) {
  const items = [];
  const modeStep = Array.isArray(rl?.lastUpdateModeStep) ? rl.lastUpdateModeStep : null;
  if (modeStep && modeStep.length >= COMPACT_ACTION_MODE_IDXS.length) {
    for (let actionSlot = 0; actionSlot < COMPACT_ACTION_MODE_IDXS.length; actionSlot++) {
      const step = Number(modeStep[actionSlot]) || 0;
      if (Math.abs(step) <= ACTION_UPDATE_FLASH_EPS) continue;
      const fullIdx = OUTPUT_IDXS_COMPACT[actionSlot];
      const renderedIdx = outputsMode === "full" ? fullIdx : actionSlot;
      if (fullIdx >= 0 && renderedIdx >= 0) items.push({ fullIdx, renderedIdx, sign: step >= 0 ? 1 : -1 });
    }
  }

  const headStep = Array.isArray(rl?.lastUpdateHeadStep) ? rl.lastUpdateHeadStep : null;
  const headFullIdxs = [BRAIN_OUT_PACE, BRAIN_OUT_DANGER, BRAIN_OUT_COMMIT, BRAIN_OUT_TEMP_BIAS];
  if (headStep && headStep.length >= 4) {
    for (let headSlot = 0; headSlot < 4; headSlot++) {
      const step = Number(headStep[headSlot]) || 0;
      if (Math.abs(step) <= HEAD_UPDATE_FLASH_EPS) continue;
      const fullIdx = headFullIdxs[headSlot];
      const renderedIdx = outputsMode === "full" ? fullIdx : COMPACT_ACTION_MODE_IDXS.length + headSlot;
      items.push({ fullIdx, renderedIdx, sign: step >= 0 ? 1 : -1 });
    }
  }
  return items;
}

function resize() {
  const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener("resize", resize);
resize();

let config = { blinkMode: "flash", outputsMode: "compact" }; // "always" | "flash", "compact" | "full"
let state = null;

let lastUpdateCounter = 0;
let flashT = 0;
let lastFrameTime = 0;
const outputGlowState = OUTPUT_LABELS_FULL.map(() => ({ t: 0, sign: 1 }));

let cachedPadX = 64;
let cachedPadXMode = null;
let cachedPadXWidth = 0;

function measureMaxLabelWidth(labels) {
  const arr = Array.isArray(labels) ? labels : [];
  let maxW = 0;
  for (const s of arr) {
    const w = ctx.measureText(String(s || "")).width || 0;
    if (w > maxW) maxW = w;
  }
  return maxW;
}

function getPadX({ outputsMode, width }) {
  const w = Math.max(1, Math.round(width));
  if (cachedPadXMode === outputsMode && cachedPadXWidth === w) return cachedPadX;

  ctx.font = LABEL_FONT;
  const inMax = measureMaxLabelWidth(INPUT_LABELS);
  const outLabels =
    outputsMode === "full" ? OUTPUT_LABELS_FULL_JA : OUTPUT_IDXS_COMPACT.map((idx) => OUTPUT_LABELS_FULL_JA[idx]);
  const outMax = measureMaxLabelWidth(outLabels);

  const maxW = Math.max(inMax, outMax);
  const desired = Math.ceil(maxW + NODE_R + 8 + 14);
  const maxPad = Math.max(64, Math.floor(width * 0.45));
  const pad = Math.max(64, Math.min(desired, maxPad));

  cachedPadX = pad;
  cachedPadXMode = outputsMode;
  cachedPadXWidth = w;
  return pad;
}

function computeLayout({ outputsMode, width, height, padX }) {
  const outCount = outputsMode === "full" ? OUTPUT_LABELS_FULL.length : OUTPUT_IDXS_COMPACT.length;
  const px = Number.isFinite(padX) ? padX : 64;
  const padY = 26;

  const xIn = px;
  const xHidden = width * 0.5;
  const xOut = width - px;

  const top = padY;
  const usableH = Math.max(80, height - padY * 2);

  const spread = (count) => {
    const c = Math.max(1, count | 0);
    if (c === 1) return [top + usableH / 2];
    const step = usableH / (c - 1);
    const ys = [];
    for (let i = 0; i < c; i++) ys.push(top + step * i);
    return ys;
  };

  const inYs = spread(BRAIN_INPUTS);
  const hiddenYs = spread(BRAIN_HIDDEN);
  const outYs = spread(outCount);

  const inputs = inYs.map((y, i) => ({ x: xIn, y, i }));
  const hidden = hiddenYs.map((y, i) => ({ x: xHidden, y, i }));
  const outputs = outYs.map((y, i) => ({ x: xOut, y, i }));

  return { inputs, hidden, outputs };
}

function nodePulse({ blinkMode, t, idx, strength01 }) {
  const s = clamp01(strength01);
  if (blinkMode !== "always") return 1;
  const phase = t * 6.2 + idx * 0.75;
  const wave = 0.65 + 0.35 * Math.sin(phase);
  return 0.35 + 0.65 * (0.25 + 0.75 * wave) * (0.5 + 0.5 * s);
}

function fullOutputIdxFromRenderedIdx(outputsMode, idx) {
  if (outputsMode === "full") return idx;
  return OUTPUT_IDXS_COMPACT[idx] ?? -1;
}

function addOutputGlow(fullIdx, sign) {
  const idx = Number(fullIdx);
  if (!(idx >= 0 && idx < outputGlowState.length)) return;
  outputGlowState[idx].t = 1;
  outputGlowState[idx].sign = sign >= 0 ? 1 : -1;
}

function advanceOutputGlow(dt) {
  const step = Math.max(0, Number(dt) || 0) / Math.max(0.001, OUTPUT_GLOW_SECONDS);
  if (step <= 0) return;
  for (const entry of outputGlowState) {
    if (!entry) continue;
    entry.t = Math.max(0, (Number(entry.t) || 0) - step);
  }
}

function drawNode({ x, y, r, value01, idx, blinkMode, t, flash, glow, label, labelSide }) {
  const v = clamp01(value01);
  const pulse = nodePulse({ blinkMode, t, idx, strength01: v });
  const alpha = v * pulse;

  if (glow && glow.t > 0) {
    const gg = clamp01(glow.t);
    const glowRgb = glow.sign >= 0 ? [80, 255, 140] : [255, 90, 90];
    ctx.beginPath();
    ctx.arc(x, y, r + 7, 0, Math.PI * 2);
    ctx.fillStyle = rgba(glowRgb[0], glowRgb[1], glowRgb[2], gg * 0.12);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = rgba(63, 208, 255, 0.12 + alpha * 0.85);
  ctx.fill();

  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(255, 255, 255, 0.12 + alpha * 0.25);
  ctx.stroke();

  if (glow && glow.t > 0) {
    const gg = clamp01(glow.t);
    const glowRgb = glow.sign >= 0 ? [80, 255, 140] : [255, 90, 90];
    ctx.lineWidth = 3;
    ctx.strokeStyle = rgba(glowRgb[0], glowRgb[1], glowRgb[2], gg * 0.75);
    ctx.stroke();
  }

  if (flash && flash.t > 0) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = rgba(flash.rgb[0], flash.rgb[1], flash.rgb[2], flash.t * 0.95);
    ctx.stroke();
  }

  if (label) {
    ctx.font = LABEL_FONT;
    ctx.fillStyle = rgba(255, 255, 255, 0.65);
    ctx.textBaseline = "middle";
    if (labelSide === "left") {
      ctx.textAlign = "right";
      ctx.fillText(label, x - r - 8, y);
    } else {
      ctx.textAlign = "left";
      ctx.fillText(label, x + r + 8, y);
    }
  }
}

function draw() {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);

  ctx.clearRect(0, 0, width, height);

  const t = performance.now() / 1000;
  if (lastFrameTime <= 0) lastFrameTime = t;
  const dt = Math.max(0, Math.min(0.1, t - lastFrameTime));
  lastFrameTime = t;
  flashT = Math.max(0, flashT - 1.8 * (1 / 60));
  advanceOutputGlow(dt);

  const outputsMode = config.outputsMode === "full" ? "full" : "compact";
  const blinkMode = config.blinkMode === "always" ? "always" : "flash";

  const padX = getPadX({ outputsMode, width });
  const layout = computeLayout({ outputsMode, width, height, padX });
  const r = NODE_R;

  const inputs = Array.isArray(state?.inputs) ? state.inputs : null;
  const hidden = Array.isArray(state?.hidden) ? state.hidden : null;
  const outputs = Array.isArray(state?.outputs) ? state.outputs : null;

  // Draw base edges.
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(255, 255, 255, 0.06);
  for (const nIn of layout.inputs) {
    const x0 = nIn.x;
    const y0 = nIn.y;
    for (const nH of layout.hidden) {
      ctx.beginPath();
      ctx.moveTo(x0 + r, y0);
      ctx.lineTo(nH.x - r, nH.y);
      ctx.stroke();
    }
  }
  for (const nH of layout.hidden) {
    const x0 = nH.x;
    const y0 = nH.y;
    for (const nO of layout.outputs) {
      ctx.beginPath();
      ctx.moveTo(x0 + r, y0);
      ctx.lineTo(nO.x - r, nO.y);
      ctx.stroke();
    }
  }

  // Flash edges toward the updated outputs (learning targets: rest/wander/food/hunt + heads).
  const flashActive = blinkMode === "flash" && flashT > 0.001;
  const flashOutputMeta = flashActive ? collectUpdatedOutputMeta(state?.rl, outputsMode) : [];
  const flashOutputMap = new Map(flashOutputMeta.map((entry) => [entry.renderedIdx, entry]));

  if (flashActive && flashOutputMeta.length > 0) {
    if (hidden) {
      for (const entry of flashOutputMeta) {
        const nO = layout.outputs[entry.renderedIdx] || null;
        if (!nO) continue;
        const flashRgb = entry.sign >= 0 ? [80, 255, 140] : [255, 90, 90];
        for (const nH of layout.hidden) {
          const hv01 = hiddenTo01(hidden[nH.i]);
          if (hv01 <= 0.01) continue;
          ctx.lineWidth = 1 + hv01 * 2.5;
          ctx.strokeStyle = rgba(flashRgb[0], flashRgb[1], flashRgb[2], flashT * (0.08 + hv01 * 0.28));
          ctx.beginPath();
          ctx.moveTo(nH.x + r, nH.y);
          ctx.lineTo(nO.x - r, nO.y);
          ctx.stroke();
        }
      }
    }
  }

  // Node values.
  const inVals = [];
  if (inputs && inputs.length >= BRAIN_INPUTS) for (let i = 0; i < BRAIN_INPUTS; i++) inVals[i] = clamp01(inputs[i]);

  const hiddenVals = [];
  if (hidden && hidden.length >= BRAIN_HIDDEN)
    for (let i = 0; i < BRAIN_HIDDEN; i++) hiddenVals[i] = hiddenTo01(hidden[i]);

  const outVals = [];
  const outLabels =
    outputsMode === "full" ? OUTPUT_LABELS_FULL_JA : OUTPUT_IDXS_COMPACT.map((idx) => OUTPUT_LABELS_FULL_JA[idx]);
  if (outputs && outputs.length >= OUTPUT_LABELS_FULL.length) {
    if (outputsMode === "compact") {
      const modeLogits = COMPACT_ACTION_MODE_IDXS.map((idx) => outputs[idx]);
      const p = softmax(modeLogits);
      for (let i = 0; i < COMPACT_ACTION_MODE_IDXS.length; i++) outVals[i] = clamp01(p[i]);
      outVals[COMPACT_ACTION_MODE_IDXS.length + 0] = decodeBrain01(outputs[BRAIN_OUT_PACE]);
      outVals[COMPACT_ACTION_MODE_IDXS.length + 1] = decodeBrain01(outputs[BRAIN_OUT_DANGER]);
      outVals[COMPACT_ACTION_MODE_IDXS.length + 2] = decodeBrain01(outputs[BRAIN_OUT_COMMIT]);
      outVals[COMPACT_ACTION_MODE_IDXS.length + 3] = decodeBrain01(outputs[BRAIN_OUT_TEMP_BIAS]);
    } else {
      const modeLogits = [];
      for (let i = 0; i < BRAIN_MODES.length; i++) modeLogits.push(outputs[i]);
      const p = softmax(modeLogits);
      for (let i = 0; i < BRAIN_MODES.length; i++) outVals[i] = clamp01(p[i]);
      outVals[BRAIN_OUT_PACE] = decodeBrain01(outputs[BRAIN_OUT_PACE]);
      outVals[BRAIN_OUT_DANGER] = decodeBrain01(outputs[BRAIN_OUT_DANGER]);
      outVals[BRAIN_OUT_COMMIT] = decodeBrain01(outputs[BRAIN_OUT_COMMIT]);
      outVals[BRAIN_OUT_TEMP_BIAS] = decodeBrain01(outputs[BRAIN_OUT_TEMP_BIAS]);
    }
  }

  // Draw nodes (with labels).
  for (const nIn of layout.inputs) {
    drawNode({
      x: nIn.x,
      y: nIn.y,
      r,
      value01: inVals[nIn.i] ?? 0,
      idx: nIn.i,
      blinkMode,
      t,
      flash: null,
      glow: null,
      label: INPUT_LABELS[nIn.i] || `in${nIn.i}`,
      labelSide: "left",
    });
  }

  for (const nH of layout.hidden) {
    drawNode({
      x: nH.x,
      y: nH.y,
      r,
      value01: hiddenVals[nH.i] ?? 0,
      idx: 100 + nH.i,
      blinkMode,
      t,
      flash: null,
      glow: null,
      label: `h${nH.i + 1}`,
      labelSide: "right",
    });
  }

  for (const nO of layout.outputs) {
    const idx = nO.i;
    const flashMeta = blinkMode === "flash" && flashT > 0.001 ? flashOutputMap.get(idx) || null : null;
    const glowState = outputGlowState[fullOutputIdxFromRenderedIdx(outputsMode, idx)] || null;
    drawNode({
      x: nO.x,
      y: nO.y,
      r,
      value01: outVals[idx] ?? 0,
      idx: 200 + idx,
      blinkMode,
      t,
      flash: flashMeta ? { t: flashT, rgb: flashMeta.sign >= 0 ? [80, 255, 140] : [255, 90, 90] } : null,
      glow: glowState,
      label: outLabels[idx] || `out${idx}`,
      labelSide: "right",
    });
  }

  // If there is no data yet, show a hint.
  if (!inputs || !hidden || !outputs) {
    ctx.font = "13px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillStyle = rgba(255, 255, 255, 0.55);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("マクロ画面で個体をクリックしてください", width / 2, height / 2);
  }
}

function updateHeader() {
  const id = state?.entity?.id;
  const label = state?.entity?.label;
  const modeText = config.outputsMode === "full" ? "全モード" : "5択";
  const blinkText = config.blinkMode === "always" ? "常時点滅" : "更新時フラッシュ";
  subtitle.textContent =
    id != null
      ? `対象: ${label || "-"} (id=${id}) / 表示:${modeText} / 点滅:${blinkText}`
      : "マクロ画面で個体をクリックしてください";

  if (!status) return;

  const upd = Number(state?.rl?.updateCounter) || 0;
  const reward = state?.rl?.lastUpdateReward;
  const baseline = state?.rl?.lastUpdateBaseline;
  const adv = Number(state?.rl?.lastUpdateAdvantage) || 0;
  const act = state?.rl?.lastUpdateAction;
  const actionLabels = ["休息", "徘徊", "食事", "狩り", "遠征"];
  const aLabel = Number.isInteger(act) && act >= 0 && act < actionLabels.length ? actionLabels[act] : "-";

  const learnAbsMode = Array.isArray(state?.rl?.learnAbsMode) ? state.rl.learnAbsMode : null;
  const learnAbsHead = Array.isArray(state?.rl?.learnAbsHead) ? state.rl.learnAbsHead : null;

  const fmtSigned = (v) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return "-";
    return `${v >= 0 ? "+" : ""}${v.toFixed(4)}`;
  };
  const fmtMagnitude = (v) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return "-";
    const n = Math.abs(v);
    if (n < 0.01) return v.toFixed(4);
    if (n < 0.1) return v.toFixed(3);
    return v.toFixed(2);
  };
  const fmtPct0 = (v) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return "-";
    return `${Math.max(0, Math.min(100, Math.round(v * 100)))}`;
  };

  const lines = [
    `更新:${upd}` ,
    `報酬:${fmtSigned(reward)}` ,
    `ベースライン:${fmtSigned(baseline)}` ,
    `優位:${fmtSigned(adv)}` ,
    `行動:${aLabel}` ,
  ];

  if (learnAbsMode && learnAbsMode.length >= actionLabels.length) {
    const actionVals = actionLabels.map((_, idx) => Number(learnAbsMode[idx]) || 0);
    const sum = actionVals.reduce((acc, value) => acc + value, 0);
    lines.push(`学習累計: ${actionLabels.map((labelText, idx) => `${labelText}${fmtMagnitude(actionVals[idx])}`).join(" / ")}`);
    if (sum > 0) {
      lines.push(
        `学習比率: ${actionLabels.map((labelText, idx) => `${labelText}${fmtPct0(actionVals[idx] / sum)}%`).join(" / ")}`
      );
    }
  }

  if (learnAbsHead && learnAbsHead.length >= 4) {
    const headLabels = ["速度", "危険回避", "決定維持", "温度指向"];
    const headVals = headLabels.map((_, idx) => Number(learnAbsHead[idx]) || 0);
    const sum = headVals.reduce((acc, value) => acc + value, 0);
    lines.push(`学習累計(head): ${headLabels.map((labelText, idx) => `${labelText}${fmtMagnitude(headVals[idx])}`).join(" / ")}`);
    if (sum > 0) {
      lines.push(
        `学習比率(head): ${headLabels.map((labelText, idx) => `${labelText}${fmtPct0(headVals[idx] / sum)}%`).join(" / ")}`
      );
    }
  }

  status.textContent = lines.join("\n");
}
window.addEventListener("message", (ev) => {
  const msg = ev?.data;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "nn_viz_config") {
    const blinkMode = msg.blinkMode === "always" ? "always" : "flash";
    const outputsMode = msg.outputsMode === "full" ? "full" : "compact";
    config = { ...config, blinkMode, outputsMode };
    updateHeader();
    return;
  }

  if (msg.type === "nn_viz_state") {
    state = msg;
    const counter = Number(state?.rl?.updateCounter) || 0;
    if (counter !== lastUpdateCounter) {
      lastUpdateCounter = counter;
      const updatedOutputs = collectUpdatedOutputMeta(state?.rl, "full");
      for (const entry of updatedOutputs) addOutputGlow(entry.fullIdx, entry.sign);
      flashT = 1;
    }
    updateHeader();
    return;
  }
});

// Handshake: tell the opener we're ready to receive config + state.
try {
  const target = window.opener || (window.parent && window.parent !== window ? window.parent : null);
  if (target) target.postMessage({ type: "nn_viz_ready" }, "*");
} catch {
  // ignore
}

function loop() {
  resize();
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
