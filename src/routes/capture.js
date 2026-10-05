import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';

import { config } from '../config.js';
import { db, nowIso, clientIp } from '../db.js';
import { uuid } from '../crypto.js';

const router = Router();

/**
 * The capture page is open to anyone holding the link, which was a deliberate
 * choice. These limits keep that from becoming a liability without putting
 * anything in front of someone who is simply trying to sign.
 */
function rateLimited(ip) {
  const windowStart = new Date(Date.now() - 3600_000).toISOString();
  // Sweep on write, so the table cannot grow without bound.
  db.prepare('DELETE FROM capture_attempts WHERE created_at < ?').run(windowStart);
  const recent = db
    .prepare('SELECT COUNT(*) AS n FROM capture_attempts WHERE ip = ? AND created_at >= ?')
    .get(ip, windowStart).n;
  return recent >= config.capture.maxPerHourPerIp;
}

router.get('/', (req, res) => {
  res.render('capture', { saved: null });
});

router.post('/api/capture', express_json_guard, (req, res) => {
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return res.status(429).json({
      error: 'Too many signatures from this device in the last hour. Try again later.',
    });
  }

  // Recorded here, before any validation, so that every submission counts
  // against the limit. Counting only the ones that succeed would leave someone
  // sending junk entirely unthrottled, which is the case the limit is for.
  db.prepare('INSERT INTO capture_attempts (ip, created_at) VALUES (?, ?)').run(ip, nowIso());

  const firstName = String(req.body.firstName || '').trim();
  const lastName = String(req.body.lastName || '').trim();
  if (firstName.length < 1 || lastName.length < 1) {
    return res.status(400).json({ error: 'Enter both a name and a surname.' });
  }
  if (firstName.length > 80 || lastName.length > 80) {
    return res.status(400).json({ error: 'That name is longer than this form accepts.' });
  }

  // A honeypot: a field hidden from people but filled in by naive bots. Answer
  // as though it worked, so a bot has nothing to learn from being refused.
  if (String(req.body.website || '').trim()) {
    return res.json({ ok: true });
  }

  const m = /^data:image\/png;base64,(.+)$/.exec(String(req.body.png || ''));
  if (!m) return res.status(400).json({ error: 'The signature did not come through. Please sign again.' });

  const png = Buffer.from(m[1], 'base64');
  if (png.length > config.capture.maxPngBytes) {
    return res.status(413).json({ error: 'That signature image is too large.' });
  }
  // A PNG always starts with this. Rejects anything mislabelled before it is
  // written to disk and handed to whatever opens it later.
  const MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!png.subarray(0, 8).equals(MAGIC)) {
    return res.status(400).json({ error: 'That was not a valid image.' });
  }

  const strokes = Array.isArray(req.body.strokes) ? req.body.strokes : [];
  const strokesJson = JSON.stringify(strokes);
  if (Buffer.byteLength(strokesJson) > config.capture.maxStrokeBytes) {
    return res.status(413).json({ error: 'That signature has more detail than this form accepts.' });
  }
  const pointCount = strokes.reduce((n, s) => n + (Array.isArray(s) ? s.length : 0), 0);
  if (pointCount < 8) {
    return res.status(400).json({ error: 'That signature looks empty. Please sign again.' });
  }

  const id = uuid();
  const dir = path.join(config.storageDir, 'signatures');
  const pngPath = path.join(dir, `${id}.png`);
  const strokesPath = path.join(dir, `${id}.json`);

  fs.writeFileSync(pngPath, png);
  // Keeping the raw points means a signature can be redrawn later at a
  // different size, colour or smoothing without asking the person back.
  fs.writeFileSync(strokesPath, strokesJson, 'utf8');

  db.prepare(
    `INSERT INTO signatures
       (id, first_name, last_name, created_at, png_path, png_width, png_height, png_bytes,
        strokes_path, stroke_count, point_count, duration_ms, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, firstName, lastName, nowIso(), pngPath,
    Number(req.body.width) || 0, Number(req.body.height) || 0, png.length,
    strokesPath, strokes.length, pointCount, Number(req.body.durationMs) || 0,
    ip, String(req.get('user-agent') || '').slice(0, 400)
  );

  res.json({ ok: true, id, name: `${firstName} ${lastName}` });
});

/** Guards against a body that arrived as something other than JSON. */
function express_json_guard(req, res, next) {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Malformed request.' });
  }
  next();
}

export default router;
