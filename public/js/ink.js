/**
 * Turning a finger-drawn scrawl into something that reads as a pen.
 *
 * No model is involved, deliberately. Smoothing a signature is a geometry
 * problem with a known answer, and curve fitting beats a learned one here: it
 * is instant, predictable, has nothing to download, and never invents a stroke
 * the person did not make. For a signature, which is evidence, not inventing
 * anything matters rather more than looking clever.
 *
 * The pipeline, in order:
 *   1. drop duplicate and near-duplicate samples (touchscreens emit many)
 *   2. low-pass the positions to kill finger tremor
 *   3. measure speed at every point
 *   4. turn speed into stroke width: fast is thin, slow is thick. This is the
 *      single thing that most makes a line look like ink rather than a cable
 *   5. low-pass the widths too, or the stroke pulses
 *   6. draw as Catmull-Rom curves, as a filled ribbon between two offset edges
 */

/** Squared distance, to avoid a sqrt in the hot filter loop. */
const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/**
 * Touchscreens report the same coordinate many times while a finger rests, and
 * those duplicates make the speed estimate read as zero and blob the stroke.
 */
function dedupe(points, minDist = 1.1) {
  const out = [];
  for (const p of points) {
    if (!out.length || d2(p, out[out.length - 1]) >= minDist * minDist) out.push(p);
  }
  // A deliberate dot is a real mark; keep it rather than discarding the stroke.
  return out.length ? out : points.slice(0, 1);
}

/**
 * Symmetric moving average over positions. Endpoints are preserved exactly, so
 * the signature neither shrinks nor drifts from where it was drawn.
 */
function smoothPositions(points, window = 2) {
  if (points.length < 3) return points;
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(points.length - 1, i + window);
    let x = 0, y = 0, n = 0;
    for (let j = lo; j <= hi; j++) { x += points[j].x; y += points[j].y; n++; }
    out.push({ x: x / n, y: y / n, t: points[i].t });
  }
  out[0] = points[0];
  out[out.length - 1] = points[points.length - 1];
  return out;
}

/**
 * Width from speed. A pen lays down more ink where the hand slows: at the start
 * of a stroke, in tight turns, at the end, and less through fast sweeps.
 * Reproducing that is most of what separates ink from a drawn cable.
 */
function widths(points, { minWidth, maxWidth, speedCap }) {
  const raw = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const dt = Math.max(1, (b.t ?? 0) - (a.t ?? 0));
    const k = Math.min(1, dist / dt / speedCap);
    raw.push(maxWidth - (maxWidth - minWidth) * k);
  }

  // Without this the width jumps sample to sample and the edge looks serrated.
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const lo = Math.max(0, i - 3);
    const hi = Math.min(raw.length - 1, i + 3);
    let s = 0, n = 0;
    for (let j = lo; j <= hi; j++) { s += raw[j]; n++; }
    out.push(s / n);
  }

  // Taper the ends so a stroke lifts off rather than stopping square.
  const taper = Math.min(4, Math.floor(out.length / 6));
  for (let i = 0; i < taper; i++) {
    const f = 0.45 + 0.55 * (i / taper);
    out[i] *= f;
    out[out.length - 1 - i] *= f;
  }
  return out;
}

/** Catmull-Rom through the samples, sampled densely enough to look continuous. */
function spline(points, perSegment = 8) {
  if (points.length < 3) return points.map((p, i) => ({ ...p, i }));
  const out = [];
  const at = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let s = 0; s < perSegment; s++) {
      const t = s / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        i: i + t,
      });
    }
  }
  out.push({ ...points[points.length - 1], i: points.length - 1 });
  return out;
}

export const INK_DEFAULTS = {
  minWidth: 0.9,
  maxWidth: 3.0,
  speedCap: 2.2,          // px per ms at which the stroke reaches its thinnest
  colour: '#0b1220',
  smoothing: 2,
};

/**
 * Draws one stroke as a filled ribbon: the spline offset to each side by half
 * the local width. Stroking a path cannot vary its width along the way, which
 * is exactly the effect that makes this look like a pen.
 */
function drawStroke(ctx, raw, opts) {
  const pts = smoothPositions(dedupe(raw), opts.smoothing);

  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, opts.maxWidth * 0.55, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const w = widths(pts, opts);
  const curve = spline(pts);
  const widthAt = (i) => {
    const lo = Math.min(Math.floor(i), w.length - 1);
    const hi = Math.min(lo + 1, w.length - 1);
    const f = i - Math.floor(i);
    return w[lo] * (1 - f) + w[hi] * f;
  };

  const left = [];
  const right = [];
  for (let i = 0; i < curve.length; i++) {
    const p = curve[i];
    const a = curve[Math.max(0, i - 1)];
    const b = curve[Math.min(curve.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const half = widthAt(p.i) / 2;
    const nx = (-dy / len) * half;
    const ny = (dx / len) * half;
    left.push({ x: p.x + nx, y: p.y + ny });
    right.push({ x: p.x - nx, y: p.y - ny });
  }

  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (const p of left) ctx.lineTo(p.x, p.y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fill();

  // Round the ends, so a stroke starts and stops like a nib rather than a blade.
  for (const end of [curve[0], curve[curve.length - 1]]) {
    ctx.beginPath();
    ctx.arc(end.x, end.y, widthAt(end.i) / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Renders every stroke onto a context already scaled to the target size. */
export function renderInk(ctx, strokes, options = {}) {
  const opts = { ...INK_DEFAULTS, ...options };
  ctx.fillStyle = opts.colour;
  ctx.strokeStyle = opts.colour;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const s of strokes) if (s && s.length) drawStroke(ctx, s, opts);
}

/**
 * Renders at a multiple of the captured size and trims the transparent margin,
 * so the PNG is crisp wherever it is placed and carries no padding of its own.
 */
export function renderToPng(strokes, { width, height, scale = 3, padding = 10, ...options } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  renderInk(ctx, strokes, options);
  return trim(canvas, padding);
}

/**
 * Crops to the ink. Without this a signature drawn in one corner would be
 * centred as though it filled the box, and land in the wrong place wherever it
 * is used.
 */
export function trim(canvas, padding = 10) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const { data } = ctx.getImageData(0, 0, w, h);

  let top = h;
  let left = w;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (right <= left || bottom <= top) return null;

  left = Math.max(0, left - padding);
  top = Math.max(0, top - padding);
  right = Math.min(w - 1, right + padding);
  bottom = Math.min(h - 1, bottom + padding);

  const out = document.createElement('canvas');
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out.getContext('2d').drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
