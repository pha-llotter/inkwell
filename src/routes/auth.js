import { Router } from 'express';
import { db, nowIso, userCount } from '../db.js';
import { hashPassword, verifyPassword, uuid } from '../crypto.js';

const router = Router();

/**
 * There is one administrator, created on first run. After that the setup page
 * is gone: an app whose capture form is open to the world must not also leave
 * a route that mints an account.
 */
const firstRunOnly = (req, res, next) => {
  if (userCount() > 0) return res.redirect('/login');
  next();
};

router.get('/setup', firstRunOnly, (req, res) => res.render('setup', { values: {}, error: null }));

router.post('/setup', firstRunOnly, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const name = String(req.body.display_name || '').trim();
  const password = String(req.body.password || '');
  const fail = (error) => res.status(400).render('setup', { values: { email, display_name: name }, error });

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Enter a valid email address.');
  if (name.length < 2) return fail('Enter your name.');
  if (password.length < 10) return fail('Use a password of at least 10 characters.');

  const id = uuid();
  db.prepare('INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, email, await hashPassword(password), name, nowIso());

  req.session.regenerate(() => { req.session.userId = id; res.redirect('/admin'); });
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/admin');
  if (userCount() === 0) return res.redirect('/setup');
  res.render('login', { email: '', error: null });
});

router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  // Verify against a dummy hash when the account is unknown, so a wrong email
  // and a wrong password take the same time to answer.
  const ok = user
    ? await verifyPassword(user.password_hash, password)
    : await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000', password);

  if (!ok || !user) return res.status(401).render('login', { email, error: 'Email or password is incorrect.' });

  req.session.regenerate((err) => {
    if (err) return res.status(500).render('login', { email, error: 'Could not start a session.' });
    req.session.userId = user.id;
    const to = req.session.returnTo || '/admin';
    delete req.session.returnTo;
    res.redirect(to);
  });
});

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

export default router;
