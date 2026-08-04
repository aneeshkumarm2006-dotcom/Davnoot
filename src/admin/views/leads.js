import { api } from '../api.js';
import { esc, estDate, estClock, toast } from '../../dashboard/dom.js';
import { dropdownHtml, wireDropdowns } from '../../dashboard/dropdown.js';

const STATUSES = ['new', 'contacted', 'won', 'lost'];
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Pretty labels for the service codes the booking form submits (mirrors the map
// in api/book-call.js). Unknown/empty codes fall back to the raw value or a dash.
const SERVICE_LABELS = {
  seo: 'SEO',
  meta: 'Meta Ads',
  email: 'Email Marketing',
  'ai-seo': 'AI SEO',
  'chatgpt-ads': 'ChatGPT / AI Ads',
  software: 'Custom Software',
  multi: 'Multi-channel',
};

// Promotions are chosen MANUALLY — no auto-detection. A lead is a promotion only
// once someone clicks "Mark as promotion" on it (sets promo === true). Everything
// else stays a normal lead and is shown by default.
function isPromo(l) {
  return l.promo === true;
}

export class Leads {
  constructor(root) { this.root = root; this.showPromos = false; }

  async mount() {
    this.root.innerHTML = '<div class="loading">Loading…</div>';
    let data;
    try { data = await api.listLeads(); }
    catch (err) { this.root.innerHTML = `<div class="empty"><h2>Couldn't load leads</h2><p class="muted">${esc(err.message)}</p></div>`; return; }
    this._all = data.leads || [];
    this.render();
    this.wire();
  }

  render() {
    const promos = this._all.filter(isPromo);
    const real = this._all.filter((l) => !isPromo(l));
    const visible = this.showPromos ? this._all : real;
    const newReal = real.filter((l) => l.status === 'new').length;

    const toggle = promos.length
      ? `<button class="btn btn-ghost" id="toggle-promos">${this.showPromos ? 'Hide' : 'Show'} ${promos.length} promotion${promos.length === 1 ? '' : 's'}</button>`
      : '';

    this.root.innerHTML = `
      <header class="page-head">
        <div><h1>Leads</h1><p class="muted">${newReal} new · ${real.length} real ${real.length === 1 ? 'lead' : 'leads'}${promos.length ? ` · ${promos.length} promotion${promos.length === 1 ? '' : 's'} hidden` : ''}. Captured even when the email fails.</p></div>
        <div class="page-actions">${toggle}<button class="btn btn-ghost" id="csv">Export CSV</button></div>
      </header>
      ${visible.length ? this.table(visible) : '<div class="empty"><h2>No leads yet</h2><p class="muted">Booking form submissions will appear here.</p></div>'}
    `;
  }

  table(leads) {
    // Each lead is its own <tbody class="lead-group"> so its detail row (the
    // message) stays visually joined to its header row — one lead, one block,
    // one hover highlight, one separator line beneath.
    return `<div class="table-scroll"><table class="grid-table leads-table">
      <thead><tr><th>When (ET)</th><th>Name</th><th>Email</th><th>Service</th><th>Slot</th><th>Email</th><th>Status</th></tr></thead>
      ${leads.map((l) => `<tbody class="lead-group${isPromo(l) ? ' is-promo' : ''}">
        <tr>
          <td class="muted small nowrap">${esc(estDate(l.createdAt))}<div class="lead-time">${esc(estClock(l.createdAt))}</div></td>
          <td><strong>${esc(l.name)}</strong>${l.company ? `<div class="muted small">${esc(l.company)}</div>` : ''}${isPromo(l) ? '<span class="pill pill-mute">promo</span>' : ''}</td>
          <td><a class="url" href="mailto:${esc(l.email)}">${esc(l.email)}</a></td>
          <td>${esc(SERVICE_LABELS[l.service] || l.service || '—')}</td>
          <td class="small nowrap">${esc(l.timeSlot || '—')}</td>
          <td>${l.emailSent ? '<span class="pill pill-ok">sent</span>' : '<span class="pill pill-warn">failed</span>'}</td>
          <td>
            ${dropdownHtml({ id: l._id, value: l.status || 'new', cls: 'cdrop-sm', ariaLabel: 'Lead status', options: STATUSES.map((s) => ({ value: s, label: cap(s) })) })}
            <button type="button" class="lead-promo-btn" data-promo="${esc(l._id)}" data-to="${isPromo(l) ? 'false' : 'true'}">${isPromo(l) ? 'Not a promotion' : 'Mark as promotion'}</button>
          </td>
        </tr>${l.brief ? `<tr class="lead-msg-row"><td colspan="7"><p class="lead-msg" title="${esc(l.brief)}">${esc(l.brief)}</p></td></tr>` : ''}
      </tbody>`).join('')}
      </table></div>`;
  }

  wire() {
    // Custom status dropdowns (Davnoot house control, not a native <select>).
    wireDropdowns(this.root, async (id, value) => {
      try { await api.patchLead({ id, status: value }); toast('Status updated.'); }
      catch (err) { toast(err.message, 'err'); }
    });

    // Per-lead promotion toggle — flips the manual promo flag and re-renders so
    // the lead moves between the real list and the hidden promotions.
    this.root.querySelectorAll('[data-promo]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.promo;
        const to = btn.dataset.to === 'true';
        try {
          await api.patchLead({ id, promo: to });
          const lead = this._all.find((l) => l._id === id);
          if (lead) lead.promo = to;
          toast(to ? 'Marked as promotion.' : 'Moved back to leads.');
          this.render();
          this.wire();
        } catch (err) { toast(err.message, 'err'); }
      });
    });

    this.root.querySelector('#toggle-promos')?.addEventListener('click', () => {
      this.showPromos = !this.showPromos;
      this.render();
      this.wire();
    });
    this.root.querySelector('#csv')?.addEventListener('click', () => this.exportCsv());
  }

  // CSV always exports EVERY lead (real + promo) so nothing is hidden from an
  // export, with an isPromo flag so the noise can be filtered in a spreadsheet.
  exportCsv() {
    const rows = this._all || [];
    const head = ['createdAt', 'name', 'email', 'company', 'role', 'service', 'timeSlot', 'status', 'emailSent', 'isPromo', 'brief'];
    const csv = [head.join(',')].concat(
      rows.map((l) => head.map((k) => {
        const v = k === 'isPromo' ? (isPromo(l) ? 'yes' : 'no') : l[k];
        return `"${String(v ?? '').replace(/"/g, '""')}"`;
      }).join(',')),
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'davnoot-leads.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
