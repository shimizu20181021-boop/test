const ASSETS = {
  groundGray: "./assets/tiles/macro/ground_gray.png",
  mountainGray: "./assets/tiles/macro/mountain_gray.png",
  plantOverlay: "./assets/tiles/macro/overlay_plant.png",
  territoryMask: "./assets/tiles/macro/mask_territory.png",
};

const TERRITORY_ALPHA_BY_LEVEL = [0, 0.12, 0.22, 0.32, 0.45];

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function fmt2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0.00";
  return x.toFixed(2);
}

function parseHexColor(hex) {
  const h = String(hex || "")
    .trim()
    .replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 59, g: 130, b: 246 };
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  return { r, g, b };
}

const imageCache = new Map();
function loadImage(url) {
  const u = String(url || "");
  if (imageCache.has(u)) return imageCache.get(u);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`画像が読み込めません: ${u}`));
    img.src = u;
  });
  imageCache.set(u, p);
  return p;
}

const tintCache = new Map();
function getTintCanvas({ r, g, b, maskImg }) {
  const key = `${r},${g},${b}`;
  const cached = tintCache.get(key);
  if (cached) return cached;

  const w = maskImg.naturalWidth || maskImg.width || 0;
  const h = maskImg.naturalHeight || maskImg.height || 0;
  if (!(w > 0 && h > 0)) return null;

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(maskImg, 0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";

  tintCache.set(key, c);
  return c;
}

function resizeCanvasToDisplaySize(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    return true;
  }
  return false;
}

function drawLabel(ctx, text, x, y) {
  ctx.save();
  ctx.font = "600 14px system-ui, -apple-system, 'Segoe UI', sans-serif";
  ctx.fillStyle = "rgba(0,0,0,0.78)";
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 4;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
}

async function main() {
  const canvas = document.getElementById("tpCanvas");
  const colorInput = document.getElementById("tpColor");
  const levelSel = document.getElementById("tpLevel");
  const zoomRange = document.getElementById("tpZoom");
  const zoomVal = document.getElementById("tpZoomVal");
  if (!canvas) return;

  if (location?.protocol === "file:") return;

  const [groundImg, mountainImg, plantImg, maskImg] = await Promise.all([
    loadImage(ASSETS.groundGray),
    loadImage(ASSETS.mountainGray),
    loadImage(ASSETS.plantOverlay),
    loadImage(ASSETS.territoryMask),
  ]);

  const redraw = () => {
    resizeCanvasToDisplaySize(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const zoom = clampNumber(zoomRange?.value ?? 1, 0.5, 2.5);
    if (zoomVal) zoomVal.textContent = fmt2(zoom);

    const tile = 96 * zoom;
    const pad = 26 * zoom;
    const x0 = 34 * zoom;
    const y0 = 36 * zoom;

    const { r, g, b } = parseHexColor(colorInput?.value || "#3b82f6");
    const lvl = Math.max(1, Math.min(4, Number(levelSel?.value || 2)));
    const alpha = TERRITORY_ALPHA_BY_LEVEL[lvl] ?? 0.22;
    const tint = getTintCanvas({ r, g, b, maskImg });

    // 4 columns
    const cols = [
      { label: "灰色（通常）", draw: (x, y) => ctx.drawImage(groundImg, x, y, tile, tile) },
      {
        label: "山（岩）",
        draw: (x, y) => {
          ctx.drawImage(mountainImg, x, y, tile, tile);
          // simulate height tint (as in macro render)
          const hm = 12;
          const t = Math.max(0, Math.min(1, hm / 20));
          const base = Math.round(232 - t * 115);
          const g = Math.max(75, Math.min(245, base));
          ctx.save();
          ctx.globalAlpha *= 0.55;
          ctx.fillStyle = `rgb(${g},${g},${g})`;
          ctx.fillRect(x, y, tile, tile);
          ctx.restore();
        },
      },
      {
        label: "植物（緑）",
        draw: (x, y) => {
          ctx.drawImage(groundImg, x, y, tile, tile);
          ctx.drawImage(plantImg, x, y, tile, tile);
        },
      },
      {
        label: "グループカラー",
        draw: (x, y) => {
          ctx.drawImage(groundImg, x, y, tile, tile);
          if (tint && alpha > 0) {
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.drawImage(tint, x, y, tile, tile);
            ctx.restore();
          }
        },
      },
    ];

    for (let i = 0; i < cols.length; i++) {
      const x = x0 + i * (tile + pad);
      const y = y0;
      cols[i].draw(x, y);

      drawLabel(ctx, cols[i].label, x, y - 10 * zoom);
    }

    // a small repeated grid for "map feel"
    const gridY = y0 + tile + 58 * zoom;
    drawLabel(ctx, "マップ感（繰り返し）", x0, gridY - 16 * zoom);

    const gridCols = 10;
    const gridRows = 4;
    const gx0 = x0;
    const gy0 = gridY;
    const gt = Math.max(24, Math.round(46 * zoom));

    for (let gy = 0; gy < gridRows; gy++) {
      for (let gx = 0; gx < gridCols; gx++) {
        const x = gx0 + gx * gt;
        const y = gy0 + gy * gt;
        ctx.drawImage(groundImg, x, y, gt, gt);
      }
    }

    // sprinkle a few mountain tiles on the grid
    for (let i = 0; i < 7; i++) {
      const gx = (i * 3 + 2) % gridCols;
      const gy = (1 + Math.floor(i / 3)) % gridRows;
      const x = gx0 + gx * gt;
      const y = gy0 + gy * gt;
      ctx.drawImage(mountainImg, x, y, gt, gt);
      const hm = 12;
      const t = Math.max(0, Math.min(1, hm / 20));
      const base = Math.round(232 - t * 115);
      const g = Math.max(75, Math.min(245, base));
      ctx.save();
      ctx.globalAlpha *= 0.55;
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(x, y, gt, gt);
      ctx.restore();
    }

    // sprinkle plant tiles on the grid
    for (let i = 0; i < 10; i++) {
      const gx = (i * 2 + 1) % gridCols;
      const gy = Math.floor(i / 3) % gridRows;
      const x = gx0 + gx * gt;
      const y = gy0 + gy * gt;
      ctx.drawImage(plantImg, x, y, gt, gt);
    }

    // paint a 3x2 territory patch
    if (tint && alpha > 0) {
      ctx.save();
      ctx.globalAlpha = alpha;
      for (let gy = 1; gy <= 2; gy++) {
        for (let gx = 6; gx <= 8; gx++) {
          const x = gx0 + gx * gt;
          const y = gy0 + gy * gt;
          ctx.drawImage(tint, x, y, gt, gt);
        }
      }
      ctx.restore();
    }

    // tile grid lines
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.lineWidth = Math.max(1, 1 * zoom);
    for (let gx = 0; gx <= gridCols; gx++) {
      const x = gx0 + gx * gt;
      ctx.beginPath();
      ctx.moveTo(x, gy0);
      ctx.lineTo(x, gy0 + gridRows * gt);
      ctx.stroke();
    }
    for (let gy = 0; gy <= gridRows; gy++) {
      const y = gy0 + gy * gt;
      ctx.beginPath();
      ctx.moveTo(gx0, y);
      ctx.lineTo(gx0 + gridCols * gt, y);
      ctx.stroke();
    }
    ctx.restore();
  };

  window.addEventListener("resize", redraw);
  colorInput?.addEventListener("input", redraw);
  levelSel?.addEventListener("change", redraw);
  zoomRange?.addEventListener("input", redraw);

  redraw();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
});
