/* The rich-text editor (Tiptap) + its toolbar + the raw-HTML escape hatch.
 *
 * The `<>` toggle is what lets a non-technical author paste a YouTube embed or a
 * chunk of markup from a brief without an engineer. It is also exactly why
 * lib/sanitize.js exists on the server: once you give someone a raw-HTML box,
 * you must assume raw HTML arrives. The sanitizer preserves <iframe> precisely so
 * this workflow keeps working.
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Underline from '@tiptap/extension-underline';

const BUTTONS = [
  { cmd: 'bold', label: 'B', title: 'Bold', className: 'is-bold' },
  { cmd: 'italic', label: 'I', title: 'Italic', className: 'is-italic' },
  { cmd: 'underline', label: 'U', title: 'Underline', className: 'is-underline' },
  { cmd: 'code', label: '‹›', title: 'Inline code' },
  { sep: true },
  { cmd: 'heading2', label: 'H2', title: 'Heading 2' },
  { cmd: 'heading3', label: 'H3', title: 'Heading 3' },
  { sep: true },
  { cmd: 'bulletList', label: '• List', title: 'Bulleted list' },
  { cmd: 'orderedList', label: '1. List', title: 'Numbered list' },
  { cmd: 'blockquote', label: '❝', title: 'Quote' },
  { cmd: 'codeBlock', label: 'Code', title: 'Code block' },
  { sep: true },
  { cmd: 'link', label: 'Link', title: 'Insert link' },
  { cmd: 'image', label: 'Image', title: 'Insert image' },
];

export class RichText {
  /**
   * @param {HTMLElement} mount
   * @param {object} opts
   * @param {string} opts.content        initial HTML
   * @param {() => void} opts.onChange
   * @param {() => Promise<{url,alt}|null>} opts.pickImage  opens the media library
   */
  constructor(mount, { content = '', onChange = () => {}, pickImage = null } = {}) {
    this.mount = mount;
    this.onChange = onChange;
    this.pickImage = pickImage;
    this.htmlMode = false;

    mount.innerHTML = `
      <div class="rt-toolbar" role="toolbar" aria-label="Formatting">
        ${BUTTONS.map((b) =>
          b.sep
            ? '<span class="rt-sep"></span>'
            : `<button type="button" class="rt-btn ${b.className || ''}" data-cmd="${b.cmd}" title="${b.title}">${b.label}</button>`,
        ).join('')}
        <span class="rt-spacer"></span>
        <button type="button" class="rt-btn rt-html" data-cmd="html" title="Show HTML — paste embeds and raw markup here">&lt;&gt;</button>
      </div>
      <div class="rt-surface"></div>
      <textarea class="rt-html-area" spellcheck="false" hidden aria-label="Raw HTML"></textarea>
    `;

    this.surface = mount.querySelector('.rt-surface');
    this.textarea = mount.querySelector('.rt-html-area');
    this.toolbar = mount.querySelector('.rt-toolbar');

    this.editor = new Editor({
      element: this.surface,
      extensions: [
        StarterKit.configure({ heading: { levels: [2, 3, 4] } }),
        Underline,
        Link.configure({ openOnClick: false, autolink: false }),
        Image.configure({ inline: false }),
      ],
      content: content || '<p></p>',
      onUpdate: () => {
        this.refreshActive();
        this.onChange();
      },
      onSelectionUpdate: () => this.refreshActive(),
    });

    this.toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cmd]');
      if (btn) this.run(btn.dataset.cmd);
    });

    // In HTML mode the textarea is the source of truth; keep the dirty flag live.
    this.textarea.addEventListener('input', () => this.onChange());
  }

  /** The authoritative body HTML, whichever mode we're in. */
  getHTML() {
    return this.htmlMode ? this.textarea.value : this.editor.getHTML();
  }

  setHTML(html) {
    if (this.htmlMode) this.textarea.value = html;
    else this.editor.commands.setContent(html || '<p></p>', false);
  }

  /** Insert an outline at the cursor (the template picker's "insert" action). */
  insertHTML(html) {
    if (this.htmlMode) {
      this.textarea.value += '\n' + html;
    } else {
      this.editor.chain().focus().insertContent(html).run();
    }
    this.onChange();
  }

  focus() {
    if (!this.htmlMode) this.editor.commands.focus();
  }

  run(cmd) {
    const chain = () => this.editor.chain().focus();

    switch (cmd) {
      case 'html':
        return this.toggleHtmlMode();
      case 'bold':
        return chain().toggleBold().run();
      case 'italic':
        return chain().toggleItalic().run();
      case 'underline':
        return chain().toggleUnderline().run();
      case 'code':
        return chain().toggleCode().run();
      case 'heading2':
        return chain().toggleHeading({ level: 2 }).run();
      case 'heading3':
        return chain().toggleHeading({ level: 3 }).run();
      case 'bulletList':
        return chain().toggleBulletList().run();
      case 'orderedList':
        return chain().toggleOrderedList().run();
      case 'blockquote':
        return chain().toggleBlockquote().run();
      case 'codeBlock':
        return chain().toggleCodeBlock().run();
      case 'link':
        return this.insertLink();
      case 'image':
        return this.insertImage();
    }
  }

  insertLink() {
    const previous = this.editor.getAttributes('link').href || '';
    const url = window.prompt('Link URL', previous);
    if (url === null) return;

    if (url === '') {
      return this.editor.chain().focus().extendMarkRange('link').unsetLink().run();
    }

    this.editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    this.onChange();
  }

  async insertImage() {
    // Prefer the media library — that's the whole point of having one. The prompt
    // fallback only exists so the editor still works if the picker is unavailable.
    let picked = null;
    if (this.pickImage) picked = await this.pickImage();

    if (!picked) {
      const url = window.prompt('Image URL');
      if (!url) return;
      const alt = window.prompt('Alt text (describe the image — this is an SEO check)') || '';
      picked = { url, alt };
    }

    this.editor.chain().focus().setImage({ src: picked.url, alt: picked.alt || '' }).run();
    this.onChange();
  }

  /**
   * Toggle between WYSIWYG and raw HTML.
   *
   * Switching BACK from HTML re-parses the textarea through Tiptap, which will
   * quietly drop anything its schema doesn't understand (an <iframe>, for
   * instance). So we warn: an author who pasted a YouTube embed and then flipped
   * back to the visual editor would otherwise watch it silently vanish.
   */
  toggleHtmlMode() {
    const btn = this.toolbar.querySelector('.rt-html');

    if (!this.htmlMode) {
      this.textarea.value = formatHtml(this.editor.getHTML());
      this.textarea.hidden = false;
      this.surface.hidden = true;
      this.htmlMode = true;
      btn.classList.add('active');
      this.toolbar.querySelectorAll('.rt-btn:not(.rt-html)').forEach((b) => (b.disabled = true));
      this.textarea.focus();
      return;
    }

    const raw = this.textarea.value;
    const risky = /<iframe|<script|<style|<form/i.test(raw);
    if (risky) {
      const ok = window.confirm(
        'Heads up: the visual editor can only show formatting it understands.\n\n' +
          'Embeds like <iframe> will disappear from the visual view if you switch back — ' +
          'they are still safe to keep here in HTML mode, and they WILL render on the live page.\n\n' +
          'Switch to the visual editor anyway?',
      );
      if (!ok) return;
    }

    this.editor.commands.setContent(raw || '<p></p>', false);
    this.textarea.hidden = true;
    this.surface.hidden = false;
    this.htmlMode = false;
    btn.classList.remove('active');
    this.toolbar.querySelectorAll('.rt-btn').forEach((b) => (b.disabled = false));
    this.onChange();
  }

  refreshActive() {
    if (this.htmlMode) return;
    const is = (name, attrs) => this.editor.isActive(name, attrs);
    const set = (cmd, on) => {
      const btn = this.toolbar.querySelector(`[data-cmd="${cmd}"]`);
      if (btn) btn.classList.toggle('active', on);
    };

    set('bold', is('bold'));
    set('italic', is('italic'));
    set('underline', is('underline'));
    set('code', is('code'));
    set('heading2', is('heading', { level: 2 }));
    set('heading3', is('heading', { level: 3 }));
    set('bulletList', is('bulletList'));
    set('orderedList', is('orderedList'));
    set('blockquote', is('blockquote'));
    set('codeBlock', is('codeBlock'));
    set('link', is('link'));
  }

  destroy() {
    this.editor?.destroy();
  }
}

/** Cosmetic newlines between block tags, so HTML mode isn't one endless line. */
function formatHtml(html) {
  return String(html)
    .replace(/></g, '>\n<')
    .replace(/\n<\/(strong|em|u|a|code|span)>/g, '</$1>');
}
