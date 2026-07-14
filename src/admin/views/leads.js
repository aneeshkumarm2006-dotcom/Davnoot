import { api } from '../api.js';
import { esc, relTime, toast } from '../../dashboard/dom.js';

const STATUSES = ['new', 'contacted', 'won', 'lost'];

export class Leads {
  constructor(root) { this.root = root; }

  async mount() {
    this.root.innerHTML = '<div class="loading">Loading…</div>';
    let data;
    try { data = await api.listLeads(); }
    catch (err) { this.root.innerHTML = `<div class="empty"><h2>Couldn't load leads</h2><p class="muted">${esc(err.message)}</p></div>`; return; }
    this.render(data);
    this.wire();
  }

  render({ leads, unread }) {
    this.root.innerHTML = `
      <header class="page-head">
        <div><h1>Leads</h1><p class="muted">${unread} new · ${leads.length} total. Every booking is captured here even if the email fails.</p></div>
        <div class="page-actions"><button class="btn btn-ghost" id="csv">Export CSV</button></div>
      </header>
      ${leads.length ? this.table(leads) : '<div class="empty"><h2>No leads yet</h2><p class="muted">Booking form submissions will appear here.</p></div>'}
    `;
    this._leads = leads;
  }

  table(leads) {
    return `<div class="table-scroll"><table class="grid-table">
      <thead><tr><th>When</th><th>Name</th><th>Email</th><th>Service</th><th>Slot</th><th>Email</th><th>Status</th></tr></thead>
      <tbody>${leads.map((l) => `
        <tr>
          <td class="muted small">${esc(relTime(l.createdAt))}</td>
          <td><strong>${esc(l.name)}</strong>${l.company ? `<div class="muted small">${esc(l.company)}</div>` : ''}</td>
          <td><a class="url" href="mailto:${esc(l.email)}">${esc(l.email)}</a></td>
          <td>${esc(l.service || '—')}</td>
          <td class="small">${esc(l.timeSlot || '—')}</td>
          <td>${l.emailSent ? '<span class="pill pill-ok">sent</span>' : '<span class="pill pill-warn">failed</span>'}</td>
          <td><select class="input input-sm" data-status="${esc(l._id)}">${STATUSES.map((s) => `<option value="${s}" ${l.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        </tr>${l.brief ? `<tr><td></td><td colspan="6" class="muted small" style="padding-top:0">“${esc(l.brief)}”</td></tr>` : ''}`).join('')}
      </tbody></table></div>`;
  }

  wire() {
    this.root.querySelectorAll('[data-status]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        try { await api.patchLead({ id: sel.dataset.status, status: sel.value }); toast('Updated.'); }
        catch (err) { toast(err.message, 'err'); }
      });
    });
    this.root.querySelector('#csv')?.addEventListener('click', () => this.exportCsv());
  }

  exportCsv() {
    const rows = this._leads || [];
    const head = ['createdAt', 'name', 'email', 'company', 'role', 'service', 'timeSlot', 'status', 'emailSent', 'brief'];
    const csv = [head.join(',')].concat(
      rows.map((l) => head.map((k) => `"${String(l[k] ?? '').replace(/"/g, '""')}"`).join(',')),
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'davnoot-leads.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
