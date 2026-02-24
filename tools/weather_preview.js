import { Renderer } from "../render/render.js";
import { MacroWorld } from "../world/macro_world.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const canvas = document.getElementById("wpCanvas");
const weatherSel = document.getElementById("wpWeather");
const zoomRange = document.getElementById("wpZoom");
const zoomVal = document.getElementById("wpZoomVal");
const wetEl = document.getElementById("wpWet");
const snowEl = document.getElementById("wpSnow");
const resetFxBtn = document.getElementById("wpResetFx");

const renderer = new Renderer(canvas);
const macroWorld = new MacroWorld();

const tileSize = 64;
macroWorld.setWorldSize({ width: tileSize * 120, height: tileSize * 120 });

const camera = { x: 0, y: 0, zoom: 1 };

function fit() {
  renderer.resizeToDisplaySize();
  const viewW = canvas.clientWidth / Math.max(0.001, camera.zoom);
  const viewH = canvas.clientHeight / Math.max(0.001, camera.zoom);
  const worldW = Number(macroWorld?._world?.width) || tileSize * 120;
  const worldH = Number(macroWorld?._world?.height) || tileSize * 120;
  camera.x = (worldW - viewW) * 0.5;
  camera.y = (worldH - viewH) * 0.5;
}

function applyWeather() {
  const kind = String(weatherSel?.value || "sunny");
  macroWorld._weatherKind = kind;
  macroWorld._weatherTimerSeconds = 0;
  if (typeof macroWorld._updateClimateState === "function") macroWorld._updateClimateState();
}

function applyZoom() {
  const z = clamp(Number(zoomRange?.value) || 1, 0.5, 2.5);
  camera.zoom = z;
  if (zoomVal) zoomVal.textContent = z.toFixed(2);
}

weatherSel?.addEventListener("change", applyWeather);
zoomRange?.addEventListener("input", applyZoom);
resetFxBtn?.addEventListener("click", () => {
  const fx = renderer?._weatherFx;
  if (fx) {
    fx.wetness01 = 0;
    fx.snowCover01 = 0;
  }
});

applyWeather();
applyZoom();
window.addEventListener("resize", fit);
fit();

let dragging = false;
let lastX = 0;
let lastY = 0;
canvas.addEventListener("pointerdown", (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  camera.x -= dx / Math.max(0.001, camera.zoom);
  camera.y -= dy / Math.max(0.001, camera.zoom);
});
canvas.addEventListener("pointerup", () => {
  dragging = false;
});
canvas.addEventListener("pointercancel", () => {
  dragging = false;
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    camera.zoom = clamp(camera.zoom * factor, 0.5, 2.5);
    if (zoomRange) zoomRange.value = String(camera.zoom);
    if (zoomVal) zoomVal.textContent = camera.zoom.toFixed(2);
  },
  { passive: false },
);

function tick() {
  renderer.render(
    {
      viewMode: "macro",
      macroWorld,
      macroCamera: camera,
      macroConfig: { tileSize },
    },
    { paused: false },
  );

  const fx = renderer?._weatherFx;
  if (fx) {
    if (wetEl) wetEl.textContent = `${Math.round(clamp(fx.wetness01, 0, 1) * 100)}%`;
    if (snowEl) snowEl.textContent = `${Math.round(clamp(fx.snowCover01, 0, 1) * 100)}%`;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

