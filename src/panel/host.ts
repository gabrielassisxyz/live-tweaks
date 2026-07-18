// T8 — the floating Shadow DOM host (PLAN §2). Pure DOM plumbing: position,
// z-index, an open shadow root (Tweakpane needs "open", not "closed" — T7
// spike, D1), and the collapse chrome. No Tweakpane knowledge lives here —
// that is panel.ts's exclusive job (PLAN §2: "all Tweakpane usage lives in
// src/panel/ ... nothing outside panel/ may import tweakpane" — host.ts
// itself doesn't import it either, so panel.ts stays swappable behind the
// TweaksPanel interface without touching host.ts).
//
// Recorded TDD exemption (AGENTS.md): verified on the demo page, not unit
// tested.

const HOST_ELEMENT_ID = "live-tweaks-host";
// The maximum value a CSS z-index can hold — outruns anything a host page's
// own UI (modals, toasts, sticky headers) could plausibly set.
const MAX_Z_INDEX = "2147483647";

export interface PanelHost {
	/** Open shadow root the panel implementation mounts Tweakpane into. */
	readonly shadowRoot: ShadowRoot;
	/** The collapsible body inside the shadow root — panel.ts's mount point. */
	readonly contentMount: HTMLElement;
	/** Removes the host element from the document. */
	destroy(): void;
}

/**
 * Creates and appends the host element: a `position: fixed` box pinned to the
 * bottom-right corner, with a clickable header that collapses/expands the
 * body below it. Idempotent by convention only — callers (main.ts's `init()`)
 * already guarantee at most one host per document via the injection guard.
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

	const panel = doc.createElement("div");
	Object.assign(panel.style, {
		fontFamily: "system-ui, sans-serif",
		width: "380px",
		maxWidth: "calc(100vw - 32px)", // never overflow a narrow viewport

		boxShadow: "0 2px 12px rgba(0, 0, 0, 0.35)",
		borderRadius: "6px",
		overflow: "hidden",
	});

	const header = doc.createElement("div");
	header.textContent = "live-tweaks";
	header.setAttribute("role", "button");
	header.setAttribute("aria-expanded", "true");
	Object.assign(header.style, {
		cursor: "pointer",
		userSelect: "none",
		padding: "6px 10px",
		background: "#17171a",
		color: "#ffffff",
		fontSize: "12px",
		fontWeight: "600",
	});

	const body = doc.createElement("div");
	// D13 (T15): an unbounded body grew to ~6754px on kernl's ~220 controls,
	// overflowing the viewport ~7.5x with the fold headers off-screen. The
	// panel is a fixed-position widget, so it scrolls internally: capped
	// height, its own scrollbar, and no scroll chaining into the page.
	Object.assign(body.style, {
		maxHeight: "70vh",
		overflowY: "auto",
		overscrollBehavior: "contain",
	});

	let collapsed = false;
	header.addEventListener("click", () => {
		collapsed = !collapsed;
		body.style.display = collapsed ? "none" : "";
		header.setAttribute("aria-expanded", String(!collapsed));
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
