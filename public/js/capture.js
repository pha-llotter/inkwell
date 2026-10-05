import { renderInk, renderToPng, INK_DEFAULTS } from '/static/js/ink.js';

/**
 * The capture page.
 *
 * Two canvases: the pad draws a thin live trace while the finger moves, which
 * has to be instant and so is not smoothed; the preview shows the finished,
 * smoothed ink. Smoothing as you draw would lag behind the finger and feel
 * broken, and seeing the result afterwards is what tells someone whether to
 * accept it or try again.
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
  preview: document.getElementById('preview'),
  previewWrap: document.getElementById('preview-wrap'),
  stage: document.getElementById('stage'),
  thanks: document.getElementById('thanks'),
  thanksName: document.getElementById('thanks-name'),
  again: document.getElementById('again-btn'),
};

const ctx = el.pad.getContext('2d');
let strokes = [];
let current = null;
let startedAt = 0;
let dpr = 1;

/* ------------------------------------------------------------------ canvas */

function sizePad() {
  const rect = el.pad.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 3);
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
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const s of strokes) {
    if (s.length < 2) {
      if (s.length === 1) {
        ctx.beginPath();
        ctx.arc(s[0].x, s[0].y, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = INK_DEFAULTS.colour;
        ctx.fill();
      }
      continue;
    }
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
  showPreview(false);
  e.preventDefault();
});

el.pad.addEventListener('pointermove', (e) => {
  if (!current) return;
  // Coalesced events give every sample the hardware captured between frames,
  // not just the latest. More samples make the speed estimate, and so the
  // stroke width, noticeably better on a high-rate screen.
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events.length ? events : [e]) current.push(pointFrom(ev));
  redrawLive();
});

function endStroke() {
  if (!current) return;
  current = null;
  updateState();
  showPreview(true);
}
el.pad.addEventListener('pointerup', endStroke);
el.pad.addEventListener('pointercancel', endStroke);
el.pad.addEventListener('pointerleave', endStroke);

/* ----------------------------------------------------------------- preview */

let previewTimer = null;
function showPreview(on) {
  clearTimeout(previewTimer);
  if (!on || !hasInk()) { el.previewWrap.hidden = true; return; }
  // Briefly delayed so it does not flash between the strokes of a signature.
  previewTimer = setTimeout(() => {
    const rect = el.pad.getBoundingClientRect();
    const out = renderToPng(strokes, { width: rect.width, height: rect.height, scale: 2, padding: 6 });
    if (!out) { el.previewWrap.hidden = true; return; }
    el.preview.src = out.toDataURL('image/png');
    el.previewWrap.hidden = false;
  }, 450);
}

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
  el.previewWrap.hidden = true;
  el.error.hidden = true;
  updateState();
});

/* ------------------------------------------------------------------ submit */

el.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (el.submit.disabled) return;

  const rect = el.pad.getBoundingClientRect();
  // Rendered at 3x so the PNG is crisp wherever it is placed afterwards.
  const out = renderToPng(strokes, { width: rect.width, height: rect.height, scale: 3, padding: 10 });
  if (!out) {
    el.error.textContent = 'That signature came out empty. Please sign again.';
    el.error.hidden = false;
    return;
  }

  el.submit.disabled = true;
  el.submit.textContent = 'Saving...';
  el.error.hidden = true;

  try {
    const res = await fetch('/api/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: el.first.value.trim(),
        lastName: el.last.value.trim(),
        website: document.getElementById('website').value,  // honeypot
        png: out.toDataURL('image/png'),
        strokes: strokes.map((s) => s.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, t: p.t }))),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        durationMs: Math.round(performance.now() - startedAt),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'That did not save. Please try again.');

    el.thanksName.textContent = data.name || '';
    el.stage.hidden = true;
    el.thanks.hidden = false;
  } catch (err) {
    el.error.textContent = err.message;
    el.error.hidden = false;
    el.submit.disabled = false;
    el.submit.textContent = 'Save my signature';
  }
});

/** Resets for the next person without a page load. */
el.again.addEventListener('click', () => {
  strokes = [];
  current = null;
  startedAt = 0;
  el.first.value = '';
  el.last.value = '';
  el.thanks.hidden = true;
  el.stage.hidden = false;
  el.previewWrap.hidden = true;
  el.submit.textContent = 'Save my signature';
  sizePad();
  updateState();
  el.first.focus();
});

window.addEventListener('resize', () => {
  clearTimeout(window.__rt);
  window.__rt = setTimeout(sizePad, 200);
});

sizePad();
updateState();
