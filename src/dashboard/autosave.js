/* Autosave.
 *
 * ===========================================================================
 * THE FOUR THINGS THAT MAKE THIS HARD
 * ===========================================================================
 *
 * 1. DIRTY TRACKING IS OUR OWN.
 *    A form library's `isDirty` is useless here: autosave itself keeps resetting
 *    it, so it oscillates and you can never answer "are there unsaved changes?"
 *    at the moment the user tries to navigate away. We track it ourselves, by
 *    comparing a serialized snapshot of the payload we WOULD persist.
 *
 * 2. COMPARE THE PAYLOAD, NOT THE FORM.
 *    Snapshotting the raw form state means a trailing space in a field, or the
 *    editor's always-present empty keyword row, counts as a change and triggers
 *    an endless save loop. We snapshot the CLEANED payload — the exact object we
 *    would send — so cosmetic churn is invisible.
 *
 * 3. A NEW POST PROMOTES TO AN EXISTING ONE, IN PLACE.
 *    The first autosave of a new post CREATES it, and from that instant the post
 *    has an id. The URL must change from /seoteam/new to /seoteam/<id> — but via
 *    history.replaceState, NOT a router navigation. A navigation would remount the
 *    editor, blow away the Tiptap instance, and drop the cursor (and quite
 *    possibly the keystroke in flight).
 *
 * 4. FAILURES RETRY.
 *    A dropped Wi-Fi packet must not cost an author their paragraph. We retry
 *    after 5s and keep the dirty flag set until the save actually lands.
 */

const DEBOUNCE_MS = 900;
const RETRY_MS = 5000;

export const STATUS = {
  IDLE: 'idle',
  DIRTY: 'unsaved',
  SAVING: 'saving',
  SAVED: 'saved',
  ERROR: 'error',
};

export class Autosave {
  /**
   * @param {object} opts
   * @param {() => object} opts.collect      build the payload we'd persist
   * @param {(payload) => Promise<object>} opts.create   returns the created post (with _id)
   * @param {(id, payload) => Promise<object>} opts.update
   * @param {(status, detail) => void} opts.onStatus
   * @param {(post) => void} opts.onPromote  called once, when a new post gains an id
   */
  constructor({ collect, create, update, onStatus, onPromote }) {
    this.collect = collect;
    this.create = create;
    this.update = update;
    this.onStatus = onStatus || (() => {});
    this.onPromote = onPromote || (() => {});

    this.id = null;
    this.snapshot = null; // serialized payload as last SAVED
    this.dirty = false;
    this.saving = false;
    this.timer = null;
    this.retryTimer = null;
    this.queued = false; // an edit arrived mid-save
  }

  /** Adopt an existing post: record its id and baseline snapshot. */
  hydrate(post) {
    this.id = post?._id ? String(post._id) : null;
    this.snapshot = JSON.stringify(this.collect());
    this.dirty = false;
    this.setStatus(STATUS.IDLE);
  }

  setStatus(status, detail) {
    this.status = status;
    this.onStatus(status, detail);
  }

  /** Call on every edit. Cheap — it only serializes and compares. */
  touch() {
    // Compare the payload we WOULD send. Whitespace-only edits and the trailing
    // empty keyword row serialize identically, so they never mark us dirty and
    // never trigger a save.
    const next = JSON.stringify(this.collect());
    if (next === this.snapshot) return;

    this.dirty = true;
    this.setStatus(STATUS.DIRTY);

    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS);
  }

  /** Force a save now (the explicit Save button, or before navigating away). */
  async flush() {
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);

    if (this.saving) {
      this.queued = true; // an edit landed while a save was in flight
      return;
    }
    if (!this.dirty) return;

    const payload = this.collect();
    const serialized = JSON.stringify(payload);

    this.saving = true;
    this.setStatus(STATUS.SAVING);

    try {
      let post;
      if (this.id) {
        post = await this.update(this.id, payload);
      } else {
        post = await this.create(payload);

        // PROMOTION. The post now exists. Record the id so the NEXT autosave is an
        // update — without this, every keystroke would create another new post.
        this.id = String(post._id);
        this.onPromote(post);
      }

      this.snapshot = serialized;
      this.saving = false;

      // If the author typed while we were saving, we're already dirty again.
      if (this.queued || JSON.stringify(this.collect()) !== this.snapshot) {
        this.queued = false;
        this.dirty = true;
        this.setStatus(STATUS.DIRTY);
        this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS);
      } else {
        this.dirty = false;
        this.setStatus(STATUS.SAVED);
      }

      return post;
    } catch (err) {
      this.saving = false;
      this.queued = false;

      // A validation error is the author's problem to fix — retrying it forever
      // would just spin. Surface it and stop. Everything else (network, 500) is
      // probably transient, so we keep trying rather than lose their work.
      if (err.status === 400) {
        this.setStatus(STATUS.ERROR, err);
        return;
      }

      this.setStatus(STATUS.ERROR, err);
      this.retryTimer = setTimeout(() => this.flush(), RETRY_MS);
    }
  }

  hasUnsavedChanges() {
    return this.dirty || this.saving;
  }
}

/** Human-readable text for the single status chip in the editor header. */
export function statusLabel(status) {
  switch (status) {
    case STATUS.SAVING:
      return 'Saving…';
    case STATUS.SAVED:
      return 'Saved';
    case STATUS.DIRTY:
      return 'Unsaved changes';
    case STATUS.ERROR:
      return "Couldn't save — will retry";
    default:
      return '';
  }
}
