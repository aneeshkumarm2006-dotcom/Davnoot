/* The block editor — ordered, drag-reorderable content sections below the body.
 *
 * Array order IS render order. `id` is generated here, client-side, and is stable
 * across reorders — it is the key we use to find a block's DOM node, so it must
 * NOT be the array index (reordering would then reassign every key and the
 * focused input would jump to a different block mid-typing).
 *
 * Adding a block type is a three-place change; this file is place 3.
 * See the header of lib/blocks.js.
 */
import { BLOCK_TYPES } from '../../lib/blocks.js';
import { esc, $, confirmDialog } from './dom.js';
import { openMediaPicker } from './media-picker.js';

const uid = () => `b${Math.random().toString(36).slice(2, 10)}`;

/** A new block of each type, pre-seeded so the author sees a usable form. */
const BLANK = {
  richtext: () => ({ html: '<p></p>' }),
  faq: () => ({ heading: 'Frequently asked questions', items: [{ q: '', a: '' }] }),
  comparison: () => ({ heading: '', headers: ['', ''], rows: [['', '']] }),
  featureGrid: () => ({ heading: '', items: [{ title: '', description: '' }] }),
  prosCons: () => ({ heading: '', pros: [''], cons: [''] }),
  cta: () => ({ heading: '', body: '', buttonLabel: 'Book a call', buttonUrl: 'https://www.davnoot.com/book-call.html' }),
  media: () => ({ url: '', alt: '', caption: '' }),
  htmlEmbed: () => ({ html: '' }),
};

export class BlockEditor {
  constructor(mount, { blocks = [], onChange = () => {} } = {}) {
    this.mount = mount;
    this.blocks = structuredClone(blocks || []);
    this.onChange = onChange;
    this.render();
    this.wire();
  }

  /** The payload we persist. Empty rows are dropped; the server validates the rest. */
  getBlocks() {
    return this.blocks.map((b) => ({ ...b, data: clean(b.type, b.data) }));
  }

  emit() {
    this.onChange();
  }

  render() {
    this.mount.innerHTML = `
      <div class="blocks-list">
        ${this.blocks.map((b, i) => this.blockCard(b, i)).join('')}
      </div>
      <div class="blocks-add">
        <select class="input input-sm" id="blk-type">
          ${BLOCK_TYPES.map((t) => `<option value="${t.type}">${esc(t.label)}</option>`).join('')}
        </select>
        <button type="button" class="btn btn-ghost btn-sm" id="blk-add">+ Add section</button>
        <span class="hint" id="blk-hint">${esc(BLOCK_TYPES[0].hint)}</span>
      </div>`;
  }

  blockCard(block, i) {
    const meta = BLOCK_TYPES.find((t) => t.type === block.type) || { label: block.type };

    return `
    <div class="blk-card" draggable="true" data-id="${esc(block.id)}" data-i="${i}">
      <header class="blk-card-head">
        <span class="blk-grip" title="Drag to reorder">⠿</span>
        <strong>${esc(meta.label)}</strong>
        <div class="blk-card-actions">
          <button type="button" class="icon-btn" data-move="up" data-id="${esc(block.id)}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="icon-btn" data-move="down" data-id="${esc(block.id)}" ${i === this.blocks.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="icon-btn is-danger" data-remove="${esc(block.id)}">Remove</button>
        </div>
      </header>
      <div class="blk-card-body">${this.form(block)}</div>
    </div>`;
  }

  /* ------------------------------------------------------------- per-type -- */

  form(b) {
    const d = b.data || {};
    const f = (k, v, ph = '', tag = 'input') =>
      tag === 'textarea'
        ? `<textarea class="input" rows="3" data-field="${k}" placeholder="${esc(ph)}">${esc(v || '')}</textarea>`
        : `<input class="input" data-field="${k}" value="${esc(v || '')}" placeholder="${esc(ph)}" />`;

    switch (b.type) {
      case 'richtext':
        return `<div class="field">${f('html', d.html, '<p>HTML…</p>', 'textarea')}</div>`;

      case 'htmlEmbed':
        return `
          <div class="field">
            ${f('html', d.html, 'Paste an embed — <iframe> is kept, <script> is stripped.', 'textarea')}
            <p class="hint">Scripts are removed on save. YouTube, Vimeo, Loom and Maps embeds all work.</p>
          </div>`;

      case 'faq':
        return `
          <div class="field">${f('heading', d.heading, 'Section heading')}</div>
          <div class="blk-rows" data-list="items">
            ${(d.items || [])
              .map(
                (item, i) => `
              <div class="blk-row" data-row="${i}">
                <input class="input input-sm" data-item="q" value="${esc(item.q)}" placeholder="Question" />
                <textarea class="input input-sm" rows="2" data-item="a" placeholder="Answer">${esc(item.a)}</textarea>
                <button type="button" class="kw-del" data-row-del="${i}">×</button>
              </div>`,
              )
              .join('')}
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-row-add="items">+ Question</button>
          <p class="hint">This block also emits <strong>FAQPage</strong> schema — the questions AI answers quote.</p>`;

      case 'featureGrid':
        return `
          <div class="field">${f('heading', d.heading, 'Section heading')}</div>
          <div class="blk-rows" data-list="items">
            ${(d.items || [])
              .map(
                (item, i) => `
              <div class="blk-row" data-row="${i}">
                <input class="input input-sm" data-item="title" value="${esc(item.title)}" placeholder="Title" />
                <textarea class="input input-sm" rows="2" data-item="description" placeholder="Description">${esc(item.description)}</textarea>
                <button type="button" class="kw-del" data-row-del="${i}">×</button>
              </div>`,
              )
              .join('')}
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-row-add="items">+ Feature</button>`;

      case 'prosCons':
        return `
          <div class="field">${f('heading', d.heading, 'Section heading')}</div>
          <div class="field-row">
            <div class="field">
              <label>Pros</label>
              ${f('pros', (d.pros || []).join('\n'), 'One per line', 'textarea')}
            </div>
            <div class="field">
              <label>Cons</label>
              ${f('cons', (d.cons || []).join('\n'), 'One per line', 'textarea')}
            </div>
          </div>`;

      case 'comparison':
        return `
          <div class="field">${f('heading', d.heading, 'Section heading')}</div>
          <div class="field">
            <label>Columns</label>
            ${f('headers', (d.headers || []).join(' | '), 'Criteria | Option A | Option B')}
            <p class="hint">Separate columns with <code>|</code></p>
          </div>
          <div class="field">
            <label>Rows</label>
            ${f('rows', (d.rows || []).map((r) => r.join(' | ')).join('\n'), 'Cost | $$ | $\nSpeed | Fast | Slow', 'textarea')}
            <p class="hint">One row per line, cells separated with <code>|</code></p>
          </div>`;

      case 'cta':
        return `
          <div class="field">${f('heading', d.heading, 'Heading')}</div>
          <div class="field">${f('body', d.body, 'Supporting line', 'textarea')}</div>
          <div class="field-row">
            <div class="field">${f('buttonLabel', d.buttonLabel, 'Button label')}</div>
            <div class="field">${f('buttonUrl', d.buttonUrl, 'https://…')}</div>
          </div>`;

      case 'media':
        return `
          <div class="field">
            ${f('url', d.url, 'Image URL')}
            <button type="button" class="btn btn-ghost btn-sm" data-pick="1">Choose from library</button>
          </div>
          <div class="field">${f('alt', d.alt, 'Alt text')}</div>
          <div class="field">${f('caption', d.caption, 'Caption (optional)')}</div>`;

      default:
        return `<p class="hint">Unknown block type “${esc(b.type)}”.</p>`;
    }
  }

  /* ----------------------------------------------------------------- wire -- */

  find(id) {
    return this.blocks.find((b) => b.id === id);
  }

  wire() {
    const m = this.mount;

    m.addEventListener('input', (e) => {
      const card = e.target.closest('.blk-card');

      if (e.target.id === 'blk-type') return;

      if (card) {
        const block = this.find(card.dataset.id);
        if (!block) return;

        // A repeated row (FAQ item, feature)
        const row = e.target.closest('.blk-row');
        if (row && e.target.dataset.item) {
          const list = row.closest('[data-list]').dataset.list;
          block.data[list][Number(row.dataset.row)][e.target.dataset.item] = e.target.value;
          return this.emit();
        }

        // A plain field
        const field = e.target.dataset.field;
        if (!field) return;

        if (field === 'pros' || field === 'cons') {
          block.data[field] = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
        } else if (field === 'headers') {
          block.data.headers = e.target.value.split('|').map((s) => s.trim());
        } else if (field === 'rows') {
          block.data.rows = e.target.value
            .split('\n')
            .map((line) => line.split('|').map((s) => s.trim()))
            .filter((r) => r.some(Boolean));
        } else {
          block.data[field] = e.target.value;
        }
        this.emit();
      }
    });

    m.addEventListener('change', (e) => {
      if (e.target.id === 'blk-type') {
        const t = BLOCK_TYPES.find((x) => x.type === e.target.value);
        $('#blk-hint', m).textContent = t?.hint || '';
      }
    });

    m.addEventListener('click', async (e) => {
      const t = e.target;

      if (t.id === 'blk-add') {
        const type = $('#blk-type', m).value;
        this.blocks.push({ type, id: uid(), data: BLANK[type]() });
        this.render();
        return this.emit();
      }

      if (t.dataset.remove) {
        if (!(await confirmDialog('Remove this section?', { confirmLabel: 'Remove', danger: true }))) return;
        this.blocks = this.blocks.filter((b) => b.id !== t.dataset.remove);
        this.render();
        return this.emit();
      }

      if (t.dataset.move) {
        const i = this.blocks.findIndex((b) => b.id === t.dataset.id);
        const j = t.dataset.move === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= this.blocks.length) return;
        [this.blocks[i], this.blocks[j]] = [this.blocks[j], this.blocks[i]];
        this.render();
        return this.emit();
      }

      if (t.dataset.rowAdd) {
        const block = this.find(t.closest('.blk-card').dataset.id);
        const list = t.dataset.rowAdd;
        const blank = block.type === 'faq' ? { q: '', a: '' } : { title: '', description: '' };
        block.data[list] = [...(block.data[list] || []), blank];
        this.render();
        return this.emit();
      }

      if (t.dataset.rowDel != null) {
        const card = t.closest('.blk-card');
        const block = this.find(card.dataset.id);
        const list = t.closest('[data-list]').dataset.list;
        block.data[list].splice(Number(t.dataset.rowDel), 1);
        this.render();
        return this.emit();
      }

      if (t.dataset.pick) {
        const picked = await openMediaPicker();
        if (!picked) return;
        const block = this.find(t.closest('.blk-card').dataset.id);
        block.data.url = picked.url;
        if (picked.alt) block.data.alt = picked.alt;
        this.render();
        return this.emit();
      }
    });

    /* Drag to reorder. We reorder the ARRAY and re-render, rather than moving DOM
     * nodes — the array is the source of truth, and letting the DOM diverge from it
     * is how a reorder silently fails to save. */
    let dragId = null;

    m.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.blk-card');
      if (!card) return;
      dragId = card.dataset.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    m.addEventListener('dragend', (e) => {
      e.target.closest('.blk-card')?.classList.remove('dragging');
      dragId = null;
    });

    m.addEventListener('dragover', (e) => {
      const over = e.target.closest('.blk-card');
      if (!over || !dragId || over.dataset.id === dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    m.addEventListener('drop', (e) => {
      const over = e.target.closest('.blk-card');
      if (!over || !dragId) return;
      e.preventDefault();

      const from = this.blocks.findIndex((b) => b.id === dragId);
      const to = this.blocks.findIndex((b) => b.id === over.dataset.id);
      if (from < 0 || to < 0 || from === to) return;

      const [moved] = this.blocks.splice(from, 1);
      this.blocks.splice(to, 0, moved);
      this.render();
      this.emit();
    });
  }
}

/** Drop empty repeated rows before we serialize — but never a partly-filled one. */
function clean(type, data) {
  const d = { ...data };

  if (type === 'faq') d.items = (d.items || []).filter((i) => i.q?.trim() || i.a?.trim());
  if (type === 'featureGrid') d.items = (d.items || []).filter((i) => i.title?.trim() || i.description?.trim());
  if (type === 'prosCons') {
    d.pros = (d.pros || []).filter(Boolean);
    d.cons = (d.cons || []).filter(Boolean);
  }
  if (type === 'comparison') {
    d.headers = (d.headers || []).filter((h) => h !== undefined);
    d.rows = (d.rows || []).filter((r) => r.some((c) => c?.trim()));
  }

  return d;
}
