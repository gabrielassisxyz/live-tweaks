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
- **T7 spike outcome (2026-07-17): PASS** — Tweakpane 4.0.5 works in an open Shadow DOM
  (Chromium via Playwright, evidence in `spike/`). Mount, color-picker popup open, popup
  click-drag (stays open, value updates, page var applied live), and keyboard focus/typing
  all verified. So `panel.ts` adopts Tweakpane (not the native-inputs fallback). Two gotchas
  for T8: (1) the style-clone workaround's target is `style[data-tp-style="plugin-default"]`,
  NOT `"default"` as PLAN D1's example string reads — clone by attribute *presence*
  (`style[data-tp-style]`), which is version-robust. (2) The button that opens the picker is
  `.tp-colswv_b` (`.tp-colv_t` is the adjacent hex text field). No `composedPath` retargeting
  breakage observed in 4.0.5.
