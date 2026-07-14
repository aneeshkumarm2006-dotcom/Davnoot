/* The structured-data sidebar panel.
 *
 * Most authors will never open this. It exists for the one post a year where the
 * engine's defaults are wrong — and so that the fix is a form field rather than a
 * ticket. Defaults are chosen so that doing nothing produces correct schema.
 */
import { CONFIG, OVERRIDABLE_FIELDS } from '../../lib/structured-data.js';
import { findFaqBlock } from '../../lib/blocks.js';
import { esc, $ } from './dom.js';

export class StructuredDataPanel {
  /**
   * @param {HTMLElement} mount
   * @param {object} opts
   * @param {() => object} opts.getPost   the current draft (for FAQ detection)
   * @param {object} opts.value           post.structuredData
   * @param {(next) => void} opts.onChange
   */
  constructor(mount, { getPost, value, onChange }) {
    this.mount = mount;
    this.getPost = getPost;
    this.onChange = onChange;
    this.value = {
      disabledTypes: [],
      fieldOverrides: {},
      customJsonLd: '',
      customMode: 'append',
      ...(value || {}),
    };

    this.render();
    this.wire();
  }

  /**
   * The value to persist, or `null` when the author has set nothing.
   *
   * NULL, NOT UNDEFINED. JSON.stringify silently drops undefined keys, so
   * returning undefined would make the key ABSENT from the request body — and an
   * absent key means "leave the stored value alone" under the three-state rule in
   * lib/post-write.js. The author could then never clear their structured data:
   * they'd delete every override, save, and it would still be there.
   *
   * `null` survives serialization and means "clear it". The validator maps it back
   * to undefined, and the writer $unsets the field.
   */
  getValue() {
    const v = this.value;
    const has =
      v.disabledTypes?.length ||
      Object.keys(v.fieldOverrides || {}).some((t) =>
        Object.values(v.fieldOverrides[t] || {}).some((x) => String(x || '').trim()),
      ) ||
      String(v.customJsonLd || '').trim();

    if (!has) return null;

    return {
      disabledTypes: v.disabledTypes,
      fieldOverrides: v.fieldOverrides,
      customJsonLd: v.customJsonLd,
      customMode: v.customMode,
    };
  }

  render() {
    const post = this.getPost();
    const hasFaq = Boolean(findFaqBlock(post.blocks));
    const disabled = new Set(this.value.disabledTypes || []);

    const nodes = CONFIG.blogPost.nodes.map((type) => {
      // FAQPage is DERIVED — it only exists if there's an FAQ block. Say so, rather
      // than showing a toggle that appears to do nothing.
      const inactive = type === 'FAQPage' && !hasFaq;

      return `
      <label class="sd-node ${inactive ? 'is-inactive' : ''}">
        <input type="checkbox" data-node="${esc(type)}" ${disabled.has(type) ? '' : 'checked'} ${inactive ? 'disabled' : ''} />
        <span>${esc(type)}</span>
        ${inactive ? '<em>add an FAQ block to enable</em>' : ''}
      </label>`;
    });

    const overridable = OVERRIDABLE_FIELDS.BlogPosting || [];
    const fo = this.value.fieldOverrides?.BlogPosting || {};

    this.mount.innerHTML = `
      <p class="hint">Emitted automatically. Only change this if you know why.</p>

      <div class="sd-nodes">${nodes.join('')}</div>

      <details class="sd-details">
        <summary>Override BlogPosting fields</summary>
        <p class="hint">Blank = use the generated value.</p>
        ${overridable
          .map(
            (field) => `
          <div class="field">
            <label for="sd-${field}">${esc(field)}</label>
            <input class="input input-sm" id="sd-${field}" data-override="${esc(field)}" value="${esc(fo[field] || '')}" />
          </div>`,
          )
          .join('')}
      </details>

      <details class="sd-details">
        <summary>Custom JSON-LD</summary>
        <div class="field">
          <select class="input input-sm" id="sd-mode">
            <option value="append" ${this.value.customMode !== 'replace' ? 'selected' : ''}>Append to the generated schema</option>
            <option value="replace" ${this.value.customMode === 'replace' ? 'selected' : ''}>Replace it entirely</option>
          </select>
        </div>
        <div class="field">
          <textarea class="input" id="sd-json" rows="6" spellcheck="false" placeholder='{"@type":"HowTo","name":"…"}'>${esc(this.value.customJsonLd || '')}</textarea>
          <p class="hint" id="sd-json-err" hidden></p>
          <p class="hint" id="sd-replace-warn" ${this.value.customMode === 'replace' ? '' : 'hidden'}>
            <strong>Replace</strong> drops Organization, BlogPosting and BreadcrumbList. Only do this if your JSON provides them.
          </p>
        </div>
      </details>`;
  }

  wire() {
    const m = this.mount;

    m.addEventListener('change', (e) => {
      if (e.target.dataset.node) {
        const type = e.target.dataset.node;
        const set = new Set(this.value.disabledTypes || []);
        // The checkbox reads "emit this node", so CHECKED means NOT disabled.
        if (e.target.checked) set.delete(type);
        else set.add(type);
        this.value.disabledTypes = [...set];
        return this.onChange();
      }

      if (e.target.id === 'sd-mode') {
        this.value.customMode = e.target.value;
        $('#sd-replace-warn', m).hidden = e.target.value !== 'replace';
        return this.onChange();
      }
    });

    m.addEventListener('input', (e) => {
      if (e.target.dataset.override) {
        const field = e.target.dataset.override;
        this.value.fieldOverrides = this.value.fieldOverrides || {};
        this.value.fieldOverrides.BlogPosting = this.value.fieldOverrides.BlogPosting || {};
        this.value.fieldOverrides.BlogPosting[field] = e.target.value;
        return this.onChange();
      }

      if (e.target.id === 'sd-json') {
        this.value.customJsonLd = e.target.value;

        // Validate as they type. The server BLOCKS the save on invalid JSON (it
        // would emit a broken <script> on the live page), so telling them here —
        // rather than at save time — is the difference between a typo and a
        // mysterious "couldn't save".
        const err = $('#sd-json-err', m);
        const raw = e.target.value.trim();

        if (!raw) {
          err.hidden = true;
        } else {
          try {
            JSON.parse(raw);
            err.hidden = true;
            e.target.classList.remove('has-error');
          } catch (parseErr) {
            err.hidden = false;
            err.textContent = `Invalid JSON — ${parseErr.message}`;
            err.classList.add('warn');
            e.target.classList.add('has-error');
          }
        }

        return this.onChange();
      }
    });
  }
}
