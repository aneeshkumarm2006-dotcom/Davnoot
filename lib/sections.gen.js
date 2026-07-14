/* The section library — renderers for composed (base:null) pages built in /admin.
 *
 * WHY THESE EXIST
 * A composed page has no disk template. Its layout is an ordered array of library
 * SECTIONS. Each renderer here emits the EXACT markup + classes of a real section on
 * the live marketing pages, so a page assembled in /admin inherits the site's real
 * design, CSS, and animations with ZERO new CSS and ZERO script.js changes — the
 * library and the live site are the same bytes. scripts/sections-library.test.js
 * asserts each renderer's class structure matches the real seo.html fixture, and that
 * every card class it emits is one script.js animates (BOX_SELECTORS) — a section that
 * rendered visible-but-unanimated next to its animated neighbours is the failure mode.
 *
 * Only the ~8 GENUINELY reusable, self-contained sections are shipped. The bespoke,
 * script-driven rigs (showcase, case-spotlight, compare-grid, the homepage process
 * track, the logo marquee) are page-specific traps and are deliberately absent — "a
 * palette of 21 where 13 are traps is worse than a palette of 8."
 *
 * FIELD KINDS: `text` fields are esc()'d; `inline`/`richtext` fields are passed
 * through (they were sanitized by kind on WRITE — see lib/page-model.js). The field
 * kind for each hole is declared in lib/section-fields.gen.js, which the write path
 * and the admin form both read, so what reaches these renderers is already safe.
 */
import { esc } from './templates.js';

// A field getter: plain-text fields are escaped; inline/richtext pass through as the
// already-sanitized markup the author saved.
const T = (fields, key, fallback = '') => esc(fields?.[key] ?? fallback); // text
const I = (fields, key, fallback = '') => String(fields?.[key] ?? fallback); // inline/richtext (pre-sanitized)
const items = (section) => (Array.isArray(section?.items) ? section.items : []);
const href = (fields, key, fallback = 'book-call.html') => {
  const v = String(fields?.[key] ?? fallback).trim() || fallback;
  return esc(v);
};

/* Each renderer takes a section = { fields:{}, items:[{}] } and returns HTML that is
 * byte-faithful (class-for-class) to the corresponding live section. */
export const SECTION_RENDERERS = {
  hero(section) {
    const f = section.fields || {};
    return `  <header class="service-hero">
    <div class="service-hero-grid">
      <div class="reveal">
        <div class="service-num-badge">${I(f, 'badge')}</div>
        <h1 class="service-hero-title">${I(f, 'title')}</h1>
        <p class="service-hero-sub">${I(f, 'sub')}</p>
        <a href="${href(f, 'ctaHref')}" class="btn-primary" data-cursor>
          ${I(f, 'ctaLabel', 'Book a call')}
          <span class="arrow">→</span>
        </a>
      </div>
    </div>
  </header>`;
  },

  capabilities(section) {
    const f = section.fields || {};
    const cards = items(section).map((c) => `      <div class="cap-card">
        <div class="cap-num">${T(c, 'num')}</div>
        <h3 class="cap-title">${I(c, 'title')}</h3>
        <p class="cap-desc">${I(c, 'desc')}</p>
      </div>`).join('\n');
    return sectionWithHeader(f, `    <div class="cap-grid reveal">\n${cards}\n    </div>`);
  },

  deliverables(section) {
    const f = section.fields || {};
    const list = items(section).map((it) => `        <div class="deliv-item">
          <div class="deliv-check"></div>
          <div class="deliv-text">
            <div class="deliv-title">${I(it, 'title')}</div>
            <div class="deliv-desc">${I(it, 'desc')}</div>
          </div>
          <div class="deliv-freq">${T(it, 'freq')}</div>
        </div>`).join('\n');
    return sectionWithHeader(f, `    <div class="deliv-layout reveal">
      <div>
        <p style="font-size:17px;line-height:1.6;color:var(--text-muted);margin-bottom:24px;">${I(f, 'intro1')}</p>
        <p style="font-size:17px;line-height:1.6;color:var(--text-muted);">${I(f, 'intro2')}</p>
      </div>
      <div class="deliv-list">
${list}
      </div>
    </div>`);
  },

  approach(section) {
    const f = section.fields || {};
    const steps = items(section).map((s) => `      <div class="approach-step">
        <div class="approach-step-num">${T(s, 'num')}</div>
        <div class="approach-step-content">
          <div class="approach-step-label">${I(s, 'label')}</div>
          <h3 class="approach-step-title">${I(s, 'title')}</h3>
          <p class="approach-step-desc">${I(s, 'desc')}</p>
        </div>
      </div>`).join('\n');
    return sectionWithHeader(f, `    <div class="approach-list reveal">\n${steps}\n    </div>`);
  },

  tiers(section) {
    const f = section.fields || {};
    const cards = items(section).map((t) => {
      const inc = (Array.isArray(t.includes) ? t.includes : []).map((li) => `              <li>${I({ li }, 'li')}</li>`).join('\n');
      return `      <div class="tier-card${t.featured ? ' featured' : ''}">
        <div class="tier-header">
          <div class="tier-name">${I(t, 'name')}</div>
          <div class="tier-tagline">${I(t, 'tagline')}</div>
        </div>
        <div class="tier-meta">
          <div class="tier-row">
            <span class="tier-row-label">For</span>
            <span class="tier-row-value">${I(t, 'for')}</span>
          </div>
          <div class="tier-row">
            <span class="tier-row-label">Timeline</span>
            <span class="tier-row-value">${I(t, 'timeline')}</span>
          </div>
          <div class="tier-row">
            <span class="tier-row-label">Includes</span>
            <ul class="tier-includes">
${inc}
            </ul>
          </div>
        </div>
        <div class="tier-cta"><a href="${href(t, 'ctaHref')}" data-cursor>${I(t, 'ctaLabel', 'Get started')} →</a></div>
      </div>`;
    }).join('\n');
    return sectionWithHeader(f, `    <div class="tier-grid reveal">\n${cards}\n    </div>`);
  },

  testimonials(section) {
    const f = section.fields || {};
    const cards = items(section).map((t) => `      <div class="t-card">
        <div class="t-card-quote-mark">"</div>
        <p class="t-card-quote">${I(t, 'quote')}</p>
        <div class="t-card-author">
          <div class="t-card-avatar">${T(t, 'avatar')}</div>
          <div class="t-card-meta">
            <span class="t-card-name">${I(t, 'name')}</span>
            <span class="t-card-role">${I(t, 'role')}</span>
          </div>
        </div>
      </div>`).join('\n');
    return sectionWithHeader(f, `    <div class="t-grid reveal">\n${cards}\n    </div>`);
  },

  faq(section) {
    const f = section.fields || {};
    const rows = items(section).map((q) => `      <div class="faq-item">
        <div class="faq-q"><span>${I(q, 'q')}</span><span class="faq-toggle">+</span></div>
        <div class="faq-a">${I(q, 'a')}</div>
      </div>`).join('\n');
    return sectionWithHeader(f, `    <div class="faq-list reveal">\n${rows}\n    </div>`);
  },

  finalCta(section) {
    const f = section.fields || {};
    return `  <section class="final-cta">
    <div class="final-cta-eyebrow reveal">${I(f, 'eyebrow', 'Ready when you are')}</div>
    <h2 class="final-cta-title reveal">${I(f, 'title')}</h2>
    <p class="final-cta-sub reveal">${I(f, 'sub')}</p>
    <div class="reveal">
      <a href="${href(f, 'ctaHref')}" class="btn-primary" data-cursor>
        ${I(f, 'ctaLabel', 'Book a call')}
        <span class="arrow">→</span>
      </a>
    </div>
  </section>`;
  },
};

/* The shared header block (eyebrow / title / sub) every grid section opens with,
 * followed by the section's body. Matches the live pages' `<section>` shape exactly. */
function sectionWithHeader(f, body) {
  return `  <section>
    <div class="reveal">
      <div class="section-eyebrow">${I(f, 'eyebrow')}</div>
      <h2 class="section-title">${I(f, 'title')}</h2>
      <p class="section-sub">${I(f, 'sub')}</p>
    </div>
${body}
  </section>`;
}

/** The reusable section types, in a sensible default palette order. */
export const SECTION_TYPES = ['hero', 'capabilities', 'deliverables', 'approach', 'tiers', 'testimonials', 'faq', 'finalCta'];

/** Render one library section. Unknown types are skipped (never thrown on). */
export function renderSection(section) {
  const fn = SECTION_RENDERERS[section?.type];
  if (!fn || section?.hidden) return '';
  return fn(section);
}
