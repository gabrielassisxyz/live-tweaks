// The D8 test seam: the walker and its declaration filter are exercised with
// hand-authored fake CSSOM objects, never jsdom's round-tripped `cssText`. This
// keeps the adversarial-value assertions honest — the fake `getPropertyValue`
// returns exactly the string a conformant engine yields, so a passing test can
// never be an artifact of the DOM engine silently dropping a custom property.
//
// The fakes are typed with the module's own structural interfaces (the same ones
// a real `Document`/`CSSStyleSheet` satisfy), so no `any` and no engine is
// involved — only the walker logic is under test.

import { describe, expect, it } from "vitest";
import {
	type CSSRuleLike,
	customPropertyDeclarations,
	type DocumentLike,
	extractRawTokens,
	type StyleDeclarationLike,
	type StyleSheetLike,
} from "./extract";

function fakeDeclaration(
	entries: ReadonlyArray<readonly [string, string]>,
): StyleDeclarationLike {
	return {
		length: entries.length,
		item: (index) => entries[index]?.[0] ?? "",
		getPropertyValue: (name) =>
			entries.find(([property]) => property === name)?.[1] ?? "",
	};
}

function fakeStyleRule(
	selector: string,
	entries: ReadonlyArray<readonly [string, string]>,
): CSSRuleLike {
	return { selectorText: selector, style: fakeDeclaration(entries) };
}

// A style rule that also nests child rules (CSS nesting): both branches fire.
function fakeNestingRule(
	selector: string,
	entries: ReadonlyArray<readonly [string, string]>,
	children: CSSRuleLike[],
): CSSRuleLike {
	return {
		selectorText: selector,
		style: fakeDeclaration(entries),
		cssRules: children,
	};
}

function fakeGroupingRule(children: CSSRuleLike[]): CSSRuleLike {
	return { cssRules: children };
}

function fakeImportRule(styleSheet: StyleSheetLike | null): CSSRuleLike {
	return { styleSheet };
}

function fakeSheet(rules: CSSRuleLike[]): StyleSheetLike {
	return { cssRules: rules };
}

// A sheet whose `.cssRules` throws models a cross-origin sheet.
function crossOriginSheet(): StyleSheetLike {
	return {
		get cssRules(): Iterable<CSSRuleLike> {
			throw new Error("SecurityError: cannot access cross-origin stylesheet");
		},
	};
}

function fakeDocument(
	sheets: StyleSheetLike[],
	adopted?: StyleSheetLike[],
): DocumentLike {
	return { styleSheets: sheets, adoptedStyleSheets: adopted };
}

describe("customPropertyDeclarations", () => {
	it("keeps only custom properties, in declaration order", () => {
		const decl = fakeDeclaration([
			["color", "red"],
			["--color-primary", "#8839ef"],
			["margin", "0"],
			["--font-body", "Inter, sans-serif"],
		]);
		expect(customPropertyDeclarations(decl)).toEqual([
			{ name: "--color-primary", value: "#8839ef" },
			{ name: "--font-body", value: "Inter, sans-serif" },
		]);
	});

	it("preserves adversarial values with ';' and '}' inside strings", () => {
		const decl = fakeDeclaration([
			["--sep", 'url("a;b}c")'],
			["--quoted", '"a; b} c"'],
		]);
		expect(customPropertyDeclarations(decl)).toEqual([
			{ name: "--sep", value: 'url("a;b}c")' },
			{ name: "--quoted", value: '"a; b} c"' },
		]);
	});

	it("returns nothing for a declaration with no custom properties", () => {
		expect(
			customPropertyDeclarations(fakeDeclaration([["color", "red"]])),
		).toEqual([]);
	});
});

describe("extractRawTokens", () => {
	it("collects a root-level custom property with its selector", () => {
		const doc = fakeDocument([
			fakeSheet([fakeStyleRule(":root", [["--color-primary", "#8839ef"]])]),
		]);
		expect(extractRawTokens(doc)).toEqual({
			tokens: [
				{
					name: "--color-primary",
					definitions: [{ rawValue: "#8839ef", selector: ":root" }],
				},
			],
			unreadableSheets: 0,
		});
	});

	it("recurses into grouping rules (media/supports/layer/nested)", () => {
		const doc = fakeDocument([
			fakeSheet([
				fakeStyleRule(":root", [["--color-primary", "#8839ef"]]),
				// @media -> @supports -> @layer -> :root, three grouping levels deep
				fakeGroupingRule([
					fakeGroupingRule([
						fakeGroupingRule([
							fakeStyleRule(":root", [["--color-primary", "#b4c5fe"]]),
						]),
					]),
				]),
			]),
		]);
		expect(extractRawTokens(doc).tokens).toEqual([
			{
				name: "--color-primary",
				definitions: [
					{ rawValue: "#8839ef", selector: ":root" },
					{ rawValue: "#b4c5fe", selector: ":root" },
				],
			},
		]);
	});

	it("collects and recurses when a style rule also nests rules", () => {
		const doc = fakeDocument([
			fakeSheet([
				fakeNestingRule(
					".card",
					[["--nested", "5px"]],
					[fakeStyleRule("&:hover", [["--hover", "9px"]])],
				),
			]),
		]);
		expect(extractRawTokens(doc).tokens.map((t) => t.name)).toEqual([
			"--nested",
			"--hover",
		]);
	});

	it("follows @import rules into the imported sheet", () => {
		const imported = fakeSheet([
			fakeStyleRule(":root", [["--imported", "1rem"]]),
		]);
		const doc = fakeDocument([fakeSheet([fakeImportRule(imported)])]);
		expect(extractRawTokens(doc).tokens).toEqual([
			{
				name: "--imported",
				definitions: [{ rawValue: "1rem", selector: ":root" }],
			},
		]);
	});

	it("skips a null @import styleSheet without counting it unreadable", () => {
		const doc = fakeDocument([fakeSheet([fakeImportRule(null)])]);
		expect(extractRawTokens(doc)).toEqual({ tokens: [], unreadableSheets: 0 });
	});

	it("counts cross-origin sheets and keeps reading the readable ones", () => {
		const doc = fakeDocument([
			crossOriginSheet(),
			fakeSheet([fakeStyleRule(":root", [["--ok", "#fff"]])]),
		]);
		const result = extractRawTokens(doc);
		expect(result.unreadableSheets).toBe(1);
		expect(result.tokens.map((t) => t.name)).toEqual(["--ok"]);
	});

	it("counts an @import whose imported sheet is cross-origin", () => {
		const doc = fakeDocument([fakeSheet([fakeImportRule(crossOriginSheet())])]);
		const result = extractRawTokens(doc);
		expect(result.unreadableSheets).toBe(1);
		expect(result.tokens).toEqual([]);
	});

	it("walks document.adoptedStyleSheets", () => {
		const doc = fakeDocument(
			[],
			[fakeSheet([fakeStyleRule(":root", [["--adopted", "2px"]])])],
		);
		expect(extractRawTokens(doc).tokens.map((t) => t.name)).toEqual([
			"--adopted",
		]);
	});

	it("tolerates a missing adoptedStyleSheets property", () => {
		const doc: DocumentLike = { styleSheets: [] };
		expect(extractRawTokens(doc)).toEqual({ tokens: [], unreadableSheets: 0 });
	});

	it("groups multiple definitions of one name in document order", () => {
		const doc = fakeDocument([
			fakeSheet([
				fakeStyleRule(":root", [["--c", "#111"]]),
				fakeStyleRule('[data-theme="dark"]', [["--c", "#eee"]]),
			]),
		]);
		expect(extractRawTokens(doc).tokens).toEqual([
			{
				name: "--c",
				definitions: [
					{ rawValue: "#111", selector: ":root" },
					{ rawValue: "#eee", selector: '[data-theme="dark"]' },
				],
			},
		]);
	});

	it("preserves adversarial values end-to-end through the walker", () => {
		const doc = fakeDocument([
			fakeSheet([fakeStyleRule(":root", [["--sep", 'url("a;b}c")']])]),
		]);
		expect(extractRawTokens(doc).tokens[0]?.definitions[0]?.rawValue).toBe(
			'url("a;b}c")',
		);
	});
});
