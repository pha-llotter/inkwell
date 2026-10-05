import { db, nowIso } from './db.js';

/**
 * The shipped defaults are a starting point, not an answer: a finger on a
 * 60Hz phone and a stylus on a tablet want different numbers. These are what
 * the administrator settles on after seeing their own handwriting.
 */
export const DEFAULTS = {
  tolerance: 1.5,
  smoothing: 2,
  minWidth: 0.8,
  maxWidth: 4.4,
  speedCap: 1.5,
};

const LIMITS = {
  tolerance: [0, 6],
  smoothing: [0, 6],
  minWidth: [0.2, 4],
  maxWidth: [1, 10],
  speedCap: [0.3, 5],
};

export function inkSettings() {
  const row = db.prepare('SELECT * FROM ink_settings WHERE id = 1').get() || {};
  return {
    // A column that was never set falls back, so a fresh install and a
    // half-filled row both behave.
    tolerance: row.tolerance ?? DEFAULTS.tolerance,
    smoothing: row.smoothing ?? DEFAULTS.smoothing,
    minWidth: row.min_width ?? DEFAULTS.minWidth,
    maxWidth: row.max_width ?? DEFAULTS.maxWidth,
    speedCap: row.speed_cap ?? DEFAULTS.speedCap,
  };
}

/** Clamps rather than rejects: a slider cannot send anything meaningful to
 *  refuse, and silently sane values beat an error nobody can act on. */
function clamp(key, value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const [lo, hi] = LIMITS[key];
  return Math.min(hi, Math.max(lo, n));
}

export function saveInkSettings(values) {
  const now = inkSettings();
  const next = {
    tolerance: clamp('tolerance', values.tolerance, now.tolerance),
    smoothing: Math.round(clamp('smoothing', values.smoothing, now.smoothing)),
    minWidth: clamp('minWidth', values.minWidth, now.minWidth),
    maxWidth: clamp('maxWidth', values.maxWidth, now.maxWidth),
    speedCap: clamp('speedCap', values.speedCap, now.speedCap),
  };
  // A minimum above the maximum would render nothing; keep them in order.
  if (next.minWidth > next.maxWidth) next.minWidth = next.maxWidth;

  db.prepare(
    `UPDATE ink_settings
     SET tolerance = ?, smoothing = ?, min_width = ?, max_width = ?, speed_cap = ?, updated_at = ?
     WHERE id = 1`
  ).run(next.tolerance, next.smoothing, next.minWidth, next.maxWidth, next.speedCap, nowIso());
  return next;
}
