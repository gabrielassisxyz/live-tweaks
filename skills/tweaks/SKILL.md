---
name: tweaks
description: >-
  Set up and round-trip live-tweaks, a live CSS-custom-property (design token)
  editing panel, for the app in the current repository. Use when the user says
  "/tweaks", "set up live-tweaks", "inject the tweaks panel", "find my design
  tokens", or pastes an exported before/after diff to apply
  ("/tweaks implement <diff-json>").
---

# tweaks — live CSS design-token editing

This skill has two invocations, matched by how it is called:

- **`/tweaks`** (no argument) — **setup mode**: inventory the app's CSS custom
  properties (design tokens), write or refresh `design.md`, then print
  instructions for injecting the live-editing panel. Covered below.
- **`/tweaks implement <diff-json>`** — **implement mode**: apply an exported
  before/after diff back into the app's source files. *(Not yet implemented —
  see "Implement mode" stub at the end of this file.)*

Both modes operate on the **current working directory's repository** (the app
the user is asking to tweak), never on the `live-tweaks` package itself.

## Setup mode

Setup mode has two branches, decided by whether the app already has CSS custom
properties (design tokens) to work with:

1. **The app has CSS custom properties** — inventory them. This branch is
   fully specified below.
2. **The app has no CSS custom properties** — hardcoded values only, so live
   editing is impossible until tokens exist. *(Not yet implemented — see
   "No-vars path" stub at the end of this file.)*

You cannot know which branch applies until after the scan in Step 3, so always
run Steps 1–3 first.

### Step 1 — Locate the repo root and `design.md`

The repo root is the nearest ancestor directory containing a `.git` entry,
starting from the current working directory. `design.md` (if it exists) lives
directly at that root.

- If `design.md` is present, read it in full — it carries a scan manifest
  (Step 2) plus the token inventory from the last run.
- If it is absent, skip straight to Step 3 (rescan).

### Step 2 — Decide: reuse or rescan

`design.md` is a **cache**, not a source of truth — never trust it blindly.
Validate it before reuse, and never patch it incrementally: it is either kept
as-is or rewritten wholesale (Step 3). There is no per-entry revalidation.

`design.md` opens with an HTML-comment scan manifest, one line per file that
was scanned last time:

```html
<!-- live-tweaks:scan
scanned_at: 2026-07-17T00:00:00Z
web/assets/css/tailwind.css sha256:1f2e3d4c5b6a...
web/assets/css/theme.css sha256:9a8b7c6d5e4f...
-->
```

To validate:

1. Recompute the hash of every file listed (`sha256sum <path>`, take the hex
   digest). If any listed file is missing, or its hash no longer matches →
   **stale**.
2. Re-run the file discovery glob from Step 3a. If it finds any CSS file that
   is *not* in the manifest → **stale** (a new source file may carry new
   tokens).
3. Otherwise → **fresh**. Skip Step 3, use the existing inventory, and go
   straight to Step 4 with the design.md you just read.

Staleness is whole-document, not per-token — one changed file invalidates the
entire cache. This is deliberate (kept simple, per the project's design
notes): no machinery tries to figure out which specific token changed.

### Step 3 — Rescan (missing or stale `design.md`)

#### 3a. Discover candidate source files

Glob for `**/*.css` from the repo root, excluding `node_modules/`, `dist/`,
`build/`, `vendor/`, `coverage/`, and `.git/`. Plain `.css` files only for v1
— framework single-file-component `<style>` blocks (Vue/Svelte SFCs etc.) are
out of scope here, because the tokens that matter (Step 3c) are root-level
ones, and root-level design tokens live in global stylesheets, not
component-scoped blocks. This keeps the scan framework-agnostic.

#### 3b. Find custom-property declarations

Within each file, find declarations shaped `--<name>: <value>;`. Use a
targeted search (e.g. `grep -n -- '--[a-zA-Z0-9-]\+[[:space:]]*:'`) to locate
candidate lines, then **read enough surrounding context to find the nearest
enclosing block** — walk upward from the match to the nearest unmatched `{`,
and read the text immediately before it. Do not guess a token's scope from
indentation or proximity alone; brace-matching is required because token
declarations are often nested inside `@layer`, `@media`, or `@supports`
at-rules, which do not change the selector's root-ness.

That text immediately before the `{` is usually a selector (`:root`, `.card`,
...), but it can also be an at-rule prelude with **no selector at all** — a
Tailwind v4 `@theme` block (`@theme { --color-primary: #8839ef; ... }`)
declares its custom properties directly, one level in, with nothing selector
shaped wrapping them. Record that at-rule text (`@theme`, `@theme inline`,
...) as the block's identity; Step 3c below treats it as root-level.

When reading a declaration's **value**, don't stop at the first `;` or `}`
you see — a quoted string value can legally contain either
(`--label: "a; odd}value";`). Scan past matched `'...'`/`"..."` string
literals when looking for the terminating `;`. This mirrors the live panel's
own extraction rule, which never string-splits raw CSS text for the same
reason.

#### 3c. Keep root-level declarations only

A declaration is **root-level** — and therefore editable, and therefore worth
recording — if its nearest enclosing block is one of:

- `:root`
- `html`, or `html[...]` (attribute selector on `html`)
- `[data-theme="..."]` or similar attribute/class selectors **when they are
  themselves top-level** (not nested inside a `.card`, a component class, or
  any other non-root selector)
- a Tailwind v4 `@theme` at-rule, in any of its forms (`@theme`,
  `@theme inline`, `@theme reference`, ...) — even though it has no selector
  at all (Step 3b). **This is the primary case, not an edge case**: kernl —
  the project's first real target app — authors essentially all of its
  design tokens (~60 of them) directly inside a Tailwind v4 `@theme` block in
  `web/assets/css/tailwind.css`, with no `:root { ... }` wrapper in source.
  Tailwind compiles `@theme` output to `:root` custom properties at
  build/runtime, so treating it as anything but root-level would make setup
  mode skip every one of kernl's tokens.

at-rule wrappers (`@layer`, `@media`, `@supports`) around one of the
selector-based cases above do not disqualify it either — e.g. a `@theme`
block's compiled output can itself land inside a `@layer` rule, and an
explicit `:root { ... }` can be nested inside `@media`.

Anything else — a class selector, an id selector, a descendant selector, a
Vue/Svelte scoped-hash selector — is **not root-level**. Skip it, but keep a
running count (you'll report it in Step 3f).

#### 3d. Drop framework-internal noise

Even among root-level declarations, drop any token whose name starts with a
known framework-internal prefix: `--tw-` (Tailwind), `--un-` (UnoCSS). These
are utility plumbing, not design tokens a person would want to tweak. Keep a
running count of how many were dropped this way too.

#### 3e. Classify each surviving token

Classify the **raw, trimmed** value text (no browser is available during a
source scan, so this cannot resolve `var()` chains or use `CSS.supports`):

1. If the value starts with `var(` → kind = `var-ref`. Record the raw text as
   given; do not attempt to resolve it. (This mirrors the live panel's own
   documented limitation: it displays the resolved value but writes back a
   literal — the reference itself is never followed.)
2. Else if the value matches a hex color (`#` + 3, 4, 6, or 8 hex digits), or
   starts with `rgb(`, `rgba(`, `hsl(`, `hsla(`, `hwb(`, `lab(`, `lch(`,
   `oklab(`, or `oklch(` (case-insensitive), or is a well-known CSS color
   keyword (e.g. `transparent`, `currentcolor`, standard named colors) →
   kind = `color`.
3. Else if the token **name** (case-insensitive) contains `font` or `family`
   → kind = `font-family`. The name check is mandatory, not a fallback: a
   value-only check would misclassify almost any plain identifier as a font
   family.
4. Else if the value matches `^-?[\d.]+(px|rem|em|%|vh|vw|pt)$` → kind =
   `length`. `calc(...)` and bare unitless numbers do **not** match — they
   fall through to `other`. This is a known, accepted limitation, not a bug.
5. Otherwise → kind = `other`.

#### 3f. Write `design.md`, wholesale

Overwrite `design.md` at the repo root completely — never edit it in place,
never append. Use this shape:

```markdown
# design.md — live-tweaks token inventory

> Generated by the `tweaks` skill's setup mode. Do not hand-edit — rerun
> `/tweaks` to regenerate. Rewritten wholesale on every rescan.

<!-- live-tweaks:scan
scanned_at: <ISO-8601 timestamp>
<path> sha256:<hex digest>
<path> sha256:<hex digest>
-->

## Tokens

| Name | Kind | Value | Selector | Location |
|---|---|---|---|---|
| `--color-primary` | color | `#8839ef` | `@theme` | `web/assets/css/tailwind.css:12` |
| `--color-primary` | color | `#1e1e2e` | `[data-theme="dark"]` | `web/assets/css/theme.css:5` |
| `--font-body` | font-family | `Inter, sans-serif` | `@theme` | `web/assets/css/tailwind.css:20` |

## Scan summary

- N CSS files scanned
- N root-level tokens recorded
- N declarations skipped (not root-level)
- N declarations skipped (framework-internal prefix)
```

Notes on the table:

- **One row per definition**, not per token — a token with a theme override
  produces two rows sharing the same `Name`. This is deliberate: later
  implement-mode work needs every candidate definition, not just one, to
  apply the project's anchor rule (unambiguous match → replace; several
  candidates or none → stop and ask, never guess).
- Sort rows by `Name`, then by `Location`, for a stable diff between runs.
- `Selector` is the full nesting path from the outermost at-rule down to the
  immediate selector, joined with ` → ` (e.g.
  `@media (prefers-color-scheme: dark) → :root`, or just `:root` when there
  is no wrapping at-rule). For a `@theme` block (Step 3c), there is no
  selector to append — record the at-rule text itself, e.g. `@theme` or
  `@theme inline`. Two definitions of the same token can otherwise both read
  as `:root` (or both as `@theme`) and look identical side by side — the
  nesting path is what tells them apart at a glance; `Location` disambiguates
  exactly, by file:line.
- `Location` is `<path relative to repo root>:<line number>`.

**Safety.** `design.md` is the only file this mode writes, and it always
writes at the repo root determined in Step 1 — never outside it, and never
any other file. It contains plain markdown data (names, values, paths); no
part of it is executed. Recorded values are copied verbatim from source, so
treat them as inert text even if a value looks unusual (e.g. the
quoted-string case in Step 3b) — do not evaluate or shell out on token
values.

#### 3g. Decide setup branch

- If the inventory has **at least one row** → continue to Step 4 (the
  token-having path this document covers).
- If the inventory is **empty** → this is the no-vars path. Stop here and
  follow the "No-vars path" stub below instead of Step 4.

### Step 4 — Print injection instructions

Whether `design.md` was reused (Step 2: fresh) or just rewritten (Step 3),
finish setup mode by printing both injection options so the user can pick the
one that fits their app. Never suggest shipping either to production.

**Option A — plain `<script>` tag** (static HTML, no bundler). Add this to
your dev HTML entry point only, right before `</body>`:

```html
<script src="/node_modules/live-tweaks/dist/live-tweaks.js"></script>
```

**Option B — bundler apps** (Vite, webpack, etc.). Add a dev-gated dynamic
import to your app's entry file:

```js
if (import.meta.env.DEV) {
  import("live-tweaks");
}
```

`import.meta.env.DEV` is Vite's dev flag; other bundlers expose an
equivalent (e.g. webpack: `process.env.NODE_ENV !== "production"`) — gate on
whichever your app already uses.

Loading either one mounts the panel automatically over the running page; no
further setup call is required. Reloading the page re-runs the scan client
side, so newly-added tokens show up without re-running `/tweaks`.

## No-vars path (stub — not yet implemented)

Reached from Step 3g when the scan finds zero root-level custom properties.
Scope: detect hardcoded values, explain the constraint ("no CSS vars, no
product" — live editing needs `:root`-level custom properties to exist
first), and offer an interactive, file-by-file refactor into CSS vars with
small diffs. Left as a stub deliberately — implementing this is a separate,
later task.

## Implement mode (stub — not yet implemented)

Invoked as `/tweaks implement <diff-json>`. Scope: parse the exported
before/after diff JSON, locate each token's definition(s) in source (the
anchor rule: exactly one root-level definition whose current value matches
`before` → replace; several matches or none → stop and ask, never guess),
apply the edits, and show a diff summary. Left as a stub deliberately —
implementing this is a separate, later task.
