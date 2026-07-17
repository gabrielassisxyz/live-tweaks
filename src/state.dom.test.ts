// @vitest-environment jsdom

// The jsdom half of T4: proves `createTweakSession` wires resolve.ts's real
// document walk, classify.ts's classification, and the inline-style snapshot
// (PLAN D12) together correctly. Mirrors resolve.dom.test.ts's split (D8) — the
// pure decision logic (TweakSession's diff/reset/resetAll) is already fully
// covered in state.test.ts against hand-authored fixtures; this file only
// checks the DOM plumbing.

import { afterEach, expect, it } from "vitest";
import { createTweakSession } from "./state";

function mountStyle(css: string): void {
	document.head.innerHTML = `<style>${css}</style>`;
}

afterEach(() => {
	document.head.innerHTML = "";
	document.documentElement.removeAttribute("style");
});

it("builds a baseline from the real document walk + classification", () => {
	mountStyle(
		":root { --color-primary: #8839ef; --font-body: Inter, sans-serif; }",
	);
	const session = createTweakSession(document);
	const token = session.tokens().find((t) => t.name === "--color-primary");
	expect(token?.before).toBe("#8839ef");
	expect(token?.activeValue).toBe("#8839ef");
	expect(token?.editable).toBe(true);
	// jsdom exposes no global CSS.supports (classify.ts's documented seam gap),
	// so the production default never classifies as "color" here — assert the
	// plumbing reached classify() at all, not a specific kind.
	expect(session.tokens().map((t) => t.name)).toContain("--font-body");
});

it("snapshots a pre-existing inline value and restores it on reset (PLAN D12)", () => {
	mountStyle(":root { --color-primary: #8839ef; }");
	// Simulate a theme manager that already set an inline override before the
	// panel ever ran.
	document.documentElement.style.setProperty("--color-primary", "#000000");

	const session = createTweakSession(document);
	session.setOverride("--color-primary", "#e07850");

	expect(session.reset("--color-primary")).toEqual({
		name: "--color-primary",
		action: "restore",
		value: "#000000",
	});
});

it("reports removal on reset when there was no pre-existing inline value", () => {
	mountStyle(":root { --color-primary: #8839ef; }");
	const session = createTweakSession(document);
	session.setOverride("--color-primary", "#e07850");

	expect(session.reset("--color-primary")).toEqual({
		name: "--color-primary",
		action: "remove",
	});
});
