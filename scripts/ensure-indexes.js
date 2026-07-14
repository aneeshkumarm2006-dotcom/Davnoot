#!/usr/bin/env node
/* Create the MongoDB indexes. Safe to re-run.
 *
 *   npm run db:indexes
 *
 * Reads MONGODB_URI from the environment (or .env.local, loaded below). Run this
 * once after pointing at a fresh Atlas cluster, and again whenever ensureIndexes()
 * in lib/db.js gains a new index.
 */
import { loadEnv, ensureSrvDns } from './_env.js';

loadEnv();

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not set. Put it in site/.env.local (see .env.example).');
  process.exit(1);
}

await ensureSrvDns();

const { ensureIndexes, getDb } = await import('../lib/db.js');

const db = await getDb();
await ensureIndexes();

console.log(`✓ Indexes created in database "${db.databaseName}" (posts, media, login_attempts).`);
process.exit(0);
