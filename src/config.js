import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

function requiredSecret(name, devFallbackFile) {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} must be set to a random value of at least 32 characters in production.`);
  }
  // Development convenience: persist a generated secret so sessions survive a
  // restart. Never used when NODE_ENV=production.
  const file = path.join(ROOT, '.secrets', devFallbackFile);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), 'utf8');
  return fs.readFileSync(file, 'utf8').trim();
}

export const config = {
  // 3100 so this can run alongside anything already on 3000.
  port: Number(process.env.PORT || 3100),
  baseUrl: (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3100}`).replace(/\/$/, ''),
  sessionSecret: requiredSecret('SESSION_SECRET', 'session.key'),
  storageDir: process.env.STORAGE_DIR || path.join(ROOT, 'storage'),
  dbPath: process.env.DB_PATH || path.join(ROOT, 'storage', 'inkwell.db'),

  brand: {
    name: process.env.BRAND_NAME || 'Inkwell',
    org: process.env.ORG_NAME || '',
  },

  /**
   * The capture page is open to anyone with the link, by choice. These are the
   * cheap limits that keep that from becoming a liability without putting
   * anything in the way of someone signing.
   */
  capture: {
    maxPerHourPerIp: Number(process.env.MAX_PER_HOUR_PER_IP || 20),
    maxStrokeBytes: Number(process.env.MAX_STROKE_BYTES || 400 * 1024),
    maxPngBytes: Number(process.env.MAX_PNG_BYTES || 4 * 1024 * 1024),
  },
};

fs.mkdirSync(path.join(config.storageDir, 'signatures'), { recursive: true });
