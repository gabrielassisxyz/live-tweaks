// Table-driven suite for classify.ts. Pure logic, no DOM — mirrors the
// style of extract.pure.test.ts (fakes typed against the module's own seam, no
// `any`, no engine involved).
//
// This file owns its own fixture table, disjoint from extract's fixtures.

import { describe, expect, it } from "vitest";
import {
	classify,
	defaultSupportsColor,
	type SupportsColor,
	type TokenKind,
} from "./classify";

// A deliberately small stand-in for `CSS.supports('color', value)`: recognizes
// the color syntaxes this fixture table actually exercises (hex, the common
// functional notations, a handful of keywords) — not a full CSS <color>
// grammar. Real verification is `CSS.supports` itself; this fake exists only
// because jsdom (this repo's DOM test environment) exposes no global `CSS` at
// all, per classify.ts's "CSS.supports seam" note.
const HEX_COLOR = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL_COLOR =
	/^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/i;
const COLOR_KEYWORDS = new Set([
	"red",
	"blue",
	"green",
	"black",
	"white",
	"transparent",
	"currentcolor",
	"rebeccapurple",
]);

const fakeSupportsColor: SupportsColor = (value) =>
	HEX_COLOR.test(value) ||
	FUNCTIONAL_COLOR.test(value) ||
	COLOR_KEYWORDS.has(value.toLowerCase());

interface ClassifyCase {
	readonly description: string;
	readonly name: string;
	readonly value: string;
	readonly expected: TokenKind;
}

const cases: ClassifyCase[] = [
	{
		description: "6-digit hex color",
		name: "--color-primary",
		value: "#8839ef",
		expected: "color",
	},
	{
		description: "8-digit hex color with alpha",
		name: "--color-overlay",
		value: "#8839efcc",
		expected: "color",
	},
	{
		description: "rgb() functional color",
		name: "--color-accent",
		value: "rgb(136, 57, 239)",
		expected: "color",
	},
	{
		description: "hsl() functional color",
		name: "--brand",
		value: "hsl(262 83% 58%)",
		expected: "color",
	},
	{
		description: "named color keyword",
		name: "--danger",
		value: "red",
		expected: "color",
	},
	{
		description: "currentColor keyword",
		name: "--outline",
		value: "currentColor",
		expected: "color",
	},
	{
		description: "color wins over a font-matching name",
		name: "--font-color",
		value: "red",
		expected: "color",
	},
	{
		description: "whitespace around a color value is trimmed",
		name: "--color-primary",
		value: "  #8839ef  ",
		expected: "color",
	},
	{
		description: "font stack, name matches 'font'",
		name: "--font-body",
		value: "Inter, sans-serif",
		expected: "font-family",
	},
	{
		description: "font stack, name matches 'family'",
		name: "--body-font-family",
		value: "system-ui",
		expected: "font-family",
	},
	{
		description: "whitespace around name and value is trimmed",
		name: "  --font-title  ",
		value: "  Georgia, serif  ",
		expected: "font-family",
	},
	{
		description: "font-named length falls through to length, not font-family",
		name: "--font-size",
		value: "16px",
		expected: "length",
	},
	{
		description: "pixel length",
		name: "--icon-size",
		value: "16px",
		expected: "length",
	},
	{
		description: "negative decimal rem length",
		name: "--radius",
		value: "-1.5rem",
		expected: "length",
	},
	{
		description: "viewport-height length",
		name: "--gap",
		value: "2vh",
		expected: "length",
	},
	{
		description: "percentage length",
		name: "--width",
		value: "100%",
		expected: "length",
	},
	{
		description: "point length",
		name: "--border-width",
		value: "1pt",
		expected: "length",
	},
	{
		description: "calc() is excluded from length, classified as other",
		name: "--spacing",
		value: "calc(1rem + 2px)",
		expected: "other",
	},
	{
		description: "unitless number is excluded from length, classified as other",
		name: "--z-index",
		value: "10",
		expected: "other",
	},
	{
		description: "unrecognized keyword",
		name: "--display-mode",
		value: "flex",
		expected: "other",
	},
	{
		description: "empty value",
		name: "--empty",
		value: "",
		expected: "other",
	},
	{
		description:
			"known rough edge (literal D5 order): a font-named calc() value is not a length, so it stays font-family",
		name: "--font-size",
		value: "calc(1rem + 2px)",
		expected: "font-family",
	},
];

describe("classify", () => {
	it.each(cases)("$description", ({ name, value, expected }) => {
		expect(classify(name, value, fakeSupportsColor)).toBe(expected);
	});
});

describe("defaultSupportsColor", () => {
	it("documents that this DOM test environment has no global CSS.supports", () => {
		// If a future jsdom upgrade adds CSS.supports, this fails loudly instead
		// of the injected-seam decision above silently going stale.
		expect(typeof (globalThis as { CSS?: unknown }).CSS).toBe("undefined");
		expect(defaultSupportsColor("#8839ef")).toBe(false);
	});

	it("classify() with the default checker never classifies as color here", () => {
		expect(classify("--color-primary", "#8839ef")).not.toBe("color");
	});
});
