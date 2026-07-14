import { esc } from '../../dashboard/dom.js';

export class NotFound {
  constructor(root) { this.root = root; }
  async mount() {
    this.root.innerHTML = `
      <div class="empty">
        <h2>Page not found</h2>
        <p class="muted">Nothing lives at <code>${esc(location.pathname)}</code>.</p>
        <p><a class="btn btn-dark" href="/admin">Back to overview</a></p>
      </div>`;
  }
}
