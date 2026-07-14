#!/usr/bin/env node
/* Local dev server — mimics Vercel's routing so you can run the whole thing
 * on your laptop without deploying.
 *
 *   npm run dev            -> http://localhost:3000
 *
 * It reproduces, in this order (the same order Vercel uses):
 *   1. redirects   (from vercel.json)
 *   2. the Edge middleware  (the /seoteam auth gate)
 *   3. static files (the marketing pages, styles.css, the dashboard bundle)
 *   4. rewrites    (so /blog, /blog/<slug>, /sitemap.xml hit the API handlers)
 *   5. /api/*      (serverless handlers, including [dynamic] segments)
 *
 * This is a DEV tool. It is not what runs in production — Vercel is. If routing
 * behaves differently here than in production, trust production and fix this file.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 3000;

/* ---- .env.local ---------------------------------------------------------- */
const envFile = path.join(ROOT, '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  console.log('· loaded .env.local');
} else {
  console.warn('! no .env.local — the blog and dashboard will fail until MONGODB_URI is set.');
}

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

/** ":slug" / ":path*" -> a regex + the param names, matching Vercel's syntax. */
function compile(source) {
  const keys = [];
  const pattern = source
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/:(\w+)\*/g, (_, k) => {
      keys.push(k);
      return '(.*)';
    })
    .replace(/:(\w+)/g, (_, k) => {
      keys.push(k);
      return '([^/]+)';
    });
  return { re: new RegExp(`^${pattern}$`), keys };
}

const REDIRECTS = (config.redirects || []).map((r) => ({ ...r, ...compile(r.source) }));
const REWRITES = (config.rewrites || []).map((r) => ({ ...r, ...compile(r.source) }));

function applyRule(rules, pathname) {
  for (const rule of rules) {
    const m = pathname.match(rule.re);
    if (!m) continue;
    let dest = rule.destination;
    rule.keys.forEach((k, i) => {
      dest = dest.replaceAll(`:${k}`, m[i + 1] ?? '');
    });
    return dest;
  }
  return null;
}

/* ---- static -------------------------------------------------------------- */

function staticFile(pathname) {
  const rel = pathname.replace(/^\/+/, '');
  if (!rel || rel.includes('..')) return null;

  const candidates = [path.join(ROOT, rel), path.join(ROOT, rel, 'index.html')];
  for (const file of candidates) {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

/* ---- api ----------------------------------------------------------------- */

/** Resolve /api/seoteam/posts/123 -> api/seoteam/posts/[id].js + { id: '123' } */
function resolveApi(pathname) {
  const segments = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const params = {};

  let dir = path.join(ROOT, 'api');

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const last = i === segments.length - 1;

    if (last) {
      const direct = path.join(dir, `${seg}.js`);
      if (fs.existsSync(direct)) return { file: direct, params };

      const asIndex = path.join(dir, seg, 'index.js');
      if (fs.existsSync(asIndex)) return { file: asIndex, params };
    }

    const nextDir = path.join(dir, seg);
    if (fs.existsSync(nextDir) && fs.statSync(nextDir).isDirectory()) {
      dir = nextDir;
      continue;
    }

    // A [dynamic] segment?
    const dynamic = fs.existsSync(dir)
      ? fs.readdirSync(dir).find((f) => f.startsWith('[') && (last ? f.endsWith('.js') : true))
      : null;

    if (dynamic) {
      const key = dynamic.replace(/^\[|\]\.js$|\]$/g, '');
      params[key] = decodeURIComponent(seg);

      if (last && dynamic.endsWith('.js')) return { file: path.join(dir, dynamic), params };
      dir = path.join(dir, dynamic);
      continue;
    }

    return null;
  }

  const index = path.join(dir, 'index.js');
  return fs.existsSync(index) ? { file: index, params } : null;
}

/** Give the handler the req/res shape Vercel's Node runtime provides. */
function enhance(req, res, query) {
  req.query = query;

  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
    return res;
  };
  res.send = (data) => {
    res.end(data);
    return res;
  };

  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const type = (req.headers['content-type'] || '').split(';')[0].trim();

      if (!raw.length) req.body = undefined;
      else if (type === 'application/json') {
        try {
          req.body = JSON.parse(raw.toString('utf8'));
        } catch {
          req.body = {};
        }
      } else if (type === 'application/x-www-form-urlencoded') {
        req.body = Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
      } else if (type.startsWith('text/')) {
        req.body = raw.toString('utf8');
      } else {
        req.body = raw; // Buffer — matches Vercel for binary uploads
      }
      resolve();
    });
  });
}

/* ---- server -------------------------------------------------------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = url.pathname;

  try {
    // 1. redirects
    const redirect = applyRule(REDIRECTS, pathname);
    if (redirect) {
      res.writeHead(308, { Location: redirect });
      return res.end();
    }

    // 2. Edge middleware (the /seoteam gate)
    if (/^\/(seoteam|api\/seoteam)(\/|$)/.test(pathname)) {
      const { default: middleware } = await import(pathToFileURL(path.join(ROOT, 'middleware.js')).href);

      const request = new Request(url.toString(), {
        method: req.method,
        headers: new Headers(Object.entries(req.headers).filter(([, v]) => typeof v === 'string')),
      });

      const result = await middleware(request);

      if (result && result.status >= 300 && result.status < 400) {
        res.writeHead(result.status, { Location: result.headers.get('location') });
        return res.end();
      }
      if (result && result.status >= 400) {
        res.writeHead(result.status, Object.fromEntries(result.headers));
        return res.end(await result.text());
      }
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    }

    // 3. static files (BEFORE rewrites — this is what Vercel does, and it's why
    //    there must be no sitemap.xml on disk)
    const file = staticFile(pathname);
    if (file) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      return res.end(fs.readFileSync(file));
    }

    // 4. rewrites
    const rewritten = applyRule(REWRITES, pathname);
    let query = Object.fromEntries(url.searchParams);

    if (rewritten) {
      const [target, qs] = rewritten.split('?');
      if (qs) query = { ...query, ...Object.fromEntries(new URLSearchParams(qs)) };

      const rewrittenFile = staticFile(target);
      if (rewrittenFile) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(rewrittenFile)] || 'text/html' });
        return res.end(fs.readFileSync(rewrittenFile));
      }
      pathname = target;
    }

    // 5. api
    if (pathname.startsWith('/api/')) {
      const route = resolveApi(pathname);
      if (!route) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `No API route for ${pathname}` }));
      }

      // Bust the module cache so edits are picked up without a restart.
      const mod = await import(`${pathToFileURL(route.file).href}?t=${Date.now()}`);
      await enhance(req, res, { ...query, ...route.params });
      return await mod.default(req, res);
    }

    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>404</h1>');
  } catch (err) {
    console.error(`✖ ${req.method} ${pathname}`, err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err?.message || err) }));
  }
});

server.listen(PORT, () => {
  console.log(`\n  Davnoot dev  →  http://localhost:${PORT}`);
  console.log(`  marketing    →  http://localhost:${PORT}/index.html`);
  console.log(`  blog         →  http://localhost:${PORT}/blog`);
  console.log(`  dashboard    →  http://localhost:${PORT}/seoteam\n`);
});
