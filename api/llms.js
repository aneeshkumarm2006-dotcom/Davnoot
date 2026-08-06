/* GET /llms.txt — the llmstxt.org manifest for AI answer engines.
 *
 * Served via a rewrite in vercel.json, for exactly the same reason /sitemap.xml is:
 * a static llms.txt on disk would shadow the rewrite AND would go stale the moment a
 * post is published. This route is generated from the same three sources the sitemap
 * uses, so "what the site says it contains" can never drift from "what the site
 * contains".
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * llms.txt is to an LLM what sitemap.xml is to a crawler: a curated, plain-markdown
 * index of the pages worth reading, with one sentence of context each. GPTBot,
 * PerplexityBot, ClaudeBot and OAI-SearchBot are all explicitly allowed in robots.txt
 * (this site sells AI search optimization — being uncitable would be an embarrassing
 * own goal), and a 404 on /llms.txt was the one thing telling them we had no index.
 *
 * FORMAT — the spec is strict and validators check it (llmstxt.org)
 * ----------------------------------------------------------------
 *   1. exactly one H1, first non-blank line
 *   2. an optional blockquote summary immediately after it
 *   3. free prose (no headings) is allowed before the first H2
 *   4. H2 sections, each containing ONLY markdown link list items:
 *        - [Name](absolute-url): description
 *   5. an optional final "## Optional" section = safe to skip under context pressure
 * Do not add tables, bold headings, or nested lists here — a formatting error makes
 * the whole file unparseable to the consumers it exists for.
 *
 * DEGRADES LIKE THE SITEMAP: the marketing half comes from COMPILED_PAGES + a
 * compiled-in static list, so a total Mongo outage costs us the blog section and
 * nothing else.
 */
import { posts } from '../lib/db.js';
import { publishedFilter } from '../lib/blog-query.js';
import { STATIC_URLS } from '../lib/sitemap-static.js';
import {
  SITE_URL,
  ORG_DESC,
  SERVICE_PAGES,
  ADS_PAGES,
  SERVICE_TYPE,
  canonicalFor,
} from '../lib/templates.js';

const BLOG_INDEX = SITE_URL + '/blog';

/* Bounded, exactly as in api/sitemap.js — a Mongo read that connects and then hangs
 * would otherwise burn the function's whole maxDuration and return a platform 5xx. */
const rejectAfter = (ms) =>
  new Promise((_, reject) => setTimeout(() => reject(new Error('mongo-timeout')), ms));
const bounded = (promise, ms = 2500) => Promise.race([promise, rejectAfter(ms)]);

/* Markdown link text is not HTML — the escaping that matters is `]` and `)`, which
 * would terminate a link early and corrupt every line after it in some parsers. */
const mdText = (s) => String(s).replace(/\\/g, '\\\\').replace(/([[\]])/g, '\\$1').replace(/\n+/g, ' ').trim();
const mdUrl = (s) => String(s).replace(/\(/g, '%28').replace(/\)/g, '%29').trim();
const link = (name, url, desc) => `- [${mdText(name)}](${mdUrl(url)})${desc ? `: ${mdText(desc)}` : ''}`;

/* Display name + one line of context per page. Keyed by FILE, like KEYWORDS and
 * SERVICE_TYPE in lib/templates.js, so a new page shows up here by adding one row —
 * and a page with no row still gets listed, under a name derived from its slug.
 *
 * The name matters more than it looks: for the service and ad-hub sections it is the
 * SERVICE_TYPE label (so "Search Engine Optimization", not "Seo"), and for everything
 * else it is written out here, because titleFor() would emit "Ai Seo Agency" and
 * "Etf Marketing" — which is precisely the sort of thing a model quotes back verbatim. */
const PAGE = {
  'index.html': ['Davnoot — home', 'Agency overview — six disciplines run as one revenue engine'],
  'services.html': ['Services', 'Every service we run, and what each one is for'],
  'ads.html': ['Ad platforms', 'The paid-advertising platforms we buy on, and when each makes sense'],
  'ecommerce.html': ['Ecommerce', 'Ecommerce agency work — store development, SEO, ads, and retention as one engine'],
  'book-call.html': ['Book a strategy call', 'The only conversion path on the site — a 30-minute call'],
  'seo.html': [null, 'Technical SEO, content, and link acquisition for organic revenue'],
  'google-ads.html': [null, 'Search, Performance Max, and Shopping campaign management'],
  'meta-ads.html': [null, 'Facebook and Instagram paid social, creative testing, Advantage+'],
  'email.html': [null, 'Lifecycle email marketing, flows, and list segmentation'],
  'ai-seo.html': [null, 'Generative engine optimization — visibility inside ChatGPT, Perplexity, and AI Overviews'],
  'chatgpt-ads.html': [null, 'ChatGPT and conversational-AI advertising'],
  'software.html': [null, 'Custom software, CRM, dashboards, and internal tooling'],
  'shopify.html': [null, 'Shopify and Shopify Plus store development'],
  'shopify-seo.html': [null, 'Ecommerce SEO for Shopify catalogues'],
  'klaviyo.html': [null, 'Klaviyo email and SMS for ecommerce retention'],
  'reddit-ads.html': [null, 'Promoted Posts, conversation ads, and subreddit targeting'],
  'pinterest-ads.html': [null, 'Shopping ads, catalogue feeds, and pin creative'],
  'amazon-ads.html': [null, 'Sponsored Products, Sponsored Brands, and Amazon DSP'],
  'spotify-ads.html': [null, 'Spotify and streaming-audio advertising'],
  'ai-seo-agency.html': ['AI SEO agency', 'What to look for when hiring an AI SEO agency'],
  'ai-seo-montreal.html': ['AI SEO Montreal', 'AI search optimization for Montreal businesses, in English and French'],
  'etf-marketing.html': ['ETF marketing', 'Marketing for ETF issuers and asset managers'],
  'startup-seo.html': ['Startup SEO', 'SEO for startups — SaaS, AI, fintech and early-stage companies, prioritised by revenue impact rather than ranking count'],
  'privacy.html': ['Privacy policy', 'What we collect, why, and how to have it removed'],
};

/* The city landing pages: one page per ad platform per city. Enumerated rather than
 * read off disk because this function is bundled by Vercel's file tracer and a
 * readdirSync() over the repo root does not survive that. lib/sitemap-static.js is
 * generated from disk by build.js and IS traced, so it stays the source of truth for
 * which of these actually exist — this map only supplies the prose. */
const CITY_BLURB = (file) => {
  const m = /^([a-z]+)-ads-([a-z]+)\.html$/.exec(file);
  if (!m) return null;
  const platform = { reddit: 'Reddit', pinterest: 'Pinterest', amazon: 'Amazon', spotify: 'Spotify', meta: 'Meta', chatgpt: 'ChatGPT', google: 'Google' }[m[1]];
  const city = m[2][0].toUpperCase() + m[2].slice(1);
  return platform ? `${platform} Ads management for ${city} businesses` : null;
};

/* Last-resort display name for a page with no PAGE row: "reddit-ads-ottawa.html"
 * -> "Reddit Ads Ottawa". Acronyms are cased properly because "Ai Seo" reads as a
 * typo to a human and gets quoted as one by a model. */
const ACRONYM = { ai: 'AI', seo: 'SEO', etf: 'ETF', chatgpt: 'ChatGPT', sms: 'SMS', crm: 'CRM', ppc: 'PPC' };
const titleFor = (file) =>
  file
    .replace(/\.html$/, '')
    .split('-')
    .map((w) => ACRONYM[w] || w[0].toUpperCase() + w.slice(1))
    .join(' ');

/** Display name for a page: the PAGE row, else a service label, else the slug. */
const nameFor = (file) => PAGE[file]?.[0] || SERVICE_TYPE[file] || titleFor(file);
const descFor = (file) => PAGE[file]?.[1];

function section(heading, lines) {
  return lines.length ? `## ${heading}\n\n${lines.join('\n')}\n` : '';
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).send('Method not allowed');
  }

  const page = (file) => link(nameFor(file), canonicalFor(file), descFor(file));

  const services = SERVICE_PAGES.map(page);
  const adPlatforms = ADS_PAGES.map(page);

  /* The city pages and any other non-CMS root page come from the SAME generated
   * manifest the sitemap uses, so a page that exists on disk can never be missing
   * from exactly one of the two files. */
  const cityLines = STATIC_URLS.map((u) => {
    const file = `${u.loc.replace(SITE_URL + '/', '')}.html`;
    const desc = CITY_BLURB(file);
    return desc ? link(titleFor(file), u.loc, desc) : null;
  }).filter(Boolean);

  // ---- The blog. The only section a Mongo outage can drop. ----
  let blogLines = [];
  try {
    const docs = await bounded(
      (async () =>
        (await posts())
          .find(publishedFilter(), { projection: { slug: 1, title: 1, excerpt: 1, publishedAt: 1 } })
          .sort({ publishedAt: -1 })
          .limit(100)
          .toArray())(),
    );
    blogLines = docs.map((d) => link(d.title || d.slug, `${BLOG_INDEX}/${d.slug}`, d.excerpt));
  } catch (err) {
    console.error('[llms] could not read posts, serving pages only:', err?.message || err);
  }

  const body = `# Davnoot

> ${ORG_DESC}

Davnoot is a Montreal-based independent growth agency working with businesses across Canada, the United States, and remotely. We run SEO, Google Ads, Meta Ads, email and lifecycle marketing, AI search optimization (GEO/AEO), ChatGPT advertising, Shopify, and custom software as a single revenue system rather than as separate retainers. Campaigns are run bilingually in English and French. Every engagement starts with a strategy call.

Contact: info@davnoot.com · +1 (438) 223-7131 · Montreal, QC, Canada

## Core pages

${page('index.html')}
${page('services.html')}
${page('ads.html')}
${page('ecommerce.html')}
${page('book-call.html')}

${section('Services', services)}
${section('Ad platforms', adPlatforms)}
${section('Blog', [
  link('Davnoot blog', BLOG_INDEX, 'Practical writing on SEO, paid media, email, and AI search'),
  ...blogLines,
])}
${section('Optional', [
  ...cityLines,
  page('startup-seo.html'),
  page('ai-seo-agency.html'),
  page('ai-seo-montreal.html'),
  page('etf-marketing.html'),
  page('privacy.html'),
])}`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader(
    'Cache-Control',
    blogLines.length ? 'public, s-maxage=600, stale-while-revalidate=3600' : 'public, s-maxage=60',
  );
  return res.status(200).send(body.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n');
}
