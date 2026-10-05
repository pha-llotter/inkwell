/**
 * Turning a finger-drawn scrawl into something that reads as a pen.
 *
 * No model is involved, deliberately. Smoothing a signature is a geometry
 * problem with a known answer, and curve fitting beats a learned one here: it
 * is instant, predictable, and never invents a stroke the person did not make.
 * For a signature, which is kept as a record, that last point matters rather
 * more than looking clever.
 *
 * The pipeline, in order:
 *   1. drop duplicate samples (touchscreens emit many while a finger rests)
 *   2. SIMPLIFY: throw away the points that carry no shape. A moving average
 *      only shrinks the wobble; discarding the samples that sit within the
 *      noise floor removes it, and is what separates a clean line from a
 *      slightly-less-shaky one
 *   3. gently relax what is left, without moving the ends
 *   4. measure pen speed from the timestamps that survived
 *   5. turn speed into stroke width: fast thin, slow thick, with a long taper
 *      into and out of every stroke
 *   6. draw as Catmull-Rom curves, as a filled ribbon between two offset edges
 */

const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Touchscreens repeat coordinates; duplicates make speed read as zero. */
function dedupe(points, minDist = 0.9) {
  const out = [];
  for (const p of points) {
    if (!out.length || d2(p, out[out.length - 1]) >= minDist * minDist) out.push(p);
  }
  return out.length ? out : points.slice(0, 1);
}

/** Perpendicular distance from p to the segment ab, for the simplifier. */
function perpendicular(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Ramer-Douglas-Peucker. Keeps the points that define the shape and discards
 * the rest, so finger tremor is removed rather than averaged down. A genuine
 * sharp corner is further than the tolerance from its neighbours' chord, so it
 * survives; a wobble is not, so it does not. That distinction is the whole
 * reason this is used instead of a stronger blur, which would round off the
 * corners that make a signature recognisable.
 *
 * Iterative, not recursive: a long stroke on a high-rate screen is thousands of
 * points, and the recursive form can exhaust the stack on exactly the input
 * this is meant to handle.
 */
function simplify(points, tolerance) {
  if (points.length < 3 || tolerance <= 0) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let worst = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpendicular(points[i], points[first], points[last]);
      if (d > worst) { worst = d; index = i; }
    }
    if (worst > tolerance && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * A light relaxation of the surviving points. The ends are pinned, so the
 * signature neither shrinks nor drifts from where it was drawn.
 */
function relax(points, strength) {
  if (points.length < 3 || strength <= 0) return points;
  const out = points.map((p) => ({ ...p }));
  for (let pass = 0; pass < strength; pass++) {
    for (let i = 1; i < out.length - 1; i++) {
      out[i] = {
        x: out[i].x * 0.5 + (out[i - 1].x + out[i + 1].x) * 0.25,
        y: out[i].y * 0.5 + (out[i - 1].y + out[i + 1].y) * 0.25,
        t: out[i].t,
      };
    }
  }
  out[0] = points[0];
  out[out.length - 1] = points[points.length - 1];
  return out;
}

/**
 * Width from speed. A pen lays down more ink where the hand slows: at the start
 * of a stroke, in tight turns, at the end, and less through fast sweeps.
 * Reproducing that is most of what separates ink from a drawn cable, and a
 * finger needs more of it than a stylus, not less, because the input itself
 * carries no pressure at all.
 */
function widths(points, { minWidth, maxWidth, speedCap }) {
  const raw = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const dt = Math.max(1, (b.t ?? 0) - (a.t ?? 0));
    // Square-rooted, so the thinning comes on gradually across the usable range
    // of speeds rather than saturating the moment the hand moves at all.
    const k = Math.sqrt(Math.min(1, dist / dt / speedCap));
    raw.push(maxWidth - (maxWidth - minWidth) * k);
  }

  // Without this the width jumps sample to sample and the edge looks serrated.
  const span = Math.max(2, Math.round(points.length / 12));
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const lo = Math.max(0, i - span);
    const hi = Math.min(raw.length - 1, i + span);
    let s = 0;
    let n = 0;
    for (let j = lo; j <= hi; j++) { s += raw[j]; n++; }
    out.push(s / n);
  }

  // A long taper: a nib touching down and lifting off, rather than a line that
  // starts and stops at full weight.
  const taper = Math.max(2, Math.floor(out.length * 0.14));
  for (let i = 0; i < taper && i < out.length; i++) {
    const f = 0.25 + 0.75 * (i / taper) ** 0.7;
    out[i] *= f;
    out[out.length - 1 - i] *= f;
  }
  return out;
}

/** Catmull-Rom through the samples, dense enough to read as continuous. */
function spline(points, perSegment) {
  if (points.length < 3) return points.map((p, i) => ({ ...p, i }));
  const out = [];
  const at = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    // More samples where the span is long, so a simplified stroke stays smooth.
    const steps = Math.max(perSegment, Math.min(40, Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 1.5)));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
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
  /** How far a point must sit off its neighbours' line to count as shape
   *  rather than tremor. The single most effective control for finger input. */
  tolerance: 1.5,
  /** Relaxation passes over what survives. Too many and corners soften. */
  smoothing: 2,
  minWidth: 0.8,
  maxWidth: 4.4,
  /** Pixels per millisecond at which the stroke reaches its thinnest. */
  speedCap: 1.5,
  colour: '#0b1220',
  perSegment: 10,
};

function drawStroke(ctx, raw, opts) {
  const cleaned = dedupe(raw);

  if (cleaned.length === 1) {
    ctx.beginPath();
    ctx.arc(cleaned[0].x, cleaned[0].y, opts.maxWidth * 0.5, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const pts = relax(simplify(cleaned, opts.tolerance), opts.smoothing);
  if (pts.length < 2) return;

  const w = widths(pts, opts);
  const curve = spline(pts, opts.perSegment);
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
    left.push({ x: p.x + (-dy / len) * half, y: p.y + (dx / len) * half });
    right.push({ x: p.x - (-dy / len) * half, y: p.y - (dx / len) * half });
  }

  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (const p of left) ctx.lineTo(p.x, p.y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fill();

  // Round the ends, so a stroke starts and stops like a nib, not a blade.
  for (const end of [curve[0], curve[curve.length - 1]]) {
    ctx.beginPath();
    ctx.arc(end.x, end.y, Math.max(0.35, widthAt(end.i) / 2), 0, Math.PI * 2);
    ctx.fill();
  }
}

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
