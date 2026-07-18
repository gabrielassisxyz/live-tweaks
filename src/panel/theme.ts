// The panel's visual system (D13 usability round 2): one place for every
// color/type/spacing decision, exported as two stylesheets because the two
// halves have different owners — HOST_CSS styles the chrome host.ts builds
// (panel shell, header, scroll body) and knows nothing of Tweakpane;
// TWEAKPANE_CSS retunes Tweakpane 4.0.5's own classes and belongs to
// panel.ts, the only module allowed Tweakpane knowledge. Class-name
// targeting of .tp-* internals is acceptable because the dependency is
// pinned (PLAN D1); any upgrade already requires a real-browser recheck.
//
// Direction (design brief, 2026-07-18): light card floating over the app —
// warm-neutral ground, one muted teal accent doing one job (primary action
// + focus), system-ui at readable sizes, values in mono, thin quiet
// scrollbar. Depth from hairlines and one moderate elevation shadow.

const TOKENS = /* css */ `
	.lt-panel {
		--lt-bg: #faf9f7;
		--lt-surface: #f0eeea;
		--lt-surface-hover: #e8e5df;
		--lt-text: #1b1b1e;
		--lt-text-muted: #6e6d75;
		--lt-hairline: #e6e3dd;
		--lt-accent: #4a9585;
		--lt-accent-strong: #428578;
		--lt-font: system-ui, -apple-system, "Segoe UI", sans-serif;
		--lt-mono: ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas,
			monospace;
	}
`;

export const HOST_CSS = /* css */ `
${TOKENS}
	.lt-panel {
		font-family: var(--lt-font);
		width: 380px;
		max-width: calc(100vw - 32px);
		background: var(--lt-bg);
		color: var(--lt-text);
		border: 1px solid var(--lt-hairline);
		border-radius: 14px;
		box-shadow: 0 12px 28px rgba(23, 23, 26, 0.16);
		overflow: hidden;
	}

	.lt-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 13px 16px 11px;
		cursor: pointer;
		user-select: none;
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.lt-header:focus-visible {
		outline: 2px solid var(--lt-accent);
		outline-offset: -2px;
	}

	.lt-chevron {
		display: inline-flex;
		color: var(--lt-text-muted);
		transition: transform 160ms ease-out;
	}
	.lt-chevron svg {
		width: 16px;
		height: 16px;
	}
	.lt-collapsed .lt-chevron {
		transform: rotate(-90deg);
	}
	@media (prefers-reduced-motion: reduce) {
		.lt-chevron {
			transition: none;
		}
	}

	.lt-body {
		max-height: 70vh;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
		scrollbar-color: #d8d5ce transparent;
	}
	.lt-body::-webkit-scrollbar {
		width: 8px;
	}
	.lt-body::-webkit-scrollbar-track {
		background: transparent;
	}
	.lt-body::-webkit-scrollbar-thumb {
		background: #d8d5ce;
		border-radius: 8px;
		border: 2px solid transparent;
		background-clip: content-box;
	}
	.lt-body::-webkit-scrollbar-thumb:hover {
		background-color: #c5c1b8;
	}
`;

export const TWEAKPANE_CSS = /* css */ `
	.lt-summary {
		padding: 0 16px 10px;
		font-size: 11.5px;
		line-height: 1.4;
		color: var(--lt-text-muted);
	}

	.lt-toolbar {
		display: flex;
		gap: 8px;
		padding: 0 16px 14px;
		border-bottom: 1px solid var(--lt-hairline);
	}
	.lt-btn {
		height: 30px;
		padding: 0 14px;
		border: 1px solid var(--lt-hairline);
		border-radius: 8px;
		background: var(--lt-bg);
		color: var(--lt-text);
		font-family: var(--lt-font);
		font-size: 12.5px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 140ms ease-out, border-color 140ms ease-out;
	}
	.lt-btn:hover {
		background: var(--lt-surface);
	}
	.lt-btn:focus-visible {
		outline: 2px solid var(--lt-accent);
		outline-offset: 2px;
	}
	.lt-btn-primary {
		flex: 1;
		background: var(--lt-accent);
		border-color: var(--lt-accent);
		color: #ffffff;
	}
	.lt-btn-primary:hover {
		background: var(--lt-accent-strong);
		border-color: var(--lt-accent-strong);
	}

	.lt-reset {
		flex: 0 0 auto;
		width: 26px;
		height: 26px;
		margin-left: 6px;
		border: none;
		border-radius: 7px;
		background: transparent;
		color: var(--lt-text-muted);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		/* A column of a hundred identical icons is noise — surface each row's
		   reset only when that row is engaged (hover or keyboard focus). */
		opacity: 0;
		transition: background-color 140ms ease-out, color 140ms ease-out,
			opacity 140ms ease-out;
	}
	.tp-lblv:hover .lt-reset,
	.tp-lblv:focus-within .lt-reset {
		opacity: 1;
	}
	.lt-reset:hover {
		background: var(--lt-surface);
		color: var(--lt-text);
	}
	.lt-reset:focus-visible {
		outline: 2px solid var(--lt-accent);
		outline-offset: 1px;
	}
	.lt-reset svg {
		width: 14px;
		height: 14px;
	}

	/* --- Tweakpane retune (pinned 4.0.5) --- */

	.tp-rotv {
		--tp-base-background-color: var(--lt-bg);
		--tp-base-shadow-color: rgba(23, 23, 26, 0.18);
		--tp-button-background-color: var(--lt-surface);
		--tp-button-background-color-active: var(--lt-surface-hover);
		--tp-button-background-color-focus: var(--lt-surface-hover);
		--tp-button-background-color-hover: var(--lt-surface-hover);
		--tp-button-foreground-color: var(--lt-text);
		--tp-container-background-color: transparent;
		--tp-container-background-color-active: transparent;
		--tp-container-background-color-focus: transparent;
		--tp-container-background-color-hover: transparent;
		--tp-container-foreground-color: var(--lt-text-muted);
		--tp-groove-foreground-color: var(--lt-hairline);
		--tp-input-background-color: var(--lt-surface);
		--tp-input-background-color-active: var(--lt-surface-hover);
		--tp-input-background-color-focus: var(--lt-surface-hover);
		--tp-input-background-color-hover: var(--lt-surface-hover);
		--tp-input-foreground-color: var(--lt-text);
		--tp-label-foreground-color: var(--lt-text);
		font-family: var(--lt-font);
	}

	/* Group headers as quiet uppercase eyebrows (reference: the "THEME"
	   label) — the collapse mark stays, the indent strip goes. */
	.tp-fldv_b {
		background: transparent;
		height: auto;
		padding: 14px 16px 4px;
	}
	.tp-fldv_b:hover,
	.tp-fldv_b:focus,
	.tp-fldv_b:active {
		background: transparent;
	}
	.tp-fldv_t {
		flex: 0 0 auto;
		padding: 0;
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--lt-text-muted);
	}
	.tp-fldv_i {
		display: none;
	}
	/* Tweakpane's stock fold mark reads as broken tick marks on a light
	   ground — replace it with a drawn chevron next to the eyebrow. */
	.tp-fldv_b {
		display: flex;
		align-items: center;
	}
	.tp-fldv_m {
		display: none;
	}
	.tp-fldv_b::after {
		content: "";
		width: 6px;
		height: 6px;
		margin-left: 8px;
		margin-top: -4px;
		border-right: 1.6px solid var(--lt-text-muted);
		border-bottom: 1.6px solid var(--lt-text-muted);
		transform: rotate(45deg);
		transition: transform 160ms ease-out;
	}
	.tp-fldv:not(.tp-fldv-expanded) > .tp-fldv_b::after {
		transform: rotate(-45deg);
		margin-top: 0;
	}
	@media (prefers-reduced-motion: reduce) {
		.tp-fldv_b::after {
			transition: none;
		}
	}
	.tp-fldv.tp-cntv,
	.tp-fldv_c {
		border: none;
		padding: 0;
		margin: 0;
	}

	/* Rows: taller, breathing, label readable, value column fixed. */
	.tp-lblv {
		display: flex;
		align-items: center;
		min-height: 34px;
		padding: 2px 16px;
	}
	.tp-lblv_l {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
		padding: 0;
		color: var(--lt-text);
	}
	.tp-lblv_v {
		flex: 0 0 auto;
		width: 138px;
	}

	/* Inputs: soft wells, mono values, comfortable height. */
	.tp-txtv_i {
		height: 26px;
		border-radius: 7px;
		font-family: var(--lt-mono);
		font-size: 12px;
	}
	.tp-colswv {
		width: 26px;
		height: 26px;
	}
	.tp-colswv_sw,
	.tp-colswv_b {
		border-radius: 7px;
	}
	.tp-colswv_sw {
		box-shadow: inset 0 0 0 1px rgba(23, 23, 26, 0.12);
	}
	.tp-colv_h {
		gap: 6px;
	}

	.tp-popv {
		border-radius: 10px;
	}
`;
