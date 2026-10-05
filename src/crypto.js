import crypto from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

// OWASP-recommended Argon2id parameters (19 MiB, 2 iterations, 1 lane).
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (plain) => argonHash(plain, ARGON_OPTS);

export async function verifyPassword(stored, plain) {
  try { return await argonVerify(stored, plain); } catch { return false; }
}

export const uuid = () => crypto.randomUUID();
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
