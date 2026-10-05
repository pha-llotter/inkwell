import { db, nowIso } from '../db.js';

export function currentUser(req, res, next) {
  req.user = null;
  if (req.session?.userId) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!user) delete req.session.userId;
    else {
      req.user = user;
      db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(nowIso(), user.id);
    }
  }
  res.locals.user = req.user;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.session) req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}
