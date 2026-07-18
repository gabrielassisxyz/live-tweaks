# live-tweaks — ideas (unplanned captures)

> Capture per `planning-pipeline.md`: one line each, no design. `🎯` = committed,
> waiting for a planning round. Planned work lives in `BACKLOG.md`, never here.

- Raw-text editing group for unclassified vars (the D5 "other" bucket) — cheap, but out of v1.
- Google Fonts loader: inject a `fonts.googleapis` `<link>` when a picked font isn't loaded (D6).
- Bookmarklet wrapper as emergency injection mode (SCOPE "Later" — preview-only on third-party pages).
- Dev-server round-trip: panel POSTs diff to a Vite-plugin endpoint that writes source + HMR (SCOPE v2).
- Icon swap via paste SVG/base64 (SCOPE v2 — needs DOM→source mapping).
- Layer 2 (LLM layout edits on-page) — gated on running Onlook for an afternoon first (SCOPE).
- Scoped-var editing (non-`:root` tokens, e.g. kernl's `--focus-*`): inject a last-in-document rule with the original selector (PLAN D3 skips these in v1).
- Prefix-allowlist init option for noisy token sets (PLAN D13 fallback if kernl's ~60 tokens prove unusable).
- Auto-rescan via `MutationObserver` on `head` (v1 ships a manual Rescan button).
- Panel `max-height` + internal scroll on the host (T15: kernl's panel is 6754px tall / ~220 controls, overflows the viewport ~7.5x and the collapse headers land off-screen — a smaller D13 mitigation than the prefix-allowlist).
- Noise filter misses framework tokens with no `--tw-`/`--un-` prefix (T15: daisyUI floods `:root` with `--radius-*`, `--size-*`, `--radialprogress`, `--color-black`, oklch palette — reinforces the prefix-allowlist need since a denylist can't enumerate them).
- daisyUI shadows kernl's `@theme` colors at runtime with `oklch()` values (T15: live `--color-primary` = `oklch(...)`, not source `#b4c5fe`); Tweakpane 4.0.5 renders oklch strings as plain text inputs (no swatch) and such tokens can't round-trip (computed `before` has no source match → implement stops-and-asks).
