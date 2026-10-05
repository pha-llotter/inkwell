/**
 * End-to-end check, driven through a real browser with touch input.
 *
 *   npm run check
 *
 * CDP input rather than synthetic events: dispatching PointerEvent objects from
 * page script fires listeners but never triggers the browser's own behaviour,
 * so a test built on them proves nothing about whether a finger would work.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium, devices } from 'playwright-core';
import { PNG } from 'pngjs';

const OUT = process.argv[2] || path.resolve(import.meta.dirname, '..', 'ui-check');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-check-'));
const PORT = 3190;
const BASE = `http://127.0.0.1:${PORT}`;
fs.mkdirSync(OUT, { recursive: true });

let passed = 0;
let failed = 0;
const check = (label, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${extra ? `\n          ${extra}` : ''}`); }
};

const server = spawn(process.execPath, ['src/server.js'], {
  cwd: path.resolve(import.meta.dirname, '..'),
  env: {
    ...process.env, NODE_ENV: 'development', PORT: String(PORT), BASE_URL: BASE,
    STORAGE_DIR: TMP, DB_PATH: path.join(TMP, 'check.db'),
    SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });

let browser;
let ok = false;

try {
  for (let i = 0; i < 120; i++) {
    try { await fetch(`${BASE}/healthz`); break; } catch { await new Promise((r) => setTimeout(r, 150)); }
  }

  browser = await chromium.launch({ channel: 'msedge', headless: true });
  console.log('\nInkwell check\n');

  /* ----------------------------------------------- capture, on a phone --- */
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(BASE);
  check('the capture page opens with no account and no link', await page.locator('#pad').isVisible());
  check('Save is disabled before anything is entered', await page.locator('#submit-btn').isDisabled());

  await page.fill('#first-name', 'Jane');
  await page.fill('#last-name', 'Mahlangu');
  check('Save is still disabled with a name but no signature',
    await page.locator('#submit-btn').isDisabled());

  // A signature drawn with a finger, through real touch input.
  const cdp = await ctx.newCDPSession(page);
  const pad = await page.locator('#pad').boundingBox();
  const pt = (x, y) => [{ x, y, radiusX: 10, radiusY: 10, force: 1 }];

  async function stroke(path) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(path[0][0], path[0][1]) });
    for (let i = 1; i < path.length; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(path[i][0], path[i][1]) });
      await page.waitForTimeout(12);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(90);
  }

  // Two strokes, like a real signature: a flowing one and a short cross.
  const cy = pad.y + pad.height * 0.55;
  const loop = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    loop.push([
      pad.x + 30 + t * (pad.width - 70),
      cy - Math.sin(t * Math.PI * 3) * 42 + Math.sin(t * 27) * 3,
    ]);
  }
  await stroke(loop);
  await stroke([
    [pad.x + 60, cy + 26],
    [pad.x + 110, cy + 18],
    [pad.x + 160, cy + 24],
  ]);

  check('drawing with a finger puts ink on the pad',
    await page.evaluate(() => {
      const c = document.getElementById('pad');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 10) return true;
      return false;
    }));

  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '1-capture.png') });

  check('Done becomes available once the name and signature are both there',
    !(await page.locator('#submit-btn').isDisabled()));

  /* ---- the review step ---- */
  await page.locator('#submit-btn').tap();
  await page.waitForSelector('#review:not([hidden])', { timeout: 10000 });
  check('the smoothed signature is shown for approval before anything is sent',
    await page.locator('#review-img').isVisible());
  check('nothing has been saved at the review step',
    !fs.existsSync(path.join(TMP, 'signatures')) ||
    fs.readdirSync(path.join(TMP, 'signatures')).length === 0,
    'files appeared before the person accepted');
  check('the review names the person it is about',
    (await page.locator('#review-name').textContent()).trim() === 'Jane Mahlangu');
  await page.screenshot({ path: path.join(OUT, '2-review.png') });

  const approved = await page.locator('#review-img').getAttribute('src');

  /* ---- redo really discards ---- */
  await page.locator('#redo-btn').tap();
  await page.waitForSelector('#stage:not([hidden])', { timeout: 10000 });
  check('Sign again returns to an empty pad, keeping the name',
    (await page.inputValue('#first-name')) === 'Jane' &&
    (await page.locator('#submit-btn').isDisabled()));
  check('Sign again saved nothing',
    !fs.existsSync(path.join(TMP, 'signatures')) ||
    fs.readdirSync(path.join(TMP, 'signatures')).length === 0);

  // Sign a second time and accept that one.
  await stroke(loop);
  await stroke([[pad.x + 60, cy + 26], [pad.x + 110, cy + 18], [pad.x + 160, cy + 24]]);
  await page.locator('#submit-btn').tap();
  await page.waitForSelector('#review:not([hidden])', { timeout: 10000 });

  const secondRender = await page.locator('#review-img').getAttribute('src');
  check('signing again produces a different image, not the discarded one',
    secondRender !== approved);

  await page.locator('#accept-btn').tap();
  await page.waitForSelector('#thanks:not([hidden])', { timeout: 15000 });
  check('saving confirms and thanks the person by name',
    (await page.locator('#thanks-name').textContent()) === 'Jane Mahlangu');
  await page.screenshot({ path: path.join(OUT, '3-thanks.png') });

  await page.locator('#again-btn').tap();
  await page.waitForTimeout(250);
  check('Capture another resets for the next person',
    (await page.inputValue('#first-name')) === '' && (await page.locator('#pad').isVisible()));

  check('no console errors on the capture page', errors.length === 0, errors.join('\n          '));

  /* --------------------------------------------------- the saved image --- */
  const files = fs.readdirSync(path.join(TMP, 'signatures'));
  const png = files.filter((f) => f.endsWith('.png'));
  const json = files.filter((f) => f.endsWith('.json'));
  check('a PNG and its raw strokes are both stored', png.length === 1 && json.length === 1,
    files.join(', '));

  const savedDataUri = 'data:image/png;base64,' +
    fs.readFileSync(path.join(TMP, 'signatures', png[0])).toString('base64');
  check('the file saved is exactly the image the person approved', savedDataUri === secondRender,
    'the saved image differs from the one shown for approval');

  const img = PNG.sync.read(fs.readFileSync(path.join(TMP, 'signatures', png[0])));
  check('the PNG is trimmed to the ink, not the whole pad',
    img.width > 40 && img.height > 20 && img.width < 1400,
    `${img.width}x${img.height}`);

  let opaque = 0;
  let transparent = 0;
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] > 200) opaque++; else if (img.data[i] < 10) transparent++;
  }
  check('the background is transparent, not white',
    transparent > opaque, `${transparent} clear vs ${opaque} solid pixels`);

  // Ink must be dark whatever theme the phone was in, or it is invisible on a
  // document. Sampled from the fully opaque pixels only.
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] > 240) { r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++; }
  }
  const lum = n ? (0.2126 * (r / n) + 0.7152 * (g / n) + 0.0722 * (b / n)) / 255 : 1;
  check('the ink is dark enough to place on a white document', n > 0 && lum < 0.25,
    `mean luminance ${lum.toFixed(3)}`);

  /* ---- the smoothing did something measurable ---- */
  const strokes = JSON.parse(fs.readFileSync(path.join(TMP, 'signatures', json[0]), 'utf8'));
  check('the raw points are kept so it can be redrawn later',
    Array.isArray(strokes) && strokes.length === 2 && strokes[0].length > 20,
    `${strokes.length} stroke(s), ${strokes.reduce((a, s) => a + s.length, 0)} points`);
  check('each point carries a timestamp, which is what drives line weight',
    strokes[0].every((p) => typeof p.t === 'number'));

  /* -------------------------------------------------------- the admin --- */
  const admin = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ap = await admin.newPage();

  await ap.goto(`${BASE}/admin`);
  check('the admin area is closed to someone not signed in',
    ap.url().endsWith('/setup') || ap.url().endsWith('/login'), ap.url());

  await ap.goto(`${BASE}/setup`);
  await ap.fill('#display_name', 'Luan');
  await ap.fill('#email', 'admin@example.test');
  await ap.fill('#password', 'a-long-enough-password');
  await ap.click('form[action="/setup"] button[type=submit]');
  await ap.waitForURL('**/admin');
  check('the first run creates the single administrator', ap.url().endsWith('/admin'));

  check('the captured signature is listed', (await ap.locator('.sig-card').count()) === 1);
  await ap.screenshot({ path: path.join(OUT, '4-admin.png'), fullPage: true });

  const second = await browser.newContext();
  const sp = await second.newPage();
  await sp.goto(`${BASE}/setup`);
  check('setup is gone once the administrator exists', sp.url().endsWith('/login'), sp.url());
  await sp.goto(`${BASE}/admin`);
  check('a stranger still cannot reach the signatures', sp.url().endsWith('/login'), sp.url());

  /* ---- downloads ---- */
  const dl = await ap.evaluate(async () => {
    const r = await fetch('/admin/download.zip');
    const b = await r.arrayBuffer();
    return { status: r.status, bytes: b.byteLength, head: [...new Uint8Array(b.slice(0, 4))] };
  });
  check('the ZIP of everything downloads and is a real ZIP',
    dl.status === 200 && dl.head[0] === 0x50 && dl.head[1] === 0x4b && dl.bytes > 200,
    `status ${dl.status}, ${dl.bytes} bytes, magic ${dl.head}`);

  /* ---- the open form is rate limited ---- */
  const burst = await ap.evaluate(async () => {
    const results = [];
    for (let i = 0; i < 24; i++) {
      const r = await fetch('/api/capture', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: 'Spam', lastName: 'Bot', png: 'nope', strokes: [] }),
      });
      results.push(r.status);
    }
    return results;
  });
  check('a flood of submissions is eventually refused', burst.includes(429),
    `statuses seen: ${[...new Set(burst)].join(', ')}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(`screenshots -> ${OUT}\n`);
  ok = failed === 0;
} catch (err) {
  console.error('\ncheck crashed:', err.message);
  if (log) console.error('\n--- server output ---\n' + log);
} finally {
  await browser?.close();
  server.kill();
  await new Promise((r) => (server.exitCode === null ? server.once('exit', r) : r()));
  try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 120 }); } catch {}
}

process.exit(ok ? 0 : 1);
