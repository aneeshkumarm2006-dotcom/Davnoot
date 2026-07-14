/* The SEO checklist — ONE pure implementation, TWO callers.
 *
 *   - The editor  (browser) runs it on every keystroke to paint the live panel.
 *   - The API     (Node)    runs it to compute the "SEO ready" badge for the
 *                           dashboard table.
 *
 * Because both call the same function over the same extracted signals, the badge
 * in the table can never disagree with the panel in the editor. Do not add a
 * second, "quick" server-side approximation — that divergence is exactly the bug
 * this design prevents.
 *
 * Pure: no I/O, no DOM, no database. Feed it a post-shaped object, get checks back.
 *
 * ---------------------------------------------------------------------------
 * IDEAL vs. ALLOWED
 * ---------------------------------------------------------------------------
 * The ranges below (30–60 title, 120–160 description) are IDEALS and produce
 * WARNINGS. They are deliberately NOT enforced in lib/validators.js, whose caps
 * are far looser. A validator that hard-rejects a 61-character meta title will,
 * one day, make an already-published post unsaveable — the author edits a typo
 * in the body and cannot save because a title written months ago is "too long".
 * Guardrails block; style advice warns. Keep it that way.
 */

import { wordCount, extractImages, extractLinks, containsKeyword } from './html-text.js';

export const IDEAL = {
  titleMin: 30,
  titleMax: 60,
  descMin: 120,
  descMax: 160,
  minWords: 300,
};

const PASS = 'pass';
const WARN = 'warn';
const INFO = 'info'; // informational — never blocks "SEO ready"

/**
 * Pull every signal the checks need out of a post document.
 * Kept separate from runChecks so the editor can extract once per keystroke and
 * the server can extract from a Mongo doc, with no shape negotiation between them.
 */
export function extractSignals(post = {}) {
  const seo = post.seo || {};
  const content = post.content || '';

  // The public <head> falls back title -> metaTitle and excerpt -> metaDescription,
  // so the checks must score the EFFECTIVE values, not the raw fields. Otherwise a
  // post with a great title but a blank metaTitle shows a spurious warning.
  const effectiveTitle = (seo.metaTitle || post.title || '').trim();
  const effectiveDesc = (seo.metaDescription || post.excerpt || '').trim();

  const images = extractImages(content);
  const links = extractLinks(content);

  // Target keywords = the focus keyword plus any meta keywords, de-duped.
  const targets = [];
  const seen = new Set();
  for (const kw of [seo.focusKeyword, ...(seo.keywords || [])]) {
    const k = String(kw || '').trim();
    if (k && !seen.has(k.toLowerCase())) {
      seen.add(k.toLowerCase());
      targets.push(k);
    }
  }

  return {
    effectiveTitle,
    effectiveDesc,
    words: wordCount(content),
    images,
    imagesMissingAlt: images.filter((i) => !i.hasAlt).length,
    internalLinks: links.filter((l) => !l.external).length,
    externalLinks: links.filter((l) => l.external).length,
    hasCover: Boolean((post.coverImage || '').trim()),
    coverHasAlt: Boolean((post.coverImageAlt || '').trim()),
    targets,
    keywordHits: targets.map((k) => ({ keyword: k, found: containsKeyword(content, k) })),
  };
}

/**
 * Run the checklist.
 *
 * @param {object} signals   from extractSignals()
 * @param {string[]} overrides  ids the author has explicitly marked "reviewed"
 * @returns {{id,label,status,message,overridden,blocking}[]}
 */
export function runChecks(signals, overrides = []) {
  const ov = new Set(overrides || []);
  const checks = [];

  const add = (id, label, status, message, blocking = true) => {
    // A "mark as reviewed" override flips a warning to pass, but we KEEP the
    // overridden flag so the UI can still tag it visually. The author green-lit
    // it; they didn't make the underlying condition go away.
    const overridden = status === WARN && ov.has(id);
    checks.push({
      id,
      label,
      status: overridden ? PASS : status,
      message,
      overridden,
      blocking,
    });
  };

  // --- Meta title ---
  const tLen = signals.effectiveTitle.length;
  if (!tLen) {
    add('meta-title', 'Meta title', WARN, 'No title yet.');
  } else if (tLen < IDEAL.titleMin) {
    add('meta-title', 'Meta title', WARN, `${tLen} characters — aim for ${IDEAL.titleMin}–${IDEAL.titleMax}. Short titles waste ranking space.`);
  } else if (tLen > IDEAL.titleMax) {
    add('meta-title', 'Meta title', WARN, `${tLen} characters — Google usually truncates past ${IDEAL.titleMax}.`);
  } else {
    add('meta-title', 'Meta title', PASS, `${tLen} characters — good length.`);
  }

  // --- Meta description ---
  const dLen = signals.effectiveDesc.length;
  if (!dLen) {
    add('meta-description', 'Meta description', WARN, 'No description or excerpt yet.');
  } else if (dLen < IDEAL.descMin) {
    add('meta-description', 'Meta description', WARN, `${dLen} characters — aim for ${IDEAL.descMin}–${IDEAL.descMax}.`);
  } else if (dLen > IDEAL.descMax) {
    add('meta-description', 'Meta description', WARN, `${dLen} characters — Google usually truncates past ${IDEAL.descMax}.`);
  } else {
    add('meta-description', 'Meta description', PASS, `${dLen} characters — good length.`);
  }

  // --- Content length ---
  if (signals.words < IDEAL.minWords) {
    add('content-length', 'Content length', WARN, `${signals.words} words — thin content struggles to rank. Aim for ${IDEAL.minWords}+.`);
  } else {
    add('content-length', 'Content length', PASS, `${signals.words} words.`);
  }

  // --- Keywords actually present in the body ---
  if (!signals.targets.length) {
    add('focus-keyword', 'Focus keyword', WARN, 'No focus keyword set — the post has no target to rank for.');
  } else {
    for (const hit of signals.keywordHits) {
      const id = `keyword:${hit.keyword.toLowerCase()}`;
      if (hit.found) {
        add(id, `Keyword: "${hit.keyword}"`, PASS, 'Appears in the body.');
      } else {
        add(id, `Keyword: "${hit.keyword}"`, WARN, 'Does not appear anywhere in the body text.');
      }
    }
  }

  // --- Cover image ---
  if (!signals.hasCover) {
    add('cover-image', 'Cover image', WARN, 'No cover image — cards and social shares will look empty.');
  } else if (!signals.coverHasAlt) {
    add('cover-image', 'Cover image', WARN, 'Cover image has no alt text.');
  } else {
    add('cover-image', 'Cover image', PASS, 'Set, with alt text.');
  }

  // --- Image alt text ---
  const total = signals.images.length;
  if (!total) {
    add('image-alt', 'Image alt text', PASS, 'No inline images.');
  } else if (signals.imagesMissingAlt > 0) {
    add('image-alt', 'Image alt text', WARN, `${signals.imagesMissingAlt} of ${total} inline images are missing alt text.`);
  } else {
    add('image-alt', 'Image alt text', PASS, `All ${total} inline images have alt text.`);
  }

  // --- Links: INFORMATIONAL ONLY ---
  // Never blocking. There is no correct number of links, and a check that
  // demands three internal links will get three garbage internal links.
  add(
    'links',
    'Links',
    INFO,
    `${signals.internalLinks} internal, ${signals.externalLinks} external.`,
    false,
  );

  return checks;
}

/** "SEO ready" = no blocking check is still warning. Info checks never count. */
export function isSeoReady(checks) {
  return checks.every((c) => !c.blocking || c.status === PASS);
}

/** Convenience: post document -> boolean. Used by the API for the table badge. */
export function scorePost(post) {
  const checks = runChecks(extractSignals(post), post.seoOverrides || []);
  return {
    checks,
    ready: isSeoReady(checks),
    warnings: checks.filter((c) => c.blocking && c.status === WARN).length,
  };
}
