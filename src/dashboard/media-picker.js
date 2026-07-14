/* The image picker dialog.
 *
 * ONE picker, opened from two places: the cover-image field and the editor's
 * insert-image button. Both get the same search, the same upload, and the same
 * alt text. Building a second, simpler picker for one of them is how the two
 * quietly grow different capabilities.
 *
 * Resolves to { url, alt } or null if the author cancelled.
 */
import { api } from './api.js';
import { esc, toast } from './dom.js';

export function openMediaPicker() {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'modal-backdrop';
    el.innerHTML = `
      <div class="modal modal-lg" role="dialog" aria-modal="true" aria-label="Choose an image">
        <header class="modal-head">
          <h2>Choose an image</h2>
          <button type="button" class="modal-x" data-act="cancel" aria-label="Close">×</button>
        </header>

        <div class="picker-bar">
          <input class="input" id="pk-q" placeholder="Search the library…" />
          <label class="btn btn-ghost">
            Upload
            <input type="file" id="pk-file" accept="image/*" multiple hidden />
          </label>
        </div>

        <div class="picker-url">
          <input class="input" id="pk-url" placeholder="…or paste an image URL" />
          <button type="button" class="btn btn-ghost" data-act="use-url">Use URL</button>
        </div>

        <div class="picker-grid" id="pk-grid"><div class="loading">Loading…</div></div>

        <footer class="modal-foot">
          <div class="picker-alt">
            <label for="pk-alt">Alt text</label>
            <input class="input" id="pk-alt" placeholder="Describe the image — this is an SEO check" />
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>
            <button type="button" class="btn btn-dark" data-act="insert" disabled>Insert</button>
          </div>
        </footer>
      </div>`;

    const grid = el.querySelector('#pk-grid');
    const altInput = el.querySelector('#pk-alt');
    const insertBtn = el.querySelector('[data-act="insert"]');
    let selected = null;

    const close = (result) => {
      el.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => e.key === 'Escape' && close(null);

    const select = (item) => {
      selected = item;
      grid.querySelectorAll('.pk-item').forEach((n) => n.classList.toggle('selected', n.dataset.url === item.url));
      // Pre-fill the alt from the library so a well-described image stays
      // well-described everywhere it's used.
      if (item.alt && !altInput.value) altInput.value = item.alt;
      insertBtn.disabled = false;
    };

    async function load(q = '') {
      try {
        const { media } = await api.listMedia({ q });
        if (!media.length) {
          grid.innerHTML = `<div class="empty-sm">Nothing in the library yet. Upload something, or paste a URL above.</div>`;
          return;
        }
        grid.innerHTML = media
          .map(
            (m) => `
          <button type="button" class="pk-item" data-url="${esc(m.url)}" data-alt="${esc(m.alt || '')}">
            <img src="${esc(m.url)}" alt="${esc(m.alt || '')}" loading="lazy" />
            <span class="pk-name">${esc(m.filename || '')}</span>
          </button>`,
          )
          .join('');
      } catch (err) {
        grid.innerHTML = `<div class="empty-sm">Couldn't load the library: ${esc(err.message)}</div>`;
      }
    }

    el.addEventListener('click', async (e) => {
      const act = e.target.dataset.act;
      if (e.target === el || act === 'cancel') return close(null);

      if (act === 'use-url') {
        const url = el.querySelector('#pk-url').value.trim();
        if (!url) return;
        return close({ url, alt: altInput.value.trim() });
      }

      if (act === 'insert' && selected) {
        return close({ url: selected.url, alt: altInput.value.trim() });
      }

      const item = e.target.closest('.pk-item');
      if (item) select({ url: item.dataset.url, alt: item.dataset.alt });
    });

    // Bulk upload = loop single uploads. See api/seoteam/media/upload.js.
    el.querySelector('#pk-file').addEventListener('change', async (e) => {
      const files = [...e.target.files];
      if (!files.length) return;

      grid.innerHTML = `<div class="loading">Uploading ${files.length} image${files.length > 1 ? 's' : ''}…</div>`;
      let last = null;

      for (const file of files) {
        try {
          const { media } = await api.uploadMedia(file);
          last = media;
        } catch (err) {
          toast(`${file.name}: ${err.message}`, 'error');
        }
      }

      await load();
      if (last) select({ url: last.url, alt: last.alt || '' });
    });

    let timer;
    el.querySelector('#pk-q').addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => load(e.target.value.trim()), 250);
    });

    document.addEventListener('keydown', onKey);
    document.body.appendChild(el);
    load();
  });
}
