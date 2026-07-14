#!/usr/bin/env node
/* Create the MongoDB indexes. Safe to re-run.
 *
 *   npm run db:indexes
 *
 * Reads MONGODB_URI from the environment (or .env.local, loaded below). Run this
 * once after pointing at a fresh Atlas cluster, and again whenever ensureIndexes()
 * in lib/db.js gains a new index.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env.local loader — we have no dotenv dependency and don't need one.
const envFile = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
  console.log('Loaded .env.local');
}

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not set. Put it in site/.env.local (see .env.example).');
  process.exit(1);
}

const { ensureIndexes } = await import('../lib/db.js');

await ensureIndexes();
console.log('✓ Indexes created (posts, media, login_attempts).');
process.exit(0);
