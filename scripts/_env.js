/* Shared bootstrap for the LOCAL scripts (dev server, index creation, smoke test).
 *
 * NOT imported by anything under api/ or lib/ — this must never run on Vercel.
 */
import fs from 'node:fs';
import dns from 'node:dns';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Load .env.local into process.env. No dotenv dependency needed for this. */
export function loadEnv() {
  const file = path.join(ROOT, '.env.local');
  if (!fs.existsSync(file)) {
    console.warn('! no .env.local — copy .env.example and fill it in.');
    return false;
  }

  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }

  console.log('· loaded .env.local');
  return true;
}

/**
 * Work around a LOCAL DNS problem, on this developer machine only.
 *
 * A `mongodb+srv://` URI requires an SRV record lookup. Node does SRV queries
 * through c-ares, talking to the OS-configured nameserver directly — and some
 * home routers (this one at 192.168.1.1) refuse those queries outright, giving:
 *
 *     Error: querySrv ECONNREFUSED _mongodb._tcp.<cluster>.mongodb.net
 *
 * Confusingly, ordinary browsing and `nslookup` still work: they use the OS
 * resolver, not c-ares. So the network is fine and only Node is affected — which
 * makes this look like a broken connection string when it is nothing of the sort.
 *
 * We probe the record, and only if the probe fails do we point Node at public
 * resolvers. This is a DEV-ONLY workaround:
 *
 *   - It lives in scripts/, never in lib/db.js, so it cannot ship to Vercel.
 *   - Vercel's DNS resolves SRV fine; overriding nameservers in production would
 *     be a gratuitous external dependency in the hot path.
 */
export async function ensureSrvDns(uri = process.env.MONGODB_URI) {
  if (!uri?.startsWith('mongodb+srv://')) return; // non-SRV URI: no lookup needed

  const host = uri.split('@')[1]?.split('/')[0]?.split('?')[0];
  if (!host) return;

  try {
    await dns.promises.resolveSrv(`_mongodb._tcp.${host}`);
    return; // the local resolver is fine — leave it alone
  } catch (err) {
    if (err.code !== 'ECONNREFUSED' && err.code !== 'ETIMEOUT' && err.code !== 'ESERVFAIL') throw err;
  }

  dns.setServers(['8.8.8.8', '1.1.1.1']);
  try {
    await dns.promises.resolveSrv(`_mongodb._tcp.${host}`);
    console.log('· local DNS refused the SRV lookup — using public resolvers (dev only)');
  } catch {
    console.error(
      `! Could not resolve _mongodb._tcp.${host} even via public DNS.\n` +
        '  Check the cluster hostname in MONGODB_URI, and that you are online.',
    );
  }
}
