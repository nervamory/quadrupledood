const CARD = 68;

export interface CustomFoilParams {
  glitterCount:      number;   // 0–120
  glitterPeriodMs:   number;   // 200–5000 ms  (twinkle period)
  glitterAlpha:      number;   // 0–1
  hatchEnabled:      boolean;
  hatchSpacing:      number;   // 1–20 px
  hatchOpacity:      number;   // 0–0.30
  gradientPeriodMs:  number;   // 1000–30000 ms (full-rotation period)
  gradientOpacity1:  number;   // 0–1
  gradientOpacity2:  number;   // 0–1
  gradientOffset:    number;   // 0–1  (fraction of 2π for 2nd gradient angle)
  blendHardLight:    boolean;
  sheenEnabled:      boolean;
  sheenPeriodMs:     number;   // 500–10000 ms (sweep period)
  sheenWidth:        number;   // 0.05–0.90  (fraction of card width)
  sheenBrightness:   number;   // 0–0.60
  gradient1Colors:   [string, string, string, string, string, string];  // 6 hue stops
  gradient2Colors:   [string, string, string, string];                  // 4 shimmer stops
}

export const DEFAULT_CUSTOM_FOIL: CustomFoilParams = {
  glitterCount:     60,
  glitterPeriodMs:  900,
  glitterAlpha:     0.9,
  hatchEnabled:     true,
  hatchSpacing:     5,
  hatchOpacity:     0.06,
  gradientPeriodMs: 8000,
  gradientOpacity1: 0.82,
  gradientOpacity2: 0.50,
  gradientOffset:   0.19,   // ≈ Math.PI*0.38 offset as fraction of 2π
  blendHardLight:   true,
  sheenEnabled:     true,
  sheenPeriodMs:    3500,
  sheenWidth:       0.35,
  sheenBrightness:  0.20,
  gradient1Colors:  ['#ff1478', '#ff8c00', '#8cff64', '#00d2ff', '#5a64ff', '#d246ff'],
  gradient2Colors:  ['#ffffd2', '#d2ffe6', '#d2d2ff', '#ffdcff'],
};

export function loadCustomFoilParams(): CustomFoilParams {
  try {
    const raw = localStorage.getItem('customFoil');
    if (raw) return { ...DEFAULT_CUSTOM_FOIL, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_CUSTOM_FOIL };
}

export function saveCustomFoilParams(p: CustomFoilParams): void {
  localStorage.setItem('customFoil', JSON.stringify(p));
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function drawCustomFoil(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  p: CustomFoilParams,
  now: number,
): void {
  const cx = x + CARD / 2;
  const cy = y + CARD / 2;
  const spacing = Math.max(1, p.hatchSpacing);
  const glitterPeriod = Math.max(1, p.glitterPeriodMs);
  const gradientPeriod = Math.max(1, p.gradientPeriodMs);
  const sheenPeriod = Math.max(1, p.sheenPeriodMs);

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, CARD, CARD, 6);
  ctx.clip();

  // Layer 1: glitter dots
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'white';
  for (let i = 0; i < p.glitterCount; i++) {
    const fx = (i * 0.618033) % 1;
    const fy = (i * 0.381966) % 1;
    const sz = 0.25 + (i % 4) * 0.18;
    const twinkle = i % 3 === 0
      ? Math.abs(Math.sin(now / glitterPeriod * Math.PI * 2 + i * 1.1))
      : 0.45 + (i % 7) * 0.08;
    ctx.globalAlpha = twinkle * p.glitterAlpha;
    ctx.beginPath();
    ctx.arc(x + fx * CARD, y + fy * CARD, sz, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Layer 2: cross-hatch texture
  if (p.hatchEnabled) {
    ctx.strokeStyle = `rgba(255,255,255,${p.hatchOpacity})`;
    ctx.lineWidth = 0.5;
    for (let d = -CARD; d < CARD * 2; d += spacing) {
      ctx.beginPath(); ctx.moveTo(x + d, y); ctx.lineTo(x + d + CARD, y + CARD); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + d + CARD, y); ctx.lineTo(x + d, y + CARD); ctx.stroke();
    }
  }

  // Layer 3: rotating rainbow gradients
  ctx.globalCompositeOperation = p.blendHardLight ? 'hard-light' : 'source-over';
  const a = (now / gradientPeriod) * Math.PI * 2;
  const r = CARD;

  const g1 = ctx.createLinearGradient(
    cx + Math.cos(a) * r, cy + Math.sin(a) * r,
    cx - Math.cos(a) * r, cy - Math.sin(a) * r,
  );
  const c1 = p.gradient1Colors;
  const stops1 = [0, 0.17, 0.33, 0.50, 0.67, 0.83] as const;
  stops1.forEach((stop, i) => g1.addColorStop(stop, hexToRgba(c1[i], p.gradientOpacity1)));
  g1.addColorStop(1, hexToRgba(c1[0], p.gradientOpacity1));
  ctx.fillStyle = g1;
  ctx.fillRect(x, y, CARD, CARD);

  const a2 = a + p.gradientOffset * Math.PI * 2;
  const g2 = ctx.createLinearGradient(
    cx + Math.cos(a2) * r, cy + Math.sin(a2) * r,
    cx - Math.cos(a2) * r, cy - Math.sin(a2) * r,
  );
  const c2 = p.gradient2Colors;
  g2.addColorStop(0,   hexToRgba(c2[0], p.gradientOpacity2));
  g2.addColorStop(0.4, hexToRgba(c2[1], p.gradientOpacity2));
  g2.addColorStop(0.7, hexToRgba(c2[2], p.gradientOpacity2));
  g2.addColorStop(1,   hexToRgba(c2[3], p.gradientOpacity2));
  ctx.fillStyle = g2;
  ctx.fillRect(x, y, CARD, CARD);

  ctx.globalCompositeOperation = 'source-over';

  // Layer 4: sheen sweep
  if (p.sheenEnabled) {
    const sheenPos = ((now / sheenPeriod) % 1.6) - 0.3;
    const sx = x + sheenPos * CARD;
    const sheen = ctx.createLinearGradient(sx, y, sx + CARD * p.sheenWidth, y);
    sheen.addColorStop(0,   'rgba(255,255,255,0)');
    sheen.addColorStop(0.5, `rgba(255,255,255,${p.sheenBrightness})`);
    sheen.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(x, y, CARD, CARD);
  }

  ctx.restore();
}
