/**
 * Produces screenshots of the whole flow against a throwaway instance, so the
 * app can be reviewed without signing anything real into the live database.
 *
 *   node scripts/walkthrough.js <outDir>
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium, devices } from 'playwright-core';

const OUT = process.argv[2] || path.resolve(import.meta.dirname, '..', 'walkthrough');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-walk-'));
const PORT = 3192;
const BASE = `http://127.0.0.1:${PORT}`;
fs.mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ['src/server.js'], {
  cwd: path.resolve(import.meta.dirname, '..'),
  env: {
    ...process.env, NODE_ENV: 'development', PORT: String(PORT), BASE_URL: BASE,
    STORAGE_DIR: TMP, DB_PATH: path.join(TMP, 'walk.db'),
    SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
    ORG_NAME: 'Protea Heights Academy',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });

for (let i = 0; i < 120; i++) {
  try { await fetch(`${BASE}/healthz`); break; } catch { await new Promise((r) => setTimeout(r, 150)); }
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });

/**
 * Paths shaped like handwriting rather than a sine wave: loops, a baseline,
 * ascenders, and a trailing flourish, with the tremor a finger really adds.
 */
function handwriting(seed, pad) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const jit = () => (rnd() - 0.5) * 2.4;

  const baseY = pad.y + pad.height * 0.56;
  const left = pad.x + pad.width * 0.10;
  const span = pad.width * 0.74;
  const strokes = [];

  // The main run of letters: loops riding a baseline, drifting rightwards.
  const main = [];
  const loops = 5 + Math.floor(rnd() * 2);
  const steps = 190;
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    const loop = Math.sin(p * Math.PI * loops * 2);
    const asc = Math.sin(p * Math.PI * loops) * (0.5 + rnd() * 0.1);
    main.push({
      x: left + p * span + Math.sin(p * Math.PI * loops * 2) * 5 + jit(),
      y: baseY - loop * 26 - asc * 20 - (p < 0.12 ? (0.12 - p) * 160 : 0) + jit(),
    });
  }
  strokes.push(main);

  // A crossing stroke, the way a t-bar or an underline is added afterwards.
  const bar = [];
  for (let i = 0; i <= 30; i++) {
    const p = i / 30;
    bar.push({ x: left + span * (0.18 + p * 0.5) + jit(), y: baseY - 34 + Math.sin(p * Math.PI) * -4 + jit() });
  }
  strokes.push(bar);

  // A trailing flourish off the end.
  const tail = [];
  for (let i = 0; i <= 40; i++) {
    const p = i / 40;
    tail.push({
      x: left + span * (0.78 + p * 0.26) + jit(),
      y: baseY + Math.sin(p * Math.PI * 1.6) * 20 - p * 10 + jit(),
    });
  }
  strokes.push(tail);
  return strokes;
}

/** Signs on the pad through real touch input, at a human, uneven speed. */
async function sign(page, cdp, seed) {
  const pad = await page.locator('#pad').boundingBox();
  const pt = (x, y) => [{ x, y, radiusX: 9, radiusY: 9, force: 1 }];
  for (const strokePath of handwriting(seed, pad)) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(strokePath[0].x, strokePath[0].y) });
    for (let i = 1; i < strokePath.length; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(strokePath[i].x, strokePath[i].y) });
      // Uneven timing, so the speed-to-width mapping has something to work with.
      if (i % 3 === 0) await page.waitForTimeout(i % 7 === 0 ? 18 : 6);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(140);
  }
}

const PEOPLE = [
  ['Jane', 'Mahlangu', 7],
  ['Thabo', 'Nkosi', 23],
  ['Sarah', 'van Wyk', 41],
];

/* ------------------------------------------------ the capture, on a phone */
const phone = await browser.newContext({ ...devices['iPhone 13'] });
const page = await phone.newPage();
const cdp = await phone.newCDPSession(page);

for (const [first, last, seed] of PEOPLE) {
  await page.goto(BASE);
  await page.fill('#first-name', first);
  await page.fill('#last-name', last);
  await sign(page, cdp, seed);
  await page.waitForTimeout(800);

  if (first === 'Jane') {
    // Scrolled so the smoothed preview is actually in shot.
    await page.locator('#preview-wrap').scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, '1-signing-phone.png') });
  }

  await page.locator('#submit-btn').tap();
  await page.waitForSelector('#thanks:not([hidden])', { timeout: 15000 });
  if (first === 'Jane') await page.screenshot({ path: path.join(OUT, '2-thanks-phone.png') });
}

/* ------------------------------------------------------------ the admin */
const desk = await browser.newContext({ viewport: { width: 1340, height: 980 } });
const ap = await desk.newPage();
await ap.goto(`${BASE}/setup`);
await ap.fill('#display_name', 'Luan');
await ap.fill('#email', 'llotter@phahs.org.za');
await ap.fill('#password', 'a-long-enough-password');
await ap.click('form[action="/setup"] button[type=submit]');
await ap.waitForURL('**/admin');
await ap.waitForTimeout(500);
await ap.screenshot({ path: path.join(OUT, '3-admin.png'), fullPage: true });

await ap.emulateMedia({ colorScheme: 'dark' });
await ap.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await ap.waitForTimeout(250);
await ap.screenshot({ path: path.join(OUT, '4-admin-dark.png'), fullPage: true });

/* ------------------------------- the exported file, shown as it will be used */
const files = fs.readdirSync(path.join(TMP, 'signatures')).filter((f) => f.endsWith('.png'));
for (const [i, f] of files.entries()) {
  fs.copyFileSync(path.join(TMP, 'signatures', f), path.join(OUT, `export-${i + 1}.png`));
}

// Placed on a mock document line, which is where these actually end up.
const asDataUri = (f) => 'data:image/png;base64,' + fs.readFileSync(path.join(TMP, 'signatures', f)).toString('base64');
const doc = await desk.newPage();
await doc.setViewportSize({ width: 900, height: 620 });
await doc.setContent(`
  <body style="margin:0;background:#eceef2;font:15px system-ui;padding:36px">
    <div style="background:#fff;padding:44px 52px;border-radius:6px;box-shadow:0 2px 14px rgba(0,0,0,.12);max-width:740px;margin:0 auto">
      <div style="font:700 17px system-ui;color:#0e1420;margin-bottom:6px">Indemnity Form</div>
      <div style="color:#626e81;font-size:13.5px;margin-bottom:34px">Protea Heights Academy</div>
      ${files.slice(0, 3).map((f, i) => `
        <div style="margin-bottom:30px">
          <img src="${asDataUri(f)}" style="display:block;height:58px;width:auto;margin-bottom:-6px">
          <div style="border-top:1px solid #333;padding-top:5px;font-size:12.5px;color:#4a5567;width:330px">
            ${['Jane Mahlangu', 'Thabo Nkosi', 'Sarah van Wyk'][i]} &nbsp;·&nbsp; Parent / Guardian
          </div>
        </div>`).join('')}
    </div>
  </body>`);
await doc.waitForTimeout(300);
await doc.screenshot({ path: path.join(OUT, '5-placed-on-a-document.png') });

console.log(`screenshots and exported PNGs -> ${OUT}`);
console.log(files.map((f) => '  ' + f).join('\n'));

await browser.close();
server.kill();
await new Promise((r) => (server.exitCode === null ? server.once('exit', r) : r()));
try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 120 }); } catch {}
