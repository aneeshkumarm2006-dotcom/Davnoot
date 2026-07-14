/* Dashboard router.
 *
 * Path-based, not hash-based: /seoteam/<id> is a real URL, so the editor can be
 * bookmarked, opened in a new tab, and — critically — reached by
 * history.replaceState when a new post is promoted to a saved one (see
 * autosave.js). vercel.json rewrites every /seoteam/* path to this shell.
 */
import { Home } from './home.js';
import { Editor } from './editor.js';
import { Gallery } from './gallery.js';
import { api } from './api.js';
import { $, confirmDialog } from './dom.js';

const root = $('#app');
let current = null;

function parse() {
  const parts = location.pathname.replace(/^\/seoteam\/?/, '').split('/').filter(Boolean);
  if (!parts.length) return { view: 'home' };
  if (parts[0] === 'gallery') return { view: 'gallery' };
  if (parts[0] === 'new') return { view: 'editor', id: 'new' };
  return { view: 'editor', id: parts[0] };
}

async function render() {
  current?.destroy?.();

  const route = parse();
  switch (route.view) {
    case 'gallery':
      current = new Gallery(root);
      break;
    case 'editor':
      current = new Editor(root, { id: route.id });
      break;
    default:
      current = new Home(root);
  }

  await current.mount();
}

/* Intercept internal links so the SPA doesn't do a full page load — EXCEPT the
 * preview link, which deliberately opens a server-rendered page in a new tab. */
document.addEventListener('click', async (e) => {
  const a = e.target.closest('a');
  if (!a) return;

  const href = a.getAttribute('href');
  if (!href?.startsWith('/seoteam') || a.target === '_blank') return;
  if (href.startsWith('/seoteam/preview')) return;

  e.preventDefault();

  // The unsaved-changes guard. beforeunload covers a real page unload; this
  // covers an in-app navigation, which beforeunload never sees.
  if (current?.autosave?.hasUnsavedChanges()) {
    const leave = await confirmDialog('You have unsaved changes. Leave anyway?', {
      confirmLabel: 'Leave',
      danger: true,
    });
    if (!leave) return;
  }

  history.pushState({}, '', href);
  render();
});

window.addEventListener('popstate', render);

$('#logout')?.addEventListener('click', async () => {
  if (current?.autosave?.hasUnsavedChanges()) {
    const leave = await confirmDialog('You have unsaved changes. Sign out anyway?', {
      confirmLabel: 'Sign out',
      danger: true,
    });
    if (!leave) return;
  }
  await api.logout();
  location.href = '/seoteam/login';
});

render();
