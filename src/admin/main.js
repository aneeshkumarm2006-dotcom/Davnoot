/* Admin SPA router.
 *
 * Path-based, like the /seoteam dashboard. vercel.json rewrites every /admin/*
 * path to admin/index.html; this parses location.pathname and mounts one view.
 * Views implement: constructor(root), async mount(), optional destroy(), optional
 * .autosave (the unsaved-changes guard is duck-typed, exactly like /seoteam).
 */
import { $, confirmDialog } from '../dashboard/dom.js';
import { api } from './api.js';

import { Overview } from './views/overview.js';
import { PagesList } from './views/pages.js';
import { PageEditor } from './views/page-editor.js';
import { SeoManager } from './views/seo.js';
import { Leads } from './views/leads.js';
import { Redirects } from './views/redirects.js';
import { Settings } from './views/settings.js';
import { NotFound } from './views/not-found.js';

const root = $('#app');
let current = null;

function parse() {
  const parts = location.pathname.replace(/^\/admin\/?/, '').split('/').filter(Boolean);
  if (!parts.length) return { view: 'overview' };
  switch (parts[0]) {
    case 'pages':
      return parts[1] ? { view: 'page-editor', key: decodeURIComponent(parts.slice(1).join('/')) } : { view: 'pages' };
    case 'new':
      return { view: 'page-editor', key: 'new' };
    case 'seo':
      return { view: 'seo' };
    case 'leads':
      return { view: 'leads' };
    case 'redirects':
      return { view: 'redirects' };
    case 'settings':
      return { view: 'settings' };
    default:
      return { view: '404' };
  }
}

const VIEWS = {
  overview: () => new Overview(root),
  pages: () => new PagesList(root),
  'page-editor': (route) => new PageEditor(root, { key: route.key }),
  seo: () => new SeoManager(root),
  leads: () => new Leads(root),
  redirects: () => new Redirects(root),
  settings: () => new Settings(root),
  '404': () => new NotFound(root),
};

async function render() {
  current?.destroy?.();
  const route = parse();
  current = (VIEWS[route.view] || VIEWS['404'])(route);
  markActive(route.view);
  try {
    await current.mount();
  } catch (err) {
    root.innerHTML = `<div class="empty"><h2>Something went wrong</h2><p>${escapeText(err.message)}</p></div>`;
  }
}

function markActive(view) {
  for (const a of document.querySelectorAll('.admin-nav a[data-view]')) {
    a.classList.toggle('active', a.dataset.view === view || (view === 'page-editor' && a.dataset.view === 'pages'));
  }
}

function escapeText(s) {
  const d = document.createElement('div');
  d.textContent = String(s == null ? '' : s);
  return d.innerHTML;
}

/* Intercept internal /admin links for SPA navigation, with the unsaved-changes guard. */
document.addEventListener('click', async (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href?.startsWith('/admin') || a.target === '_blank') return;
  e.preventDefault();
  if (current?.autosave?.hasUnsavedChanges?.()) {
    const leave = await confirmDialog('You have unsaved changes. Leave anyway?', { confirmLabel: 'Leave', danger: true });
    if (!leave) return;
  }
  history.pushState({}, '', href);
  render();
});

window.addEventListener('popstate', render);

$('#logout')?.addEventListener('click', async () => {
  if (current?.autosave?.hasUnsavedChanges?.()) {
    const leave = await confirmDialog('You have unsaved changes. Sign out anyway?', { confirmLabel: 'Sign out', danger: true });
    if (!leave) return;
  }
  await api.logout();
  location.href = '/seoteam/login';
});

render();
