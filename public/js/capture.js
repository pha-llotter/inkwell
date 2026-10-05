import { renderToPng, INK_DEFAULTS } from '/static/js/ink.js';

/**
 * The capture page, in three stages: sign, review, done.
 *
 * The pad draws a thin live trace while the finger moves, which has to be
 * instant and so is not smoothed — smoothing as you draw lags behind the finger
 * and feels broken. The smoothed result is shown afterwards, on its own screen,
 * because accepting your own signature should be a decision someone actually
 * makes rather than a preview they can skip past.
 */

const el = {
  form: document.getElementById('capture-form'),
  first: document.getElementById('first-name'),
  last: document.getElementById('last-name'),
  pad: document.getElementById('pad'),
  clear: document.getElementById('clear-btn'),
  submit: document.getElementById('submit-btn'),
  error: document.getElementById('capture-error'),
  hint: document.getElementById('pad-hint'),

  stage: document.getElementById('stage'),
  review: document.getElementById('review'),
  reviewImg: document.getElementById('review-img'),
  reviewName: document.getElementById('review-name'),
  reviewError: document.getElementById('review-error'),
  redo: document.getElementById('redo-btn'),
  accept: document.getElementById('accept-btn'),

  thanks: document.getElementById('thanks'),
  thanksName: document.getElementById('thanks-name'),
  again: document.getElementById('again-btn'),
};

const ctx = el.pad.getContext('2d');
let strokes = [];
let current = null;
let startedAt = 0;

/**
 * The exact PNG the person was shown. Held rather than re-rendered on accept,
 * so what gets saved is the image they looked at and not a second render that
 * could differ.
 */
let approved = null;

/* ------------------------------------------------------------------ canvas */

function sizePad() {
  const rect = el.pad.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  el.pad.width = Math.round(rect.width * dpr);
  el.pad.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redrawLive();
}

/** The live trace: plain thin lines, drawn as fast as the events arrive. */
function redrawLive() {
  const rect = el.pad.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.strokeStyle = INK_DEFAULTS.colour;
  ctx.fillStyle = INK_DEFAULTS.colour;
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const s of strokes) {
    if (s.length === 1) {
      ctx.beginPath();
      ctx.arc(s[0].x, s[0].y, 1.2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    if (s.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(s[0].x, s[0].y);
    for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
    ctx.stroke();
  }
  el.hint.hidden = strokes.length > 0;
}

const pointFrom = (e) => {
  const r = el.pad.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, t: Math.round(performance.now()) };
};

el.pad.addEventListener('pointerdown', (e) => {
  // The pad owns the gesture. Without this the browser treats a drag as a
  // scroll, cancels the pointer stream mid-stroke, and nothing gets drawn.
  el.pad.setPointerCapture(e.pointerId);
  if (!startedAt) startedAt = performance.now();
  current = [pointFrom(e)];
  strokes.push(current);
  redrawLive();
  e.preventDefault();
});

el.pad.addEventListener('pointermove', (e) => {
  if (!current) return;
  // Coalesced events give every sample the hardware captured between frames,
  // not just the latest. More samples make the speed estimate — and so the
  // stroke width — noticeably better on a high-rate screen.
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events.length ? events : [e]) current.push(pointFrom(ev));
  redrawLive();
});

function endStroke() {
  if (!current) return;
  current = null;
  updateState();
}
el.pad.addEventListener('pointerup', endStroke);
el.pad.addEventListener('pointercancel', endStroke);
el.pad.addEventListener('pointerleave', endStroke);

const hasInk = () => strokes.reduce((n, s) => n + s.length, 0) >= 8;

function updateState() {
  const named = el.first.value.trim() && el.last.value.trim();
  el.submit.disabled = !(named && hasInk());
}

el.first.addEventListener('input', updateState);
el.last.addEventListener('input', updateState);

el.clear.addEventListener('click', () => {
  strokes = [];
  current = null;
  startedAt = 0;
  redrawLive();
  el.error.hidden = true;
  updateState();
});

/* --------------------------------------------------------------- stages -- */

function show(stage) {
  el.stage.hidden = stage !== 'sign';
  el.review.hidden = stage !== 'review';
  el.thanks.hidden = stage !== 'thanks';
  window.scrollTo({ top: 0, behavior: 'auto' });
}

/** Sign -> review. Renders once, and keeps what it rendered. */
el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (el.submit.disabled) return;

  const rect = el.pad.getBoundingClientRect();
  // Rendered at 3x so the PNG stays crisp wherever it is placed afterwards.
  const out = renderToPng(strokes, { width: rect.width, height: rect.height, scale: 3, padding: 10 });
  if (!out) {
    el.error.textContent = 'That signature came out empty. Please sign again.';
    el.error.hidden = false;
    return;
  }

  approved = {
    png: out.toDataURL('image/png'),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    durationMs: Math.round(performance.now() - startedAt),
    firstName: el.first.value.trim(),
    lastName: el.last.value.trim(),
    strokes: strokes.map((s) => s.map((p) => ({
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      t: p.t,
    }))),
  };

  el.reviewImg.src = approved.png;
  el.reviewName.textContent = `${approved.firstName} ${approved.lastName}`;
  el.reviewError.hidden = true;
  el.accept.disabled = false;
  el.accept.textContent = 'Yes, that is mine';
  show('review');
  el.accept.focus();
});

/** Review -> sign, with the pad cleared and the name kept. */
el.redo.addEventListener('click', () => {
  approved = null;
  strokes = [];
  current = null;
  startedAt = 0;
  show('sign');
  sizePad();
  updateState();
});

/** Review -> saved. The only point at which anything leaves the device. */
el.accept.addEventListener('click', async () => {
  if (!approved) return;
  el.accept.disabled = true;
  el.accept.textContent = 'Saving...';
  el.reviewError.hidden = true;

  try {
    const res = await fetch('/api/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...approved,
        website: document.getElementById('website').value,  // honeypot
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'That did not save. Please try again.');

    el.thanksName.textContent = data.name || '';
    show('thanks');
  } catch (err) {
    el.reviewError.textContent = err.message;
    el.reviewError.hidden = false;
    el.accept.disabled = false;
    el.accept.textContent = 'Yes, that is mine';
  }
});

/** Resets for the next person, without a page load. */
el.again.addEventListener('click', () => {
  approved = null;
  strokes = [];
  current = null;
  startedAt = 0;
  el.first.value = '';
  el.last.value = '';
  el.submit.textContent = 'Done';
  show('sign');
  sizePad();
  updateState();
  el.first.focus();
});

window.addEventListener('resize', () => {
  clearTimeout(window.__rt);
  // Resizing the pad clears it, so only do it while there is nothing to lose.
  window.__rt = setTimeout(() => { if (!strokes.length) sizePad(); }, 200);
});

sizePad();
updateState();
