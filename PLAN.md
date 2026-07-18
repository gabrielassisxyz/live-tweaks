# live-tweaks — v1 implementation plan

> Output of the planning round (2026-07-17), per `planning-pipeline.md` step 3.
> Reviewed by two independent adversarial passes (technical; scope/task-graph) and
> revised against ground truth read from kernl's actual CSS.
> Scope authority: `SCOPE.md` (this plan implements it, never widens it).
> Task queue: `BACKLOG.md` (materialized from this plan — drain from there).

## 0 · Context (self-contained)

live-tweaks is a live design-tweaks widget you inject into **your own** running app:
a floating panel lists the app's CSS custom properties (design tokens), you edit
colors/fonts/sizes and watch the real UI update as you type, then **Save** exports a
before/after JSON diff that the `/tweaks` agent skill writes back into source code.

Two deliverables, one contract between them:

1. **The panel** — a single-file IIFE (`dist/live-tweaks.js`) injected via dev-only
   `<script>`/dynamic import. Reads CSS vars from the page, renders controls in a
   Shadow DOM, applies edits via `setProperty`, exports the diff JSON.
2. **The skill** — `skills/tweaks/SKILL.md`, an agent skill with two modes:
   *setup* (inventory/create the app's CSS vars, tell the user how to inject the
   panel) and *implement* (apply an exported diff JSON to the source files).

The **contract** is the diff JSON (§4). The panel never touches source; the skill
never touches the browser. That seam is what keeps v1 bundler-agnostic.

**First target: kernl (Vue)** — as guinea pig only; nothing may depend on Vue.
Ground truth read during planning (facts the plan must survive):

- kernl's tokens live in `web/assets/css/tailwind.css` as a **Tailwind v4 `@theme`
  block** (~60 color tokens, daisyUI plugin) — at runtime these become custom
  properties on `:root` **inside `@layer` rules**, not top-level style rules.
- kernl also has **component-scoped vars with media-query overrides**
  (`--focus-read` etc. in `web/components/inbox/InboxFocusCard.vue`).
- Tailwind also emits internal vars (`--tw-*`) and framework noise.

Success is defined by the 4 checks in `SCOPE.md` (§ "Success check").

## 1 · Decisions taken (rationale recorded, per no-silent-decisions)

### D1 — Panel UI: adopt Tweakpane v4, behind a thin wrapper
*Researched 2026-07-17, resolving the evaluation SCOPE.md mandated.*

- **Shadow DOM works** with the author's own 2-line workaround (issue
  cocopon/tweakpane#535): after mounting, clone `style[data-tp-style="default"]`
  into the shadow root. Fragile-ish (internal attribute) → pinned version + spike gate.
- **Cost**: 152 KB min / 31 KB gzip — fine for a dev-only tool that never ships in
  the user's production bundle.
- **Health**: MIT, 4.5k stars, active (last push 2026-03), v4.0.5 stable.
- **What it buys**: color picker (with alpha), text/list inputs, folders, collapse —
  the entire panel chrome we'd otherwise hand-roll.
- **Known Shadow-DOM failure mode beyond styles**: event retargeting — document-level
  "click outside" handlers see the shadow *host* as target, which breaks picker
  popups unless the lib uses `composedPath()`. The T7 spike tests this explicitly
  (open popup, click-drag inside it, keyboard focus), not just appearance.
- **Hedge**: all Tweakpane usage lives in `src/panel/` behind our own
  `TweaksPanel` interface. If the spike fails, fallback is native
  `<input type="color">`/text controls behind the same interface.
- Strict `style-src` CSP on a target app blocks Tweakpane's injected styles (and
  the clone). Dev servers rarely set one; README documents the limitation.

### D2 — Token discovery: recursive CSSOM walk + computed-style supplement
`getComputedStyle` *can* enumerate custom properties in current engines
(iterating the computed declaration includes `--*` names in Chromium ≥118 and
Firefox), but it yields no selectors, no raw authored text, and no definition
sites — all of which the contract needs. So:

- **Primary source — recursive walk of `document.styleSheets`**, switching on rule
  type: `CSSStyleRule` (collect `--*` declarations **via CSSOM iteration** —
  `style.item(i)` + `getPropertyValue`, never string-splitting `cssText`: custom
  values may legally contain `;`/`}` inside strings), `CSSMediaRule` /
  `CSSSupportsRule` / `CSSLayerBlockRule` / nested rules (recurse into
  `.cssRules`), `CSSImportRule` (recurse into `.styleSheet`, own try/catch).
  Also walk `document.adoptedStyleSheets`. Without the recursion the walker is
  blind on kernl (Tailwind v4 emits tokens inside `@layer`) and on the standard
  `@media (prefers-color-scheme: dark)` theme pattern.
- **Cross-origin sheets** throw on `.cssRules` → try/catch, count, surface
  "N stylesheets unreadable (cross-origin)" in the panel.
- **Supplementary source — computed-style enumeration on `documentElement`**:
  catches root-level tokens the walk can't see (cross-origin sheets, JS-set inline
  vars from theme managers). These tokens carry no raw text; their `before` falls
  back per §4.
- **Active value** (what a control shows initially) =
  `getComputedStyle(documentElement).getPropertyValue(name)`, **always `.trim()`ed**
  — engines preserve leading whitespace in the token stream, and an untrimmed
  value breaks both classification regexes and `before` matching. Empty string
  means "not set at root" → the token is never exported with an empty `before`.
- `@property`-registered tokens: computed values are canonicalized (authored
  `#B4C5FE` → `rgb(…)`), and `inherits: false` breaks root overrides. v1 detects
  `CSSPropertyRule` and warns; registered tokens are treated as unclassified
  (skipped with the D5 counter), not silently mis-edited.

### D3 — v1 edits root-level tokens only; the `before` value is the anchor
The product's own load-bearing constraint (SCOPE: "the vars live on `:root`")
becomes an explicit editing boundary:

- **Editable = tokens with at least one definition on a root-level selector**
  (`:root`, `html`, `html[...]`, or found via the computed-style supplement).
  Edits set an inline override on `documentElement`, which wins over any
  declaration *on the html element itself* — that is the precise cascade claim
  (an inline root value does **not** beat a direct declaration on a descendant,
  importance included; that's per-element cascade competition, not a bug).
- **Non-root-scoped tokens** (kernl's `--focus-*`, Vue scoped/`v-bind` hash vars)
  are counted and console-logged, not rendered. This one rule both keeps v1
  honest (no silently-dead controls) and filters most framework noise. Scoped-var
  editing via an injected last-in-document rule is sketched in `IDEAS.md`.
- **Themes / multi-definition root tokens** (`:root` + `[data-theme="dark"]`, or
  `@media` overrides): one control per name; the exported `before` is the raw text
  of the *active* definition (§4 algorithm). The skill's implement mode replaces
  the definition whose current source value matches `before`; one definition →
  replace regardless; several match or none → **stop and ask**, never guess.
  Editing both themes in one session is out of v1.

### D4 — `var()` references: display resolved, write literal (documented limitation)
A token like `--btn-bg: var(--color-primary)` shows its *resolved* color in the
picker; editing it writes a literal value, breaking the reference. v1 accepts
this, documented in README — dependency-graph editing is layer-2 machinery. The
exported `before` for such a token is its raw `var(...)` text, so the skill still
finds the right declaration. (`state.ts` therefore carries both `raw` and
`resolved` per token.)

### D5 — Editable kinds: color, font-family, length; everything else omitted
Classification (`classify.ts`), operating on **trimmed** values:

- **color** — `CSS.supports('color', value)` on the resolved value → color picker.
- **font-family** — name matches `/font|family/` (mandatory — value-only checks are
  unsound: `CSS.supports('font-family', v)` accepts almost any ident) AND value is
  not a length → text input with a datalist of system font stacks.
- **length** — resolved value matches `/^-?[\d.]+(px|rem|em|%|vh|vw|pt)$/` → text
  input (SCOPE's "icon size" case). `calc()` and unitless numbers are explicitly
  excluded in v1 (they classify as *other* — a known limitation, not a T15 bug).
- **other** — not rendered; console-logged (`live-tweaks: skipped N vars`) so
  nothing disappears silently. Raw-text editing for these → `IDEAS.md`.

### D6 — Webfont loading is OUT of v1
Editing `font-family` to a font the page hasn't loaded silently falls back. v1
ships the honest version: system-stack datalist (always renders), free text
allowed, README states that loading new webfonts is on the user. A Google-Fonts
loader is parked in `IDEAS.md` — cheap, but beyond SCOPE, and v1 discipline wins.

### D7 — Demo page is a first-class artifact that mirrors kernl for real
`demo/index.html` + `demo/tokens.css` — static, no build step, served over http
(`file://` makes even same-folder CSS origin-opaque to the walk). It is the manual
test bed, the T7 spike target, and **success check #4** (non-Vue proof). Its
fixture must contain the patterns kernl actually has: tokens inside an `@layer`
block, an `@media` override, an `@import`ed sheet, a component-scoped var (must be
skipped with the D3 counter), `--tw-*`-style noise, a `var()` reference, a
semicolon-inside-string value, and a dark-theme `[data-theme]` block.

### D8 — Test seam: CSSOM in production, pure string parsing only in test fixtures
Production extraction iterates CSSOM (D2) — the browser has already parsed
correctly. The pure-function layer (declaration filtering, classification,
active-definition matching, diff) is fed **authored fixture strings** in tests,
never jsdom's round-tripped `cssText` (which may drop custom props and make tests
vacuous). T2 runs a jsdom capability probe: if jsdom's CSSOM can't carry custom
properties even for walking, swap the DOM test environment to `happy-dom` and
note it in AGENTS.md. Adversarial fixtures (semicolon-in-string, comments) are
part of T1's suite.

### D9 — Skill distribution: lives in-repo, symlinked into the agent
`skills/tweaks/SKILL.md` is versioned here (it *is* half the product). Install for
v1 = symlink into `~/.claude/skills/tweaks` (documented in README). Marketplace /
plugin packaging is a v2+ concern.

### D10 — `design.md` is the skill's cache, produced in the target app (kept simple)
Setup mode writes a `design.md` in the target app's repo: the token inventory
(name → kind → value(s) → definition file:line). Next setup invocation reads it;
if it's missing or stale, **rescan and rewrite wholesale** — no per-entry
revalidation machinery, no role-guessing.

### D11 — Bookmarklet: out of v1 (SCOPE self-contradiction resolved, not silently)
SCOPE's v1 table still listed "bookmarklet (zero setup)" as an injection mode,
while its own "Later" section (added later, PR #1) re-decided the bookmarklet as a
future *emergency* mode. This plan resolves the contradiction in favor of the
newer decision: **v1 injection = dev-only snippet only**, and this PR amends the
stale SCOPE table row. (Cost of adding it later stays near-zero: same artifact,
different wrapper.)

### D12 — Reset (per-var + reset-all) is IN, recorded as a deliberate addition
Not in SCOPE's table. Kept because an editing panel without undo forces a page
reload to recover from any experiment, mid-session — that fights the product's
whole point — and the cost is a few lines on `state.ts`. **Reset semantics**: at
init, snapshot any *pre-existing* inline `--*` values on `documentElement` (theme
managers set these); reset restores the snapshot value, and only uses
`removeProperty` when there was none.

### D13 — Noise filtering: root-only + internal-prefix denylist, usability-gated
Tailwind/daisyUI emit framework-internal vars alongside real tokens. v1 filter:
D3's root-only rule (kills element-scoped noise like `--tw-*` utilities and Vue
hash vars) plus a small denylist of known-internal root prefixes (`--tw-`,
`--un-`). kernl's ~60 `@theme` tokens all survive — they *are* the design tokens.
If T15 finds the panel unusable at that count even with folders+collapse, the
parked fallback is a prefix-allowlist init option (`IDEAS.md`) — not built
preemptively.

**Gate outcome (2026-07-18): failed at kernl scale** — daisyUI floods `:root`
with 177 unprefixed tokens (~220 controls, 6754px panel), which no denylist can
enumerate. Both parked fallbacks are now built: `window.LiveTweaksConfig =
{ allow: [...] }` (pre-declared before the script loads; prefixes or exact
names; supersedes the denylist when present) and an internal-scroll cap on the
host (`max-height: 70vh`). Config arrives via a pre-declared global because the
IIFE auto-mounts — there is no init call to pass options to, and the same shape
works for both injection paths. Match rule: a trailing-dash entry is a prefix,
anything else is exact — prefix-matching exact names re-admitted daisyUI's
suffixed variants on kernl (104 names → 227 matches), measured on the built
artifact, invisible to unit tests.

### D14 — Build emits `iife` + `es`; UMD is forbidden
The script-tag/bookmarklet artifact stays IIFE. Bundler users get a real ESM
entry (`import('live-tweaks')` executing an IIFE as side-effect-only ESM works,
but only by accident — and would break the day the build emitted a UMD/`this`
wrapper). Task: `formats: ["iife", "es"]` in `vite.config.ts` + proper
`exports`/`module` fields in `package.json`. Dev-gating pattern documented:
`if (import.meta.env.DEV) import('live-tweaks')`.

## 2 · Architecture

```
src/
  main.ts            entry: idempotency guard (double-injection = no-op),
                     orchestrates extract → classify → panel mount; exposes
                     window.LiveTweaks {dump(), rescan()}
  extract.ts         recursive stylesheet walk (D2) → RawToken[] {name, definitions:
                     [{rawValue, selector, sheet, rootLevel}]} + activeValue (trimmed)
                     + skipped-sheet/token counters
  classify.ts        RawToken → Token {kind: color|font-family|length|other} (D5)
  state.ts           TweakSession: baseline (raw+resolved per token, D4), inline
                     pre-existing snapshot (D12), overrides, diff(), reset/resetAll
  apply.ts           setProperty/removeProperty on documentElement (D12 semantics)
  export.ts          diff → contract JSON (§4); clipboard w/ rejection fallback
  panel/
    host.ts          Shadow DOM host element (position, z-index, open shadow root)
    panel.ts         TweaksPanel interface + Tweakpane impl (style-clone workaround
                     and all Tweakpane knowledge live here and nowhere else)
demo/
  index.html + tokens.css   kernl-mirroring static fixture page (D7)
skills/
  tweaks/SKILL.md    setup + implement modes
```

Data flow: `extract → classify → state.baseline → panel controls → (user edit) →
apply + state.overrides → (Save) → export(state.diff())`.

Everything left of `panel/` is framework-free, DOM-light, unit-tested (TDD).
`panel/` is the only Tweakpane-aware layer and is verified on the demo page — a
**recorded TDD exemption** (AGENTS.md), compensated by the T7 spike gate and the
human checkpoints at T9/T15/T16.

## 3 · Phases and tasks

Tasks T1–T17; `BACKLOG.md` is the drain queue with dependencies and verify steps.
After P1, **Track A** (panel, P2–P4) and **Track B** (skill, P5) are independent —
they share only §4 + D3/D10, all pinned here. Process: one branch per track;
AGENTS.md's review gate applies per branch, pre-push.

### P1 — Extraction core (the testable heart)
- **T1** `extract.ts` walker per D2 (recursive rule-type switch, imports,
  adoptedStyleSheets, cross-origin counters, CSSOM iteration) + pure declaration
  filters. TDD with authored-string + jsdom fixtures, incl. adversarial values.
- **T2** active-value resolution (trimmed), root-level flagging, multi-definition
  dedupe, and the **`before` algorithm** (§4) — incl. the authored≠computed test
  (`#B4C5FE` vs `rgb(…)` via a var() chain) and the jsdom capability probe (D8).
- **T3** `classify.ts` per D5. Table-driven tests.
- **T4** `state.ts` per D12 + `diff()` in contract format. TDD.

### P2 — Panel shell (Track A)
- **T5** `apply.ts` + `main.ts` + build config (D14: dual format, exports map):
  console build first — `window.LiveTweaks.dump()` prints the token table on a
  real page. Verify: dump on the demo page lists exactly the fixture's root
  tokens with correct kinds and counters.
- **T6** demo fixture per D7.
- **T7** **SPIKE/GATE (~2h box)** — Tweakpane v4 in Shadow DOM on the demo page:
  mount, style-clone, and D1's interaction criteria (picker popup click-drag,
  keyboard focus). Outcome recorded in AGENTS.md; fail → native-inputs fallback.
- **T8** `panel/host.ts` + `panel/panel.ts`: floating host, folders per kind,
  controls per D5, "Rescan" button (re-runs the pipeline — lazy-loaded routes
  inject styles after panel load; a MutationObserver auto-rescan is `IDEAS.md`).

### P3 — Live editing (Track A)
- **T9** edit wiring: control change → apply → state; per-var reset + reset-all
  (D12). **HUMAN CHECKPOINT**: SCOPE success-check #2 on the demo page.

### P4 — Save / export (Track A)
- **T10** `export.ts`: Save → §4 JSON → clipboard (fallback modal on *rejection*,
  not just API absence). Unit-verify: session with 2 edits + 1 reset exports
  exactly the 2, `before` = raw authored text.

### P5 — The `/tweaks` skill (Track B)
- **T11** `skills/tweaks/SKILL.md` — *setup*, token-having paths: read `design.md`
  if present, else scan source and write it (D10); end by printing injection
  instructions (script tag / D14 dev-gated import).
- **T12** *setup*, no-vars path: detect hardcoded values, explain the constraint
  (SCOPE: "No CSS vars → no product"), offer the interactive refactor-to-vars
  path (file-by-file, small diffs). Verified against a hardcoded-colors fixture.
- **T13** *implement* mode: parse diff JSON, locate definitions, apply the D3
  anchor rule (ambiguous → stop and ask), edit, show diff summary.
- **T14** `README.md`: what/install (npm + skill symlink)/inject snippets/
  limitations (D4, D6, CSP, rescan). Minimal and honest; polish at `/public-repo`.

### P6 — Validation + release
- **T15** kernl end-to-end (SCOPE checks 1–3). kernl lives at
  `~/repositories/kernl` (web app under `web/` — run per kernl's own AGENTS.md).
  **HUMAN CHECKPOINT** for the visual steps; every breakage fixed with a
  regression test. D13 usability gate evaluated here.
- **T16** demo-page end-to-end (SCOPE check 4). **HUMAN CHECKPOINT.**
- **T17** release: manual first `npm publish` as **v1.0.0** (2FA), then configure
  npm Trusted Publisher per AGENTS.md; subsequent releases via tag workflow.

## 4 · The contract (diff JSON)

Exactly SCOPE.md's shape — a flat map, no envelope (YAGNI; the consumer is an
agent, a tolerant reader):

```json
{
  "--color-primary": { "before": "#8839ef", "after": "#e07850" },
  "--font-body":     { "before": "Inter, sans-serif", "after": "system-ui, sans-serif" }
}
```

- Keys: var names verbatim (leading `--`). Tokens reset to baseline never appear.
- **`before` — the anchor, produced by this algorithm (T2), pinned because both
  tracks implement against it:**
  1. Token has exactly one root-level definition → `before` = that definition's
     raw authored text, trimmed.
  2. Multiple definitions → `before` = raw text of the definition whose value —
     after trimming and, for `var()` refs, after substitution via computed
     values — textually matches the active computed value. (Unregistered custom
     properties are not canonicalized by the engine, which is what makes textual
     matching feasible.)
  3. No raw source available (cross-origin, JS-set inline) or no match →
     `before` = the trimmed *computed* value. Safe by construction: the skill's
     "no source match → stop and ask" rule catches it on the other side.
- `after`: the literal value the user ended on.
- Any change to this shape after v1 must version both sides in the same commit.

## 5 · Risks (updated post-review)

| Risk | Tripwire | Mitigation |
|---|---|---|
| Tweakpane Shadow-DOM workaround or popup interaction breaks | T7 spike fails; later upgrade regresses | pinned 4.0.5; `TweaksPanel` interface → native-inputs fallback |
| jsdom can't carry custom props even for walking | T2 probe fails | authored-string seam (D8); `happy-dom` swap, noted in AGENTS.md |
| Panel unusable at kernl's ~60-token count | T15 (D13 gate) | folders+collapse first; prefix-allowlist option parked in IDEAS.md |
| kernl still surprises us (CSS-in-JS-ish output, CSP, lazy styles) | T15 | T6 fixture already mirrors known patterns; Rescan button (T8); T15 budgeted as real work, not a demo |

## 6 · Out of plan (guarded)

Bookmarklet wrapper (D11), dev-server round-trip, icon swap, layer 2 (Onlook
gate), webfont loading (D6), unclassified-var editing (D5), scoped-var editing
(D3), auto-rescan observer, prefix allowlist (D13) — all in `SCOPE.md` /
`IDEAS.md`, none scheduled. If implementation drifts toward any of these: STOP,
flag, re-plan.
