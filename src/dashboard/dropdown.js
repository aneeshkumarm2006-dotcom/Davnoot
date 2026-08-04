// Reusable custom dropdown — the Davnoot house replacement for a native <select>,
// shared by the /admin and /seoteam dashboards. Renders as an HTML string (so it
// drops into the existing innerHTML-then-wire view pattern) and is activated with
// wireDropdowns(root, onChange).
//
// Markup:  dropdownHtml({ value, options, id })
// Wiring:  wireDropdowns(root, (id, value, el) => { ... })   // once per render
import { esc } from './dom.js';

export function dropdownHtml({ value, options, id = '', cls = '', ariaLabel = '' }) {
  const cur = options.find((o) => o.value === value) || options[0] || { label: '' };
  return `<div class="cdrop${cls ? ' ' + cls : ''}" data-cdrop${id ? ` data-id="${esc(id)}"` : ''} data-value="${esc(value ?? '')}">
    <button type="button" class="cdrop-btn" aria-haspopup="listbox" aria-expanded="false"${ariaLabel ? ` aria-label="${esc(ariaLabel)}"` : ''}>
      <span class="cdrop-label">${esc(cur.label)}</span>
      <svg class="cdrop-caret" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <ul class="cdrop-menu" role="listbox" hidden>
      ${options.map((o) => `<li role="option" class="cdrop-opt${o.value === value ? ' is-selected' : ''}" data-val="${esc(o.value)}">${esc(o.label)}</li>`).join('')}
    </ul>
  </div>`;
}

function setOpen(drop, open) {
  drop.classList.toggle('is-open', open);
  const btn = drop.querySelector('.cdrop-btn');
  const menu = drop.querySelector('.cdrop-menu');
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (menu) menu.hidden = !open;
}
function closeAll() {
  document.querySelectorAll('.cdrop.is-open').forEach((d) => setOpen(d, false));
}

// The outside-click / Escape closers are installed ONCE for the app lifetime, so
// repeated view re-renders (which each call wireDropdowns) never stack listeners.
let _globalInstalled = false;
function installGlobal() {
  if (_globalInstalled) return;
  _globalInstalled = true;
  document.addEventListener('click', (e) => { if (!e.target.closest('.cdrop')) closeAll(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
}

export function wireDropdowns(root, onChange) {
  installGlobal();
  // Delegated on root: root is replaced on every re-render, so its listener is
  // garbage-collected with it — no manual teardown, no leaks.
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.cdrop-btn');
    if (btn && root.contains(btn)) {
      const drop = btn.closest('.cdrop');
      const willOpen = !drop.classList.contains('is-open');
      closeAll();
      setOpen(drop, willOpen);
      return;
    }
    const opt = e.target.closest('.cdrop-opt');
    if (opt && root.contains(opt)) {
      const drop = opt.closest('.cdrop');
      const value = opt.dataset.val;
      setOpen(drop, false);
      if (value !== drop.dataset.value) {
        drop.dataset.value = value;
        drop.querySelector('.cdrop-label').textContent = opt.textContent;
        drop.querySelectorAll('.cdrop-opt').forEach((o) => o.classList.toggle('is-selected', o === opt));
        onChange?.(drop.dataset.id || '', value, drop);
      }
    }
  });
}
