# Roadmap

## What exists today

- **The panel** (`dist/live-tweaks.js`): a single injectable IIFE that scans root-level
  CSS custom properties, renders a Tweakpane control per token (colors, font families,
  unit-carrying lengths) in a floating Shadow-DOM panel, and applies edits live.
- **Round-trip to source**: **Save** copies a before/after JSON diff to the clipboard;
  the bundled `/tweaks` skill (`skills/tweaks/`) writes it back into the app's source,
  and its setup mode builds the token inventory (`.live-tweaks/design-tokens.md`) first.
- **Noise control**: a built-in `--tw-`/`--un-` denylist, a `window.LiveTweaksConfig.allow`
  allowlist (prefix or exact match) that also defines panel order, a filtered-token
  counter, and a manual **Rescan** for stylesheets injected after mount.
- **Pipette**: finds the token(s) behind any color on the page — EyeDropper API where
  available, element-click fallback elsewhere.
- **Packaging**: published on npm (`live-tweaks`) with type declarations; releases go
  through a tag-triggered workflow with npm trusted publishing (OIDC). `bin/ci` is the
  full local gate (tests, lint, audit, secret scan).

## Missing / natural next steps

- **Guided installer** (`npx live-tweaks`): planned to replace the manual
  symlink-into-skills-directory install for the skill.
- **Webfont loading**: the panel offers system fonts only; typing an unloaded font
  name silently falls back. Loading new webfonts is currently on the user.
- **More value kinds**: `calc()` expressions and unitless numbers are not classified
  and get no control today.

## Deliberately out of scope

- **Dependency-aware (`var()`) editing**: editing a token defined as `var(--other)`
  writes a literal value over the reference; layer-2 indirection is not in scope.
- **Bookmarklet and dev-server write-back**: parked ideas, not v1 features — injection
  is script tag or dev-gated dynamic import only.
- **Production use**: dev-only by design; there is no build-time strip step.
- **Component-scoped tokens**: only root-level custom properties are editable; scoped
  tokens are counted, never shown as controls.
- **Framework coupling**: the package stays framework-agnostic; production code must
  not depend on one framework's runtime or conventions.
