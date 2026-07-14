# The Davnoot blog engine

Three surfaces over one MongoDB collection:

| Surface | Who | URL |
|---|---|---|
| **Writer dashboard** | The content team, shared password | `/seoteam` |
| **Public blog** | Everyone | `/blog`, `/blog/<slug>` |
| **Author preview** | The content team | `/seoteam/preview/<id>` |

The marketing site (the 8 hand-written `.html` pages) is **untouched** by all of this.
It is still static HTML built by `build.js`, and it still deploys exactly as before.

---

## Go live (once)

1. **MongoDB Atlas** — create a free cluster, then copy `.env.example` to
   `.env.local` and fill in `MONGODB_URI`.
2. **Create the indexes:** `npm run db:indexes`
3. **Set the same env vars in Vercel** → Settings → Environment Variables:
   `MONGODB_URI`, `MONGODB_DB`, `SESSION_SECRET`, `SEOTEAM_PASSWORD`,
   `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
4. Deploy.
5. **In Search Console:** submit `/sitemap.xml` and request indexing for `/blog`.
   The old `/blog → /` redirect was a **301**, which Google and browsers cache hard —
   test in a private window, and expect the redirect to linger for a crawl or two.

## Day to day

```bash
npm run dev       # http://localhost:3000 — the whole site, Vercel routing emulated
npm test          # 128 tests. Run this before you touch anything below.
npm run site      # rebuild the static marketing pages + the sitemap manifest
npm run bundle    # rebuild seoteam/app.js  (COMMIT the output)
npm run watch     # rebuild the dashboard on save
```

`npm run live-smoke` equivalent: `PORT=3456 node scripts/live-smoke.js` boots an
in-memory Mongo with a seeded post — useful for a demo with no Atlas account.

### Three things that will bite you

- **`vercel.json` takes no comments.** Vercel validates it against a *strict*
  schema and rejects any unknown top-level key — including the `"//note"` keys
  people add to JSON files that have no comment syntax. The deploy then fails at
  config validation, **before** the build, so there are no build logs and the
  error looks like a code problem:

  > `The vercel.json schema validation failed: should NOT have additional property //redirects`

  Put explanatory notes here in BLOG.md instead. `scripts/vercel-config.test.js`
  now guards this.

- **There is deliberately no `build` script.** Adding one flips Vercel from
  "serve these static files" to "run a build", changing output-directory
  resolution for a site that has shipped as static files its whole life. That is
  why `seoteam/app.js` is built locally and **committed**. Run `npm run bundle`
  after touching anything under `src/`.
- **There is no `sitemap.xml` on disk.** `/sitemap.xml` is a serverless function
  that merges the static pages with the published posts. Vercel only applies a
  rewrite when no static file matches — so a `sitemap.xml` file would shadow the
  function and the blog would silently never reach Google. `build.js` writes
  `lib/sitemap-static.js` instead, and deletes any stray `sitemap.xml`.

---

## Architecture

```
lib/templates.js     nav + footer + Organization schema
                     ^ imported by BOTH build.js (static pages) and the blog
                       renderer, so the two can never drift

lib/blog-render.js   THE article component
                     ^ used by the public page AND the preview, so "preview looks
                       like production" is true by construction

lib/seo-score.js     THE SEO checklist — a pure function
                     ^ run in the BROWSER for the live editor panel, and on the
                       SERVER for the table's "SEO ready" badge. One impl, two callers.

lib/keyword-links.js backlinks injected AT RENDER TIME, never stored
lib/validators.js    Zod — the only thing between a request body and the database
lib/post-write.js    the $set/$unset split; publish-date rules
lib/session.js       Edge-safe (Web Crypto ONLY — no node:crypto, ever)
lib/uploader.js      uploadImage() — the ONE place Cloudinary is named
```

## Caching / "when does a publish go live?"

This is not Next.js, so there is no `revalidatePath()` and no on-demand purge.
Blog pages are served with `s-maxage=60, stale-while-revalidate`:

- Readers and Googlebot hit the **edge cache** → Core Web Vitals are static-like.
- A publish is live **within ~60 seconds**. No build, no deploy.
- A **scheduled** post appears on its own when its date passes — because pages
  render on demand, this needs no cron job.

Want instant instead? Drop `s-maxage` in `api/blog/*.js`. That is the only knob.
Do **not** add a `revalidate` fetch — it is a no-op on this platform.

---

## The invariants

These are in `scripts/invariants.test.js` and `scripts/render.test.js` as
executable tests. Every one is a bug that has already happened once. **Run
`npm test` before and after any refactor of `lib/`.**

1. **`robotsIndex`/`robotsFollow` are TRI-STATE.** `undefined` means *emit no
   robots tag*, not `noindex`. Every existing post has `undefined`. A `Boolean("")`
   anywhere in the chain — validator, writer, renderer — **de-indexes the whole
   blog**. There is no `.default()` on these fields at any layer, and the Mongo
   client sets `ignoreUndefined: true` so the driver can't turn them into `null`.
2. **A cross-origin `canonicalUrl` is ignored** at render time. Honouring one
   silently de-indexes the page that sets it.
3. **A save from one surface must not wipe another's fields.** `blocks` /
   `structuredData` are on `PRESERVE_KEYS` in `lib/post-write.js`: absent → leave
   alone; explicit `[]` → clear; value → set.
4. **`content` is the authoritative body.** Reading time, word count, and the
   keyword injector all read it.
5. **Author HTML is sanitized on save** — but `<iframe>` is **deliberately kept**,
   or every YouTube embed breaks.
6. **The OG headline never falls back into `metaTitle`.** A custom meta title is
   treated as absolute (no " — Davnoot" suffix), so a social hook leaking into it
   strips the branding off every search result.
7. **`views` and `readingTimeMinutes` are server-managed** — absent from every
   input validator, so no crafted payload can set them.
8. **JSON-LD is serialized with `jsonLdSafe()`**, which escapes `<`. A post titled
   `Why </script> breaks SEO` would otherwise close the JSON-LD block early and
   inject live HTML into the page.

---

## Blocks

Optional structured sections, rendered **after** the body (never instead of it —
Invariant 4). Types: `richtext`, `faq`, `comparison`, `featureGrid`, `prosCons`,
`cta`, `media`, `htmlEmbed`. Drag to reorder; array order is render order.

**Adding a type is a three-place change:**

1. a member of the discriminated union in `lib/blocks.js`
2. a renderer in the same file
3. an edit form in `src/dashboard/block-editor.js`

That union is **the only thing** stopping arbitrary JSON from landing in
`block.data` — Mongo will not stop you.

## Structured data

`lib/structured-data.js` declares, per content type, which schema.org nodes to
emit. A blog post gets `Organization` + `BlogPosting` + `BreadcrumbList`, plus
**`FAQPage` derived from an FAQ block** if one exists.

`FAQPage` is *derived*, never authored: schema that claims questions the page
does not visibly show is a structured-data violation and earns a manual action.
Because it is a projection of the block, the two can't disagree.

Per-post overrides (sidebar → Structured data): disable a node, override
whitelisted fields, or paste custom JSON-LD in `append` or `replace` mode.
Field overrides are **whitelisted** — letting an author set `@type` or `@id`
means one typo detaches the publisher reference from every node.

## Not built

- **An admin-panel surface.** This site has no admin panel, so there is exactly
  one writer surface today. `PRESERVE_KEYS` is live anyway, so if you add one, it
  cannot wipe the block editor's work.
- **TypeScript / a linter.** The repo is plain JS and stays that way; `npm test`
  is the gate.
