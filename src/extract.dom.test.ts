// @vitest-environment jsdom

// The jsdom half of T1's suite: proves the walker reads *real* CSSOM produced by
// a conformant parser — recursion through @media/@supports/@layer, and that
// CSSOM iteration (never `cssText` splitting) preserves values carrying ';'/'}'
// inside strings and drops comments. Pairs with extract.pure.test.ts (the
// authored-string seam) so neither environment's quirks can hide a bug alone.

import { afterEach, expect, it } from "vitest";
import { extractRawTokens } from "./extract";

function mountStyle(css: string): void {
	document.head.innerHTML = `<style>${css}</style>`;
}

afterEach(() => {
	document.head.innerHTML = "";
});

function tokenByName(name: string) {
	return extractRawTokens(document).tokens.find((token) => token.name === name);
}

it("reads a plain :root custom property from live CSSOM", () => {
	mountStyle(":root { --color-primary: #8839ef; }");
	expect(tokenByName("--color-primary")?.definitions).toEqual([
		{ rawValue: "#8839ef", selector: ":root" },
	]);
});

it("finds tokens nested inside @media, @supports and @layer", () => {
	mountStyle(`
		:root { --color-primary: #8839ef; }
		@media (prefers-color-scheme: dark) { :root { --media-token: #b4c5fe; } }
		@supports (display: grid) { :root { --supports-token: 2px; } }
		@layer base { :root { --layer-token: 1rem; } }
	`);
	const names = extractRawTokens(document).tokens.map((t) => t.name);
	expect(names).toContain("--media-token");
	expect(names).toContain("--supports-token");
	expect(names).toContain("--layer-token");
});

it("preserves ';' and '}' that live inside a quoted value", () => {
	mountStyle(':root { --quoted: "a; b} c"; --after: 1px; }');
	// The ';' inside the string must not truncate the value, and the trailing
	// declaration must still be seen — the exact failure mode of cssText splitting.
	expect(tokenByName("--quoted")?.definitions[0]?.rawValue).toBe('"a; b} c"');
	expect(tokenByName("--after")).toBeDefined();
});

it("drops comments from values (the engine strips them, we never re-parse)", () => {
	mountStyle(":root { --commented: 1px /* ; here } */ solid; }");
	expect(tokenByName("--commented")?.definitions[0]?.rawValue).toBe(
		"1px solid",
	);
});

it("does not collect non-custom declarations", () => {
	mountStyle(":root { color: red; --only: #fff; }");
	const names = extractRawTokens(document).tokens.map((t) => t.name);
	expect(names).toEqual(["--only"]);
});

it("reports zero unreadable sheets for same-origin CSS", () => {
	mountStyle(":root { --x: 1; }");
	expect(extractRawTokens(document).unreadableSheets).toBe(0);
});
