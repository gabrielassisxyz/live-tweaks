# live-tweaks — backlog (drain queue)

> Materialized from `PLAN.md` (2026-07-17 planning round). Backend: markdown, per
> AGENTS.md. Pull top-down within a track. After P1, **Track A** (P2–P4) and
> **Track B** (P5) are independent — they share only PLAN §4 + D3/D10, all pinned.
>
> **Process (orchestrated drain)**: one orchestrator session owns this queue. Per
> wave (table below) it spawns one agent per task — each in its own worktree +
> branch off current `master` — then reviews each task branch and merges it,
> resolving conflicts. The orchestrator's pre-merge review satisfies AGENTS.md's
> review gate. Done = checked here + `bin/ci` green + the task's verify step
> shown + AGENTS.md post-implementation checklist.
>
> **HUMAN CHECKPOINT** = the verify is visual/interactive and cannot be
> self-declared a pass. The orchestrator does NOT block on Gabriel mid-drain: the
> task's agent gathers the best evidence it can (command output, screenshots when
> possible, explicit notes on what it could not verify) and the wave closes on
> that evidence. Gabriel reviews all checkpoints in ONE batch after the last
> implementation wave — T17 (release) only runs after that batch review passes.

## Dependency tree

```
T1 ──→ T2 ──┐
  └──→ T3 ──┴→ T4 ──→ T5 ──┐
T6 ──────────────────→ ↑   ├→ T8 ──→ T9 ──→ T10 ──┐
  └──→ T7 ─────────────────┘                      ├→ T15 ──→ T16 ──┐
T11 ──→ T12                                       │                ├→ T17
   └──→ T13 ──→ T14 ──────────────────────────────┘────────────────┘
```

Edge list (authoritative; the drawing is a convenience):
`T1→{T2,T3}` · `{T2,T3}→T4` · `{T4,T6}→T5` · `T6→T7` · `{T5,T7}→T8` ·
`T8→T9→T10` · `T11→{T12,T13}` · `T13→T14` · `{T10,T13}→T15` · `T15→T16` ·
`{T14,T16}→T17`.

## Execution waves

| Wave | Tasks (parallel) | Notes for the orchestrator |
|---|---|---|
| 1 | **T1 · T6 · T11** | 3 agents, fully disjoint files. |
| 2 | **T2 · T3 · T7 · (T12+T13)** | T12+T13 go to ONE agent — both edit `skills/tweaks/SKILL.md` (guaranteed conflict if split). T2 and T7 may both append to AGENTS.md (probe/spike outcomes) — trivial append conflict, resolve by keeping both lines. T2/T3 share test fixtures: keep fixtures per-module to stay disjoint. |
| 3 | **T4 · T14** | |
| 4–7 | **T5 → T8 → T9 → T10** | Serial chain (Track A tail) — hand it to a single agent as one branch rather than 4 spawns. T9 ends in a HUMAN CHECKPOINT. |
| 8 | **T15** | HUMAN CHECKPOINT (kernl e2e) — collect evidence, don't block. |
| 9 | **T16** | HUMAN CHECKPOINT (demo e2e) — collect evidence, don't block. |
| 10 | **T17** | Runs only after Gabriel's batch review of all checkpoints; the first `npm publish` is manual (2FA), Gabriel runs it. |

Max useful parallelism is wave 2 (4 agents); after wave 3 the graph is a chain —
don't spawn a fleet for it.

## P1 — extraction core

- [x] **T1** `src/extract.ts` — recursive walker per PLAN D2: rule-type switch
      (style/media/supports/layer/nested), `CSSImportRule` recursion with own
      try/catch, `document.adoptedStyleSheets`, cross-origin skip counter; custom
      props read via CSSOM iteration (`style.item` + `getPropertyValue`), never by
      splitting `cssText`. TDD: authored-string + jsdom fixtures incl. adversarial
      values (`;`/`}` inside strings, comments). *(depends: —)*
- [ ] **T2** active-value resolution (trimmed `getComputedStyle`), root-level
      flagging (PLAN D3), multi-definition dedupe, computed-style supplementary
      enumeration, and the **`before` algorithm** (PLAN §4, all 3 branches). Tests
      incl. authored≠computed case (hex authored, `rgb(…)` computed via var()
      chain). Checkpoint: jsdom capability probe — if custom props don't survive
      jsdom CSSOM, swap to `happy-dom` and note in AGENTS.md (PLAN D8).
      *(depends: T1)*
- [x] **T3** `src/classify.ts` — color / font-family / length / other per PLAN D5
      (trimmed input; font requires name match; `calc()`/unitless excluded →
      other). Table-driven tests. *(depends: T1)*
- [ ] **T4** `src/state.ts` — baseline (raw+resolved per token), pre-existing
      inline snapshot (PLAN D12), overrides, `diff()` in contract format,
      `reset(name)`/`resetAll()` restoring snapshot values. TDD. *(depends: T2, T3)*

## P2 — panel shell (Track A)

- [ ] **T5** `src/apply.ts` + `src/main.ts` + build config — init idempotency
      guard, `window.LiveTweaks.{dump, rescan}`; vite `formats: ["iife","es"]` +
      package.json `exports`/`module` (PLAN D14; UMD forbidden). Verify:
      `npm run build`, serve `demo/` over http, `LiveTweaks.dump()` lists exactly
      the fixture's root tokens with correct kinds and skip counters.
      *(depends: T4, T6)*
- [x] **T6** `demo/index.html` + `demo/tokens.css` — kernl-mirroring fixture per
      PLAN D7: tokens inside `@layer`, an `@media` override, an `@import`ed sheet,
      a component-scoped var, `--tw-*` noise, a `var()` reference, a
      semicolon-in-string value, a `[data-theme]` dark block. *(depends: —)*
- [ ] **T7** **SPIKE/GATE (~2h box)** — Tweakpane 4.0.5 in Shadow DOM on the demo
      page: mount, style-clone workaround (issue #535), color-picker popup
      click-drag stays open, keyboard focus works (PLAN D1). Record outcome in
      AGENTS.md; on fail, `panel.ts` impl = native inputs behind the same
      interface. *(depends: T6)*
- [ ] **T8** `src/panel/host.ts` + `src/panel/panel.ts` — floating Shadow DOM host
      (bottom-right, max z-index, collapse), `TweaksPanel` interface, folders per
      kind, controls per PLAN D5, Rescan button. *(depends: T5, T7)*

## P3 — live editing (Track A)

- [ ] **T9** edit wiring: control change → apply → state; per-var reset +
      reset-all (PLAN D12). **HUMAN CHECKPOINT**: SCOPE success-check #2 on the
      demo page (color + font update live as you type). *(depends: T8)*

## P4 — save / export (Track A)

- [ ] **T10** `src/export.ts` — Save → contract JSON (PLAN §4) → clipboard;
      fallback modal triggers on promise *rejection*, not only API absence. Unit
      verify: session with 2 edits + 1 reset exports exactly the 2, `before` =
      raw authored text. *(depends: T9)*

## P5 — `/tweaks` skill (Track B — needs only PLAN §4 + D3/D10)

- [x] **T11** `skills/tweaks/SKILL.md` — *setup*, token-having paths: read
      `design.md` if present; missing/stale → rescan source, rewrite wholesale
      (PLAN D10); end printing injection instructions (script tag + dev-gated
      `import('live-tweaks')`). Verify: run against `demo/` finds the fixture
      tokens, writes correct `design.md`. *(depends: —)*
- [x] **T12** *setup*, no-vars path: detect hardcoded values, explain the
      constraint, offer interactive refactor-to-vars (file-by-file, small diffs).
      Verify: run against a hardcoded-colors fixture page produces the
      explanation + a concrete refactor offer. *(depends: T11)*
- [x] **T13** *implement* mode: parse diff JSON, locate definitions, apply PLAN D3
      anchor rule (ambiguous → stop and ask), edit files, show diff summary.
      Verify: hand-written diff JSON applied to the demo fixture edits the right
      definitions, incl. the `[data-theme]` anchor case and a stop-and-ask case.
      *(depends: T11)*
- [ ] **T14** `README.md` — what / install (npm + skill symlink) / inject
      snippets / limitations (PLAN D4, D6, CSP, rescan). Minimal and honest;
      polish at `/public-repo`. *(depends: T13)*

## P6 — validation + release

- [ ] **T15** kernl end-to-end — SCOPE success checks 1–3. kernl:
      `~/repositories/kernl`, web app under `web/`, run per kernl's own AGENTS.md.
      **HUMAN CHECKPOINT** on the visual steps; every breakage fixed with a
      regression test; PLAN D13 usability gate evaluated here.
      *(depends: T10, T13)*
- [ ] **T16** demo-page end-to-end — SCOPE success check 4 (framework-agnosticism
      proof). **HUMAN CHECKPOINT.** *(depends: T15 — sequencing choice per SCOPE's
      "repeat steps 1–3", not a hard dependency)*
- [ ] **T17** release — manual first `npm publish` as **v1.0.0** (2FA), then
      configure npm Trusted Publisher (org `gabrielassisxyz`, repo `live-tweaks`,
      workflow `release.yml`) per AGENTS.md. *(depends: T14, T16)*
