import { renderInk, INK_DEFAULTS } from '/static/js/ink.js';

/**
 * The tuning page: draw once, then watch the settings change the result.
 *
 * The same strokes are redrawn on every adjustment rather than asking for a new
 * signature each time, because comparing two settings is only meaningful
 * against identical input.
 */

const KEYS = ['tolerance', 'smoothing', 'minWidth', 'maxWidth', 'speedCap'];
const STEP = { tolerance: 1, smoothing: 0, minWidth: 1, maxWidth: 1, speedCap: 1 };

const pad = document.getElementById('pad');
const ctx = pad.getContext('2d');
const hint = document.getElementById('pad-hint');
const rawCanvas = document.getElementById('out-raw');
const inkCanvas = document.getElementById('out-ink');

let strokes = [];
let current = null;

/* ------------------------------------------------------------------ canvas */

function fit(canvas, cssHeight) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round((cssHeight ?? rect.height) * dpr);
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx: c, width: rect.width, height: cssHeight ?? rect.height };
}

function sizeAll() {
  fit(pad);
  redrawLive();
  render();
}

function redrawLive() {
  const rect = pad.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.strokeStyle = INK_DEFAULTS.colour;
  ctx.fillStyle = INK_DEFAULTS.colour;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const s of strokes) {
    if (s.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(s[0].x, s[0].y);
    for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
    ctx.stroke();
  }
  hint.hidden = strokes.length > 0;
}

const pointFrom = (e) => {
  const r = pad.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, t: Math.round(performance.now()) };
};

pad.addEventListener('pointerdown', (e) => {
  pad.setPointerCapture(e.pointerId);
  current = [pointFrom(e)];
  strokes.push(current);
  redrawLive();
  e.preventDefault();
});

pad.addEventListener('pointermove', (e) => {
  if (!current) return;
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events.length ? events : [e]) current.push(pointFrom(ev));
  redrawLive();
});

function end() {
  if (!current) return;
  current = null;
  render();
}
pad.addEventListener('pointerup', end);
pad.addEventListener('pointercancel', end);
pad.addEventListener('pointerleave', end);

document.getElementById('clear-btn').addEventListener('click', () => {
  strokes = [];
  current = null;
  redrawLive();
  render();
});

/* ----------------------------------------------------------------- render */

const read = () => Object.fromEntries(KEYS.map((k) => [k, Number(document.getElementById(k).value)]));

function render() {
  const opts = read();
  const padRect = pad.getBoundingClientRect();

  for (const [canvas, options] of [
    // Raw: no simplification, no softening, one width. What the finger gave.
    [rawCanvas, { tolerance: 0, smoothing: 0, minWidth: 1.6, maxWidth: 1.6, speedCap: 99 }],
    [inkCanvas, opts],
  ]) {
    const { ctx: c, width, height } = fit(canvas, 150);
    c.clearRect(0, 0, width, height);
    if (!strokes.length) continue;
    // Scaled to fit the comparison box, so both show the whole signature.
    const scale = Math.min(width / padRect.width, height / padRect.height);
    c.save();
    c.scale(scale, scale);
    renderInk(c, strokes, options);
    c.restore();
  }
}

for (const k of KEYS) {
  const input = document.getElementById(k);
  const out = document.getElementById(`${k}-out`);
  const show = () => { out.textContent = Number(input.value).toFixed(STEP[k]); };
  input.addEventListener('input', () => { show(); render(); });
  show();
}

document.getElementById('reset-btn').addEventListener('click', () => {
  const d = window.__TUNE__.defaults;
  for (const k of KEYS) {
    const input = document.getElementById(k);
    input.value = d[k];
    document.getElementById(`${k}-out`).textContent = Number(d[k]).toFixed(STEP[k]);
  }
  render();
});

window.addEventListener('resize', () => {
  clearTimeout(window.__rt);
  window.__rt = setTimeout(() => { if (!strokes.length) sizeAll(); else render(); }, 200);
});

sizeAll();
