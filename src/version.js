import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './config.js';

function packageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch { return '0.0.0'; }
}

/**
 * A deployed container has no git, so BUILD_SHA is the override a build sets;
 * the git lookup is the convenience for running from a working copy.
 */
function commit() {
  if (process.env.BUILD_SHA) return { sha: process.env.BUILD_SHA.slice(0, 12), dirty: false };
  try {
    const run = (args) => execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    return { sha: run(['rev-parse', '--short=12', 'HEAD']), dirty: run(['status', '--porcelain']).length > 0 };
  } catch { return { sha: null, dirty: false }; }
}

const num = packageVersion();
const c = commit();

export const version = {
  number: num,
  sha: c.sha,
  dirty: c.dirty,
  startedAt: new Date().toISOString(),
  short: `v${num}`,
  full: c.sha ? `v${num} (${c.sha}${c.dirty ? '+local changes' : ''})` : `v${num}`,
};
