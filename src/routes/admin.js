import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';

import { db, nowIso } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { zipStore } from '../zip.js';
import { inkSettings, saveInkSettings, DEFAULTS } from '../ink-settings.js';

const router = Router();

/** A filename the management system will accept, derived from the person. */
function fileNameFor(sig) {
  const base = `${sig.last_name}-${sig.first_name}`
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip accents
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'signature';
  return `${base}-${sig.id.slice(0, 8)}.png`;
}

router.get('/admin', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  const rows = q
    ? db.prepare(
        `SELECT * FROM signatures
         WHERE first_name LIKE ? COLLATE NOCASE OR last_name LIKE ? COLLATE NOCASE
         ORDER BY created_at DESC`
      ).all(`%${q}%`, `%${q}%`)
    : db.prepare('SELECT * FROM signatures ORDER BY created_at DESC').all();

  res.render('admin', {
    rows: rows.map((r) => ({ ...r, fileName: fileNameFor(r) })),
    q,
    total: db.prepare('SELECT COUNT(*) AS n FROM signatures').get().n,
  });
});

/** Inline for the thumbnails on the list; the download route forces a save. */
router.get('/admin/:id.png', requireAuth, (req, res) => {
  const sig = db.prepare('SELECT * FROM signatures WHERE id = ?').get(req.params.id);
  if (!sig || !fs.existsSync(sig.png_path)) {
    return res.status(404).render('error', { code: 404, message: 'That signature is not here.' });
  }
  res.type('image/png').sendFile(path.resolve(sig.png_path));
});

router.get('/admin/:id/download', requireAuth, (req, res) => {
  const sig = db.prepare('SELECT * FROM signatures WHERE id = ?').get(req.params.id);
  if (!sig || !fs.existsSync(sig.png_path)) {
    return res.status(404).render('error', { code: 404, message: 'That signature is not here.' });
  }
  res.setHeader('Content-Disposition', `attachment; filename="${fileNameFor(sig)}"`);
  res.type('image/png').sendFile(path.resolve(sig.png_path));
});

/**
 * Everything at once, as a ZIP. Stored rather than deflated: a PNG is already
 * compressed, so deflating again costs time and saves almost nothing.
 */
router.get('/admin/download.zip', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM signatures ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE').all();
  const entries = [];
  const used = new Set();

  for (const sig of rows) {
    if (!fs.existsSync(sig.png_path)) continue;
    // Two people with the same name must not overwrite one another in the zip.
    let name = fileNameFor(sig);
    let n = 2;
    while (used.has(name)) name = fileNameFor(sig).replace(/\.png$/, `-${n++}.png`);
    used.add(name);
    entries.push({ name, data: fs.readFileSync(sig.png_path), date: new Date(sig.created_at) });
  }

  if (!entries.length) {
    req.session.flash = { type: 'error', text: 'There are no signatures to download yet.' };
    return res.redirect('/admin');
  }

  const zip = zipStore(entries);
  const stamp = nowIso().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="signatures-${stamp}.zip"`);
  res.type('application/zip').send(zip);
});

router.post('/admin/:id/delete', requireAuth, (req, res) => {
  const sig = db.prepare('SELECT * FROM signatures WHERE id = ?').get(req.params.id);
  if (sig) {
    for (const p of [sig.png_path, sig.strokes_path]) {
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
    }
    db.prepare('DELETE FROM signatures WHERE id = ?').run(sig.id);
    req.session.flash = { type: 'ok', text: `Deleted the signature for ${sig.first_name} ${sig.last_name}.` };
  }
  res.redirect('/admin');
});

/**
 * Tuning. The shipped numbers are a guess at an average finger; this is where
 * they are replaced with ones chosen against real handwriting on the actual
 * device people will sign on.
 */
router.get('/admin/tuning', requireAuth, (req, res) => {
  res.render('tuning', { settings: inkSettings(), defaults: DEFAULTS, saved: req.query.saved === '1' });
});

router.post('/admin/tuning', requireAuth, (req, res) => {
  saveInkSettings(req.body || {});
  req.session.flash = { type: 'ok', text: 'Saved. New signatures will use these.' };
  res.redirect('/admin/tuning?saved=1');
});

export default router;
