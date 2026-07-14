import { api } from '../api.js';
import { esc, toast } from '../../dashboard/dom.js';

/* The global SEO manager: every URL on the site (pages + posts) in one table,
 * inline-editable. The robots control is a tri-state SELECT — NEVER a checkbox.
 * An unchecked checkbox submits false, and robotsIndex:false is `noindex` on every
 * page that never touched the field. See Invariant 1. */
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'no-desc', label: 'Missing description', test: (r) => !r.metaDescription },
  { id: 'title-len', label: 'Title out of range', test: (r) => r.titleLen < 30 || r.titleLen > 60 },
  { id: 'noindex', label: 'Noindexed', test: (r) => r.robotsIndex === false },
  { id: 'dupe-title', label: 'Duplicate title' }, // computed below
  { id: 'off-canon', label: 'Off-site canonical', test: (r) => r.canonicalUrl && !r.canonicalUrl.includes('davnoot.com') },
];

export class SeoManager {
  constructor(root) { this.root = root; this.filter = 'all'; }

  async mount() {
    this.root.innerHTML = '<div class="loading">Loading…</div>';
    try { this.data = await api.seoTable(); }
    catch (err) { this.root.innerHTML = `<div class="empty"><h2>Couldn't load the SEO table</h2><p class="muted">${esc(err.message)}</p></div>`; return; }
    this.markDuplicates();
    this.render();
    this.wire();
  }

  markDuplicates() {
    const seen = new Map();
    for (const r of this.data.rows) {
      const t = (r.metaTitle || r.title || '').trim().toLowerCase();
      if (!t) continue;
      seen.set(t, (seen.get(t) || 0) + 1);
    }
    for (const r of this.data.rows) {
      const t = (r.metaTitle || r.title || '').trim().toLowerCase();
      r._dupeTitle = t && seen.get(t) > 1;
    }
  }

  rows() {
    const f = FILTERS.find((x) => x.id === this.filter);
    if (this.filter === 'dupe-title') return this.data.rows.filter((r) => r._dupeTitle);
    if (!f?.test) return this.data.rows;
    return this.data.rows.filter(f.test);
  }

  render() {
    const rows = this.rows();
    this.root.innerHTML = `
      <header class="page-head">
        <div><h1>SEO</h1><p class="muted">Every URL on the site. Edit inline — changes to a page land on its draft and go live when you publish it.</p></div>
      </header>
      <div class="table-controls" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        ${FILTERS.map((f) => `<button class="btn btn-sm ${this.filter === f.id ? 'btn-dark' : 'btn-ghost'}" data-filter="${f.id}">${esc(f.label)}</button>`).join('')}
      </div>
      <div class="table-scroll"><table class="grid-table">
        <thead><tr><th>URL</th><th>Meta title</th><th>Meta description</th><th>Robots</th><th>Canonical</th><th></th></tr></thead>
        <tbody>${rows.map((r) => this.row(r)).join('')}</tbody>
      </table></div>
      <p class="muted small" style="margin-top:10px">${rows.length} of ${this.data.rows.length} URLs.</p>
    `;
  }

  row(r) {
    const ref = `${r.type}:${r.key}`;
    return `<tr data-ref="${esc(ref)}">
      <td>
        <a class="url" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a>
        <div class="small">${r.type === 'post' ? '<span class="pill pill-muted">post</span>' : '<span class="pill pill-muted">page</span>'} ${r.seoReady ? '<span class="pill pill-ok">SEO ready</span>' : ''} ${r._dupeTitle ? '<span class="pill pill-warn">dupe title</span>' : ''}</div>
      </td>
      <td>
        <input class="cell-edit" data-field="seo.metaTitle" value="${esc(r.metaTitle)}" placeholder="${esc(r.title)}" />
        <span class="cell-count ${r.titleLen < 30 || r.titleLen > 60 ? 'bad' : ''}" data-count="title">${r.titleLen}/60</span>
      </td>
      <td>
        <input class="cell-edit" data-field="seo.metaDescription" value="${esc(r.metaDescription)}" placeholder="—" />
        <span class="cell-count ${r.descLen && (r.descLen < 120 || r.descLen > 160) ? 'bad' : ''}" data-count="desc">${r.descLen}/160</span>
      </td>
      <td>
        <select class="cell-edit" data-field="seo.robotsIndex">
          <option value="" ${r.robotsIndex === undefined ? 'selected' : ''}>Default (index)</option>
          <option value="true" ${r.robotsIndex === true ? 'selected' : ''}>index</option>
          <option value="false" ${r.robotsIndex === false ? 'selected' : ''}>noindex</option>
        </select>
      </td>
      <td><input class="cell-edit" data-field="seo.canonicalUrl" value="${esc(r.canonicalUrl)}" placeholder="—" style="min-width:150px" /></td>
      <td><a class="btn btn-ghost btn-sm" href="${esc(r.editUrl)}"${r.type === 'post' ? ' target="_blank" rel="noopener"' : ''}>Edit</a></td>
    </tr>`;
  }

  wire() {
    this.root.querySelectorAll('[data-filter]').forEach((b) =>
      b.addEventListener('click', () => { this.filter = b.dataset.filter; this.render(); this.wire(); }),
    );

    this.root.querySelectorAll('tr[data-ref]').forEach((tr) => {
      const [type, key] = tr.dataset.ref.split(/:(.+)/);
      tr.querySelectorAll('[data-field]').forEach((el) => {
        const commit = async () => {
          const field = el.dataset.field;
          let value = el.value;
          if (field === 'seo.robotsIndex') value = value === '' ? null : value === 'true'; // tri-state
          try {
            await api.patchSeo({ type, key, field, value });
            el.classList.add('saved-flash');
            setTimeout(() => el.classList.remove('saved-flash'), 900);
            // Live-update length counters.
            const src = this.data.rows.find((r) => `${r.type}:${r.key}` === tr.dataset.ref);
            if (src && field === 'seo.metaTitle') src.metaTitle = value || '';
            if (src && field === 'seo.metaDescription') src.metaDescription = value || '';
          } catch (err) { toast(err.fields?.[el.dataset.field] || err.message, 'err'); }
        };
        if (el.tagName === 'SELECT') el.addEventListener('change', commit);
        else {
          el.addEventListener('blur', commit);
          el.addEventListener('input', () => this.updateCount(tr, el));
        }
      });
    });
  }

  updateCount(tr, el) {
    if (el.dataset.field === 'seo.metaTitle') {
      const c = tr.querySelector('[data-count="title"]');
      if (c) { c.textContent = `${el.value.length}/60`; c.classList.toggle('bad', el.value.length < 30 || el.value.length > 60); }
    } else if (el.dataset.field === 'seo.metaDescription') {
      const c = tr.querySelector('[data-count="desc"]');
      if (c) { c.textContent = `${el.value.length}/160`; c.classList.toggle('bad', el.value.length && (el.value.length < 120 || el.value.length > 160)); }
    }
  }
}
