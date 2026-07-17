// @vitest-environment jsdom

// The jsdom half of T2: proves `resolveDocumentTokens` wires the real walker to a
// real getComputedStyle. Per the T2 probe (2026-07-17), jsdom's getComputedStyle
// DOES carry plain root custom properties and DOES enumerate their names, but does
// NOT resolve var() chains — so this file only asserts what jsdom can faithfully
// produce (plain values, the computed supplement). The var()-substitution / match
// branches live in resolve.pure.test.ts, fed engine-independent computed values.

import { afterEach, expect, it } from "vitest";
import { resolveDocumentTokens } from "./resolve";

function mountStyle(css: string): void {
	document.head.innerHTML = `<style>${css}</style>`;
}

afterEach(() => {
	document.head.innerHTML = "";
	document.documentElement.removeAttribute("style");
});

function tokenByName(name: string) {
	return resolveDocumentTokens(document).tokens.find(
		(token) => token.name === name,
	);
}

it("resolves the trimmed active value from real computed style", () => {
	mountStyle(":root { --color-primary: #8839ef; }");
	const token = tokenByName("--color-primary");
	expect(token?.activeValue).toBe("#8839ef");
	expect(token?.editable).toBe(true);
	expect(token?.before).toBe("#8839ef");
});

it("flags a :root definition root-level and a scoped one not", () => {
	mountStyle(":root { --a: 1px; } .card { --b: 2px; }");
	expect(tokenByName("--a")?.editable).toBe(true);
	expect(tokenByName("--b")?.editable).toBe(false);
});

it("surfaces a JS-set inline root var via the computed supplement", () => {
	// No stylesheet defines it — only an inline style on the root element, the
	// pattern a theme manager produces. The walk cannot see it; the supplement can.
	document.documentElement.style.setProperty("--js-set", "#abcdef");
	const token = tokenByName("--js-set");
	expect(token).toBeDefined();
	expect(token?.definitions).toEqual([]);
	expect(token?.activeValue).toBe("#abcdef");
	expect(token?.before).toBe("#abcdef");
});
