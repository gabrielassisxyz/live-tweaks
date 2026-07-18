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
  before/after diff back into the app's source files. Specified in the
  "Implement mode" section below.

Both modes operate on the **current working directory's repository** (the app
the user is asking to tweak), never on the `live-tweaks` package itself.

## Setup mode

Setup mode has two branches, decided by whether the app already has CSS custom
properties (design tokens) to work with:

1. **The app has CSS custom properties** — inventory them. This branch is
   fully specified below.
2. **The app has no CSS custom properties** — hardcoded values only, so live
   editing is impossible until tokens exist. Specified in the "No-vars path"
   section below.

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
  at all (Step 3b). This is common in Tailwind v4 setups: authored design
  tokens can live directly inside a global `@theme` block, with no
  `:root { ... }` wrapper in source. Tailwind compiles `@theme` output to
  `:root` custom properties at build/runtime, so treating it as anything but
  root-level would make setup mode skip every one of those tokens.

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
  follow the "No-vars path" section below instead of Step 4.

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

**Include an allowlist when the app uses a CSS framework** (Tailwind, daisyUI,
UnoCSS — anything that defines its own `:root` custom properties). Frameworks
can flood `:root` with hundreds of internal tokens that bury the app's real
ones, and framework noise may share the app's own naming (daisyUI also
defines `--color-*`), so build the allowlist from `design.md`'s **exact token
names** — the definitive inventory Step 3 just wrote — not from prefixes.
Exact entries match exactly (only an entry ending in `-` acts as a prefix),
so suffixed framework variants like `--color-primary-content` stay out.

**Order the `allow` array by visual prominence — the panel renders tokens in
allow-entry order**, so the list you print decides what the user sees first.
Judge prominence by reading the app's layout and styles (which tokens paint
the largest or most important areas), never alphabetically. Rank roughly:

1. Main surface colors — the page background, the primary containers/panels
   the user stares at (e.g. an app shell, a capture box).
2. Primary text colors (body text, dimmed/faint text).
3. Brand accents — primary, secondary, tertiary.
4. Every remaining color, then font tokens, then lengths.
Print it as a pre-declared global the page sets *before* the panel script
loads (for Option A a `<script>` block above the `src` tag; for Option B an
assignment above the dynamic import):

```html
<script>
  window.LiveTweaksConfig = {
    allow: ["--color-bg-base", "--font-headline" /* …every design.md token name */],
  };
</script>
```

If the scan found no framework noise (every root token is the app's own),
skip the allowlist — the default filter already handles the common `--tw-`/
`--un-` internals.

Loading either one mounts the panel automatically over the running page; no
further setup call is required. Reloading the page re-runs the scan client
side, so newly-added tokens show up without re-running `/tweaks` — but a
token added to source *after* setup must also be added to the printed
allowlist, or the panel will filter it out.

## No-vars path

Reached from Step 3g when the scan of Steps 1–3 found **zero** root-level
custom properties. The app styles everything with hardcoded values, so there
is nothing on `:root` for the live panel to override — and the panel edits
*only* by setting `--var` overrides on the document root. This is the
product's load-bearing constraint, stated plainly: **no CSS custom
properties, no live editing.** Before the panel can help, the design values it
would edit have to exist as `:root`-level custom properties. Extracting them
is a first-class setup step, not a workaround — but it edits source, so it is
done *with* the user, one file at a time, never in a single sweep.

Do not fall back to Step 4 (injection) from here: injecting the panel over a
page with no tokens would mount an empty, useless panel. Offer the refactor
instead; if the user declines, setup stops — honestly — with no tokens to
edit.

### N1 — State the constraint and what changes

Tell the user, in plain terms:

- The scan found no `:root`-level custom properties, so live editing is not
  possible yet.
- The fix is to extract the design values (colors, fonts) the app already
  hardcodes into CSS custom properties on a root selector, then re-run setup.
- This is **pure extraction**: each hardcoded value becomes
  `var(--token-name)` and the token is defined with that same value, so the
  rendered result is identical — no visual change, only a new seam the panel
  (and future edits) can grab.

### N2 — Detect and inventory the hardcoded values

Reuse the candidate files from Step 3a (same glob, same exclusions). Within
them, find the hardcoded design values worth tokenizing — the same kinds the
panel can later edit (D5):

- **colors** — hex (`#` + 3/4/6/8 digits), `rgb(`/`rgba(`/`hsl(`/`hsla(`/
  `hwb(`/`lab(`/`lch(`/`oklab(`/`oklch(` functions, and well-known color
  keywords — wherever they appear as property values.
- **font-family** — `font-family:` declarations (and the family part of the
  `font:` shorthand).

Group by **value**, not by occurrence: one color used in twelve places is the
single strongest refactor candidate, because one new token replaces all twelve
uses. Present a short, honest inventory — the recurring values, roughly where
they appear, and how many times — leading with the highest-impact ones. Don't
list every one-off length; keep the offer focused on what a person would
actually want to tweak (colors and fonts), matching the panel's own scope.

### N3 — Agree on token names

Do not silently invent a taxonomy. Propose sensible, conventional names for
the values you found (`--color-primary`, `--color-bg`, `--color-text`,
`--font-body`, `--font-heading`, …), tied to how each value is used, and let
the user correct them. The names are the vocabulary they will edit later, so
they are the user's call, not yours.

### N4 — Refactor file by file, small diffs, user confirms each step

Extract incrementally — never rewrite the whole codebase in one edit:

1. **Pick a home for the tokens.** If a global stylesheet with a `:root { }`
   block already exists, add the definitions there; otherwise create one (or
   add a `:root { }` block to the app's main global stylesheet) and make sure
   it is loaded. Define each agreed token with the *current* hardcoded value.
2. **Go one file at a time.** For each file, show a small, reviewable diff: the
   specific hardcoded values replaced with `var(--token-name)`. Keep the diff
   to a single file (or a single logical group) so it is easy to read and easy
   to revert.
3. **Wait for the user to confirm before applying, then move on.** After each
   file the app still renders identically (the var resolves to the same
   value), so every step is independently safe and the user can stop at any
   point with a working app.

### N5 — Finish by re-running setup

Once the user has extracted as many values as they want, the app now has
root-level tokens. Re-run setup from Step 1: the scan will find the new
tokens, write `design.md`, and reach Step 4 to print the panel-injection
instructions. The no-vars path has done its job the moment there is at least
one `:root`-level custom property to edit.

**Safety.** Unlike the token-having path (which writes only `design.md`), this
path edits the app's **source files** — it is the one setup branch that
changes code. Guard it accordingly: only ever edit files inside the repo root
from Step 1; change only the specific declarations shown in the confirmed
diff; keep every extracted value identical to the original (extraction, not
redesign); and treat all values as inert text — copy them verbatim, never
evaluate or shell out on a value even if it looks unusual. Apply nothing the
user has not confirmed for that file.

## Implement mode

Invoked as `/tweaks implement <diff-json>` — the round-trip half of the
product. The user edited tokens live in the panel, hit Save, and pasted the
exported before/after diff; this mode writes those `after` values back into
the app's source, choosing the right definition by the `before` anchor. Like
the no-vars path, it operates on the current working directory's repository
and writes source files, so its safety guards below are not optional.

### I1 — Parse the diff JSON, strictly

The diff is exactly the contract shape: a **flat map, no
envelope**. Keys are custom-property names verbatim (leading `--`); each value
is an object with a `before` and an `after` string:

```json
{
  "--color-primary": { "before": "#8839ef", "after": "#e07850" },
  "--font-body":     { "before": "Inter, sans-serif", "after": "system-ui" }
}
```

Parse it as given. If it is wrapped in an outer object or array (an envelope),
if a key is missing `before`/`after`, or if it is not valid JSON → **stop and
report**; do not guess a shape. Both `before` and `after` are opaque token
values: treat them as **inert text**. Never evaluate them, interpolate them
into a shell command, or otherwise execute them — they originate from page
content.

### I2 — Build a current definition inventory

For each token in the diff you need every candidate *definition* in source.
Reuse setup mode's scan: if a `design.md` is present and validates as **fresh**
(Step 2), its inventory already lists one row per definition with a `Location`
(file:line) and `Selector`; otherwise rescan (Step 3) to rebuild it. Either
way, before editing, **re-read the actual source line** at each candidate's
`Location` and take its *current* value from the file — the file is the
authority, `design.md` is only the index that points you at the candidates.
The inventory is already root-level-only (Step 3c), so "candidate definition"
means "root-level definition of this token".

### I3 — Choose the definition to edit (the anchor rule)

For each token in the diff, gather its candidate definitions and apply D3 /
§4, comparing values **textually after trimming** (no evaluation, no `var()`
resolution — `before` is already the raw authored text the panel exported):

- **No candidate definition found** → **stop and ask**. The token may have
  been renamed, live in a file the scan excluded, or its `before` may be a
  *computed* value with no source match (§4 branch 3). Report it; do not
  invent a place to write.
- **Exactly one candidate definition** → replace it, regardless of whether its
  current value equals `before` — there is nothing to disambiguate. If it does
  *not* match `before`, note the discrepancy in the summary (the source moved
  since export) but proceed.
- **Multiple candidate definitions** → keep only those whose current source
  value (trimmed) equals `before` (trimmed):
  - **exactly one matches** → replace that one; leave the others untouched.
    This is the theme case — e.g. `:root` and `[data-theme="dark"]` each define
    the token, and `before` pins which one the user was actually looking at.
  - **zero match, or more than one matches** → **stop and ask, never guess.**
    Show the candidates (file:line, current value, selector) and let the user
    pick. Two definitions can hold the *same* value (a light and a dark block
    both `#11111b`), which is exactly the ambiguity this rule refuses to
    resolve on its own.

### I4 — Apply the edit

For the chosen definition, replace **only the value** of its
`--name: <value>;` declaration with `after`, written verbatim. Preserve the
property name, the surrounding whitespace/indentation, and everything else on
the line and in the file. When finding where the old value ends, scan past
matched `'...'`/`"..."` string literals — a value may legally contain a `;`
inside a quoted string (the Step 3b rule), so do not truncate at the first
`;`. Edit nothing that is not the chosen definition's value.

### I5 — Show a diff summary

After applying the unambiguous edits, print a concise summary so the user can
see exactly what happened:

- one line per token that was written: `--name` — `<file>:<line>` —
  `before` → `after`;
- a clearly separated list of any tokens that were **stopped and asked**
  (not-found, no match, or multiple matches) with the reason and the
  candidates, so nothing is silently dropped;
- a note on any single-definition token whose source value didn't match its
  `before`.

Resolve the stopped-and-asked tokens with the user, then apply their choice
the same way. The edited files are under version control — recommend the user
review the change with `git diff` before committing.

**Safety.** Implement mode writes the app's **source files**, so it carries
the same guards as the no-vars path: edit only within the repo root from
Step 1; change only the located definition's value; and treat every `before`/
`after` value as inert text — copied verbatim, never evaluated or passed to a
shell. When the anchor rule is not certain, the rule *is* to stop and ask —
never overwrite a definition on a guess.
