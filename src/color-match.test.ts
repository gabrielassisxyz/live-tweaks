// Pure half of the pipette feature (panel.ts's EyeDropper button): parse the
// two normalized color forms that ever reach the matcher — the EyeDropper
// API's "#rrggbb" and getComputedStyle's "rgb(r, g, b)" / "rgba(...)" — and
// find which tokens' resolved values equal the picked pixel. DOM
// normalization (arbitrary CSS color -> computed rgb string) stays in
// panel/, injected as data; this module never touches a document.

import { describe, expect, it } from "vitest";
import { findColorMatches, parseColorToRgb } from "./color-match";

describe("parseColorToRgb", () => {
	it.each([
		["#0f1217", [15, 18, 23]],
		["#0F1217", [15, 18, 23]],
		["#fff", [255, 255, 255]],
		["rgb(15, 18, 23)", [15, 18, 23]],
		["rgb(15,18,23)", [15, 18, 23]],
		["rgba(15, 18, 23, 1)", [15, 18, 23]],
	])("parses %s", (value, expected) => {
		expect(parseColorToRgb(value)).toEqual(expected);
	});

	it.each([
		["rgba(15, 18, 23, 0.5)"], // translucent: the picked pixel is a blend
		["oklch(71% 0.194 13.428)"], // not a normalized form — normalize first
		["#12"],
		["#12345"],
		["blue"],
		[""],
	])("rejects %s", (value) => {
		expect(parseColorToRgb(value)).toBeUndefined();
	});
});

describe("findColorMatches", () => {
	const tokens = [
		{ name: "--color-bg-base", resolvedValue: "rgb(15, 18, 23)" },
		{ name: "--color-background", resolvedValue: "rgb(15, 18, 23)" },
		{ name: "--color-primary", resolvedValue: "rgb(180, 197, 254)" },
		{ name: "--color-broken", resolvedValue: "not-a-color" },
	];

	it("returns every token whose resolved value equals the picked color", () => {
		expect(findColorMatches("#0f1217", tokens)).toEqual([
			"--color-bg-base",
			"--color-background",
		]);
	});

	it("returns an empty list when nothing matches", () => {
		expect(findColorMatches("#ffffff", tokens)).toEqual([]);
	});

	it("returns an empty list for an unparseable pick", () => {
		expect(findColorMatches("nonsense", tokens)).toEqual([]);
	});
});
