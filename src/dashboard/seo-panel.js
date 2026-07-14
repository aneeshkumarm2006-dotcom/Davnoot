/* The SEO sidebar: live character counters, a Google snippet preview, and the
 * pass/warn checklist with per-check "mark as reviewed" overrides.
 *
 * The checklist is computed by lib/seo-score.js — the SAME pure module the server
 * imports to compute the "SEO ready" badge in the posts table. Not a copy of it;
 * the same file. That is the only way the badge and this panel can be guaranteed
 * to agree. If you need a new check, add it there and BOTH surfaces get it.
 */
import { extractSignals, runChecks, isSeoReady, IDEAL } from '../../lib/seo-score.js';
import { esc } from './dom.js';

/** Google truncates by pixel width, but character count is the honest proxy. */
function counter(value, min, max) {
  const n = (value || '').length;
  const state = n === 0 ? 'empty' : n < min || n > max ? 'warn' : 'ok';
  return `<span class="counter is-${state}">${n} / ${min}–${max}</span>`;
}

export class SeoPanel {
  /**
   * @param {HTMLElement} mount
   * @param {object} opts
   * @param {() => object} opts.getPost       current post-shaped draft
   * @param {(ids: string[]) => void} opts.onOverridesChange
   */
  constructor(mount, { getPost, onOverridesChange }) {
    this.mount = mount;
    this.getPost = getPost;
    this.onOverridesChange = onOverridesChange;

    mount.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-override]');
      if (!btn) return;

      const id = btn.dataset.override;
      const post = this.getPost();
      const current = new Set(post.seoOverrides || []);

      if (current.has(id)) current.delete(id);
      else current.add(id);

      this.onOverridesChange([...current]);
      this.render();
    });
  }

  render() {
    const post = this.getPost();
    const signals = extractSignals(post);
    const checks = runChecks(signals, post.seoOverrides || []);
    const ready = isSeoReady(checks);
    const seo = post.seo || {};

    this.mount.innerHTML = `
      <div class="seo-ready ${ready ? 'is-ready' : 'is-not'}">
        <span class="dot"></span>
        <strong>${ready ? 'SEO ready' : 'Not SEO ready'}</strong>
        <span class="muted">${checks.filter((c) => c.blocking && c.status === 'warn').length} to fix</span>
      </div>

      ${this.snippetPreview(post, signals)}

      <ul class="seo-checks">
        ${checks.map((c) => this.checkRow(c)).join('')}
      </ul>
    `;

    return { ready, checks, signals };
  }

  /** What the post will actually look like in a Google result. */
  snippetPreview(post, signals) {
    const url = `www.davnoot.com › blog › ${post.slug || 'your-post'}`;
    const title = signals.effectiveTitle || 'Your title will appear here';
    const desc = signals.effectiveDesc || 'Your meta description will appear here. Aim for 120–160 characters.';

    // Google truncates ~60 chars of title and ~160 of description — show it.
    const t = title.length > 60 ? esc(title.slice(0, 60)) + '…' : esc(title);
    const d = desc.length > 160 ? esc(desc.slice(0, 160)) + '…' : esc(desc);

    return `
      <div class="snippet">
        <div class="snippet-label">Google preview</div>
        <div class="snippet-url">${esc(url)}</div>
        <div class="snippet-title">${t}</div>
        <div class="snippet-desc">${d}</div>
        <div class="snippet-counts">
          Title ${counter(signals.effectiveTitle, IDEAL.titleMin, IDEAL.titleMax)}
          Description ${counter(signals.effectiveDesc, IDEAL.descMin, IDEAL.descMax)}
        </div>
      </div>`;
  }

  checkRow(c) {
    const icon = c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : 'i';

    // An override still SHOWS as an override. The author green-lit the warning;
    // they didn't make the underlying condition go away, and a future reader of
    // this post should be able to see that a human made that call.
    const overrideBtn =
      c.blocking && (c.status === 'warn' || c.overridden)
        ? `<button type="button" class="override-btn" data-override="${esc(c.id)}">
             ${c.overridden ? 'Undo override' : 'Mark as reviewed'}
           </button>`
        : '';

    return `
      <li class="check is-${c.status} ${c.overridden ? 'is-overridden' : ''}">
        <span class="check-icon">${icon}</span>
        <div class="check-body">
          <div class="check-label">
            ${esc(c.label)}
            ${c.overridden ? '<span class="override-tag">manual override</span>' : ''}
          </div>
          <div class="check-msg">${esc(c.message)}</div>
          ${overrideBtn}
        </div>
      </li>`;
  }
}
