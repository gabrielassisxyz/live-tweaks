# live-tweaks — Agent Briefing

> Read before every interaction. Living spec: short, imperative. On every gotcha or
> decision, append one line here.

> **What it is:** a live design-tweaks panel injected into your own running app — edit CSS
> design tokens (colors, fonts) in a floating panel, watch the UI update as you type, then
> round-trip the changes to source via the `/tweaks` skill. Full scope: `SCOPE.md`.
> **Calibration:** Tier 2 · Phase: work. No external stakes yet (no users), real personal
> stakes — a scoped product headed for open-source release.
> **Review gate:** standard — one independent external review of the whole branch diff,
> exactly once, pre-push. No per-commit or mid-development reviews.

## Stack & Commands

- **Stack:** TypeScript + Vite (lib mode → single IIFE `dist/live-tweaks.js`) + Vitest +
  Biome. Node >= 24, npm.
- **After clone (once):** `bin/install-hooks` (gitleaks pre-commit), `npm install`
- **Dev:** `npm run dev`
- **Build:** `npm run build` → `dist/live-tweaks.js`
- **Test:** `npm test`
- **Lint / format:** `npm run lint` / `npm run format`
- **Full gate:** `bin/ci` — the exact thing CI runs; green locally means green in CI.

## Scope (current)

- **Current scope:** v1 as pinned in `SCOPE.md` — CSS-var extraction/setup, panel injection
  (Shadow DOM), live editing of colors + fonts, save → JSON diff → `/tweaks implement`
  round-trip. Don't expand beyond it without a present need; if a change drifts past it,
  STOP and flag it.
- **Nothing may depend on Vue.** kernl is the first target app, but only as a guinea pig —
  the product is framework-agnostic by construction.
- **Task backend:** markdown — scope authority is `SCOPE.md`; the v1 implementation
  plan lives in `PLAN.md`; the drain queue is `BACKLOG.md`; parked ideas go to
  `IDEAS.md`. No issue tracker / beads needed at this size.

## Tests (TDD)

- Every feature is born with a test; every bugfix with a regression test.
- Tests run with ONE command (`npm test`), no manual setup, no secret credential. If it
  can't run headless, it's wrong.
- Mock external I/O with a named fake, not an inline stub. DOM-dependent code gets a jsdom
  environment (add the dep only when the first DOM test appears).
- **Recorded exemption (2026-07-17):** `src/panel/` (the Tweakpane wrapper) has no unit
  tests — it is verified on the demo page via the T7 spike gate and the human checkpoints
  in `BACKLOG.md` (T9/T15/T16). Everything left of `panel/` stays strictly TDD.
- Before saying "done", run `bin/ci`; show the result.

## Small releases

- Every commit on `master` passes `bin/ci` and is production-ready — no "broken commit I
  fix in the next one".
- If closed work is left uncommitted when switching tasks, remind the owner.

## Release (npm)

- Ships as an npm package (`live-tweaks`). Flow: `npm version <patch|minor|major>` →
  `git push --follow-tags` → the `v*` tag triggers `.github/workflows/release.yml`, which
  runs `bin/ci` and then `npm publish`.
- Auth is **npm trusted publishing (OIDC)** — no token, no repo secret, provenance
  automatic. Bootstrap at v1: (1) first publish is manual — `npm publish` from a local
  terminal, 2FA prompt (trusted publishing only configures on an existing package);
  (2) then on npmjs.com → package → Settings → Trusted Publisher → GitHub Actions with
  org `gabrielassisxyz`, repo `live-tweaks`, workflow `release.yml`, allowed action
  `npm publish`. Every later release goes through the workflow.

## Security (habit, not a phase)

- When touching user input, injected scripts, filesystem writes (the `/tweaks` round-trip),
  or anything that evaluates page content, flag the risk and propose the guard.
- Dependency CVEs are caught by `npm audit --audit-level=high` in `bin/ci`; the gitleaks
  hook + CI job catch secrets.

## Git & secrets

- Before any commit, show `git status` + `git diff --cached`; confirm no secret is staged.
  The gitleaks pre-commit hook is the deterministic backstop; this habit is the
  probabilistic one.
- Real secrets stay out of git — only `.env.example` files with fake values are committed.

## Post-implementation checklist (run before "done")

1. New tests written and passing.
2. `bin/ci` green.
3. `git diff --cached` reviewed — zero secrets.
4. Commits small and well-described.
5. Refactoring candidates listed (if the change was large).
6. Security risks flagged (if a sensitive surface was touched).
7. Docs / this spec updated if behavior, setup, or release flow changed.

## Common hurdles (append as discovered)

- `bin/ci` runs `npm ci` (not `npm install`) — it wipes and reinstalls `node_modules`
  from the lockfile every run. Slower locally, but identical to CI by design.
- Biome formats with **tabs** (its default, kept on purpose); don't hand-format with
  spaces — run `npm run format`.
- `.ai-jail` is gitignored (machine-specific absolute paths); recreate it per machine
  from the house default in `project-bootstrap`.
- `package-lock.json` is tab-indented on purpose (2026-07-18): npm inherits the indent
  style of `package.json` (tabs, via Biome) when rewriting the lockfile, so a 2-space
  lockfile made every plain `npm install` produce a full-file whitespace diff. The
  regenerated tab version is a stable fixed point — repeat installs are churn-free.
  Don't "fix" its indentation; Biome ignores lockfiles (protected files).
- Lockfile chapter two (2026-07-18): npm >= 11.7 (bundled with the CI runner's node 24.18)
  demands hoisted lockfile entries for nested optional deps (`@emnapi/*`) that npm <= 11.6
  neither writes nor needs — so a lockfile regenerated locally can pass `bin/ci` here and
  fail `npm ci` on CI with "Missing ... from lock file". If that happens, regenerate with
  `npx -y npm@latest install` and verify BOTH accept it (`npx npm@latest ci --dry-run` and
  plain `npm ci --dry-run`). GitHub CI had been red since 2026-07-17 because of this while
  local runs stayed green.
- T2 jsdom computed-style probe (2026-07-17): jsdom's `getComputedStyle(documentElement)`
  **does** carry plain root custom-property values and **does** enumerate their names, but
  **does not** resolve `var()` chains (returns the literal `var(...)`) nor canonicalize
  colors — so no `happy-dom` swap (PLAN D8), but the `before` var-substitution/match must
  stay a pure function fed injected computed values (`src/resolve.ts` / `resolve.pure.test.ts`),
  never asserted through jsdom.
- **T7 spike outcome (2026-07-17): PASS** — Tweakpane 4.0.5 works in an open Shadow DOM
  (Chromium via Playwright, evidence in `spike/`). Mount, color-picker popup open, popup
  click-drag (stays open, value updates, page var applied live), and keyboard focus/typing
  all verified. So `panel.ts` adopts Tweakpane (not the native-inputs fallback). Two gotchas
  for T8: (1) the style-clone workaround's target is `style[data-tp-style="plugin-default"]`,
  NOT `"default"` as PLAN D1's example string reads — clone by attribute *presence*
  (`style[data-tp-style]`), which is version-robust. (2) The button that opens the picker is
  `.tp-colswv_b` (`.tp-colv_t` is the adjacent hex text field). No `composedPath` retargeting
  breakage observed in 4.0.5.
- **T5 vite iife global-name trap (2026-07-17)**: `vite.config.ts`'s `lib.name` for the
  `iife` format must NOT be `"LiveTweaks"`. The iife wrapper's global binding
  (`var <name> = (function(){...})()`) assigns `window.<name>` *after* the module body
  finishes running — so naming it `"LiveTweaks"` silently overwrote `window.LiveTweaks`
  (already set correctly, mid-module, by `main.ts`'s own `init()`) with the raw
  module-exports object once the IIFE returned, clobbering `.dump`/`.rescan` with the wrong
  shape. Caught only by driving the *built* `dist/live-tweaks.js` in a real browser — the
  bug was invisible from `vitest` (which runs the TS source, never the iife bundle) and
  from `tsc` (no type distinguishes the two assignments). `lib.name` is now the internal,
  never-referenced `"__liveTweaksModule"`; `init()`'s own assignment is the only thing
  that may own `window.LiveTweaks`. Lesson: any change to `vite.config.ts`'s `lib.name`
  needs a real-browser check of the actual built artifact, not just `npm test`.
- **kernl (T15) injection + daisyUI reality:** the least-invasive Nuxt wiring is a dev-gated
  client plugin (`plugins/live-tweaks.client.ts`, `if (import.meta.dev)`) that appends a
  `<script src>` pointing at the IIFE placed in `web/public/` — this survives HMR and needs
  no bundler config. Two runtime facts the panel surfaced, both **documented limitations, not
  bugs**: (1) daisyUI floods `:root` with unprefixed noise (`--radius-*`, `--size-*`,
  `--radialprogress`, its oklch palette) that the `--tw-`/`--un-` denylist can't catch, and
  (2) daisyUI *shadows* kernl's `@theme` colors with `oklch()` at runtime, so the live value
  of e.g. `--color-primary` is `oklch(...)` not source `#b4c5fe`; Tweakpane 4.0.5 renders
  oklch as a text input (no swatch) and those tokens don't round-trip (computed `before` has
  no source match → implement mode correctly stops-and-asks). Hex-authored kernl-only tokens
  (`--color-bg-base`, `--font-headline`) get real controls and round-trip cleanly.
