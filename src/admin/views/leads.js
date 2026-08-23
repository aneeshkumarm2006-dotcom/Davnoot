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

// Filled from the GET payload, never restated here. The classifier owns the list
// of categories; a hand-copied copy drifts the moment a rule is added and leaves
// rows in the Spam tab labelled "undefined". Importing lib/spam.js directly would
// also silently defeat the bundle-freshness hash (scripts/imports.test.js).
let CATEGORY_LABELS = {};

/* Three tabs, three very different things:
 *
 *   inbox    real leads — what the business is actually for
 *   spam     quarantined: captured and categorised, never emailed, still readable
 *   blocked  rejected at the door and never written to `leads` at all, kept 30
 *            days purely so a false positive can be spotted and rescued
 *
 * The Blocked tab is the reason the hard-reject rules are allowed to be as sharp
 * as they are. Without somewhere to check, an over-eager rule would quietly
 * destroy prospects and nobody would ever find out. */
const TABS = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'spam', label: 'Spam' },
  { key: 'blocked', label: 'Blocked' },
];

export class Leads {
  constructor(root) { this.root = root; this.tab = 'inbox'; }

  async mount() {
    this.root.innerHTML = '<div class="loading">Loading…</div>';
    let data;
    try { data = await api.listLeads(); }
    catch (err) { this.root.innerHTML = `<div class="empty"><h2>Couldn't load leads</h2><p class="muted">${esc(err.message)}</p></div>`; return; }
    this._all = data.leads || [];
    this._blocked = data.blocked || [];
    CATEGORY_LABELS = Object.fromEntries((data.categories || []).map((c) => [c.key, c.label]));
    this.render();
    this.wire();
  }

  counts() {
    const real = this._all.filter((l) => !l.spam);
    return {
      inbox: real.length,
      spam: this._all.length - real.length,
      blocked: this._blocked.length,
      newReal: real.filter((l) => l.status === 'new').length,
    };
  }

  render() {
    const n = this.counts();
    const rows = this.tab === 'blocked' ? this._blocked
      : this._all.filter((l) => (this.tab === 'spam' ? l.spam : !l.spam));

    const subtitle = {
      inbox: `${n.newReal} new · ${n.inbox} real ${n.inbox === 1 ? 'lead' : 'leads'}. Captured even when the email fails.`,
      spam: 'Caught by the filter and never emailed. Nothing here was deleted — if one is real, put it back.',
      blocked: 'Rejected before reaching the inbox. Kept 30 days so a wrong call can be spotted, then swept automatically.',
    }[this.tab];

    const actions = this.tab === 'spam' && n.spam
      ? '<button class="btn btn-ghost" id="purge">Delete all spam</button>'
      : '';

    this.root.innerHTML = `
      <header class="page-head">
        <div><h1>Leads</h1><p class="muted">${esc(subtitle)}</p></div>
        <div class="page-actions">${actions}<button class="btn btn-ghost" id="csv">Export CSV</button></div>
      </header>
      <nav class="lead-tabs">
        ${TABS.map((t) => `<button type="button" class="lead-tab${this.tab === t.key ? ' is-active' : ''}" data-tab="${t.key}">${t.label}<span class="lead-tab-n">${n[t.key]}</span></button>`).join('')}
      </nav>
      ${rows.length ? (this.tab === 'blocked' ? this.blockedTable(rows) : this.table(rows)) : this.emptyState()}
    `;
  }

  emptyState() {
    const copy = {
      inbox: ['No leads yet', 'Booking form submissions will appear here.'],
      spam: ['Nothing in spam', 'Submissions the filter catches will collect here instead of your inbox.'],
      blocked: ['Nothing blocked', 'Rejected submissions appear here for 30 days.'],
    }[this.tab];
    return `<div class="empty"><h2>${copy[0]}</h2><p class="muted">${copy[1]}</p></div>`;
  }

  /** The reasons a submission was flagged, shown so a verdict is never a black box. */
  static why(l) {
    if (!l.spamReasons || !l.spamReasons.length) return '';
    return `<div class="lead-why">${esc(l.spamReasons.join(' · '))}${l.spamScore != null ? ` <span class="muted">(score ${esc(String(l.spamScore))})</span>` : ''}</div>`;
  }

  static categoryPill(l) {
    if (!l.spamCategory) return '';
    return `<span class="pill pill-spam">${esc(CATEGORY_LABELS[l.spamCategory] || l.spamCategory)}</span>`;
  }

  table(leads) {
    // Each lead is its own <tbody class="lead-group"> so its detail row (the
    // message) stays visually joined to its header row — one lead, one block,
    // one hover highlight, one separator line beneath.
    const spamView = this.tab === 'spam';
    return `<div class="table-scroll"><table class="grid-table leads-table">
      <thead><tr><th>When (ET)</th><th>Name</th><th>Email</th><th>Service</th><th>Slot</th><th>Email</th><th>${spamView ? 'Actions' : 'Status'}</th></tr></thead>
      ${leads.map((l) => `<tbody class="lead-group${l.spam ? ' is-promo' : ''}">
        <tr>
          <td class="muted small nowrap">${esc(estDate(l.createdAt))}<div class="lead-time">${esc(estClock(l.createdAt))}</div></td>
          <td><strong>${esc(l.name)}</strong>${l.company ? `<div class="muted small">${esc(l.company)}</div>` : ''}${Leads.categoryPill(l)}</td>
          <td><a class="url" href="mailto:${esc(l.email)}">${esc(l.email)}</a></td>
          <td>${esc(SERVICE_LABELS[l.service] || l.service || '—')}</td>
          <td class="small nowrap">${esc(l.timeSlot || '—')}</td>
          <td>${l.spam ? '<span class="pill pill-mute">held</span>' : l.emailSent ? '<span class="pill pill-ok">sent</span>' : '<span class="pill pill-warn">failed</span>'}</td>
          <td>
            ${spamView ? '' : dropdownHtml({ id: l._id, value: l.status || 'new', cls: 'cdrop-sm', ariaLabel: 'Lead status', options: STATUSES.map((s) => ({ value: s, label: cap(s) })) })}
            <button type="button" class="lead-promo-btn" data-spam="${esc(l._id)}" data-to="${l.spam ? 'false' : 'true'}">${l.spam ? 'Not spam' : 'Mark as spam'}</button>
            ${spamView ? `<button type="button" class="lead-promo-btn is-danger" data-del="${esc(l._id)}">Delete</button>` : ''}
          </td>
        </tr>${l.brief || l.spamReasons?.length ? `<tr class="lead-msg-row"><td colspan="7">${l.brief ? `<p class="lead-msg" title="${esc(l.brief)}">${esc(l.brief)}</p>` : ''}${Leads.why(l)}</td></tr>` : ''}
      </tbody>`).join('')}
      </table></div>`;
  }

  /* Blocked submissions were never leads, so they get no status dropdown and no
   * "not spam" toggle — there is no document in `leads` to move. Restoring one is
   * a copy-the-address-and-reply job, which is the honest affordance: if the
   * filter was wrong, a human should be writing to that person anyway. */
  blockedTable(rows) {
    return `<div class="table-scroll"><table class="grid-table leads-table">
      <thead><tr><th>When (ET)</th><th>Name</th><th>Email</th><th>Why it was blocked</th></tr></thead>
      ${rows.map((b) => `<tbody class="lead-group is-promo">
        <tr>
          <td class="muted small nowrap">${esc(estDate(b.createdAt))}<div class="lead-time">${esc(estClock(b.createdAt))}</div></td>
          <td><strong>${esc(b.name)}</strong>${b.company ? `<div class="muted small">${esc(b.company)}</div>` : ''}${Leads.categoryPill(b)}</td>
          <td class="small">${esc(b.email)}</td>
          <td class="small">${esc((b.spamReasons || []).join(' · '))} <span class="muted">(${esc(String(b.spamScore ?? '—'))})</span></td>
        </tr>${b.brief ? `<tr class="lead-msg-row"><td colspan="4"><p class="lead-msg" title="${esc(b.brief)}">${esc(b.brief)}</p></td></tr>` : ''}
      </tbody>`).join('')}
      </table></div>`;
  }

  redraw() { this.render(); this.wire(); }

  wire() {
    this.root.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => { this.tab = btn.dataset.tab; this.redraw(); });
    });

    // Custom status dropdowns (Davnoot house control, not a native <select>).
    wireDropdowns(this.root, async (id, value) => {
      try { await api.patchLead({ id, status: value }); toast('Status updated.'); }
      catch (err) { toast(err.message, 'err'); }
    });

    // Per-lead spam toggle — moves the row between the Inbox and Spam tabs.
    this.root.querySelectorAll('[data-spam]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.spam;
        const to = btn.dataset.to === 'true';
        try {
          await api.patchLead({ id, spam: to, spamCategory: to ? 'manual' : undefined });
          const lead = this._all.find((l) => l._id === id);
          if (lead) {
            lead.spam = to;
            lead.spamCategory = to ? 'manual' : null;
            if (!to) { lead.spamReasons = []; lead.spamScore = null; }
          }
          toast(to ? 'Moved to spam.' : 'Moved back to the inbox.');
          this.redraw();
        } catch (err) { toast(err.message, 'err'); }
      });
    });

    this.root.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.del;
        if (!confirm('Delete this submission permanently?')) return;
        try {
          await api.deleteLeads({ ids: [id] });
          this._all = this._all.filter((l) => l._id !== id);
          toast('Deleted.');
          this.redraw();
        } catch (err) { toast(err.message, 'err'); }
      });
    });

    this.root.querySelector('#purge')?.addEventListener('click', async () => {
      const n = this.counts().spam;
      if (!confirm(`Permanently delete all ${n} spam submission${n === 1 ? '' : 's'}? This cannot be undone.`)) return;
      try {
        const r = await api.deleteLeads({ purge: 'spam' });
        this._all = this._all.filter((l) => !l.spam);
        toast(`Deleted ${r.deleted} submission${r.deleted === 1 ? '' : 's'}.`);
        this.redraw();
      } catch (err) { toast(err.message, 'err'); }
    });

    this.root.querySelector('#csv')?.addEventListener('click', () => this.exportCsv());
  }

  // CSV always exports EVERY lead (real + spam) so nothing is hidden from an
  // export, with the category and score so the noise can be filtered — or the
  // filter itself audited — in a spreadsheet.
  exportCsv() {
    const rows = this._all || [];
    const head = ['createdAt', 'name', 'email', 'company', 'role', 'service', 'timeSlot', 'status', 'emailSent', 'spam', 'spamCategory', 'spamScore', 'brief'];
    const csv = [head.join(',')].concat(
      rows.map((l) => head.map((k) => {
        const v = k === 'spam' ? (l.spam ? 'yes' : 'no') : l[k];
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
