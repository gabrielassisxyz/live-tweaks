// T8 — the only module besides host.ts under src/panel/, and the only one
// that imports "tweakpane" (PLAN §2: "all Tweakpane usage lives in
// src/panel/ ... nothing outside panel/ may import tweakpane"). Everything
// it needs from the rest of the app arrives as plain data (`PanelToken[]`)
// and plain callbacks (`TweaksPanelCallbacks`) — it never reaches into
// state.ts/apply.ts directly, so swapping Tweakpane for the native-inputs
// fallback (D1's hedge) would only ever touch this one file.
//
// Recorded TDD exemption (AGENTS.md): verified on the demo page (T7 spike
// gate + T9/T15/T16 human checkpoints), not unit tested.

import { Pane } from "tweakpane";
import { findColorMatches } from "../color-match";
import { TWEAKPANE_CSS } from "./theme";

// Lucide's rotate-cw glyph — the per-row reset affordance (design brief:
// a reload icon on the value's right, not a full-width button row).
const RESET_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`;

// Lucide's pipette glyph — pick a pixel anywhere on the page, find the
// token(s) currently painting that color.
const PIPETTE_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg>`;

/** The EyeDropper API — typed locally because TypeScript's dom lib does not
 * ship it. Chromium-only, and privacy-focused Chromium forks (Brave) remove
 * it outright, so the pipette also carries an element-pick fallback. */
interface EyeDropperLike {
	open(): Promise<{ sRGBHex: string }>;
}

/** Fallback pick mode for browsers without EyeDropper: crosshair cursor,
 * one click anywhere on the page, resolve to that element's candidate
 * colors — computed background (walking up past transparent ancestors),
 * then text color. Escape or a click on the panel itself cancels. Not
 * pixel-perfect like the real eyedropper, but flat surfaces — the main
 * use case — resolve identically. */
function pickElementColors(doc: Document): Promise<string[] | undefined> {
	return new Promise((resolve) => {
		const crosshair = doc.createElement("style");
		crosshair.textContent = "* { cursor: crosshair !important; }";
		doc.head.append(crosshair);
		const cleanup = () => {
			crosshair.remove();
			doc.removeEventListener("click", onClick, true);
			doc.removeEventListener("keydown", onKey, true);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				cleanup();
				resolve(undefined);
			}
		};
		const onClick = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			cleanup();
			const target = event.target as Element | null;
			if (!target || target.closest("#live-tweaks-host")) {
				resolve(undefined); // clicking the panel is a cancel, not a pick
				return;
			}
			const view = doc.defaultView;
			if (!view) {
				resolve(undefined);
				return;
			}
			const candidates: string[] = [];
			for (
				let el: Element | null = target;
				el && el !== doc.documentElement;
				el = el.parentElement
			) {
				const bg = view.getComputedStyle(el).backgroundColor;
				if (bg && bg !== "transparent" && !/rgba\(.+,\s*0\)$/.test(bg)) {
					candidates.push(bg);
					break;
				}
			}
			candidates.push(view.getComputedStyle(target).color);
			resolve(candidates);
		};
		doc.addEventListener("click", onClick, true);
		doc.addEventListener("keydown", onKey, true);
	});
}

/** Normalizes an arbitrary CSS color (hex, oklch, named…) to the computed
 * `rgb(...)` string via a throwaway probe element — the DOM half of the
 * matcher; color-match.ts stays document-free. Returns the raw value when
 * the browser rejects it (the pure matcher then rejects it too). */
function normalizeCssColor(doc: Document, value: string): string {
	const probe = doc.createElement("div");
	probe.style.color = value;
	if (probe.style.color === "") return value;
	doc.body.append(probe);
	const computed = doc.defaultView?.getComputedStyle(probe).color ?? value;
	probe.remove();
	return computed;
}

/** A token ready for a control — "other"-kind tokens never reach the panel
 * (PLAN D5); main.ts's `panelTokens()` filters them out upstream. */
export type EditableKind = "color" | "font-family" | "length";

export interface PanelToken {
	readonly name: string;
	readonly kind: EditableKind;
	readonly value: string;
}

export interface TweaksPanelCallbacks {
	onChange(name: string, value: string): void;
	onReset(name: string): void;
	onResetAll(): void;
	onRescan(): void;
	/** Save (T10): export the session's diff and attempt the clipboard copy. */
	onSave(): void;
}

export interface TweaksPanel {
	/** (Re)renders the full token list — used for the initial mount and after
	 * a Rescan. `skippedSummary` is pre-formatted text (main.ts's D3/D5/D13
	 * counters); this module renders it verbatim, no counting logic here. */
	render(tokens: readonly PanelToken[], skippedSummary: string): void;
	/** Updates one control's displayed value without a full re-render — used
	 * after an external reset (per-var or reset-all) changes the DOM value
	 * out from under the control the user was looking at. */
	setValue(name: string, value: string): void;
	destroy(): void;
}

const KIND_ORDER: readonly EditableKind[] = ["color", "font-family", "length"];
const KIND_LABELS: Record<EditableKind, string> = {
	color: "Colors",
	"font-family": "Fonts",
	length: "Lengths",
};

// D6: a datalist of common system font stacks, always renders (no webfont
// loading in v1) — free text stays allowed alongside the suggestions.
const SYSTEM_FONT_STACKS = [
	"system-ui, sans-serif",
	'-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
	'Georgia, "Times New Roman", serif',
	'"Courier New", Courier, monospace',
	"ui-monospace, SFMono-Regular, monospace",
];

// T7 finding (AGENTS.md "Common hurdles"): clone by attribute *presence*, not
// by the specific string PLAN D1's example reads ("default") — the real
// 4.0.5 attribute value is "plugin-default", and pinning that literal would
// be exactly as fragile as the upstream bug (cocopon/tweakpane#535) this
// workaround exists to fix.
const TP_STYLE_SELECTOR = "style[data-tp-style]";

/**
 * cocopon/tweakpane#535: Tweakpane appends its `<style data-tp-style>`
 * elements to `document.head` (it resolves `ownerDocument`, which for a
 * shadow-root child is still the top document); those styles never cross the
 * shadow boundary on their own. Clone every not-yet-cloned one into the
 * shadow root — called after every (re)build, since a plugin (e.g. the color
 * picker's popup) can register its own sheet lazily, on first use.
 */
function cloneTweakpaneStyles(shadowRoot: ShadowRoot): void {
	for (const style of document.head.querySelectorAll(TP_STYLE_SELECTOR)) {
		const marker = style.getAttribute("data-tp-style");
		if (shadowRoot.querySelector(`style[data-tp-style="${marker}"]`)) {
			continue;
		}
		shadowRoot.append(style.cloneNode(true));
	}
	ensureThemeLast(shadowRoot);
}

/** The theme retunes Tweakpane's own classes at equal specificity, so it
 * only wins if its sheet comes *after* every cloned Tweakpane sheet.
 * Appending an already-attached node moves it, so calling this after each
 * clone pass keeps the theme last no matter how late a plugin sheet (e.g.
 * the color popup's) shows up. */
function ensureThemeLast(shadowRoot: ShadowRoot): void {
	let theme = shadowRoot.querySelector<HTMLStyleElement>(
		"style[data-lt-theme]",
	);
	if (!theme) {
		theme = document.createElement("style");
		theme.setAttribute("data-lt-theme", "");
		theme.textContent = TWEAKPANE_CSS;
	}
	shadowRoot.append(theme);
}

function groupByKind(
	tokens: readonly PanelToken[],
): Map<EditableKind, PanelToken[]> {
	const groups = new Map<EditableKind, PanelToken[]>();
	for (const token of tokens) {
		const group = groups.get(token.kind) ?? [];
		if (group.length === 0) groups.set(token.kind, group);
		group.push(token);
	}
	return groups;
}

// Tweakpane's public types re-export from "@tweakpane/core", a package this
// repo does not depend on — only "tweakpane" itself is pinned (PLAN D1) — so
// that .d.ts chain is unresolvable here and, under tsconfig's skipLibCheck,
// silently degrades to `any` rather than a compile error. Runtime
// correctness is verified empirically (T7 spike + T9/T15/T16 human-checkpoint
// evidence), the documented trade-off of the recorded panel/ TDD exemption
// (AGENTS.md).
// biome-ignore lint/suspicious/noExplicitAny: see comment above.
type TweakpaneAny = any;

/** Attaches the D6 system-font datalist to a font-family binding's real
 * `<input>` (`.tp-txtv_i`, T7 finding) so free text stays possible alongside
 * suggestions. A silent no-op if Tweakpane's DOM shape ever changes under us
 * — the binding itself still works, it just loses the suggestion list. */
function attachFontDatalist(
	binding: TweakpaneAny,
	mount: HTMLElement,
	tokenName: string,
): void {
	const input: HTMLInputElement | null =
		binding.element.querySelector(".tp-txtv_i");
	if (!input) return;
	const doc = mount.ownerDocument;
	const datalistId = `live-tweaks-fonts-${tokenName.replace(/[^a-z0-9]/gi, "-")}`;
	const datalist = doc.createElement("datalist");
	datalist.id = datalistId;
	for (const stack of SYSTEM_FONT_STACKS) {
		const option = doc.createElement("option");
		option.value = stack;
		datalist.append(option);
	}
	mount.append(datalist);
	input.setAttribute("list", datalistId);
}

interface Control {
	readonly params: { value: string };
	readonly binding: TweakpaneAny;
}

/**
 * Tweakpane implementation of `TweaksPanel`. `contentMount`/`shadowRoot` come
 * from `createPanelHost()` (host.ts); this function owns everything inside
 * the mount, including disposing and rebuilding the whole `Pane` on every
 * `render()` — simplest correct behavior for the Rescan case (PLAN T8: the
 * token set can change shape entirely between scans), and cheap enough for a
 * dev tool with at most a few dozen controls.
 */
export function createTweaksPanel(
	contentMount: HTMLElement,
	shadowRoot: ShadowRoot,
	callbacks: TweaksPanelCallbacks,
): TweaksPanel {
	let pane: TweakpaneAny;
	const controls = new Map<string, Control>();

	function addControl(folder: TweakpaneAny, token: PanelToken): void {
		const params = { value: token.value };
		// Display without the "--" prefix (design brief) — every custom
		// property carries it, so it is pure noise on-screen; the full name
		// stays in the reset button's title/aria and in every callback.
		const binding = folder.addBinding(params, "value", {
			label: token.name.replace(/^--/, ""),
		});
		binding.on("change", (ev: { value: unknown }) => {
			callbacks.onChange(token.name, String(ev.value));
		});
		controls.set(token.name, { params, binding });

		if (token.kind === "font-family") {
			attachFontDatalist(binding, contentMount, token.name);
		}

		// Reset lives inside the binding's own row (design brief: an icon on
		// the value's right, not a second full-width row per token). A silent
		// degrade if Tweakpane's row shape ever changes: the control still
		// works, the token just loses its inline reset.
		const row: HTMLElement | null = binding.element;
		if (row) {
			const doc = row.ownerDocument;
			const reset = doc.createElement("button");
			reset.className = "lt-reset";
			reset.title = `Reset ${token.name}`;
			reset.setAttribute("aria-label", `Reset ${token.name}`);
			reset.innerHTML = RESET_ICON_SVG;
			reset.addEventListener("click", () => callbacks.onReset(token.name));
			row.append(reset);
		}
	}

	/** Scrolls to and flashes every row whose current color equals the first
	 * matching candidate (eyedropper mode passes one pixel color; element
	 * mode passes background-then-text); a transient summary-line message
	 * when nothing matches. */
	function locateColor(
		doc: Document,
		candidates: readonly string[],
		summaryEl: HTMLElement,
		summaryText: string,
	): void {
		const resolved = Array.from(controls.entries()).map(([name, control]) => ({
			name,
			resolvedValue: normalizeCssColor(doc, control.params.value),
		}));
		const matches =
			candidates
				.map((candidate) => findColorMatches(candidate, resolved))
				.find((found) => found.length > 0) ?? [];
		if (matches.length === 0) {
			summaryEl.textContent = "No token matches that color";
			setTimeout(() => {
				summaryEl.textContent = summaryText;
			}, 2200);
			return;
		}
		const reduceMotion =
			doc.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches ??
			false;
		matches.forEach((name, index) => {
			const row: HTMLElement | null | undefined =
				controls.get(name)?.binding.element;
			if (!row) return;
			if (index === 0) {
				row.scrollIntoView({
					block: "center",
					behavior: reduceMotion ? "auto" : "smooth",
				});
			}
			row.classList.add("lt-flash");
			setTimeout(() => row.classList.remove("lt-flash"), 1800);
		});
	}

	/** The pipette renders everywhere: pixel-perfect via the EyeDropper API
	 * where it exists, the element-pick fallback otherwise (Firefox, and
	 * Brave, which removes the API). */
	function addPipetteButton(
		doc: Document,
		toolbar: HTMLElement,
		summaryEl: HTMLElement,
		summaryText: string,
	): void {
		const EyeDropperCtor = (
			globalThis as { EyeDropper?: new () => EyeDropperLike }
		).EyeDropper;
		const button = doc.createElement("button");
		button.className = "lt-btn lt-btn-icon";
		button.title = "Pick a color on the page to find its token";
		button.setAttribute(
			"aria-label",
			"Pick a color on the page to find its token",
		);
		button.innerHTML = PIPETTE_ICON_SVG;
		button.addEventListener("click", async () => {
			let candidates: readonly string[];
			if (EyeDropperCtor) {
				try {
					candidates = [(await new EyeDropperCtor().open()).sRGBHex];
				} catch {
					return; // the user dismissed the eyedropper
				}
			} else {
				button.classList.add("lt-btn-icon-active");
				const picked = await pickElementColors(doc);
				button.classList.remove("lt-btn-icon-active");
				if (!picked) return; // canceled
				candidates = picked;
			}
			locateColor(doc, candidates, summaryEl, summaryText);
		});
		toolbar.append(button);
	}

	function render(tokens: readonly PanelToken[], skippedSummary: string): void {
		pane?.dispose();
		contentMount.innerHTML = "";
		controls.clear();

		const doc = contentMount.ownerDocument;
		const skipInfo = doc.createElement("div");
		skipInfo.className = "lt-summary";
		skipInfo.textContent = skippedSummary;
		contentMount.append(skipInfo);

		// The three panel-wide actions are plain buttons in chrome this module
		// owns — one row, Save as the primary — instead of stacked Tweakpane
		// button blades.
		const toolbar = doc.createElement("div");
		toolbar.className = "lt-toolbar";
		const addAction = (
			label: string,
			primary: boolean,
			onClick: () => void,
		) => {
			const button = doc.createElement("button");
			button.className = primary ? "lt-btn lt-btn-primary" : "lt-btn";
			button.textContent = label;
			button.addEventListener("click", onClick);
			toolbar.append(button);
		};
		addAction("Save", true, () => callbacks.onSave());
		addAction("Rescan", false, () => callbacks.onRescan());
		addAction("Reset all", false, () => callbacks.onResetAll());
		addPipetteButton(doc, toolbar, skipInfo, skippedSummary);
		contentMount.append(toolbar);

		const paneMount = doc.createElement("div");
		contentMount.append(paneMount);

		pane = new Pane({ container: paneMount });
		cloneTweakpaneStyles(shadowRoot);

		const byKind = groupByKind(tokens);
		for (const kind of KIND_ORDER) {
			const kindTokens = byKind.get(kind);
			if (!kindTokens || kindTokens.length === 0) continue;
			const folder = pane.addFolder({ title: KIND_LABELS[kind] });
			for (const token of kindTokens) addControl(folder, token);
		}

		cloneTweakpaneStyles(shadowRoot);
	}

	return {
		render,
		setValue(name, value) {
			const control = controls.get(name);
			if (!control) return;
			control.params.value = value;
			control.binding.refresh();
		},
		destroy() {
			pane?.dispose();
		},
	};
}
