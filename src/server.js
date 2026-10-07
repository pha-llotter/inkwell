import express from 'express';
import session from 'express-session';
import SqliteStoreFactory from 'better-sqlite3-session-store';
import path from 'node:path';

import { config, ROOT } from './config.js';
import { db } from './db.js';
import { version } from './version.js';
import { currentUser } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import captureRoutes from './routes/capture.js';
import adminRoutes from './routes/admin.js';

const app = express();
const SqliteStore = SqliteStoreFactory(session);

// Only trust proxy headers when told to, or a client could spoof the IP that
// ends up on a capture record and defeat the rate limit.
//
// Express reads a number here as "how many hops in front of me to trust" and a
// string as a list of trusted addresses or presets. process.env only ever
// yields strings, so TRUST_PROXY=1 was taken as an address literally named
// "1", matched nothing, and left req.secure false behind a TLS-terminating
// proxy -- which stops the secure session cookie from ever being sent and
// makes every correct password look wrong. Converted back to its real type.
const trustProxy = (process.env.TRUST_PROXY || '').trim();
if (trustProxy) {
  app.set(
    'trust proxy',
    /^\d+$/.test(trustProxy) ? Number(trustProxy)
      : trustProxy === 'true' ? true
        : trustProxy === 'false' ? false
          : trustProxy
  );
}

// A secure cookie behind a TLS-terminating proxy is dropped unless TRUST_PROXY
// is set, and nothing in the request or the logs says so -- every correct
// password simply comes back to the sign-in page. Say it at boot instead.
if (process.env.NODE_ENV === 'production' && !app.get('trust proxy')) {
  console.warn([
    'Warning: NODE_ENV=production sends a secure session cookie, but TRUST_PROXY is unset.',
    '         If anything terminates HTTPS in front of this app (nginx, Caddy, a load',
    '         balancer), set TRUST_PROXY=1 or every sign-in will fail with no error.',
  ].join('\n'));
}

app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'views'));

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
// A signature arrives as a base64 PNG plus its raw points, so the JSON body is
// larger than a form but nowhere near a file upload.
app.use(express.json({ limit: '8mb' }));

// Stamped onto asset URLs so a stylesheet change is picked up immediately
// rather than being masked by a cached copy.
const ASSET_VERSION = process.env.NODE_ENV === 'production'
  ? (process.env.ASSET_VERSION || version.number)
  : String(Date.now());

app.use('/static', express.static(path.join(ROOT, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '30d' : 0,
  etag: true,
}));

app.use(session({
  store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 15 * 60 * 1000 } }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  name: 'inkwell.sid',
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 12,
  },
}));

app.use(currentUser);
app.use((req, res, next) => {
  res.locals.brand = config.brand;
  res.locals.v = ASSET_VERSION;
  res.locals.appVersion = version;
  res.locals.path = req.path;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

/** Unauthenticated: a health check cannot sign in, and knowing which build is
 *  live is the first question when something is wrong. */
app.get('/healthz', (req, res) => {
  res.json({
    status: 'ok',
    version: version.number,
    commit: version.sha,
    startedAt: version.startedAt,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.use('/', authRoutes);
app.use('/', captureRoutes);
app.use('/', adminRoutes);

app.use((req, res) => res.status(404).render('error', { code: 404, message: 'Page not found.' }));

app.use((err, req, res, _next) => {
  console.error(err);
  const code = err.status || 500;
  // A JSON caller gets a sentence it can show, not an HTML error page.
  if (req.path.startsWith('/api/')) {
    return res.status(code).json({ error: code === 500 ? 'Something went wrong on our side.' : err.message });
  }
  res.status(code).render('error', {
    code,
    message: code === 500 ? 'Something went wrong on our side.' : err.message,
  });
});

app.listen(config.port, () => {
  console.log(`${config.brand.name} ${version.short} listening on ${config.baseUrl}`);
});
