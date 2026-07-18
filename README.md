# live-tweaks

A live design-tweaks panel you inject into your own running app: edit CSS custom
properties (design tokens) — colors, fonts, sizes — in a floating panel, watch the UI
update as you type, then round-trip the changes back into your source code.

## The itch

Tools like realtimecolors.com nail live color editing, but only on their own demo
template. Nothing lets you tweak the design of the app you're actually building, live,
and then persist the result to source. That's the whole scope of this tool: no more,
no less.

It only works if your app's design is driven by CSS custom properties (`--color-primary`,
not `#8839ef` sprinkled through your stylesheets). If it isn't yet, the `/tweaks` skill's
setup mode will help you get there before it tries to edit anything.

## How it works

Two pieces, one contract between them:

- **The panel** (`dist/live-tweaks.js`) — a single injectable script. It reads every
  CSS custom property defined at the root of your stylesheets, renders a control for
  each one in a floating Shadow-DOM panel, and applies edits live via
  `style.setProperty()`. It never touches your source files.
- **The `/tweaks` skill** (`skills/tweaks/SKILL.md`) — an agent skill with two jobs:
  *setup* (find or create your app's CSS custom properties, then tell you how to
  inject the panel) and *implement* (write an exported diff back into your source).
  It never touches the browser.

The two talk to each other through one artifact: a before/after diff. When you hit
**Save** in the panel, it copies this to your clipboard:

```json
{
  "--color-primary": { "before": "#8839ef", "after": "#e07850" },
  "--font-body":     { "before": "Inter, sans-serif", "after": "system-ui, sans-serif" }
}
```

Paste it into `/tweaks implement <diff-json>` and the skill locates each token's
definition in your source and rewrites its value — nothing else on the line changes.
If a token has more than one candidate definition (a light/dark theme pair, say) and
it can't tell which one you meant, it stops and asks instead of guessing.

The usual flow:

1. `/tweaks` in your app's repo — sets up (or reuses) the token inventory and prints
   injection instructions.
2. Inject the panel (see below), open your app, edit tokens, watch it update live.
3. Hit **Save** in the panel — the diff above is on your clipboard.
4. `/tweaks implement <diff-json>` — your source is updated. Reload without the panel
   injected and the design is the same, minus the panel.

## Install

Two installs — the panel is an npm package, the skill is a symlink into your
agent's skills directory.

**The panel:**

```sh
npm install --save-dev live-tweaks
```

It's a dev-only tool; nothing about it should ship in a production bundle (see
Inject, below).

**The skill:**

The skill ships inside the npm package (`skills/tweaks`), so a project that
depends on `live-tweaks` can link it pinned to the panel version it installed
— for Claude Code:

```sh
mkdir -p .claude/skills
ln -s "$(pwd)/node_modules/live-tweaks/skills/tweaks" .claude/skills/tweaks
```

For a global install (available in every repo), link from a clone instead:

```sh
git clone https://github.com/gabrielassisxyz/live-tweaks.git
ln -s "$(pwd)/live-tweaks/skills/tweaks" ~/.claude/skills/tweaks
```

Other agents: same idea, pointed at that agent's skills directory. A guided
installer (`npx live-tweaks`) is planned.

## Inject

Load the panel into your app's dev build only — pick whichever fits:

**Plain `<script>` tag** (static HTML, no bundler). Add this to your dev HTML entry
point, right before `</body>`:

```html
<script src="/node_modules/live-tweaks/dist/live-tweaks.js"></script>
```

**Bundler apps** (Vite, webpack, etc.). Add a dev-gated dynamic import to your app's
entry file:

```js
if (import.meta.env.DEV) {
  import("live-tweaks");
}
```

`import.meta.env.DEV` is Vite's dev flag; other bundlers expose an equivalent (e.g.
webpack's `process.env.NODE_ENV !== "production"`) — gate on whichever your app
already uses.

Either one mounts the panel automatically over the running page. Loading it in a
production build is never intended — there's no build-time strip step, so the gate
above is on you.

### Filtering noisy token sets (allowlist)

CSS frameworks can flood `:root` with hundreds of internal custom properties
(daisyUI alone adds ~177), burying your real design tokens in the panel. Declare
an allowlist **before** the script loads and the panel shows only matching tokens:

```html
<script>
  window.LiveTweaksConfig = { allow: ["--color-", "--font-", "--spacing-component"] };
</script>
<script src="/node_modules/live-tweaks/dist/live-tweaks.js"></script>
```

For the bundler path, set `window.LiveTweaksConfig` in your entry file before the
`import("live-tweaks")` line. An entry ending in `-` (like `--color-`) matches as
a prefix; any other entry must match a token name exactly — so `--color-primary`
does *not* pull in a framework's `--color-primary-content`, which matters when
framework noise shares your naming. When set, the allowlist replaces the built-in
`--tw-`/`--un-` denylist,
and the panel's counter line reports how many tokens it filtered. An invalid
config warns on the console and is ignored — it never blocks the panel.

The panel renders tokens in allow-entry order, so put the important ones first
— main surfaces, then text colors, then brand accents (`/tweaks` setup writes
the list in that order for you). In Chromium, the toolbar's pipette button picks
any pixel on the page and scrolls to (and highlights) the token(s) currently
painting that color.

## Limitations

Read these before you're surprised by them:

- **`var()` references write literal values.** A token like
  `--btn-bg: var(--color-primary)` shows its resolved color in the panel, but editing
  it writes a literal value over the `var()` reference — the indirection is gone
  after that edit. Layer-2, dependency-aware editing isn't in scope.
- **No webfont loading.** Typing a font name the page hasn't loaded silently falls
  back to whatever's next in the stack. The panel offers a datalist of common system
  fonts (which always work) plus free text; loading new webfonts is on you.
- **A strict `style-src` CSP blocks the panel.** The panel injects its own styles
  into a Shadow DOM; an app with a strict `style-src` Content Security Policy will
  block that injection. Dev servers rarely set one, but if yours does, relax it for
  local dev or the panel won't render.
- **Lazy-loaded routes need a manual rescan.** The panel scans stylesheets present at
  mount time. If your app injects CSS later (route-level code splitting, lazy
  stylesheets), tokens defined in it won't show up until you hit **Rescan** in the
  panel.
- **Root-level tokens only.** Only custom properties defined on `:root`, `html`, or
  an equivalent root-level selector are editable. Component-scoped tokens (Vue
  `scoped`/`v-bind` hashes, CSS Modules, anything not reachable from the root) are
  skipped and counted, never silently dropped, but they aren't shown as controls.
- **Editable kinds: color, font-family, length — nothing else.** Lengths must carry
  a unit the panel recognizes (`px`, `rem`, `em`, `%`, `vh`, `vw`, `pt`); `calc()`
  expressions and unitless numbers aren't classified and won't get a control.
- **Dev-only injection, no bookmarklet.** v1 ships the script-tag/dynamic-import
  snippets above and nothing else — no bookmarklet, no dev-server write-back. Both
  are parked ideas, not v1 features.

## License

MIT.
