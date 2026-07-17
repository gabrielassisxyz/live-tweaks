// @vitest-environment jsdom

// T5 — the DOM-coupled half of main.ts: `init()` wired against a real
// document (mirrors resolve.dom.test.ts / state.dom.test.ts's split, D8).
// The top-level auto-run at the bottom of main.ts is guarded out under
// Vitest (see main.ts's comment) specifically so these tests can call
// `init()` themselves against a document they control, once per test.

import { afterEach, expect, it } from "vitest";
import { init, type LiveTweaksWindow } from "./main";

function mountStyle(css: string): void {
	document.head.innerHTML = `<style>${css}</style>`;
}

function freshWindow(): LiveTweaksWindow {
	// A plain object satisfies the structural `LiveTweaksWindow` (only the
	// `LiveTweaks` property is ever read/written) — no real jsdom `Window`
	// object is needed, and reusing one across tests would defeat the point.
	return {} as LiveTweaksWindow;
}

afterEach(() => {
	document.head.innerHTML = "";
	document.documentElement.removeAttribute("style");
});

it("dump() lists root tokens with kinds after init", () => {
	mountStyle(":root { --spacing-lg: 24px; } .card { --card-radius: 12px; }");
	const win = freshWindow();
	const api = init(document, win);
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
	init(document, win);
	expect(win.LiveTweaks).toBeDefined();
});

it("a second init() on the same window is a no-op (idempotency guard)", () => {
	mountStyle(":root { --spacing-lg: 24px; }");
	const win = freshWindow();
	const first = init(document, win);
	mountStyle(":root { --spacing-lg: 24px; --spacing-sm: 8px; }");
	const second = init(document, win);
	expect(second).toBe(first);
	// Proves the second call did not re-scan: the newly-mounted --spacing-sm
	// is absent until an explicit rescan() is requested.
	expect(second.dump().tokens.map((t) => t.name)).not.toContain("--spacing-sm");
});

it("rescan() re-runs the pipeline and picks up newly-mounted tokens", () => {
	mountStyle(":root { --spacing-lg: 24px; }");
	const win = freshWindow();
	const api = init(document, win);
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
	init(document, winA);
	init(document, winB);
	expect(winA.LiveTweaks).not.toBe(winB.LiveTweaks);
});
