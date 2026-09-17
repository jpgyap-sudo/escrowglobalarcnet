# Content workspace

The admin console now has a **Content** group with **Pages**, **Media**, and **Blog**.

## What is synced

Pages are seeded from the current public route inventory: `/`, `/about`, `/disclaimer`, `/support`, and `/blog`. Media is seeded from the tracked hero/workflow artwork, app icons, and favicon. The source file and last-sync timestamp remain visible so an editor can distinguish a managed template from a legacy functional page.

Use **Sync from website** to reconcile missing route and asset records. Sync updates inventory metadata only; it never overwrites edited page sections or media metadata. Tracked routes are archived rather than deleted. Media records in use by a page cannot be deleted.

## Editing model

Pages use structured blocks instead of raw HTML: `hero`, `rich_text`, `list`, `image`, and `cta`. This keeps editor input escaped and makes the same content portable to a future mobile renderer. The server renderer currently owns published `/about` pages. The SPA home, interactive disclaimer acknowledgement, functional support form, and API-backed journal remain on their existing source files until their interactive behavior is represented as first-class blocks.

Media editing is metadata-only in this sandbox. Existing public files are reused by path; the editor does not upload or replace binary files.

## High-leverage next steps

1. Add a side-by-side preview that highlights the block selected in the editor.
2. Add reusable synced patterns for header, risk notice, footer, and support CTA; allow “detach” for one-off variants.
3. Add draft preview tokens, scheduled publishing, revision history, and a diff before publish.
4. Add a visual block picker with locked layout variants so editors change meaning without breaking the design system.
5. Add asset checks (missing file, dimensions, contrast/alt-text completeness) before publishing.

These ideas follow the durable parts of modern structured-content systems: model meaning separately from presentation, compose pages from reorderable blocks, and reuse synced patterns for content that should stay consistent.
