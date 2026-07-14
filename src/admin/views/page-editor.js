import { api } from '../api.js';
import { esc, toast, confirmDialog } from '../../dashboard/dom.js';

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
