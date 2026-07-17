# live-tweaks — scope

> A live design-tweaks widget you inject into **your own** running app: edit CSS design
> tokens (colors, fonts) in a floating panel, watch the UI update as you type, then
> round-trip the changes back into your source code via an agent skill (`/tweaks`).
> Open-source, framework-agnostic.
>
> Origin: "IDEA FODA" (2026-07-16), gate-⑤-resolved 2026-07-17 in
> `llm-workflow/IDEAS.md` — read that entry for the full prior-art verdict.

## The itch (why this exists)

Tools like realtimecolors.com nail live color editing — **on their own demo template**.
The Claude-design tweaks menu nails the UX — **on Claude's app only**. Nothing
open-source lets you tweak the design of *the thing you are actually building*, live,
and then persist the result to source. That delta is this tool's entire scope.

## The load-bearing constraint

Live editing is trivial **iff** the app's design is driven by CSS custom properties:

```js
document.documentElement.style.setProperty('--color-primary', '#E07850')
```

One line, instant, framework-agnostic, survives re-renders (the vars live on `:root`;
the framework doesn't own them). **No CSS vars → no product** — which is why setup
(extract/refactor into vars) is a mandatory first-class step, not a nicety.

## v1 scope (in)

| Piece | What it does |
|---|---|
| **Skill `tweaks` — setup** (first invocation) | Reads `design.md` if present; else extracts and maps the app's CSS custom properties; else (hardcoded colors) tells the user live-editing is impossible until tokens exist and offers to refactor into CSS vars. |
| **Panel injection** | A dev-only `<script>` that reads every CSS var from the stylesheets and renders a floating edit panel in a **Shadow DOM** (no style collisions). Injection: bookmarklet (zero setup) or dev-only `index.html` snippet. |
| **Live editing** | Colors + fonts (incl. icon **color/size** — it's CSS). Each var gets a picker; edits call `setProperty` as you type. |
| **Save → round-trip** | Panel tracks a before/after diff (`{ '--color-primary': {before, after} }`), **Save** serializes it to JSON; user pastes it into `/tweaks implement <map>`; the agent greps each var's definition in source and swaps the value. Mechanical, low-risk. |

**First target app: kernl (Vue).** Nothing may depend on Vue — kernl is the guinea pig
that proves "any app with CSS vars" works.

**Possible building block:** [Tweakpane](https://tweakpane.github.io/docs/) as the
panel UI (params pane, MIT) instead of hand-rolling pickers — evaluate before writing
panel code. It is *not* prior art for the product (no CSS-var auto-extraction, no
source round-trip).

## v2 (out of v1, decided)

- **Dev-server round-trip**: panel `POST`s the diff to a tiny dev-server endpoint
  (Vite plugin middleware) that writes the file; HMR reflects it. v1 stays copy-paste
  on purpose — bundler-agnostic, keeps the skill decoupled from the server.
- **Icon swap** (paste SVG / base64 / `<img src>`): live preview is easy
  (`el.outerHTML`), but manual DOM surgery is clobbered by the next re-render/HMR, and
  writing it back needs DOM→source mapping — layer-2 machinery, not CSS-var machinery.

## Layer 2 (gated — not scheduled)

Ask an LLM for **layout/structure** changes directly on the page (point-and-iterate
instead of chat-and-wait). Requires build-time instrumentation (Babel plugin tagging
elements with source origin) — a different, much bigger animal.
**Gate:** run [Onlook](https://github.com/onlook-dev/onlook) for an afternoon first;
only reopen if a concrete delta survives (framework-agnostic, embedded in Gabriel's
own agent loop, not a separate design IDE). Do not let layer 2 eat v1.

## Success check (v1 is done when)

1. On kernl: invoke `/tweaks` setup → panel appears over the running app.
2. Change a color + a font in the panel → the real UI updates live as you type.
3. Save → paste map into `/tweaks implement` → source files updated → reload shows
   the same design without the panel.
4. Repeat steps 1–3 on one non-Vue app (any static page with CSS vars) to prove
   framework-agnosticism.
