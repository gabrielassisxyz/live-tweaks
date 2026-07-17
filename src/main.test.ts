// T5 — the pure half of main.ts (D8 split, mirrors resolve/state's
// pure/dom test files): the D13 noise denylist, the panel-visibility filter,
// and the dump/rescan summary builder are all plain data transforms over
// `BaselineToken[]`, so they are exercised with hand-authored fixtures, no
// DOM. The DOM-coupled half (`init`, idempotency, `window.LiveTweaks`) is
// covered in main.dom.test.ts.

import { describe, expect, it } from "vitest";
import {
	buildDumpResult,
	isNoiseToken,
	LIVE_TWEAKS_VERSION,
	panelTokens,
} from "./main";
import type { BaselineToken } from "./state";

it("exposes a semver version", () => {
	expect(LIVE_TWEAKS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});

describe("isNoiseToken (D13)", () => {
	it.each([
		["--tw-ring-offset-width", true],
		["--tw-gradient-from", true],
		["--un-text-opacity", true],
		["--color-primary", false],
		["--twemoji-size", false], // shares the "tw" substring but not the prefix
	])("%s -> %s", (name, expected) => {
		expect(isNoiseToken(name)).toBe(expected);
	});
});

function baselineToken(overrides: Partial<BaselineToken> = {}): BaselineToken {
	return {
		name: "--color-primary",
		before: "#8839ef",
		activeValue: "#8839ef",
		kind: "color",
		editable: true,
		...overrides,
	};
}

describe("panelTokens", () => {
	it("keeps editable, classified, non-noise tokens", () => {
		const tokens = [baselineToken({ name: "--color-primary" })];
		expect(panelTokens(tokens).map((t) => t.name)).toEqual(["--color-primary"]);
	});

	it("drops non-root tokens (D3)", () => {
		const tokens = [baselineToken({ name: "--card-radius", editable: false })];
		expect(panelTokens(tokens)).toEqual([]);
	});

	it("drops unclassified 'other' tokens (D5)", () => {
		const tokens = [
			baselineToken({ name: "--empty-state-label", kind: "other" }),
		];
		expect(panelTokens(tokens)).toEqual([]);
	});

	it("drops noise-prefixed tokens even when classified (D13)", () => {
		const tokens = [
			baselineToken({ name: "--tw-gradient-from", kind: "color" }),
		];
		expect(panelTokens(tokens)).toEqual([]);
	});
});

describe("buildDumpResult", () => {
	it("lists only root-level tokens, with their kind", () => {
		const tokens = [
			baselineToken({ name: "--color-primary", kind: "color" }),
			baselineToken({ name: "--card-radius", editable: false, kind: "length" }),
		];
		expect(buildDumpResult(tokens, 0).tokens).toEqual([
			{ name: "--color-primary", kind: "color" },
		]);
	});

	it("counts non-root tokens under skipped.nonRoot", () => {
		const tokens = [
			baselineToken({ name: "--color-primary" }),
			baselineToken({ name: "--card-radius", editable: false }),
			baselineToken({ name: "--focus-ring", editable: false }),
		];
		expect(buildDumpResult(tokens, 0).skipped.nonRoot).toBe(2);
	});

	it("counts noise-prefixed root tokens under skipped.noise", () => {
		const tokens = [
			baselineToken({ name: "--color-primary" }),
			baselineToken({ name: "--tw-gradient-from", kind: "color" }),
			baselineToken({ name: "--tw-ring-offset-width", kind: "length" }),
		];
		expect(buildDumpResult(tokens, 0).skipped.noise).toBe(2);
	});

	it("counts unclassified root tokens under skipped.unclassified, excluding noise", () => {
		const tokens = [
			baselineToken({ name: "--color-primary" }),
			baselineToken({ name: "--empty-state-label", kind: "other" }),
			// Noise that happens to classify as "other" is counted as noise, not
			// double-counted as unclassified.
			baselineToken({ name: "--un-something", kind: "other" }),
		];
		const result = buildDumpResult(tokens, 0);
		expect(result.skipped.unclassified).toBe(1);
		expect(result.skipped.noise).toBe(1);
	});

	it("passes unreadableSheets through unchanged", () => {
		expect(buildDumpResult([], 3).skipped.unreadableSheets).toBe(3);
	});
});
