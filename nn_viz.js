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

const INPUT_LABELS = [
  "体力",
  "空腹（不足）",
  "スタミナ",
  "恐怖",
  "発情",
  "雌",
  "食べ物あり",
  "食べ物距離",
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
  "陣地耐性",
];

const OUTPUT_LABELS_FULL = [...BRAIN_MODES, "pace", "danger", "commit", "tempBias"];
const OUTPUT_LABELS_FULL_JA = [
  ...BRAIN_MODES.map((m) => {
    if (m === "rest") return "休息";
    if (m === "wander") return "徘徊";
    if (m === "food") return "食事";
    if (m === "flee") return "逃走";
    if (m === "mate") return "交尾";
    if (m === "hunt") return "狩り";
    if (m === "parenting") return "子育て";
    return String(m || "");
  }),
  "速度",
  "危険回避",
  "決定維持",
  "温度指向",
];
const OUTPUT_IDXS_COMPACT = [
  BRAIN_MODES.indexOf("rest"),
  BRAIN_MODES.indexOf("wander"),
  BRAIN_MODES.indexOf("food"),
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
let flashSign = 1;
let flashAction = null;

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

function drawNode({ x, y, r, value01, idx, blinkMode, t, flash, label, labelSide }) {
  const v = clamp01(value01);
  const pulse = nodePulse({ blinkMode, t, idx, strength01: v });
  const alpha = v * pulse;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = rgba(63, 208, 255, 0.12 + alpha * 0.85);
  ctx.fill();

  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(255, 255, 255, 0.12 + alpha * 0.25);
  ctx.stroke();

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
  flashT = Math.max(0, flashT - 1.8 * (1 / 60));

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

  // Flash edges toward the updated outputs (learning targets: rest/wander/food + pace/danger/commit).
  const flashActive = blinkMode === "flash" && flashT > 0.001;
  const flashOutIdxs = [];
  if (flashActive) {
    if (flashAction != null) {
      const flashOutLabel = flashAction === 0 ? "rest" : flashAction === 1 ? "wander" : "food";
      const actionIdx = outputsMode === "full" ? OUTPUT_LABELS_FULL.indexOf(flashOutLabel) : flashAction;
      if (actionIdx != null && actionIdx >= 0) flashOutIdxs.push(actionIdx);
    }

    if (outputsMode === "full") flashOutIdxs.push(BRAIN_OUT_PACE, BRAIN_OUT_DANGER, BRAIN_OUT_COMMIT, BRAIN_OUT_TEMP_BIAS);
    else flashOutIdxs.push(3, 4, 5, 6);
  }

  if (flashActive && flashOutIdxs.length > 0) {
    const flashRgb = flashSign >= 0 ? [80, 255, 140] : [255, 90, 90];
    if (hidden) {
      for (const outIdx of flashOutIdxs) {
        const nO = layout.outputs[outIdx] || null;
        if (!nO) continue;
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
      const modeLogits = [outputs[OUTPUT_IDXS_COMPACT[0]], outputs[OUTPUT_IDXS_COMPACT[1]], outputs[OUTPUT_IDXS_COMPACT[2]]];
      const p = softmax(modeLogits);
      outVals[0] = clamp01(p[0]);
      outVals[1] = clamp01(p[1]);
      outVals[2] = clamp01(p[2]);
      outVals[3] = decodeBrain01(outputs[BRAIN_OUT_PACE]);
      outVals[4] = decodeBrain01(outputs[BRAIN_OUT_DANGER]);
      outVals[5] = decodeBrain01(outputs[BRAIN_OUT_COMMIT]);
      outVals[6] = decodeBrain01(outputs[BRAIN_OUT_TEMP_BIAS]);
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
      label: `h${nH.i + 1}`,
      labelSide: "right",
    });
  }

  for (const nO of layout.outputs) {
    const idx = nO.i;
    const isUpdated =
      blinkMode === "flash" &&
      flashT > 0.001 &&
      flashOutIdxs.length > 0 &&
      flashOutIdxs.includes(idx);

    const rgb = flashSign >= 0 ? [80, 255, 140] : [255, 90, 90];
    drawNode({
      x: nO.x,
      y: nO.y,
      r,
      value01: outVals[idx] ?? 0,
      idx: 200 + idx,
      blinkMode,
      t,
      flash: isUpdated ? { t: flashT, rgb } : null,
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
    ctx.fillText("データ待ち（生物をクリック）", width / 2, height / 2);
  }
}

function updateHeader() {
  const id = state?.entity?.id;
  const label = state?.entity?.label;
  const modeText = config.outputsMode === "full" ? "全モード" : "3択";
  const blinkText = config.blinkMode === "always" ? "常時点滅" : "更新フラッシュ";
  subtitle.textContent = id != null ? `対象: ${label || "-"}（id=${id}） / 表示:${modeText} / 点滅:${blinkText}` : "マクロ視点で生物をクリックしてください";

  if (!status) return;
  const upd = Number(state?.rl?.updateCounter) || 0;
  const reward = state?.rl?.lastUpdateReward;
  const baseline = state?.rl?.lastUpdateBaseline;
  const adv = Number(state?.rl?.lastUpdateAdvantage) || 0;
  const act = state?.rl?.lastUpdateAction;
  const aLabel = act === 0 ? "休息" : act === 1 ? "徘徊" : act === 2 ? "食事" : "-";

  const learnAbsMode = Array.isArray(state?.rl?.learnAbsMode) ? state.rl.learnAbsMode : null;
  const learnAbsHead = Array.isArray(state?.rl?.learnAbsHead) ? state.rl.learnAbsHead : null;
  const fmt = (v) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return "-";
    return `${v >= 0 ? "+" : ""}${v.toFixed(4)}`;
  };
  const fmtU = (v) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return "-";
    const n = Math.abs(v);
    if (n < 0.01) return `${v.toFixed(4)}`;
    if (n < 0.1) return `${v.toFixed(3)}`;
    return `${v.toFixed(2)}`;
  };
  const fmtPct0 = (v) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return "-";
    return `${Math.max(0, Math.min(100, Math.round(v * 100)))}`;
  };

  const lines = [`更新:${upd}`, `報酬:${fmt(reward)}`, `ベースライン:${fmt(baseline)}`, `優位:${fmt(adv)}`, `行動:${aLabel}`];
  if (learnAbsMode && learnAbsMode.length === 3) {
    const a0 = Number(learnAbsMode[0]) || 0;
    const a1 = Number(learnAbsMode[1]) || 0;
    const a2 = Number(learnAbsMode[2]) || 0;
    const sum = a0 + a1 + a2;
    const p0 = sum > 0 ? a0 / sum : 0;
    const p1 = sum > 0 ? a1 / sum : 0;
    const p2 = sum > 0 ? a2 / sum : 0;
    lines.push(`学習累計: 休息${fmtU(a0)} / 徘徊${fmtU(a1)} / 食事${fmtU(a2)}`);
    if (sum > 0) lines.push(`学習比率: 休息${fmtPct0(p0)}% / 徘徊${fmtPct0(p1)}% / 食事${fmtPct0(p2)}%`);
  }
  if (learnAbsHead && learnAbsHead.length === 4) {
    const a0 = Number(learnAbsHead[0]) || 0;
    const a1 = Number(learnAbsHead[1]) || 0;
    const a2 = Number(learnAbsHead[2]) || 0;
    const a3 = Number(learnAbsHead[3]) || 0;
    const sum = a0 + a1 + a2 + a3;
    const p0 = sum > 0 ? a0 / sum : 0;
    const p1 = sum > 0 ? a1 / sum : 0;
    const p2 = sum > 0 ? a2 / sum : 0;
    const p3 = sum > 0 ? a3 / sum : 0;
    lines.push(`学習累計(head): 速度${fmtU(a0)} / 危険回避${fmtU(a1)} / 決定維持${fmtU(a2)} / 温度指向${fmtU(a3)}`);
    if (sum > 0)
      lines.push(
        `学習比率(head): 速度${fmtPct0(p0)}% / 危険回避${fmtPct0(p1)}% / 決定維持${fmtPct0(p2)}% / 温度指向${fmtPct0(p3)}%`,
      );
  } else if (learnAbsHead && learnAbsHead.length === 3) {
    const a0 = Number(learnAbsHead[0]) || 0;
    const a1 = Number(learnAbsHead[1]) || 0;
    const a2 = Number(learnAbsHead[2]) || 0;
    const sum = a0 + a1 + a2;
    const p0 = sum > 0 ? a0 / sum : 0;
    const p1 = sum > 0 ? a1 / sum : 0;
    const p2 = sum > 0 ? a2 / sum : 0;
    lines.push(`学習累計(head): 速度${fmtU(a0)} / 危険回避${fmtU(a1)} / 決定維持${fmtU(a2)}`);
    if (sum > 0)
      lines.push(`学習比率(head): 速度${fmtPct0(p0)}% / 危険回避${fmtPct0(p1)}% / 決定維持${fmtPct0(p2)}%`);
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
      const adv = Number(state?.rl?.lastUpdateAdvantage) || 0;
      flashSign = adv >= 0 ? 1 : -1;
      flashAction =
        state?.rl?.lastUpdateAction === 0 || state?.rl?.lastUpdateAction === 1 || state?.rl?.lastUpdateAction === 2
          ? state.rl.lastUpdateAction
          : null;
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
