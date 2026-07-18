// T8 — the floating Shadow DOM host (PLAN §2). Pure DOM plumbing: position,
// z-index, an open shadow root (Tweakpane needs "open", not "closed" — T7
// spike, D1), and the collapse chrome. No Tweakpane knowledge lives here —
// that is panel.ts's exclusive job (PLAN §2: "all Tweakpane usage lives in
// src/panel/ ... nothing outside panel/ may import tweakpane" — host.ts
// itself doesn't import it either, so panel.ts stays swappable behind the
// TweaksPanel interface without touching host.ts). The visual system lives
// in theme.ts; this file only builds the elements those classes style.
//
// Recorded TDD exemption (AGENTS.md): verified on the demo page, not unit
// tested.

import { HOST_CSS } from "./theme";

const HOST_ELEMENT_ID = "live-tweaks-host";
// The maximum value a CSS z-index can hold — outruns anything a host page's
// own UI (modals, toasts, sticky headers) could plausibly set.
const MAX_Z_INDEX = "2147483647";

const CHEVRON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;

export interface PanelHost {
	/** Open shadow root the panel implementation mounts Tweakpane into. */
	readonly shadowRoot: ShadowRoot;
	/** The collapsible body inside the shadow root — panel.ts's mount point. */
	readonly contentMount: HTMLElement;
	/** Removes the host element from the document. */
	destroy(): void;
}

/**
 * Creates and appends the host element: a `position: fixed` card pinned to
 * the bottom-right corner, with a clickable header that collapses/expands
 * the scrollable body below it. Idempotent by convention only — callers
 * (main.ts's `init()`) already guarantee at most one host per document via
 * the injection guard.
 */
export function createPanelHost(doc: Document = document): PanelHost {
	const host = doc.createElement("div");
	host.id = HOST_ELEMENT_ID;
	Object.assign(host.style, {
		all: "initial", // don't inherit the host page's font/color/etc.
		position: "fixed",
		right: "16px",
		bottom: "16px",
		zIndex: MAX_Z_INDEX,
	});

	const shadowRoot = host.attachShadow({ mode: "open" });

	const style = doc.createElement("style");
	style.textContent = HOST_CSS;
	shadowRoot.append(style);

	const panel = doc.createElement("div");
	panel.className = "lt-panel";

	const header = doc.createElement("div");
	header.className = "lt-header";
	header.setAttribute("role", "button");
	header.setAttribute("tabindex", "0");
	header.setAttribute("aria-expanded", "true");

	const title = doc.createElement("span");
	title.textContent = "live-tweaks";
	const chevron = doc.createElement("span");
	chevron.className = "lt-chevron";
	chevron.innerHTML = CHEVRON_SVG;
	header.append(title, chevron);

	const body = doc.createElement("div");
	body.className = "lt-body";

	let collapsed = false;
	function toggle(): void {
		collapsed = !collapsed;
		body.style.display = collapsed ? "none" : "";
		panel.classList.toggle("lt-collapsed", collapsed);
		header.setAttribute("aria-expanded", String(!collapsed));
	}
	header.addEventListener("click", toggle);
	header.addEventListener("keydown", (event) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			toggle();
		}
	});

	panel.append(header, body);
	shadowRoot.append(panel);
	doc.body.append(host);

	return {
		shadowRoot,
		contentMount: body,
		destroy: () => host.remove(),
	};
}
