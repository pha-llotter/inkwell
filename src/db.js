import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const db = new Database(config.dbPath);
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

export const nowIso = () => new Date().toISOString();

/** Honours X-Forwarded-For only when the app is explicitly behind a proxy. */
export function clientIp(req) {
  return (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

export const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
