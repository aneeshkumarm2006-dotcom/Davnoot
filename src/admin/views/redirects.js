import { api } from '../api.js';
import { esc, confirmDialog, toast } from '../../dashboard/dom.js';

export class Redirects {
  constructor(root) { this.root = root; }

  async mount() {
    this.root.innerHTML = '<div class="loading">Loading…</div>';
    await this.load();
  }

  async load() {
    let data;
    try { data = await api.listRedirects(); }
    catch (err) { this.root.innerHTML = `<div class="empty"><h2>Couldn't load redirects</h2><p class="muted">${esc(err.message)}</p></div>`; return; }
    this.render(data.redirects);
    this.wire();
  }

  render(rows) {
    this.root.innerHTML = `
      <header class="page-head">
        <div><h1>Redirects</h1><p class="muted">Applied without a deploy. Note: a redirect only fires for single-segment paths that reach the page renderer.</p></div>
      </header>

      <div class="field-group" style="margin-bottom:22px">
        <h3>Add a redirect</h3>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div class="field" style="margin:0;flex:1;min-width:160px"><label>From (path)</label><input class="input" id="src" placeholder="/old-page" /></div>
          <div class="field" style="margin:0;flex:1;min-width:160px"><label>To (path or URL)</label><input class="input" id="dst" placeholder="/new-page" /></div>
          <div class="field" style="margin:0"><label>Type</label>
            <select class="input input-sm" id="code"><option value="308">308 permanent</option><option value="302">302 temporary</option><option value="410">410 gone</option></select></div>
          <button class="btn btn-dark" id="add">Add</button>
        </div>
      </div>

      ${rows.length ? this.table(rows) : '<p class="muted">No redirects yet.</p>'}
    `;
  }

  table(rows) {
    return `<div class="table-scroll"><table class="grid-table">
      <thead><tr><th>From</th><th>To</th><th>Type</th><th>Hits</th><th></th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td class="url">${esc(r.source)}</td>
          <td class="url">${r.status === 410 ? '<span class="pill pill-muted">gone</span>' : esc(r.destination)}</td>
          <td><span class="pill pill-muted">${r.status}</span></td>
          <td class="cell-count">${r.hits || 0}</td>
          <td><button class="btn btn-ghost btn-sm" data-del="${esc(r.source)}">Delete</button></td>
        </tr>`).join('')}
      </tbody></table></div>`;
  }

  wire() {
    this.root.querySelector('#add')?.addEventListener('click', async () => {
      const source = this.root.querySelector('#src').value.trim();
      const destination = this.root.querySelector('#dst').value.trim();
      const status = Number(this.root.querySelector('#code').value);
      try { await api.createRedirect({ source, destination, status }); toast('Redirect added.'); this.load(); }
      catch (err) { toast(err.fields?.source || err.fields?.destination || err.message, 'err'); }
    });
    this.root.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!(await confirmDialog(`Delete the redirect from ${btn.dataset.del}?`, { confirmLabel: 'Delete', danger: true }))) return;
        try { await api.deleteRedirect(btn.dataset.del); toast('Deleted.'); this.load(); }
        catch (err) { toast(err.message, 'err'); }
      });
    });
  }
}
