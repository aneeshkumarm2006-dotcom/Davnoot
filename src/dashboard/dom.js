/* Tiny DOM helpers. No framework: the dashboard is a handful of screens, and a
 * React/Vue dependency would dwarf the code it manages. */

export const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Format a date for a <input type="datetime-local">, in LOCAL time. */
export function toLocalInput(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse a datetime-local value back to an ISO string (or undefined). */
export function fromLocalInput(value) {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function relTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(value);
}

/** A promise-based confirm dialog, so we don't scatter window.confirm around. */
export function confirmDialog(message, { confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'modal-backdrop';
    el.innerHTML = `
      <div class="modal modal-sm" role="dialog" aria-modal="true">
        <p class="modal-msg">${esc(message)}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-dark'}" data-act="ok">${esc(confirmLabel)}</button>
        </div>
      </div>`;

    const close = (result) => {
      el.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
    };

    el.addEventListener('click', (e) => {
      if (e.target === el || e.target.dataset.act === 'cancel') close(false);
      if (e.target.dataset.act === 'ok') close(true);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(el);
    el.querySelector('[data-act="ok"]').focus();
  });
}

export function toast(message, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast is-${kind}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('in'), 10);
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}
