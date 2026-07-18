// @vitest-environment jsdom

// T5/T9 — the DOM-coupled half of main.ts: `init()` wired against a real
// document (mirrors resolve.dom.test.ts / state.dom.test.ts's split, D8).
// The top-level auto-run at the bottom of main.ts is guarded out under
// Vitest (see main.ts's comment) specifically so these tests can call
// `init()` themselves against a document they control, once per test.
//
// Every test injects a *fake* `PanelFactory`: a real Tweakpane instance needs
// browser APIs jsdom does not implement (this is exactly why panel/ carries
// the recorded TDD exemption, AGENTS.md). The fake still exercises init()'s
// real wiring — onChange/onReset/onResetAll/onRescan, and the render()/
// setValue() calls made on the panel — which is ordinary glue code, not
// Tweakpane-coupled, and stays TDD per this file's own module (main.ts).

import { afterEach, describe, expect, it, vi } from "vitest";
import { init, type LiveTweaksWindow, type PanelFactory } from "./main";
import type { PanelHost } from "./panel/host";
import type {
	PanelToken,
	TweaksPanel,
	TweaksPanelCallbacks,
} from "./panel/panel";

function mountStyle(css: string): void {
	document.head.innerHTML = `<style>${css}</style>`;
}

function freshWindow(): LiveTweaksWindow {
	// A plain object satisfies the structural `LiveTweaksWindow` (only the
	// `LiveTweaks` property is ever read/written) — no real jsdom `Window`
	// object is needed, and reusing one across tests would defeat the point.
	return {} as LiveTweaksWindow;
}

interface RenderCall {
	readonly tokens: readonly PanelToken[];
	readonly summary: string;
}

interface FakePanel {
	factory: PanelFactory;
	renders: RenderCall[];
	setValues: Array<{ name: string; value: string }>;
	/** Populated once `init()` has called `createPanel()` — every test calls
	 * `init()` before touching this. */
	callbacks?: TweaksPanelCallbacks;
}

/** A `PanelFactory` whose "panel" is just recorder arrays plus the captured
 * callbacks object main.ts wired up — the same structural-fake pattern the
 * rest of the codebase uses for its DOM seams (D8). `shadowRoot` is never
 * touched by the fake, so an empty cast stands in for a real one. */
function fakePanelFactory(): FakePanel {
	const renders: RenderCall[] = [];
	const setValues: Array<{ name: string; value: string }> = [];
	const fake = {} as FakePanel;
	fake.renders = renders;
	fake.setValues = setValues;
	fake.factory = {
		createHost: (): PanelHost => ({
			shadowRoot: {} as ShadowRoot,
			contentMount: document.createElement("div"),
			destroy: () => {},
		}),
		createPanel: (
			_mount: HTMLElement,
			_shadow: ShadowRoot,
			callbacks: TweaksPanelCallbacks,
		): TweaksPanel => {
			fake.callbacks = callbacks;
			return {
				render: (tokens, summary) => {
					renders.push({ tokens, summary });
				},
				setValue: (name, value) => {
					setValues.push({ name, value });
				},
				destroy: () => {},
			};
		},
	};
	return fake;
}

afterEach(() => {
	document.head.innerHTML = "";
	document.body.innerHTML = ""; // onSave's fallback modal (export.ts) mounts here
	document.documentElement.removeAttribute("style");
});

it("dump() lists root tokens with kinds after init", () => {
	mountStyle(":root { --spacing-lg: 24px; } .card { --card-radius: 12px; }");
	const win = freshWindow();
	const api = init(document, win, fakePanelFactory().factory);
	const dump = api.dump();
	expect(dump.tokens).toEqual(
		expect.arrayContaining([{ name: "--spacing-lg", kind: "length" }]),
	);
	expect(dump.tokens.map((t) => t.name)).not.toContain("--card-radius");
});

it("init() sets window.LiveTweaks", () => {
	mountStyle(":root { --spacing-lg: 24px; }");
	const win = freshWindow();
	expect(win.LiveTweaks).toBeUndefined();
	init(document, win, fakePanelFactory().factory);
	expect(win.LiveTweaks).toBeDefined();
});

it("a second init() on the same window is a no-op (idempotency guard)", () => {
	mountStyle(":root { --spacing-lg: 24px; }");
	const win = freshWindow();
	const fake = fakePanelFactory();
	const first = init(document, win, fake.factory);
	mountStyle(":root { --spacing-lg: 24px; --spacing-sm: 8px; }");
	const second = init(document, win, fakePanelFactory().factory);
	expect(second).toBe(first);
	// Proves the second call did not re-scan: the newly-mounted --spacing-sm
	// is absent until an explicit rescan() is requested.
	expect(second.dump().tokens.map((t) => t.name)).not.toContain("--spacing-sm");
	// And it did not mount a second panel: only the first factory's panel saw
	// a render() call.
	expect(fake.renders).toHaveLength(1);
});

it("rescan() re-runs the pipeline and picks up newly-mounted tokens", () => {
	mountStyle(":root { --spacing-lg: 24px; }");
	const win = freshWindow();
	const api = init(document, win, fakePanelFactory().factory);
	mountStyle(":root { --spacing-lg: 24px; --spacing-sm: 8px; }");
	const rescanned = api.rescan();
	expect(rescanned.tokens.map((t) => t.name)).toEqual(
		expect.arrayContaining(["--spacing-lg", "--spacing-sm"]),
	);
	expect(api.dump().tokens.map((t) => t.name)).toEqual(
		expect.arrayContaining(["--spacing-lg", "--spacing-sm"]),
	);
});

it("two independent windows each get their own session", () => {
	mountStyle(":root { --spacing-lg: 24px; }");
	const winA = freshWindow();
	const winB = freshWindow();
	init(document, winA, fakePanelFactory().factory);
	init(document, winB, fakePanelFactory().factory);
	expect(winA.LiveTweaks).not.toBe(winB.LiveTweaks);
});

it("mounts the panel once, on init, with only panel-worthy tokens (D3/D5/D13)", () => {
	mountStyle(
		":root { --spacing-lg: 24px; --tw-noise: 0px; } .card { --card-radius: 12px; }",
	);
	const fake = fakePanelFactory();
	init(document, freshWindow(), fake.factory);

	expect(fake.renders).toHaveLength(1);
	const names = fake.renders[0]?.tokens.map((t) => t.name);
	expect(names).toEqual(["--spacing-lg"]); // --card-radius (non-root) and
	// --tw-noise (D13 denylist) are both excluded.
	expect(fake.renders[0]?.summary).toContain("1 non-root");
	expect(fake.renders[0]?.summary).toContain("1 noise");
});

it("onChange applies the override to the DOM and records it in state", () => {
	mountStyle(":root { --spacing-lg: 24px; }");
	const fake = fakePanelFactory();
	init(document, freshWindow(), fake.factory);

	fake.callbacks?.onChange("--spacing-lg", "32px");

	expect(document.documentElement.style.getPropertyValue("--spacing-lg")).toBe(
		"32px",
	);
});

it("onReset removes the property when there was no pre-existing inline value (D12)", () => {
	mountStyle(":root { --spacing-lg: 24px; }");
	const fake = fakePanelFactory();
	init(document, freshWindow(), fake.factory);

	fake.callbacks?.onChange("--spacing-lg", "32px");
	fake.callbacks?.onReset("--spacing-lg");

	expect(document.documentElement.style.getPropertyValue("--spacing-lg")).toBe(
		"",
	);
	expect(fake.setValues).toContainEqual({
		name: "--spacing-lg",
		value: "24px",
	});
});

it("onReset restores a pre-existing inline value set before init (D12)", () => {
	mountStyle(":root { --spacing-lg: 24px; }");
	// A theme manager (or a previous session) already set an inline value
	// before live-tweaks ever ran.
	document.documentElement.style.setProperty("--spacing-lg", "40px");
	const fake = fakePanelFactory();
	init(document, freshWindow(), fake.factory);

	fake.callbacks?.onChange("--spacing-lg", "32px");
	fake.callbacks?.onReset("--spacing-lg");

	expect(document.documentElement.style.getPropertyValue("--spacing-lg")).toBe(
		"40px",
	);
	expect(fake.setValues).toContainEqual({
		name: "--spacing-lg",
		value: "40px",
	});
});

it("onReset is a no-op when the token has no active override", () => {
	mountStyle(":root { --spacing-lg: 24px; }");
	const fake = fakePanelFactory();
	init(document, freshWindow(), fake.factory);

	fake.callbacks?.onReset("--spacing-lg");

	expect(fake.setValues).toEqual([]);
});

it("onResetAll resets every overridden token and syncs the panel for each", () => {
	mountStyle(":root { --spacing-lg: 24px; --radius-md: 8px; }");
	const fake = fakePanelFactory();
	init(document, freshWindow(), fake.factory);

	fake.callbacks?.onChange("--spacing-lg", "32px");
	fake.callbacks?.onChange("--radius-md", "16px");
	fake.callbacks?.onResetAll();

	expect(document.documentElement.style.getPropertyValue("--spacing-lg")).toBe(
		"",
	);
	expect(document.documentElement.style.getPropertyValue("--radius-md")).toBe(
		"",
	);
	expect(fake.setValues).toEqual(
		expect.arrayContaining([
			{ name: "--spacing-lg", value: "24px" },
			{ name: "--radius-md", value: "8px" },
		]),
	);
});

it("onRescan re-runs the pipeline and re-renders the panel with the new tokens", () => {
	mountStyle(":root { --spacing-lg: 24px; }");
	const fake = fakePanelFactory();
	init(document, freshWindow(), fake.factory);
	expect(fake.renders).toHaveLength(1);

	mountStyle(":root { --spacing-lg: 24px; --radius-md: 8px; }");
	fake.callbacks?.onRescan();

	expect(fake.renders).toHaveLength(2);
	expect(fake.renders[1]?.tokens.map((t) => t.name)).toEqual(
		expect.arrayContaining(["--spacing-lg", "--radius-md"]),
	);
});

it("a live override survives into a later render's token value", () => {
	mountStyle(":root { --spacing-lg: 24px; }");
	const fake = fakePanelFactory();
	init(document, freshWindow(), fake.factory);

	fake.callbacks?.onChange("--spacing-lg", "32px");
	fake.callbacks?.onRescan();

	// rescan() merges rather than replaces (review-gate fix): the override
	// itself is untouched by the merge, and buildPanelTokens() always prefers
	// a live override over the baseline's activeValue — so the re-rendered
	// control still shows the edit, not the pre-edit baseline value.
	const rescannedToken = fake.renders[1]?.tokens.find(
		(t) => t.name === "--spacing-lg",
	);
	expect(rescannedToken?.value).toBe("32px");
});

it("onSave falls back to the copy-paste modal when navigator.clipboard is absent (T10)", async () => {
	// jsdom exposes `navigator` but not the Clipboard API (confirmed by hand,
	// same documented gap as classify.ts's CSS.supports seam) — exactly the
	// "API absent" branch export.ts's saveAndExport() must fall back on.
	expect(navigator.clipboard).toBeUndefined();

	mountStyle(":root { --spacing-lg: 24px; }");
	const fake = fakePanelFactory();
	init(document, freshWindow(), fake.factory);
	fake.callbacks?.onChange("--spacing-lg", "32px");

	fake.callbacks?.onSave();
	// saveAndExport() is async (awaits the clipboard write attempt); flush
	// the microtask queue before asserting the modal landed.
	await Promise.resolve();
	await Promise.resolve();

	const modal = document.getElementById("live-tweaks-export-fallback");
	expect(modal).not.toBeNull();
	const exported = JSON.parse(modal?.querySelector("textarea")?.value ?? "{}");
	expect(exported).toEqual({
		"--spacing-lg": { before: "24px", after: "32px" },
	});
});

describe("rescan() merges instead of replacing (review-gate regression fix)", () => {
	// Shared setup for all three: edit a token, then rescan while a
	// lazily-injected stylesheet adds a new one — mirrors PLAN T8's actual
	// reason for Rescan existing (picking up new tokens), which must not
	// cost the user their in-flight session.
	function editThenRescanWithNewToken() {
		mountStyle(":root { --spacing-lg: 24px; }");
		const fake = fakePanelFactory();
		init(document, freshWindow(), fake.factory);

		fake.callbacks?.onChange("--spacing-lg", "32px");
		mountStyle(":root { --spacing-lg: 24px; --radius-md: 8px; }");
		fake.callbacks?.onRescan();

		return fake;
	}

	it("(a) diff() still contains the edit, anchored on the ORIGINAL before — not the fresh scan's post-edit value", async () => {
		const fake = editThenRescanWithNewToken();

		// window.LiveTweaks exposes no diff() directly (only dump/rescan), so
		// Save is the real production path to observe it: onSave() exports
		// session.diff() (export.ts), and jsdom has no Clipboard API, so the
		// fallback modal's textarea carries the exact exported JSON.
		fake.callbacks?.onSave();
		await Promise.resolve();
		await Promise.resolve();

		const modal = document.getElementById("live-tweaks-export-fallback");
		const exported = JSON.parse(
			modal?.querySelector("textarea")?.value ?? "{}",
		);
		expect(exported).toEqual({
			"--spacing-lg": { before: "24px", after: "32px" },
		});
	});

	it("(b) reset restores the true pre-session value, not the edited value a fresh scan would wrongly snapshot", () => {
		const fake = editThenRescanWithNewToken();

		fake.callbacks?.onReset("--spacing-lg");

		// There was no pre-existing inline value before this session ever
		// ran, so the correct D12 instruction is "remove" — a buggy replace-
		// on-rescan would instead "restore" to the edited "32px" the fresh
		// scan's snapshot wrongly captured as pre-existing.
		expect(
			document.documentElement.style.getPropertyValue("--spacing-lg"),
		).toBe("");
	});

	it("(c) a token newly present in the second scan appears in panelTokens", () => {
		const fake = editThenRescanWithNewToken();

		const latestRender = fake.renders.at(-1);
		expect(latestRender?.tokens.map((t) => t.name)).toEqual(
			expect.arrayContaining(["--spacing-lg", "--radius-md"]),
		);
	});
});

describe("init() with a pre-declared LiveTweaksConfig (D13 allowlist)", () => {
	// Fixtures use length tokens: jsdom has no CSS.supports, so a color value
	// classifies as "other" here (the recorded classify.ts seam) — allowlist
	// behavior is kind-independent, so length tokens exercise it fully.
	it("renders only allowlisted tokens and reports the rest in the summary", () => {
		mountStyle(":root { --spacing-lg: 24px; --radius-box: 8px; }");
		const win = freshWindow();
		win.LiveTweaksConfig = { allow: ["--spacing-"] };
		const fake = fakePanelFactory();

		init(document, win, fake.factory);

		const first = fake.renders[0];
		expect(first?.tokens.map((t) => t.name)).toEqual(["--spacing-lg"]);
		expect(first?.summary).toContain("1 outside allowlist");
	});

	it("ignores an invalid config and renders as if there were none", () => {
		mountStyle(":root { --spacing-lg: 24px; --radius-box: 8px; }");
		const win = freshWindow();
		win.LiveTweaksConfig = { allow: "--spacing-" };
		const fake = fakePanelFactory();

		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		init(document, win, fake.factory);
		warn.mockRestore();

		expect(fake.renders[0]?.tokens.map((t) => t.name)).toEqual(
			expect.arrayContaining(["--spacing-lg", "--radius-box"]),
		);
	});

	it("rescan() keeps honoring the allowlist for newly-found tokens", () => {
		mountStyle(":root { --spacing-lg: 24px; }");
		const win = freshWindow();
		win.LiveTweaksConfig = { allow: ["--spacing-"] };
		const fake = fakePanelFactory();
		init(document, win, fake.factory);

		document.head.innerHTML +=
			"<style>:root { --spacing-gap: 8px; --size-field: 2rem; }</style>";
		fake.callbacks?.onRescan();

		const latest = fake.renders.at(-1);
		expect(latest?.tokens.map((t) => t.name)).toEqual([
			"--spacing-lg",
			"--spacing-gap",
		]);
	});

	it("reads the config once at init — later mutations never apply (read-once contract)", () => {
		mountStyle(":root { --spacing-lg: 24px; --radius-box: 8px; }");
		const win = freshWindow();
		win.LiveTweaksConfig = { allow: ["--spacing-"] };
		const fake = fakePanelFactory();
		init(document, win, fake.factory);

		win.LiveTweaksConfig = { allow: ["--radius-"] };
		fake.callbacks?.onRescan();

		const latest = fake.renders.at(-1);
		expect(latest?.tokens.map((t) => t.name)).toEqual(["--spacing-lg"]);
	});
});
