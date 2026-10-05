/**
 * Renders the same captured strokes raw and smoothed, side by side, so the
 * effect of the pipeline can be judged by eye rather than asserted.
 *
 *   node scripts/ink-preview.js <outDir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const OUT = process.argv[2] || path.resolve(import.meta.dirname, '..', 'ui-check');
fs.mkdirSync(OUT, { recursive: true });

const inkSource = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'public', 'js', 'ink.js'), 'utf8');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 2 });

await page.route('**/ink.js', (r) => r.fulfill({ body: inkSource, contentType: 'text/javascript' }));
await page.route('**/preview.html', (r) => r.fulfill({
  contentType: 'text/html',
  body: `<!doctype html><body style="margin:0;background:#fff;font:14px system-ui">
    <div id="out"></div></body>`,
}));
await page.goto('https://preview.local/preview.html');

const shot = await page.evaluate(async () => {
  const { renderInk } = await import('/ink.js');

  /**
   * A synthetic signature with the tremor a finger actually produces: the
   * high-frequency wobble is the thing the filter is there to remove, and the
   * varying speed is what drives the line weight.
   */
  function fakeSignature() {
    const strokes = [];
    let t = 0;
    const jitter = () => (Math.random() - 0.5) * 5.5;

    const main = [];
    for (let i = 0; i <= 70; i++) {
      const p = i / 70;
      // Deliberately uneven speed: slow at the start, fast through the middle.
      const speed = 0.35 + Math.sin(p * Math.PI) * 1.5;
      t += 16 / speed;
      main.push({
        x: 40 + p * 430 + jitter(),
        y: 120 - Math.sin(p * Math.PI * 2.4) * 46 - Math.sin(p * 11) * 7 + jitter(),
        t: Math.round(t),
      });
    }
    strokes.push(main);

    const flick = [];
    for (let i = 0; i <= 45; i++) {
      const p = i / 45;
      t += 9;
      flick.push({
        x: 95 + p * 300 + jitter(),
        y: 168 + Math.sin(p * Math.PI * 1.1) * 15 + jitter(),
        t: Math.round(t),
      });
    }
    strokes.push(flick);
    return strokes;
  }

  const strokes = fakeSignature();
  const out = document.getElementById('out');

  function panel(title, draw) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:18px 24px';
    const h = document.createElement('div');
    h.textContent = title;
    h.style.cssText = 'font-weight:650;color:#4a5567;margin-bottom:6px;font-size:13px';
    const c = document.createElement('canvas');
    c.width = 520 * 2; c.height = 230 * 2;
    c.style.cssText = 'width:520px;height:230px;border:1px solid #e3e7ed;border-radius:12px;background:#fff';
    const ctx = c.getContext('2d');
    ctx.scale(2, 2);
    draw(ctx);
    wrap.append(h, c);
    out.appendChild(wrap);
  }

  // What the raw samples look like: uniform width, every wobble preserved.
  panel('A finger on a phone - raw samples, one width', (ctx) => {
    ctx.strokeStyle = '#0b1220';
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const s of strokes) {
      ctx.beginPath();
      ctx.moveTo(s[0].x, s[0].y);
      for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
      ctx.stroke();
    }
  });

  panel('After the new pipeline - noise discarded, curve fitted, weight from speed', (ctx) => {
    renderInk(ctx, strokes);
  });

  return true;
});

await page.screenshot({ path: path.join(OUT, 'ink-comparison.png') });
console.log(`comparison -> ${path.join(OUT, 'ink-comparison.png')}`);
await browser.close();
