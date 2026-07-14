import { api } from '../api.js';
import { esc, toast, confirmDialog } from '../../dashboard/dom.js';
// section-fields.gen.js imports NOTHING, so it is safe in the browser bundle (unlike
// sections.gen.js, which pulls in the server renderers). The palette order is its keys.
import { SECTION_FIELDS } from '../../../lib/section-fields.gen.js';
const SECTION_TYPES = Object.keys(SECTION_FIELDS);

/* The page content editor. For the 8 marketing pages this edits field VALUES only
 * (the user chose content-only editing for them); layout stays fixed. Each slot
 * renders the right control by kind: inline -> a constrained contenteditable with a
 * small accent toolbar, text -> a plain input, image/url -> an input. The right
 * pane is a live preview iframe served by the SAME renderer as production. */

export class PageEditor {
  constructor(root, { key }) {
    this.root = root;
    this.key = key;
    this.dirty = false;
    this.saving = false;
    this.values = {};
    this.autosave = { hasUnsavedChanges: () => this.dirty }; // duck-typed guard for the router
  }

  destroy() { clearTimeout(this._debounce); }

  async mount() {
    if (this.key === 'new') return this.renderNew();
    this.root.innerHTML = '<div class="loading">Loading…</div>';
    try { this.page = await api.getPage(this.key); }
    catch (err) { this.root.innerHTML = `<div class="empty"><h2>Couldn't load the page</h2><p class="muted">${esc(err.message)}</p></div>`; return; }

    // A COMPOSED page (base:null) has no disk template — it is built from library
    // sections, with full layout control. An OVERLAY page (one of the 8) edits field
    // values only. Different editors; same draft/publish/preview plumbing.
    if (this.page.base === null) {
      this.composed = true;
      this.sections = Array.isArray(this.page.draft?.sections) ? this.page.draft.sections.map(normalizeSection) : [];
      this.renderComposed();
      return;
    }

    // Seed the editable values from the saved draft (section field overrides + seo).
    this.values = flattenDraft(this.page.draft);
    this.render();
    this.wire();
  }

  render() {
    const groups = groupSlots(this.page.slots);
    this.root.innerHTML = `
      <div class="editor-bar">
        <div>
          <a href="/admin/pages" class="muted small">← Pages</a>
          <h1 style="font-size:20px;margin-top:2px">${esc(this.page.draft.title || this.key)}</h1>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span class="editor-status" id="status">${this.page.hasUnpublishedChanges ? 'Unpublished changes' : 'Live'}</span>
          <button class="btn btn-ghost" id="revisions">History</button>
          <button class="btn btn-dark" id="publish">Publish</button>
        </div>
      </div>

      <div class="editor-split">
        <div class="editor-fields">
          ${this.page.slots.length ? Object.entries(groups).map(([g, slots]) => this.group(g, slots)).join('')
            : '<p class="muted">This page has no editable fields yet. Add <code>data-cms</code> annotations to <code>pages/' + esc(this.key) + '</code> to expose content here.</p>'}
        </div>
        <div class="editor-preview">
          <div class="preview-bar"><span class="muted small">Live preview (draft)</span></div>
          <iframe class="preview-frame" id="preview" src="/admin/preview/${encodeURIComponent(this.key)}"></iframe>
        </div>
      </div>
    `;
  }

  group(name, slots) {
    return `<div class="field-group"><h3>${esc(name)}</h3>
      ${slots.map((s) => this.field(s)).join('')}
    </div>`;
  }

  field(slot) {
    const val = this.values[slot.key] != null ? this.values[slot.key] : slot.def;
    const id = 'f_' + slot.key.replace(/[^a-z0-9]/gi, '_');
    if (slot.kind === 'inline' || slot.kind === 'richtext') {
      return `<div class="field">
        <label>${esc(slot.label)}</label>
        <div class="inline-toolbar">
          <button type="button" data-cmd="bold" title="Bold"><b>B</b></button>
          <button type="button" data-cmd="italic" title="Italic"><i>I</i></button>
          <button type="button" data-cmd="accent" title="Accent (em)"><em>A</em></button>
        </div>
        <div class="inline-edit" contenteditable="true" data-slot="${esc(slot.key)}" id="${id}">${val}</div>
      </div>`;
    }
    // text / url / image -> plain input
    return `<div class="field">
      <label>${esc(slot.label)}</label>
      <input class="input" data-slot="${esc(slot.key)}" id="${id}" value="${esc(stripTags(val))}" />
    </div>`;
  }

  wire() {
    // Inline accent toolbar (execCommand is deprecated but universally supported and
    // perfect for a 3-button constrained editor — no dependency needed).
    this.root.querySelectorAll('.inline-toolbar button').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const cmd = btn.dataset.cmd;
        if (cmd === 'accent') document.execCommand('italic'); // em ~ italic accent
        else document.execCommand(cmd);
      });
    });

    this.root.querySelectorAll('[data-slot]').forEach((el) => {
      const read = () => (el.isContentEditable ? el.innerHTML : el.value);
      const handler = () => { this.values[el.dataset.slot] = read(); this.touch(); };
      el.addEventListener('input', handler);
      el.addEventListener('blur', handler);
    });

    this.root.querySelector('#publish')?.addEventListener('click', () => this.publish());
    this.root.querySelector('#revisions')?.addEventListener('click', () => this.showRevisions());
  }

  touch() {
    this.dirty = true;
    this.setStatus('Unsaved…', 'dirty');
    clearTimeout(this._debounce);
    this._debounce = setTimeout(() => this.save(), 900); // autosave to DRAFT
  }

  async save() {
    if (this.saving) return;
    this.saving = true;
    this.setStatus('Saving…', 'dirty');
    const body = buildDraftPayload(this.values, this.page);
    body.__version = this.page.version;
    try {
      const r = await api.savePageDraft(this.key, body, this.page.version);
      this.page.version = r.version;
      this.dirty = false;
      this.setStatus('Saved to draft', 'saved');
      this.reloadPreview();
    } catch (err) {
      if (err.status === 409) { this.setStatus('Someone else saved — reload', 'dirty'); toast('This page changed elsewhere. Reload to continue.', 'err'); }
      else { this.setStatus('Save failed', 'dirty'); toast(err.message, 'err'); }
    } finally { this.saving = false; }
  }

  async publish() {
    if (this.dirty) await this.save();
    if (!(await confirmDialog('Publish this page? Your draft edits go live within ~60 seconds.', { confirmLabel: 'Publish' }))) return;
    try { await api.publishPage(this.key); toast('Published — live in ~60s.'); this.setStatus('Live', 'saved'); this.page.hasUnpublishedChanges = false; }
    catch (err) { toast(err.message, 'err'); }
  }

  async showRevisions() {
    let data;
    try { data = await api.pageRevisions(this.key); }
    catch (err) { toast(err.message, 'err'); return; }
    if (!data.revisions.length) { toast('No revisions yet.'); return; }
    const list = data.revisions.map((r) => `v${r.version} · ${new Date(r.at).toLocaleString()} · ${r.by}`).join('\n');
    if (await confirmDialog(`Restore the most recent revision into the draft?\n\n${list}`, { confirmLabel: 'Restore latest' })) {
      try { await api.restoreRevision(this.key, data.revisions[0].version); toast('Restored into draft.'); this.mount(); }
      catch (err) { toast(err.message, 'err'); }
    }
  }

  reloadPreview() {
    clearTimeout(this._pv);
    this._pv = setTimeout(() => { const f = this.root.querySelector('#preview'); if (f) f.src = f.src; }, 400);
  }

  setStatus(text, cls) {
    const el = this.root.querySelector('#status');
    if (el) { el.textContent = text; el.className = 'editor-status ' + (cls || ''); }
  }

  /* ---- Composed-page section editor (full layout control) ---- */

  renderComposed() {
    this.root.innerHTML = `
      <div class="editor-bar">
        <div>
          <a href="/admin/pages" class="muted small">← Pages</a>
          <h1 style="font-size:20px;margin-top:2px">${esc(this.page.draft?.title || this.key)}</h1>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span class="editor-status" id="status">${this.page.hasUnpublishedChanges ? 'Unpublished changes' : 'Draft'}</span>
          <button class="btn btn-ghost" id="revisions">History</button>
          <button class="btn btn-dark" id="publish">Publish</button>
        </div>
      </div>
      <div class="editor-split">
        <div class="editor-fields">
          <div class="section-palette">
            <span class="muted small">Add a section:</span>
            ${SECTION_TYPES.map((t) => `<button class="btn btn-ghost btn-add-section" data-type="${t}">+ ${esc(SECTION_FIELDS[t].label)}</button>`).join('')}
          </div>
          <div id="section-list">${this.sections.map((s, i) => this.sectionCard(s, i)).join('') || '<p class="muted">No sections yet. Add one above to start building the page.</p>'}</div>
        </div>
        <div class="editor-preview">
          <div class="preview-bar"><span class="muted small">Live preview (draft)</span></div>
          <iframe class="preview-frame" id="preview" src="/admin/preview/${encodeURIComponent(this.key)}"></iframe>
        </div>
      </div>`;
    this.wireComposed();
  }

  sectionCard(section, i) {
    const spec = SECTION_FIELDS[section.type];
    if (!spec) return '';
    const fieldInputs = spec.fields.map((f) => this.fieldControl(`s${i}.${f.key}`, f, section.fields?.[f.key])).join('');
    const itemsHtml = spec.item
      ? `<div class="section-items"><div class="muted small" style="margin:8px 0 4px">${esc(spec.item.label)}s</div>
          ${(section.items || []).map((it, j) => `<div class="section-item">
            <div class="section-item-head"><span class="muted small">${esc(spec.item.label)} ${j + 1}</span><button class="btn-icon btn-del-item" data-s="${i}" data-i="${j}" title="Remove">✕</button></div>
            ${spec.item.fields.map((f) => this.fieldControl(`s${i}.i${j}.${f.key}`, f, it?.[f.key])).join('')}
          </div>`).join('')}
          <button class="btn btn-ghost btn-add-item" data-s="${i}">+ Add ${esc(spec.item.label.toLowerCase())}</button></div>`
      : '';
    return `<div class="section-card${section.hidden ? ' is-hidden' : ''}" data-idx="${i}">
      <div class="section-card-head">
        <strong>${esc(spec.label)}</strong>
        <div class="section-card-actions">
          <button class="btn-icon btn-move" data-dir="-1" data-s="${i}" title="Move up">↑</button>
          <button class="btn-icon btn-move" data-dir="1" data-s="${i}" title="Move down">↓</button>
          <button class="btn-icon btn-hide" data-s="${i}" title="${section.hidden ? 'Show' : 'Hide'}">${section.hidden ? '◌' : '●'}</button>
          <button class="btn-icon btn-del-section" data-s="${i}" title="Remove">✕</button>
        </div>
      </div>
      <div class="section-card-body">${fieldInputs}${itemsHtml}</div>
    </div>`;
  }

  fieldControl(path, f, value) {
    const id = 'f_' + path.replace(/[^a-z0-9]/gi, '_');
    if (f.kind === 'bool') {
      return `<label class="field-inline"><input type="checkbox" data-path="${path}" ${value ? 'checked' : ''} /> ${esc(f.label)}</label>`;
    }
    if (f.kind === 'inline-list') {
      const text = Array.isArray(value) ? value.join('\n') : '';
      return `<div class="field"><label>${esc(f.label)}</label><textarea class="input" data-path="${path}" data-list="1" rows="3">${esc(text)}</textarea></div>`;
    }
    if (f.kind === 'richtext') {
      return `<div class="field"><label>${esc(f.label)}</label><textarea class="input" data-path="${path}" rows="3">${esc(value || '')}</textarea></div>`;
    }
    return `<div class="field"><label>${esc(f.label)}</label><input class="input" data-path="${path}" id="${id}" value="${esc(value == null ? '' : value)}" /></div>`;
  }

  wireComposed() {
    const $ = (sel) => this.root.querySelector(sel);
    this.root.querySelectorAll('.btn-add-section').forEach((b) => b.addEventListener('click', () => {
      this.sections.push(newSection(b.dataset.type));
      this.rerenderSections(); this.touchComposed();
    }));
    this.root.querySelectorAll('.btn-move').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.s, dir = +b.dataset.dir, j = i + dir;
      if (j < 0 || j >= this.sections.length) return;
      [this.sections[i], this.sections[j]] = [this.sections[j], this.sections[i]];
      this.rerenderSections(); this.touchComposed();
    }));
    this.root.querySelectorAll('.btn-hide').forEach((b) => b.addEventListener('click', () => {
      const s = this.sections[+b.dataset.s]; s.hidden = !s.hidden; this.rerenderSections(); this.touchComposed();
    }));
    this.root.querySelectorAll('.btn-del-section').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog('Remove this section?', { confirmLabel: 'Remove', danger: true }))) return;
      this.sections.splice(+b.dataset.s, 1); this.rerenderSections(); this.touchComposed();
    }));
    this.root.querySelectorAll('.btn-add-item').forEach((b) => b.addEventListener('click', () => {
      const s = this.sections[+b.dataset.s]; (s.items ||= []).push({}); this.rerenderSections(); this.touchComposed();
    }));
    this.root.querySelectorAll('.btn-del-item').forEach((b) => b.addEventListener('click', () => {
      this.sections[+b.dataset.s].items.splice(+b.dataset.i, 1); this.rerenderSections(); this.touchComposed();
    }));
    this.root.querySelectorAll('[data-path]').forEach((el) => {
      const handler = () => { this.applyField(el); this.touchComposed(); };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });
    $('#publish')?.addEventListener('click', () => this.publish());
    $('#revisions')?.addEventListener('click', () => this.showRevisions());
  }

  // Re-render only the section list, preserving the palette + preview iframe.
  rerenderSections() {
    const list = this.root.querySelector('#section-list');
    if (!list) return;
    list.innerHTML = this.sections.map((s, i) => this.sectionCard(s, i)).join('') || '<p class="muted">No sections yet. Add one above to start building the page.</p>';
    // Re-wire just the list controls (palette/publish stay bound).
    this.wireComposedList();
  }

  wireComposedList() {
    // Rebind the controls inside #section-list after a re-render.
    const rebind = (sel, fn) => this.root.querySelectorAll('#section-list ' + sel).forEach(fn);
    rebind('.btn-move', (b) => b.addEventListener('click', () => {
      const i = +b.dataset.s, j = i + +b.dataset.dir;
      if (j < 0 || j >= this.sections.length) return;
      [this.sections[i], this.sections[j]] = [this.sections[j], this.sections[i]];
      this.rerenderSections(); this.touchComposed();
    }));
    rebind('.btn-hide', (b) => b.addEventListener('click', () => { const s = this.sections[+b.dataset.s]; s.hidden = !s.hidden; this.rerenderSections(); this.touchComposed(); }));
    rebind('.btn-del-section', (b) => b.addEventListener('click', async () => { if (!(await confirmDialog('Remove this section?', { confirmLabel: 'Remove', danger: true }))) return; this.sections.splice(+b.dataset.s, 1); this.rerenderSections(); this.touchComposed(); }));
    rebind('.btn-add-item', (b) => b.addEventListener('click', () => { const s = this.sections[+b.dataset.s]; (s.items ||= []).push({}); this.rerenderSections(); this.touchComposed(); }));
    rebind('.btn-del-item', (b) => b.addEventListener('click', () => { this.sections[+b.dataset.s].items.splice(+b.dataset.i, 1); this.rerenderSections(); this.touchComposed(); }));
    rebind('[data-path]', (el) => { const h = () => { this.applyField(el); this.touchComposed(); }; el.addEventListener('input', h); el.addEventListener('change', h); });
  }

  applyField(el) {
    const path = el.dataset.path; // s{i}.{key} or s{i}.i{j}.{key}
    const m = path.match(/^s(\d+)(?:\.i(\d+))?\.(.+)$/);
    if (!m) return;
    const [, si, ii, key] = m;
    const section = this.sections[+si];
    if (!section) return;
    let val;
    if (el.type === 'checkbox') val = el.checked;
    else if (el.dataset.list) val = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
    else val = el.value;
    if (ii != null) { (section.items ||= [])[+ii] ||= {}; section.items[+ii][key] = val; }
    else { (section.fields ||= {})[key] = val; }
  }

  touchComposed() {
    this.dirty = true;
    this.setStatus('Unsaved…', 'dirty');
    clearTimeout(this._debounce);
    this._debounce = setTimeout(() => this.saveComposed(), 900);
  }

  async saveComposed() {
    if (this.saving) return;
    this.saving = true;
    this.setStatus('Saving…', 'dirty');
    try {
      const body = { title: this.page.draft?.title || this.key, sections: this.sections };
      const r = await api.savePageDraft(this.key, body, this.page.version);
      this.page.version = r.version;
      this.dirty = false;
      this.setStatus('Saved to draft', 'saved');
      this.reloadPreview();
    } catch (err) {
      if (err.status === 409) { this.setStatus('Someone else saved — reload', 'dirty'); toast('This page changed elsewhere. Reload to continue.', 'err'); }
      else { this.setStatus('Save failed', 'dirty'); toast(err.message, 'err'); }
    } finally { this.saving = false; }
  }

  renderNew() {
    this.root.innerHTML = `
      <header class="page-head"><div><h1>New page</h1><p class="muted">Create a custom page at a clean URL.</p></div></header>
      <div class="field-group" style="max-width:520px">
        <div class="field"><label>Title</label><input class="input" id="np-title" placeholder="Pricing" /></div>
        <div class="field"><label>URL slug</label><input class="input" id="np-slug" placeholder="pricing" /><p class="muted small">The page will live at <code>/<span id="np-preview">pricing</span></code></p></div>
        <div class="field"><label>Kind</label><select class="input" id="np-kind">
          <option value="landing">Landing page</option><option value="service">Service page</option>
          <option value="caseStudy">Case study</option><option value="legal">Legal</option></select></div>
        <button class="btn btn-dark" id="np-create">Create</button>
      </div>`;
    const slug = this.root.querySelector('#np-slug');
    slug.addEventListener('input', () => { this.root.querySelector('#np-preview').textContent = slug.value || 'slug'; });
    this.root.querySelector('#np-create').addEventListener('click', async () => {
      try {
        const r = await api.createPage({
          title: this.root.querySelector('#np-title').value,
          slug: slug.value.trim(),
          kind: this.root.querySelector('#np-kind').value,
        });
        toast('Page created.');
        history.pushState({}, '', `/admin/pages/${encodeURIComponent(r.key)}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      } catch (err) { toast(err.fields?.slug || err.message, 'err'); }
    });
  }
}

/* ---- helpers ---- */

function groupSlots(slots) {
  const groups = {};
  for (const s of slots) (groups[s.group] ||= []).push(s);
  return groups;
}

// The draft stores section field overrides + seo. Flatten to a key->value map keyed
// exactly like the compiled holes (so field() can look them up).
function flattenDraft(draft) {
  const out = {};
  for (const [k, v] of Object.entries(draft?.seo || {})) if (v != null) out['seo.' + k] = v;
  for (const section of draft?.sections || []) {
    for (const [k, v] of Object.entries(section.fields || {})) if (v != null) out[k] = v;
  }
  return out;
}

// Rebuild the draft content payload from the flat value map. Overlay pages store
// their overrides in a single synthetic 'overlay' section keyed by the slot key.
function buildDraftPayload(values, page) {
  const seo = {};
  const fields = {};
  for (const [k, v] of Object.entries(values)) {
    if (k.startsWith('seo.')) seo[k.slice(4)] = v;
    else fields[k] = v;
  }
  const content = { title: page.draft?.title || '', sections: [{ id: 'overlay', source: 'base', fields }] };
  if (Object.keys(seo).length) content.seo = seo;
  return content;
}

function stripTags(s) { return String(s || '').replace(/<[^>]+>/g, ''); }

/* ---- composed-page section helpers ---- */
function newSection(type) {
  const spec = SECTION_FIELDS[type];
  const s = { id: type + '-' + Math.random().toString(36).slice(2, 8), type, source: 'library', fields: {} };
  if (spec?.item) s.items = [{}]; // seed one repeating item so the section isn't empty
  return s;
}
function normalizeSection(s) {
  // Defensive: ensure the shape the editor expects, whatever the DB holds.
  return { id: s.id, type: s.type, source: s.source || 'library', hidden: !!s.hidden, fields: s.fields || {}, items: Array.isArray(s.items) ? s.items : undefined };
}
