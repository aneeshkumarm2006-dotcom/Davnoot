import { api } from '../api.js';
import { esc, toast } from '../../dashboard/dom.js';

export class Settings {
  constructor(root) { this.root = root; }

  async mount() {
    this.root.innerHTML = '<div class="loading">Loading…</div>';
    let data;
    try { data = await api.getSettings(); }
    catch (err) { this.root.innerHTML = `<div class="empty"><h2>Couldn't load settings</h2><p class="muted">${esc(err.message)}</p></div>`; return; }
    this.eff = data.effective;
    this.render(data.effective);
    this.wire();
  }

  render(s) {
    this.root.innerHTML = `
      <header class="page-head">
        <div><h1>Site settings</h1><p class="muted">Brand, contact, and organization details used across the site.</p></div>
        <div class="page-actions"><button class="btn btn-dark" id="save">Save</button></div>
      </header>

      <div class="editor-fields" style="max-width:640px">
        <div class="field-group"><h3>Brand</h3>
          ${input('brand.name', 'Name', s.brand.name)}
          ${input('brand.wordmark', 'Wordmark', s.brand.wordmark)}
          ${input('brand.tagline', 'Tagline', s.brand.tagline)}
        </div>
        <div class="field-group"><h3>Contact</h3>
          ${input('contact.email', 'Email', s.contact.email)}
          ${input('contact.phone', 'Phone (E.164)', s.contact.phone)}
          ${input('contact.phoneDisplay', 'Phone (display)', s.contact.phoneDisplay)}
        </div>
        <div class="field-group"><h3>Organization</h3>
          ${input('org.description', 'Description', s.org.description, true)}
          ${input('org.priceRange', 'Price range', s.org.priceRange)}
          ${input('defaults.siteUrl', 'Canonical site URL', s.defaults.siteUrl)}
          ${input('defaults.ogImage', 'Default OG image', s.defaults.ogImage)}
        </div>
      </div>
      <p class="muted small" style="margin-top:14px">Changes are stored as a diff over the built-in defaults. Empty fields fall back to the default.</p>
    `;
  }

  wire() {
    this.root.querySelector('#save')?.addEventListener('click', async () => {
      const diff = {};
      this.root.querySelectorAll('[data-key]').forEach((el) => {
        setDeep(diff, el.dataset.key, el.value);
      });
      try { await api.saveSettings(diff); toast('Settings saved.'); }
      catch (err) { toast(err.message, 'err'); }
    });
  }
}

function input(key, label, value, area) {
  const tag = area
    ? `<textarea class="input" rows="3" data-key="${key}">${esc(value || '')}</textarea>`
    : `<input class="input" data-key="${key}" value="${esc(value || '')}" />`;
  return `<div class="field"><label>${esc(label)}</label>${tag}</div>`;
}

function setDeep(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}
