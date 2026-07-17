// The D8 pure seam for T2's resolution layer: the `before` algorithm (PLAN §4),
// root-level flagging (D3), multi-definition dedupe and the computed-style
// supplement are exercised with authored fixture strings and a hand-authored fake
// computed style. jsdom does NOT resolve var() chains (T2 probe, 2026-07-17), so
// the authored≠computed matching case CANNOT be tested through a live engine —
// this seam feeds the computed values directly, which is exactly why it exists.

import { describe, expect, it } from "vitest";
import type { ExtractResult, RawToken, StyleDeclarationLike } from "./extract";
import { isRootLevelSelector, resolveTokens } from "./resolve";

// A fake getComputedStyle(documentElement) result: `map` is name -> computed value
// (already resolved and canonicalized, as a real engine would return it).
function fakeComputed(map: Record<string, string>): StyleDeclarationLike {
	const names = Object.keys(map);
	return {
		length: names.length,
		item: (index) => names[index] ?? "",
		getPropertyValue: (name) => map[name] ?? "",
	};
}

function raw(tokens: RawToken[], unreadableSheets = 0): ExtractResult {
	return { tokens, unreadableSheets };
}

describe("isRootLevelSelector", () => {
	it("accepts the document-root subjects (D3)", () => {
		for (const selector of [
			":root",
			"html",
			'html[data-theme="dark"]',
			':root[data-theme="dark"]',
			"html.dark",
			'[data-theme="dark"]',
			":root, .card", // a group is root-level if any part is
		]) {
			expect(isRootLevelSelector(selector)).toBe(true);
		}
	});

	it("rejects element/class-scoped and nested selectors", () => {
		for (const selector of [
			".card",
			"#app",
			"html .card", // descendant combinator -> targets a nested element
			":root .card",
			'.dark[data-theme="dark"]', // class-qualified -> not the bare root attr
			".a, .b",
		]) {
			expect(isRootLevelSelector(selector)).toBe(false);
		}
	});
});

describe("resolveTokens — active value & flagging", () => {
	it("trims the computed active value (leading token-stream whitespace)", () => {
		const result = resolveTokens(
			raw([
				{
					name: "--c",
					definitions: [{ rawValue: "#8839ef", selector: ":root" }],
				},
			]),
			fakeComputed({ "--c": "  #8839ef  " }),
		);
		expect(result.tokens[0]?.activeValue).toBe("#8839ef");
	});

	it("flags each definition root-level and marks the token editable", () => {
		const result = resolveTokens(
			raw([
				{
					name: "--c",
					definitions: [
						{ rawValue: "#111", selector: ":root" },
						{ rawValue: "#222", selector: ".card" },
					],
				},
			]),
			fakeComputed({ "--c": "#111" }),
		);
		const token = result.tokens[0];
		expect(token?.editable).toBe(true);
		expect(token?.definitions.map((d) => d.rootLevel)).toEqual([true, false]);
	});

	it("marks a token with only element-scoped definitions non-editable", () => {
		const result = resolveTokens(
			raw([
				{
					name: "--focus",
					definitions: [{ rawValue: "1px", selector: ".card" }],
				},
			]),
			fakeComputed({}), // not set at root
		);
		expect(result.tokens[0]?.editable).toBe(false);
	});

	it("passes the cross-origin sheet count through", () => {
		const result = resolveTokens(raw([], 3), fakeComputed({}));
		expect(result.unreadableSheets).toBe(3);
	});
});

describe("before algorithm — branch 1 (single root definition)", () => {
	it("uses the trimmed raw authored text", () => {
		const result = resolveTokens(
			raw([
				{
					name: "--c",
					definitions: [{ rawValue: "  #8839ef  ", selector: ":root" }],
				},
			]),
			fakeComputed({ "--c": "#8839ef" }),
		);
		expect(result.tokens[0]?.before).toBe("#8839ef");
	});

	it("ignores non-root definitions when counting for branch 1", () => {
		const result = resolveTokens(
			raw([
				{
					name: "--c",
					definitions: [
						{ rawValue: "#111", selector: ":root" },
						{ rawValue: "#222", selector: ".card" },
					],
				},
			]),
			fakeComputed({ "--c": "#111" }),
		);
		expect(result.tokens[0]?.before).toBe("#111");
	});
});

describe("before algorithm — branch 2 (multi-definition, active-value match)", () => {
	it("picks the active theme definition by direct textual match", () => {
		const themed: RawToken = {
			name: "--c",
			definitions: [
				{ rawValue: "#111", selector: ":root" },
				{ rawValue: "#eee", selector: '[data-theme="dark"]' },
			],
		};
		expect(
			resolveTokens(raw([themed]), fakeComputed({ "--c": "#eee" })).tokens[0]
				?.before,
		).toBe("#eee");
		expect(
			resolveTokens(raw([themed]), fakeComputed({ "--c": "#111" })).tokens[0]
				?.before,
		).toBe("#111");
	});

	it("authored≠computed: matches a var() chain via computed substitution, anchors to raw", () => {
		// Authored is a var() ref (whose chain ends in the hex #B4C5FE); the active
		// computed value is the canonicalized rgb(...). The anchor must be the RAW
		// var() text, found by substituting the referenced computed value.
		const token: RawToken = {
			name: "--button-bg",
			definitions: [
				{ rawValue: "var(--brand-light)", selector: ":root" },
				{ rawValue: "var(--brand-dark)", selector: '[data-theme="dark"]' },
			],
		};
		const result = resolveTokens(
			raw([token]),
			fakeComputed({
				"--button-bg": "rgb(180, 197, 254)", // active (light) — canonicalized
				"--brand-light": "rgb(180, 197, 254)", // #B4C5FE resolved
				"--brand-dark": "rgb(20, 20, 20)",
			}),
		);
		expect(result.tokens[0]?.before).toBe("var(--brand-light)");
	});

	it("resolves a var() fallback when the referenced property is unset", () => {
		const token: RawToken = {
			name: "--c",
			definitions: [
				{ rawValue: "var(--missing, #123456)", selector: ":root" },
				{ rawValue: "#eeeeee", selector: '[data-theme="dark"]' },
			],
		};
		const result = resolveTokens(
			raw([token]),
			fakeComputed({ "--c": "#123456" }),
		);
		expect(result.tokens[0]?.before).toBe("var(--missing, #123456)");
	});
});

describe("before algorithm — branch 3 (fallback to computed)", () => {
	it("falls back to the trimmed computed value when no definition matches", () => {
		const token: RawToken = {
			name: "--c",
			definitions: [
				{ rawValue: "var(--a)", selector: ":root" },
				{ rawValue: "var(--b)", selector: '[data-theme="dark"]' },
			],
		};
		const result = resolveTokens(
			raw([token]),
			fakeComputed({
				"--c": "rgb(9, 9, 9)",
				"--a": "rgb(1, 1, 1)",
				"--b": "rgb(2, 2, 2)",
			}),
		);
		expect(result.tokens[0]?.before).toBe("rgb(9, 9, 9)");
	});

	it("falls back to computed when there is no root-level definition", () => {
		const result = resolveTokens(
			raw([
				{
					name: "--focus",
					definitions: [{ rawValue: "1px", selector: ".card" }],
				},
			]),
			fakeComputed({}),
		);
		expect(result.tokens[0]?.before).toBe("");
	});
});

describe("multi-definition dedupe", () => {
	it("collapses exact-duplicate definitions so an identical pair is branch 1", () => {
		const token: RawToken = {
			name: "--c",
			definitions: [
				{ rawValue: "#111", selector: ":root" },
				{ rawValue: "#111", selector: ":root" }, // duplicate rule (e.g. re-@import)
			],
		};
		const result = resolveTokens(raw([token]), fakeComputed({ "--c": "#111" }));
		expect(result.tokens[0]?.definitions).toHaveLength(1);
		expect(result.tokens[0]?.before).toBe("#111");
	});
});

describe("computed-style supplementary enumeration", () => {
	it("adds root-only tokens the walk never saw (JS-set / cross-origin)", () => {
		const result = resolveTokens(
			raw([]), // walk found nothing (e.g. all cross-origin)
			fakeComputed({ "--js-set": "#abcdef" }),
		);
		const token = result.tokens.find((t) => t.name === "--js-set");
		expect(token).toBeDefined();
		expect(token?.editable).toBe(true);
		expect(token?.definitions).toEqual([]);
		expect(token?.activeValue).toBe("#abcdef");
		expect(token?.before).toBe("#abcdef"); // branch 3: no raw source
	});

	it("does not duplicate a token already found by the walk", () => {
		const result = resolveTokens(
			raw([
				{ name: "--c", definitions: [{ rawValue: "#111", selector: ":root" }] },
			]),
			fakeComputed({ "--c": "#111" }), // same name also enumerated at root
		);
		expect(result.tokens.filter((t) => t.name === "--c")).toHaveLength(1);
		expect(result.tokens[0]?.definitions).toHaveLength(1);
	});

	it("ignores non-custom properties in the computed enumeration", () => {
		const result = resolveTokens(
			raw([]),
			fakeComputed({ color: "red", "--real": "#fff" }),
		);
		expect(result.tokens.map((t) => t.name)).toEqual(["--real"]);
	});
});
