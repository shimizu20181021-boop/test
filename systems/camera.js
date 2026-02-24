import { clamp } from "../core/utils.js";

export class Camera2D {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.viewportWidth = 800;
    this.viewportHeight = 600;
    this.worldWidth = 800;
    this.worldHeight = 600;
  }

  getZoom() {
    const z = Number(this.zoom);
    if (!Number.isFinite(z) || z <= 0) return 1;
    return z;
  }

  getViewportWorldSize() {
    const z = this.getZoom();
    return { width: this.viewportWidth / z, height: this.viewportHeight / z };
  }

  setWorldSize({ width, height }) {
    this.worldWidth = Math.max(1, Math.floor(width));
    this.worldHeight = Math.max(1, Math.floor(height));
    this.clampToWorld();
  }

  setViewportSize({ width, height }) {
    this.viewportWidth = Math.max(1, Math.floor(width));
    this.viewportHeight = Math.max(1, Math.floor(height));
    this.clampToWorld();
  }

  setZoom(zoom) {
    const z = Number(zoom);
    if (!Number.isFinite(z) || z <= 0) return;
    this.zoom = z;
    this.clampToWorld();
  }

  zoomAt(zoom, screenX, screenY) {
    const oldZoom = this.getZoom();
    const z = Number(zoom);
    if (!Number.isFinite(z) || z <= 0) return;

    const sx = Number(screenX) || 0;
    const sy = Number(screenY) || 0;

    const worldX = this.x + sx / oldZoom;
    const worldY = this.y + sy / oldZoom;

    this.zoom = z;
    this.x = worldX - sx / z;
    this.y = worldY - sy / z;
    this.clampToWorld();
  }

  clampToWorld() {
    const { width: vw, height: vh } = this.getViewportWorldSize();
    const maxX = Math.max(0, this.worldWidth - vw);
    const maxY = Math.max(0, this.worldHeight - vh);
    this.x = clamp(this.x, 0, maxX);
    this.y = clamp(this.y, 0, maxY);
  }

  moveBy(dx, dy) {
    this.x += dx;
    this.y += dy;
    this.clampToWorld();
  }

  centerOn(x, y) {
    const { width: vw, height: vh } = this.getViewportWorldSize();
    this.x = x - vw / 2;
    this.y = y - vh / 2;
    this.clampToWorld();
  }
}

export class CameraInput {
  constructor(canvas) {
    this.canvas = canvas;
    this.keysDown = new Set();
    this.pointers = new Map();
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;
    this.enabled = true;

    this.isPinching = false;
    this.lastPinchAt = 0;
    this._pinchDist = 0;
    this._pinchMidX = 0;
    this._pinchMidY = 0;

    const posFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const touchPointers = () => Array.from(this.pointers.values()).filter((p) => p.type === "touch");

    const ensureDragFromRemainingTouch = () => {
      const touches = touchPointers();
      if (touches.length !== 1) return;
      const p = touches[0];
      this.dragging = true;
      this.lastX = p.x;
      this.lastY = p.y;
    };

    window.addEventListener("keydown", (e) => {
      this.keysDown.add(e.key.toLowerCase());
    });
    window.addEventListener("keyup", (e) => {
      this.keysDown.delete(e.key.toLowerCase());
    });

    canvas.addEventListener("pointerdown", (e) => {
      if (!this.enabled) return;
      const pos = posFromEvent(e);
      this.pointers.set(e.pointerId, { id: e.pointerId, type: e.pointerType, x: pos.x, y: pos.y });

      const touches = touchPointers();
      if (touches.length >= 2) {
        this.isPinching = true;
        this.dragging = false;
        const a = touches[0];
        const b = touches[1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        this._pinchDist = Math.sqrt(dx * dx + dy * dy);
        this._pinchMidX = (a.x + b.x) / 2;
        this._pinchMidY = (a.y + b.y) / 2;
        this.lastPinchAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      } else {
        this.dragging = true;
        this.lastX = pos.x;
        this.lastY = pos.y;
      }
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    });
    canvas.addEventListener("pointerup", (e) => {
      this.pointers.delete(e.pointerId);
      const touches = touchPointers();
      if (this.isPinching && touches.length < 2) {
        this.isPinching = false;
        this._pinchDist = 0;
      }
      this.dragging = false;
      if (!this.isPinching) ensureDragFromRemainingTouch();
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    });
    canvas.addEventListener("pointercancel", () => {
      this.pointers.clear();
      this.isPinching = false;
      this._pinchDist = 0;
      this.dragging = false;
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.enabled) return;
      const existing = this.pointers.get(e.pointerId);
      if (existing) {
        const pos = posFromEvent(e);
        existing.x = pos.x;
        existing.y = pos.y;
      }

      const touches = touchPointers();
      if (touches.length >= 2) {
        if (!this.isPinching) {
          this.isPinching = true;
          this.dragging = false;
          const a = touches[0];
          const b = touches[1];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          this._pinchDist = Math.sqrt(dx * dx + dy * dy);
          this._pinchMidX = (a.x + b.x) / 2;
          this._pinchMidY = (a.y + b.y) / 2;
          this.lastPinchAt = typeof performance !== "undefined" ? performance.now() : Date.now();
          return;
        }

        const a = touches[0];
        const b = touches[1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;

        const midDx = midX - this._pinchMidX;
        const midDy = midY - this._pinchMidY;
        this._pinchMidX = midX;
        this._pinchMidY = midY;

        if (this.onDrag && (midDx !== 0 || midDy !== 0)) this.onDrag(midDx, midDy);

        const prev = Math.max(1e-6, Number(this._pinchDist) || dist || 1);
        const scale = dist / prev;
        this._pinchDist = dist;
        this.lastPinchAt = typeof performance !== "undefined" ? performance.now() : Date.now();
        if (this.onPinch) this.onPinch(scale, midX, midY);
        return;
      }

      if (!this.dragging) return;
      const pos = existing ? { x: existing.x, y: existing.y } : posFromEvent(e);
      const dx = pos.x - this.lastX;
      const dy = pos.y - this.lastY;
      this.lastX = pos.x;
      this.lastY = pos.y;
      if (this.onDrag) this.onDrag(dx, dy);
    });
  }

  wasPinchingRecently(ms = 250) {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    return now - (Number(this.lastPinchAt) || 0) < ms;
  }

  update(dt, camera, speedPxPerSecond) {
    if (!this.enabled) return;
    const s = speedPxPerSecond * dt;
    let dx = 0;
    let dy = 0;

    if (this.keysDown.has("arrowleft") || this.keysDown.has("a")) dx -= s;
    if (this.keysDown.has("arrowright") || this.keysDown.has("d")) dx += s;
    if (this.keysDown.has("arrowup") || this.keysDown.has("w")) dy -= s;
    if (this.keysDown.has("arrowdown") || this.keysDown.has("s")) dy += s;

    if (dx !== 0 || dy !== 0) camera.moveBy(dx, dy);
  }
}
