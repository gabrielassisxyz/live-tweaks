// T5 — the pure half of main.ts (D8 split, mirrors resolve/state's
// pure/dom test files): the D13 noise denylist, the panel-visibility filter,
// and the dump/rescan summary builder are all plain data transforms over
// `BaselineToken[]`, so they are exercised with hand-authored fixtures, no
// DOM. The DOM-coupled half (`init`, idempotency, `window.LiveTweaks`) is
// covered in main.dom.test.ts.

import { describe, expect, it, vi } from "vitest";
import {
	buildDumpResult,
	formatSkipped,
	isNoiseToken,
	LIVE_TWEAKS_VERSION,
	panelTokens,
	readAllowlist,
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

describe("readAllowlist (D13 allowlist)", () => {
	it("returns undefined when there is no config", () => {
		expect(readAllowlist(undefined)).toBeUndefined();
		expect(readAllowlist(null)).toBeUndefined();
	});

	it("returns the allow entries", () => {
		expect(readAllowlist({ allow: ["--color-", "--font-body"] })).toEqual([
			"--color-",
			"--font-body",
		]);
	});

	it("returns undefined when allow is missing", () => {
		expect(readAllowlist({})).toBeUndefined();
	});

	it("warns and returns undefined when the config is not an object", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(readAllowlist("--color-")).toBeUndefined();
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
	});

	it("warns and returns undefined when allow is not an array", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(readAllowlist({ allow: "--color-" })).toBeUndefined();
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
	});

	it("drops entries that are not custom-property prefixes, keeping the rest", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(readAllowlist({ allow: ["--color-", 5, "color"] })).toEqual([
			"--color-",
		]);
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
	});

	it("treats an empty (or fully-invalid) allow as no allowlist", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(readAllowlist({ allow: [] })).toBeUndefined();
		expect(readAllowlist({ allow: [42] })).toBeUndefined();
		warn.mockRestore();
	});
});

describe("panelTokens with an allowlist (D13 fallback)", () => {
	it("a trailing-dash entry matches as a prefix", () => {
		const tokens = [
			baselineToken({ name: "--color-primary" }),
			baselineToken({ name: "--radius-box", kind: "length" }),
		];
		expect(panelTokens(tokens, ["--color-"]).map((t) => t.name)).toEqual([
			"--color-primary",
		]);
	});

	it("any other entry matches exactly — suffixed variants stay out", () => {
		// The kernl lesson: daisyUI shadows app tokens and extends them with
		// suffixes (--color-primary-content), so exact entries must not match
		// as prefixes or the allowlist re-admits the noise it exists to block.
		const tokens = [
			baselineToken({ name: "--color-primary" }),
			baselineToken({ name: "--color-primary-content" }),
		];
		expect(panelTokens(tokens, ["--color-primary"]).map((t) => t.name)).toEqual(
			["--color-primary"],
		);
	});

	it("supersedes the noise denylist — an explicit allow wins", () => {
		const tokens = [
			baselineToken({ name: "--tw-gradient-from", kind: "color" }),
		];
		expect(panelTokens(tokens, ["--tw-"]).map((t) => t.name)).toEqual([
			"--tw-gradient-from",
		]);
	});

	it("still drops non-root and unclassified tokens", () => {
		const tokens = [
			baselineToken({ name: "--color-scoped", editable: false }),
			baselineToken({ name: "--color-odd", kind: "other" }),
		];
		expect(panelTokens(tokens, ["--color-"])).toEqual([]);
	});
});

describe("buildDumpResult with an allowlist (D13 fallback)", () => {
	it("counts root tokens outside the allowlist under skipped.notAllowed", () => {
		const tokens = [
			baselineToken({ name: "--color-primary" }),
			baselineToken({ name: "--radius-box", kind: "length" }),
			baselineToken({ name: "--size-field", kind: "length" }),
			baselineToken({ name: "--card-radius", editable: false }),
		];
		const skipped = buildDumpResult(tokens, 0, ["--color-"]).skipped;
		expect(skipped.notAllowed).toBe(2);
		expect(skipped.nonRoot).toBe(1);
	});

	it("reports zero noise and counts unclassified only among allowed tokens", () => {
		const tokens = [
			baselineToken({ name: "--tw-gradient-from", kind: "color" }),
			baselineToken({ name: "--color-odd", kind: "other" }),
			baselineToken({ name: "--radius-odd", kind: "other" }),
		];
		const skipped = buildDumpResult(tokens, 0, ["--color-"]).skipped;
		expect(skipped.noise).toBe(0);
		expect(skipped.unclassified).toBe(1); // --color-odd; --radius-odd is notAllowed
		expect(skipped.notAllowed).toBe(2);
	});

	it("leaves notAllowed undefined when no allowlist is configured", () => {
		expect(buildDumpResult([], 0).skipped.notAllowed).toBeUndefined();
	});
});

describe("formatSkipped", () => {
	it("formats the three always-present counters", () => {
		expect(
			formatSkipped({
				nonRoot: 1,
				noise: 2,
				unclassified: 1,
				unreadableSheets: 0,
			}),
		).toBe("1 non-root, 1 unclassified, 2 noise vars skipped");
	});

	it("appends the unreadable-sheets counter only when non-zero (PLAN D2)", () => {
		const zero = formatSkipped({
			nonRoot: 0,
			noise: 0,
			unclassified: 0,
			unreadableSheets: 0,
		});
		expect(zero).not.toContain("unreadable");

		const some = formatSkipped({
			nonRoot: 0,
			noise: 0,
			unclassified: 0,
			unreadableSheets: 2,
		});
		expect(some).toContain("2 unreadable sheets");
	});

	it("appends the outside-allowlist counter only when present and non-zero", () => {
		const absent = formatSkipped({
			nonRoot: 0,
			noise: 0,
			unclassified: 0,
			unreadableSheets: 0,
		});
		expect(absent).not.toContain("allowlist");

		const zero = formatSkipped({
			nonRoot: 0,
			noise: 0,
			unclassified: 0,
			notAllowed: 0,
			unreadableSheets: 0,
		});
		expect(zero).not.toContain("allowlist");

		const some = formatSkipped({
			nonRoot: 1,
			noise: 0,
			unclassified: 0,
			notAllowed: 173,
			unreadableSheets: 0,
		});
		expect(some).toContain("173 outside allowlist");
	});
});
