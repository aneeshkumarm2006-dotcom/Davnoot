/* The post editor. /seoteam/new and /seoteam/<id>. */
import { api } from './api.js';
import { RichText } from './rich-text.js';
import { SeoPanel } from './seo-panel.js';
import { Autosave, statusLabel, STATUS } from './autosave.js';
import { TEMPLATES, findTemplate } from './post-templates.js';
import { openMediaPicker } from './media-picker.js';
import { BlockEditor } from './block-editor.js';
import { StructuredDataPanel } from './structured-data-panel.js';
import { findFaqBlock } from '../../lib/blocks.js';
import { esc, $, toLocalInput, fromLocalInput, confirmDialog, toast } from './dom.js';

const REL_OPTIONS = ['dofollow', 'nofollow', 'sponsored'];

export class Editor {
  constructor(root, { id }) {
    this.root = root;
    this.id = id === 'new' ? null : id;
    this.post = null;
    this.overrides = [];
    this.backlinks = [];
  }

  async mount() {
    this.root.innerHTML = '<div class="loading">Loading…</div>';

    if (this.id) {
      try {
        const { post } = await api.getPost(this.id);
        this.post = post;
      } catch (err) {
        this.root.innerHTML = `<div class="empty"><h2>Couldn't open that post</h2><p>${esc(err.message)}</p><a class="btn btn-dark" href="/seoteam">Back to posts</a></div>`;
        return;
      }
    } else {
      this.post = { status: 'draft', linkFirstOccurrenceOnly: true, contentWidth: 'standard', coverLayout: 'standard' };
    }

    this.overrides = this.post.seoOverrides || [];
    this.backlinks = [...(this.post.keywords || []), blankRow()];

    this.render();
    this.wire();

    this.autosave = new Autosave({
      collect: () => this.collect(),
      create: async (payload) => (await api.createPost(payload)).post,
      update: async (id, payload) => (await api.updatePost(id, payload)).post,
      onStatus: (s, detail) => this.renderStatus(s, detail),
      onPromote: (post) => this.promote(post),
    });
    this.autosave.hydrate(this.post);

    this.seoPanel.render();
    this.guardUnload();
  }

  /* ------------------------------------------------------------ promotion -- */

  /**
   * The first autosave of a NEW post created it. Swap the URL from /seoteam/new to
   * /seoteam/<id> with replaceState — NOT a router navigation, which would remount
   * this component, destroy the Tiptap instance, and lose the author's cursor
   * (and very likely the keystroke that triggered the save).
   */
  promote(post) {
    this.id = String(post._id);
    this.post = { ...this.post, ...post };
    history.replaceState({}, '', `/seoteam/${this.id}`);
    $('.editor-preview-link').href = `/seoteam/preview/${this.id}`;
    $('.editor-preview-link').hidden = false;
  }

  /* ------------------------------------------------------------- collect ---- */

  /** The exact payload we persist. Autosave snapshots THIS, not the raw form. */
  collect() {
    const v = (sel) => $(sel, this.root)?.value ?? '';
    const status = v('#f-status');

    return {
      title: v('#f-title'),
      slug: v('#f-slug'),
      excerpt: v('#f-excerpt'),
      content: this.rt ? this.rt.getHTML() : this.post.content || '',
      coverImage: v('#f-cover'),
      coverImageAlt: v('#f-cover-alt'),
      author: v('#f-author'),
      tags: splitList(v('#f-tags')),
      status: status === 'published' || status === 'scheduled' ? 'published' : 'draft',

      // "Scheduled" is not a stored status — it is `published` with a future date.
      // The server derives the distinction; we only ever send status + date.
      publishedAt: status === 'scheduled' ? fromLocalInput(v('#f-date')) : fromLocalInput(v('#f-date')),

      seo: {
        metaTitle: v('#f-meta-title'),
        metaDescription: v('#f-meta-desc'),
        keywords: splitList(v('#f-meta-keywords')),
        ogTitle: v('#f-og-title'),
        ogDescription: v('#f-og-desc'),
        ogImage: v('#f-og-image'),
        twitterCard: v('#f-twitter'),
        canonicalUrl: v('#f-canonical'),

        // TRI-STATE. '' means "no directive at all" and MUST stay undefined —
        // sending `false` here would emit noindex. This is why the control is a
        // three-way <select> and not a checkbox: a checkbox cannot express the
        // third state, and coercing its unchecked value would de-index the post.
        robotsIndex: triState(v('#f-robots-index')),
        robotsFollow: triState(v('#f-robots-follow')),

        focusKeyword: v('#f-focus'),
      },

      template: this.post.template || undefined,
      keywords: this.collectBacklinks(),
      linkFirstOccurrenceOnly: $('#f-first-only', this.root)?.checked ?? true,
      seoOverrides: this.overrides,
      contentWidth: v('#f-width') || 'standard',
      coverLayout: v('#f-cover-layout') || 'standard',

      // ALWAYS sent, even when empty. That is what lets an author delete their
      // last block: the key is present as [], which the three-state rule in
      // lib/post-write.js treats as "clear it" (whereas an absent key means
      // "leave it alone"). Omitting it here would make the last block immortal.
      blocks: this.blockEditor ? this.blockEditor.getBlocks() : this.post.blocks || [],
      structuredData: this.sdPanel ? this.sdPanel.getValue() : this.post.structuredData,
    };
  }

  /**
   * Drop the trailing blank row before sending. A row with SOME fields filled is
   * left in deliberately so the server rejects it and the author is told to finish
   * it — silently discarding a half-typed link is how work goes missing.
   */
  collectBacklinks() {
    return [...this.root.querySelectorAll('.kw-row')]
      .map((row) => ({
        keyword: $('.kw-keyword', row).value.trim(),
        url: $('.kw-url', row).value.trim(),
        rel: $('.kw-rel', row).value,
      }))
      .filter((r) => r.keyword || r.url);
  }

  /* -------------------------------------------------------------- render ---- */

  render() {
    const p = this.post;
    const seo = p.seo || {};
    const scheduled = p.status === 'published' && p.publishedAt && new Date(p.publishedAt) > new Date();
    const status = p.status === 'published' ? (scheduled ? 'scheduled' : 'published') : 'draft';

    this.root.innerHTML = `
    <form class="editor" autocomplete="off">
      <header class="editor-bar">
        <a href="/seoteam" class="back">← Posts</a>
        <div class="editor-bar-right">
          <span class="save-chip" aria-live="polite"></span>
          <a class="btn btn-ghost editor-preview-link" href="/seoteam/preview/${esc(this.id || '')}" target="_blank" rel="noopener" ${this.id ? '' : 'hidden'}>Open full preview ↗</a>
          <button type="button" class="btn btn-dark" id="f-save">Save</button>
        </div>
      </header>

      <div class="editor-grid">
        <!-- ---------------- LEFT ---------------- -->
        <div class="editor-main">
          ${this.id ? '' : this.templatePicker()}

          <div class="tabs">
            <button type="button" class="tab active" data-tab="edit">Edit</button>
            <button type="button" class="tab" data-tab="preview">Preview</button>
          </div>

          <div class="tab-panel" data-panel="edit">
            <div class="field">
              <label for="f-title">Title</label>
              <input id="f-title" class="input input-xl" placeholder="How to choose an SEO agency" value="${esc(p.title)}" />
            </div>

            <div class="field">
              <label for="f-slug">URL</label>
              <div class="slug-row">
                <span class="slug-prefix">davnoot.com/blog/</span>
                <input id="f-slug" class="input" placeholder="auto-generated from the title" value="${esc(p.slug)}" />
              </div>
              <p class="hint">Leave blank and we'll build it from the title. Changing this after publishing changes the live URL.</p>
            </div>

            <div class="field-row">
              <div class="field">
                <label for="f-author">Author</label>
                <input id="f-author" class="input" value="${esc(p.author)}" placeholder="Prem" />
              </div>
              <div class="field">
                <label for="f-tags">Tags</label>
                <input id="f-tags" class="input" value="${esc((p.tags || []).join(', '))}" placeholder="SEO, AI Search" />
              </div>
            </div>

            <div class="field">
              <label for="f-excerpt">Excerpt</label>
              <textarea id="f-excerpt" class="input" rows="3" placeholder="One or two sentences. Used on cards, and as the meta description if you don't write one.">${esc(p.excerpt)}</textarea>
            </div>

            <div class="field">
              <label>Cover image</label>
              <div class="cover-row">
                <div class="cover-thumb" id="f-cover-thumb">${p.coverImage ? `<img src="${esc(p.coverImage)}" alt="" />` : '<span>No cover</span>'}</div>
                <div class="cover-fields">
                  <input id="f-cover" class="input" placeholder="Paste an image URL, or choose from the library" value="${esc(p.coverImage)}" />
                  <input id="f-cover-alt" class="input" placeholder="Alt text — describe the image" value="${esc(p.coverImageAlt)}" />
                  <div class="cover-actions">
                    <button type="button" class="btn btn-ghost" id="f-cover-pick">Choose from library</button>
                    <select id="f-cover-layout" class="input input-sm">
                      <option value="standard" ${p.coverLayout !== 'wide' ? 'selected' : ''}>Standard width</option>
                      <option value="wide" ${p.coverLayout === 'wide' ? 'selected' : ''}>Full width</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div class="field">
              <label>Body</label>
              <div class="rt" id="f-editor"></div>
            </div>

            <div class="field">
              <label for="f-width">Content width</label>
              <select id="f-width" class="input input-sm">
                <option value="standard" ${p.contentWidth !== 'wide' ? 'selected' : ''}>Standard</option>
                <option value="wide" ${p.contentWidth === 'wide' ? 'selected' : ''}>Wide</option>
              </select>
            </div>

            <section class="blocks-panel">
              <h3>Sections</h3>
              <p class="hint">Optional structured sections, rendered <strong>after</strong> the body. An FAQ section also emits FAQ schema — the format AI answers quote.</p>
              <div id="f-blocks"></div>
            </section>
          </div>

          <div class="tab-panel" data-panel="preview" hidden>
            <div class="inline-preview post-body" id="f-preview"></div>
          </div>
        </div>

        <!-- ---------------- RIGHT ---------------- -->
        <aside class="editor-side">
          <section class="card">
            <h3>Visibility</h3>
            <div class="field">
              <select id="f-status" class="input">
                <option value="draft" ${status === 'draft' ? 'selected' : ''}>Draft</option>
                <option value="scheduled" ${status === 'scheduled' ? 'selected' : ''}>Scheduled</option>
                <option value="published" ${status === 'published' ? 'selected' : ''}>Published</option>
              </select>
            </div>
            <div class="field" id="f-date-field" ${status === 'draft' ? 'hidden' : ''}>
              <label for="f-date">Publish date</label>
              <input id="f-date" class="input" type="datetime-local" value="${toLocalInput(p.publishedAt)}" />
              <p class="hint" id="f-date-hint"></p>
            </div>
          </section>

          <section class="card">
            <h3>SEO</h3>
            <div id="f-seo-panel"></div>
          </section>

          <section class="card">
            <h3>Search appearance</h3>
            <div class="field">
              <label for="f-meta-title">Meta title</label>
              <input id="f-meta-title" class="input" value="${esc(seo.metaTitle)}" placeholder="Defaults to the post title" />
            </div>
            <div class="field">
              <label for="f-meta-desc">Meta description</label>
              <textarea id="f-meta-desc" class="input" rows="3" placeholder="Defaults to the excerpt">${esc(seo.metaDescription)}</textarea>
            </div>
            <div class="field">
              <label for="f-focus">Focus keyword</label>
              <input id="f-focus" class="input" value="${esc(seo.focusKeyword)}" placeholder="seo agency montreal" />
            </div>
            <div class="field">
              <label for="f-meta-keywords">Meta keywords</label>
              <input id="f-meta-keywords" class="input" value="${esc((seo.keywords || []).join(', '))}" placeholder="comma, separated" />
            </div>
          </section>

          <section class="card">
            <h3>Social</h3>
            <p class="hint">These are for Facebook, LinkedIn and X. They are <strong>separate</strong> from the meta title above — a punchy social hook doesn't belong in your search result.</p>
            <div class="field">
              <label for="f-og-title">Social headline</label>
              <input id="f-og-title" class="input" value="${esc(seo.ogTitle)}" placeholder="Defaults to the post title" />
            </div>
            <div class="field">
              <label for="f-og-desc">Social description</label>
              <textarea id="f-og-desc" class="input" rows="2">${esc(seo.ogDescription)}</textarea>
            </div>
            <div class="field">
              <label for="f-og-image">Social image URL</label>
              <input id="f-og-image" class="input" value="${esc(seo.ogImage)}" placeholder="Defaults to the cover image" />
            </div>
            <div class="field">
              <label for="f-twitter">Twitter card</label>
              <select id="f-twitter" class="input input-sm">
                <option value="">Default (large image)</option>
                <option value="summary_large_image" ${seo.twitterCard === 'summary_large_image' ? 'selected' : ''}>Large image</option>
                <option value="summary" ${seo.twitterCard === 'summary' ? 'selected' : ''}>Summary</option>
              </select>
            </div>
          </section>

          <section class="card">
            <h3>Indexing</h3>
            <div class="field">
              <label for="f-canonical">Canonical URL</label>
              <input id="f-canonical" class="input" value="${esc(seo.canonicalUrl)}" placeholder="Leave blank — this post's own URL" />
              <p class="hint warn" id="f-canonical-warn" hidden></p>
            </div>
            <div class="field-row">
              <div class="field">
                <label for="f-robots-index">Index</label>
                <select id="f-robots-index" class="input input-sm">
                  ${triStateOptions(seo.robotsIndex, 'Index', 'Noindex')}
                </select>
              </div>
              <div class="field">
                <label for="f-robots-follow">Follow</label>
                <select id="f-robots-follow" class="input input-sm">
                  ${triStateOptions(seo.robotsFollow, 'Follow', 'Nofollow')}
                </select>
              </div>
            </div>
            <p class="hint">"Default" emits no robots tag at all, which is what you want almost always. Only set these to override.</p>
          </section>

          <section class="card">
            <h3>Keyword backlinks</h3>
            <p class="hint">Links are added when the page renders — change them here and every post updates. They never touch your body text.</p>
            <div id="f-kw-rows"></div>
            <button type="button" class="btn btn-ghost btn-sm" id="f-kw-add">+ Add keyword</button>
            <label class="check-inline">
              <input type="checkbox" id="f-first-only" ${p.linkFirstOccurrenceOnly === false ? '' : 'checked'} />
              Link only the first occurrence
            </label>
          </section>

          <section class="card">
            <h3>Structured data</h3>
            <div id="f-sd-panel"></div>
          </section>

          <section class="card card-danger">
            <button type="button" class="btn btn-danger-ghost btn-sm" id="f-delete" ${this.id ? '' : 'disabled'}>Delete post</button>
          </section>
        </aside>
      </div>
    </form>`;

    this.rt = new RichText($('#f-editor', this.root), {
      content: p.content || '',
      onChange: () => this.onChange(),
      pickImage: () => openMediaPicker(),
    });

    this.blockEditor = new BlockEditor($('#f-blocks', this.root), {
      blocks: p.blocks || [],
      onChange: () => this.onChange(),
    });

    this.seoPanel = new SeoPanel($('#f-seo-panel', this.root), {
      getPost: () => this.collect(),
      onOverridesChange: (ids) => {
        this.overrides = ids;
        this.onChange();
      },
    });

    this.sdPanel = new StructuredDataPanel($('#f-sd-panel', this.root), {
      getPost: () => this.collect(),
      value: p.structuredData,
      onChange: () => this.onChange(),
    });

    this.renderBacklinks();
    this.updateSaveLabel();
    this.updateDateHint();
  }

  templatePicker() {
    return `
    <section class="template-picker">
      <h3>Start from a template</h3>
      <p class="hint">Drops in a heading structure so you're filling in a shape, not staring at a blank page.</p>
      <div class="template-grid">
        ${TEMPLATES.map(
          (t) => `
          <div class="template-card" data-template="${esc(t.id)}">
            <strong>${esc(t.label)}</strong>
            <span>${esc(t.description)}</span>
            <div class="template-actions">
              <button type="button" class="btn btn-sm btn-dark" data-use="${esc(t.id)}">Start from this</button>
              <button type="button" class="btn btn-sm btn-ghost" data-insert="${esc(t.id)}">Insert outline</button>
            </div>
          </div>`,
        ).join('')}
      </div>
    </section>`;
  }

  renderBacklinks() {
    const mount = $('#f-kw-rows', this.root);
    mount.innerHTML = this.backlinks
      .map(
        (row, i) => `
      <div class="kw-row" data-i="${i}">
        <input class="input input-sm kw-keyword" placeholder="keyword" value="${esc(row.keyword)}" />
        <input class="input input-sm kw-url" placeholder="https://…" value="${esc(row.url)}" />
        <select class="input input-sm kw-rel">
          ${REL_OPTIONS.map((r) => `<option value="${r}" ${row.rel === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
        <button type="button" class="kw-del" data-del="${i}" aria-label="Remove">×</button>
      </div>`,
      )
      .join('');
  }

  /* ---------------------------------------------------------------- wire ---- */

  wire() {
    const root = this.root;

    root.addEventListener('input', (e) => {
      if (e.target.id === 'f-title') this.syncSlug();
      if (e.target.id === 'f-cover') this.syncCoverThumb();
      if (e.target.id === 'f-canonical') this.checkCanonical();
      this.onChange();
    });

    root.addEventListener('change', (e) => {
      if (e.target.id === 'f-status') {
        this.onStatusChange();
      }
      this.onChange();
    });

    root.addEventListener('click', async (e) => {
      const t = e.target;

      if (t.dataset.tab) return this.switchTab(t.dataset.tab);

      if (t.dataset.use) {
        const tpl = findTemplate(t.dataset.use);
        if (!tpl) return;
        const hasContent = this.rt.getHTML().replace(/<[^>]+>/g, '').trim().length > 0;
        if (hasContent && !(await confirmDialog('Replace the current body with this template?'))) return;
        this.post.template = tpl.id;
        this.rt.setHTML(tpl.html);
        this.onChange();
        toast(`Started from “${tpl.label}”`);
        return;
      }

      if (t.dataset.insert) {
        const tpl = findTemplate(t.dataset.insert);
        if (tpl) {
          this.rt.insertHTML(tpl.html);
          toast(`Inserted the “${tpl.label}” outline`);
        }
        return;
      }

      if (t.id === 'f-cover-pick') {
        const picked = await openMediaPicker();
        if (picked) {
          $('#f-cover', root).value = picked.url;
          if (picked.alt && !$('#f-cover-alt', root).value) $('#f-cover-alt', root).value = picked.alt;
          this.syncCoverThumb();
          this.onChange();
        }
        return;
      }

      if (t.id === 'f-kw-add') {
        this.backlinks = this.collectBacklinks().concat(blankRow());
        this.renderBacklinks();
        return;
      }

      if (t.dataset.del != null) {
        const rows = this.collectBacklinks();
        rows.splice(Number(t.dataset.del), 1);
        this.backlinks = rows.length ? rows : [blankRow()];
        this.renderBacklinks();
        this.onChange();
        return;
      }

      if (t.id === 'f-save') return this.save();
      if (t.id === 'f-delete') return this.remove();
    });

    // Ctrl/Cmd+S — writers expect it, and it costs one listener.
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.save();
      }
    });
  }

  onChange() {
    this.autosave?.touch();
    this.seoPanel?.render();
    this.updateSaveLabel();
    this.syncStructuredDataPanel();
    if (this.activeTab === 'preview') this.renderInlinePreview();
  }

  /**
   * The structured-data panel shows whether FAQPage is available, which depends on
   * whether an FAQ block exists. So it must refresh when blocks change — but ONLY
   * when FAQ availability actually flips. Re-rendering it on every keystroke would
   * blow away the author's focus and caret while they are typing custom JSON-LD
   * into its own textarea.
   */
  syncStructuredDataPanel() {
    if (!this.sdPanel || !this.blockEditor) return;
    const hasFaq = Boolean(findFaqBlock(this.blockEditor.getBlocks()));
    if (hasFaq === this.hadFaq) return;
    this.hadFaq = hasFaq;
    this.sdPanel.render();
  }

  switchTab(tab) {
    this.activeTab = tab;
    this.root.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    this.root.querySelectorAll('.tab-panel').forEach((p) => (p.hidden = p.dataset.panel !== tab));
    if (tab === 'preview') this.renderInlinePreview();
  }

  /* The inline Preview tab is a quick look. The REAL check is "Open full preview",
   * which renders through the same server-side component as the live page. */
  renderInlinePreview() {
    $('#f-preview', this.root).innerHTML = this.rt.getHTML() || '<p class="muted">Nothing to preview yet.</p>';
  }

  syncSlug() {
    const slugField = $('#f-slug', this.root);
    // Only auto-fill while the author hasn't taken manual control of the slug, and
    // never for an existing post — silently changing a live URL is a real SEO bug.
    if (slugField.dataset.touched === '1' || this.post.slug) return;
    slugField.value = slugify($('#f-title', this.root).value);
  }

  syncCoverThumb() {
    const url = $('#f-cover', this.root).value.trim();
    $('#f-cover-thumb', this.root).innerHTML = url
      ? `<img src="${esc(url)}" alt="" />`
      : '<span>No cover</span>';
  }

  /** Invariant 2, surfaced to the author before it bites them. */
  checkCanonical() {
    const el = $('#f-canonical', this.root);
    const warn = $('#f-canonical-warn', this.root);
    const value = el.value.trim();

    if (!value) return (warn.hidden = true);

    let crossOrigin = false;
    try {
      crossOrigin = !/(^|\.)davnoot\.com$/i.test(new URL(value).hostname);
    } catch {
      crossOrigin = true;
    }

    warn.hidden = !crossOrigin;
    warn.textContent = crossOrigin
      ? 'This points off davnoot.com. A cross-site canonical would de-index this post, so it will be ignored when the page renders.'
      : '';
  }

  onStatusChange() {
    const status = $('#f-status', this.root).value;
    $('#f-date-field', this.root).hidden = status === 'draft';

    // Switching to Scheduled with no date yet? Default to tomorrow 9am — a
    // scheduled post with a blank date would just publish immediately, which is
    // the opposite of what the author asked for.
    if (status === 'scheduled' && !$('#f-date', this.root).value) {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      $('#f-date', this.root).value = toLocalInput(d);
    }

    // Switching to "Published" clears a future date so the server stamps `now`.
    if (status === 'published') {
      const v = $('#f-date', this.root).value;
      if (v && new Date(v) > new Date()) $('#f-date', this.root).value = '';
    }

    this.updateSaveLabel();
    this.updateDateHint();
  }

  updateDateHint() {
    const hint = $('#f-date-hint', this.root);
    if (!hint) return;
    const status = $('#f-status', this.root).value;
    const v = $('#f-date', this.root).value;

    if (status === 'scheduled' && v) {
      hint.textContent = `Hidden from the blog until ${new Date(v).toLocaleString()}.`;
    } else if (status === 'published' && v && new Date(v) < new Date()) {
      hint.textContent = 'Backdated — it will appear with this date.';
    } else if (status === 'published') {
      hint.textContent = 'Leave blank to publish right now.';
    } else {
      hint.textContent = '';
    }
  }

  updateSaveLabel() {
    const status = $('#f-status', this.root)?.value;
    const btn = $('#f-save', this.root);
    if (!btn) return;
    btn.textContent = status === 'published' ? 'Publish' : status === 'scheduled' ? 'Schedule' : 'Save draft';
  }

  renderStatus(status, detail) {
    const chip = $('.save-chip', this.root);
    if (!chip) return;
    chip.textContent = statusLabel(status);
    chip.className = `save-chip is-${status}`;

    // A 400 means a field is wrong. Show it against the field, not as a toast the
    // author has to remember.
    this.root.querySelectorAll('.field-error').forEach((e) => e.remove());
    this.root.querySelectorAll('.input.has-error').forEach((e) => e.classList.remove('has-error'));

    if (status === STATUS.ERROR && detail?.fields) {
      for (const [path, message] of Object.entries(detail.fields)) {
        const el = fieldFor(this.root, path);
        if (!el) continue;
        el.classList.add('has-error');
        const err = document.createElement('p');
        err.className = 'field-error';
        err.textContent = message;
        el.insertAdjacentElement('afterend', err);
      }
      chip.textContent = 'Fix the highlighted fields';
    }
  }

  async save() {
    await this.autosave.flush();
    if (!this.autosave.hasUnsavedChanges() && this.autosave.status !== STATUS.ERROR) {
      const status = $('#f-status', this.root).value;
      toast(status === 'published' ? 'Published — live within a minute.' : 'Saved.');
    }
  }

  async remove() {
    if (!this.id) return;
    const ok = await confirmDialog('Delete this post? This cannot be undone.', {
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;

    await api.deletePost(this.id);
    this.autosave.dirty = false; // don't trip the unsaved-changes guard on the way out
    location.href = '/seoteam';
  }

  /** Invariant: never let an author lose a paragraph to a stray browser-back. */
  guardUnload() {
    const slug = $('#f-slug', this.root);
    slug.addEventListener('input', () => (slug.dataset.touched = '1'));

    window.addEventListener('beforeunload', (e) => {
      if (this.autosave?.hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  destroy() {
    this.rt?.destroy();
  }
}

/* --------------------------------------------------------------- helpers ---- */

const blankRow = () => ({ keyword: '', url: '', rel: 'dofollow' });

const splitList = (s) =>
  String(s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * '' -> undefined  (emit NO robots directive — the default, and what every
 *                   existing post has)
 * 'true'  -> true
 * 'false' -> false
 *
 * Note what is NOT here: any fallback to `false`. See lib/validators.js rule 1.
 */
function triState(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function triStateOptions(current, onLabel, offLabel) {
  const sel = (v) => (current === v ? 'selected' : '');
  return `
    <option value="" ${current === undefined || current === null ? 'selected' : ''}>Default (no tag)</option>
    <option value="true" ${sel(true)}>${onLabel}</option>
    <option value="false" ${sel(false)}>${offLabel}</option>`;
}

/** Map a server field path ("seo.metaTitle", "keywords.2.url") to its input. */
function fieldFor(root, path) {
  const map = {
    title: '#f-title',
    slug: '#f-slug',
    excerpt: '#f-excerpt',
    coverImage: '#f-cover',
    coverImageAlt: '#f-cover-alt',
    author: '#f-author',
    'seo.metaTitle': '#f-meta-title',
    'seo.metaDescription': '#f-meta-desc',
    'seo.canonicalUrl': '#f-canonical',
    'seo.ogImage': '#f-og-image',
    'seo.focusKeyword': '#f-focus',
  };
  if (map[path]) return $(map[path], root);

  const kw = path.match(/^keywords\.(\d+)\.(keyword|url)$/);
  if (kw) {
    const row = root.querySelector(`.kw-row[data-i="${kw[1]}"]`);
    return row?.querySelector(kw[2] === 'url' ? '.kw-url' : '.kw-keyword');
  }
  return null;
}

function slugify(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
    .replace(/-+$/g, '');
}
