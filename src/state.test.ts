// The D8 pure seam for T4's state layer: `buildBaseline`, the inline snapshot
// reader, and `TweakSession` are all exercised with hand-authored fixtures — no
// DOM, per AGENTS.md's TDD rule and PLAN §2 ("everything left of panel/ is
// framework-free, DOM-light, unit-tested"). The production wire
// (`createTweakSession`) is covered separately in state.dom.test.ts, mirroring
// resolve.ts's pure/dom split (D8).

import { describe, expect, it } from "vitest";
import type { SupportsColor } from "./classify";
import type { StyleDeclarationLike } from "./extract";
import type { ResolvedToken } from "./resolve";
import {
	type BaselineToken,
	buildBaseline,
	snapshotInlineCustomProperties,
	TweakSession,
} from "./state";

// Mirrors classify.test.ts's fake: jsdom exposes no global CSS.supports, so
// production's defaultSupportsColor never fires in tests.
const fakeSupportsColor: SupportsColor = (value) =>
	/^#[0-9a-f]{6}$/i.test(value);

function resolved(overrides: Partial<ResolvedToken> = {}): ResolvedToken {
	return {
		name: "--color-primary",
		definitions: [],
		activeValue: "#8839ef",
		editable: true,
		before: "#8839ef",
		...overrides,
	};
}

function fakeStyle(map: Record<string, string>): StyleDeclarationLike {
	const names = Object.keys(map);
	return {
		length: names.length,
		item: (index) => names[index] ?? "",
		getPropertyValue: (name) => map[name] ?? "",
	};
}

describe("buildBaseline", () => {
	it("carries both the raw anchor and the resolved active value per token (D4)", () => {
		const token = resolved({
			name: "--button-bg",
			before: "var(--brand-light)", // raw text, unresolved
			activeValue: "rgb(180, 197, 254)", // resolved, canonicalized
		});
		const [baseline] = buildBaseline([token], fakeSupportsColor);
		expect(baseline?.before).toBe("var(--brand-light)");
		expect(baseline?.activeValue).toBe("rgb(180, 197, 254)");
	});

	it("classifies each token from its resolved active value (D5)", () => {
		const tokens: ResolvedToken[] = [
			resolved({ name: "--color-primary", activeValue: "#8839ef" }),
			resolved({ name: "--font-body", activeValue: "Inter, sans-serif" }),
			resolved({ name: "--icon-size", activeValue: "16px" }),
			resolved({ name: "--spacing", activeValue: "calc(1rem + 2px)" }),
		];
		const baseline = buildBaseline(tokens, fakeSupportsColor);
		expect(baseline.map((t) => t.kind)).toEqual([
			"color",
			"font-family",
			"length",
			"other",
		]);
	});

	it("passes editable through unchanged (PLAN D3)", () => {
		const tokens: ResolvedToken[] = [
			resolved({ name: "--a", editable: true }),
			resolved({ name: "--focus", editable: false }),
		];
		expect(
			buildBaseline(tokens, fakeSupportsColor).map((t) => t.editable),
		).toEqual([true, false]);
	});

	it("uses the default CSS.supports-based color check when none is injected", () => {
		// jsdom has no global CSS, so this exercises the production default path
		// without asserting a specific outcome — only that it doesn't throw.
		expect(() => buildBaseline([resolved()])).not.toThrow();
	});
});

describe("snapshotInlineCustomProperties", () => {
	it("collects only custom-property entries, trimmed", () => {
		const snapshot = snapshotInlineCustomProperties(
			fakeStyle({ "--color-primary": "  #111111  ", color: "red" }),
		);
		expect(snapshot.size).toBe(1);
		expect(snapshot.get("--color-primary")).toBe("#111111");
	});

	it("returns an empty snapshot when nothing is set inline", () => {
		expect(snapshotInlineCustomProperties(fakeStyle({})).size).toBe(0);
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

describe("TweakSession — reading state", () => {
	it("tokens() returns every baseline token", () => {
		const session = new TweakSession([
			baselineToken({ name: "--a" }),
			baselineToken({ name: "--b" }),
		]);
		expect(session.tokens().map((t) => t.name)).toEqual(["--a", "--b"]);
	});

	it("currentValue() falls back to the baseline's resolved value with no override", () => {
		const session = new TweakSession([
			baselineToken({ activeValue: "#8839ef" }),
		]);
		expect(session.currentValue("--color-primary")).toBe("#8839ef");
	});

	it("currentValue() reflects a live override once set", () => {
		const session = new TweakSession([baselineToken()]);
		session.setOverride("--color-primary", "#e07850");
		expect(session.currentValue("--color-primary")).toBe("#e07850");
	});

	it("currentValue() is undefined for an unknown token", () => {
		const session = new TweakSession([baselineToken()]);
		expect(session.currentValue("--nope")).toBeUndefined();
	});
});

describe("TweakSession — setOverride", () => {
	it("throws on an unknown token name (panel/wiring bug, not a user error)", () => {
		const session = new TweakSession([baselineToken()]);
		expect(() => session.setOverride("--nope", "red")).toThrow(/unknown token/);
	});

	it("a later override on the same token replaces the earlier one", () => {
		const session = new TweakSession([baselineToken()]);
		session.setOverride("--color-primary", "#111111");
		session.setOverride("--color-primary", "#222222");
		expect(session.currentValue("--color-primary")).toBe("#222222");
		expect(session.diff()).toEqual({
			"--color-primary": { before: "#8839ef", after: "#222222" },
		});
	});
});

describe("TweakSession — diff() (PLAN §4 contract)", () => {
	it("is empty with no edits", () => {
		const session = new TweakSession([baselineToken()]);
		expect(session.diff()).toEqual({});
	});

	it("uses the baseline anchor as `before`, not the resolved active value", () => {
		// D4: a var() token displays resolved but the contract's `before` is the
		// raw text — buildBaseline already made that distinction; diff() must
		// preserve it, not silently swap in activeValue.
		const session = new TweakSession([
			baselineToken({
				name: "--button-bg",
				before: "var(--brand-light)",
				activeValue: "rgb(180, 197, 254)",
			}),
		]);
		session.setOverride("--button-bg", "#e07850");
		expect(session.diff()).toEqual({
			"--button-bg": { before: "var(--brand-light)", after: "#e07850" },
		});
	});

	it("omits a token reset back to baseline (never appears in the diff)", () => {
		const session = new TweakSession([
			baselineToken({ name: "--a" }),
			baselineToken({ name: "--b" }),
		]);
		session.setOverride("--a", "#111111");
		session.setOverride("--b", "#222222");
		session.reset("--a");
		expect(session.diff()).toEqual({
			"--b": { before: "#8839ef", after: "#222222" },
		});
	});
});

describe("TweakSession — reset(name) (PLAN D12)", () => {
	it("restores the pre-existing inline snapshot value when there was one", () => {
		const session = new TweakSession(
			[baselineToken()],
			new Map([["--color-primary", "#000000"]]), // a theme manager set this before init
		);
		session.setOverride("--color-primary", "#e07850");
		expect(session.reset("--color-primary")).toEqual({
			name: "--color-primary",
			action: "restore",
			value: "#000000",
		});
	});

	it("reports removal when there was no pre-existing inline value", () => {
		const session = new TweakSession([baselineToken()]); // no snapshot entry
		session.setOverride("--color-primary", "#e07850");
		expect(session.reset("--color-primary")).toEqual({
			name: "--color-primary",
			action: "remove",
		});
	});

	it("clears the override, so the token disappears from the diff", () => {
		const session = new TweakSession([baselineToken()]);
		session.setOverride("--color-primary", "#e07850");
		session.reset("--color-primary");
		expect(session.diff()).toEqual({});
	});

	it("currentValue() falls back to the baseline value after reset", () => {
		const session = new TweakSession([
			baselineToken({ activeValue: "#8839ef" }),
		]);
		session.setOverride("--color-primary", "#e07850");
		session.reset("--color-primary");
		expect(session.currentValue("--color-primary")).toBe("#8839ef");
	});

	it("is a no-op (returns undefined) for a token with no active override", () => {
		const session = new TweakSession([baselineToken()]);
		expect(session.reset("--color-primary")).toBeUndefined();
	});

	it("is a no-op (returns undefined) for an unknown token name", () => {
		const session = new TweakSession([baselineToken()]);
		expect(session.reset("--nope")).toBeUndefined();
	});
});

describe("TweakSession — resetAll() (PLAN D12)", () => {
	it("returns one instruction per overridden token and clears every override", () => {
		const session = new TweakSession(
			[baselineToken({ name: "--a" }), baselineToken({ name: "--b" })],
			new Map([["--a", "#000000"]]), // only --a had a pre-existing inline value
		);
		session.setOverride("--a", "#111111");
		session.setOverride("--b", "#222222");

		const instructions = session.resetAll();

		expect(instructions).toEqual(
			expect.arrayContaining([
				{ name: "--a", action: "restore", value: "#000000" },
				{ name: "--b", action: "remove" },
			]),
		);
		expect(instructions).toHaveLength(2);
		expect(session.diff()).toEqual({});
	});

	it("returns an empty array when nothing was overridden", () => {
		const session = new TweakSession([baselineToken()]);
		expect(session.resetAll()).toEqual([]);
	});
});

describe("TweakSession — mergeNewTokens() (rescan review-gate fix)", () => {
	it("adds tokens the session didn't know about, from the other session's baseline", () => {
		const session = new TweakSession([baselineToken({ name: "--a" })]);
		const fresh = new TweakSession([
			baselineToken({ name: "--a" }),
			baselineToken({ name: "--b", before: "#222222", activeValue: "#222222" }),
		]);

		session.mergeNewTokens(fresh);

		expect(session.tokens().map((t) => t.name)).toEqual(["--a", "--b"]);
		expect(session.currentValue("--b")).toBe("#222222");
	});

	it("leaves an already-known token's baseline completely untouched", () => {
		const session = new TweakSession([
			baselineToken({ name: "--a", before: "#8839ef", activeValue: "#8839ef" }),
		]);
		// A fresh scan of a DOM the user has since edited would see --a's
		// *edited* value as both the new activeValue and (wrongly) the new
		// before anchor — merging must never let that leak into the session.
		const fresh = new TweakSession([
			baselineToken({ name: "--a", before: "#e07850", activeValue: "#e07850" }),
		]);

		session.mergeNewTokens(fresh);

		const merged = session.tokens().find((t) => t.name === "--a");
		expect(merged?.before).toBe("#8839ef");
		expect(merged?.activeValue).toBe("#8839ef");
	});

	it("does not overwrite an already-known token's snapshot value", () => {
		const session = new TweakSession(
			[baselineToken({ name: "--a" })],
			new Map([["--a", "#000000"]]), // the true pre-session inline value
		);
		session.setOverride("--a", "#e07850");
		// The fresh scan's snapshot sees the user's own inline override and
		// would (wrongly) treat it as "pre-existing" if it won.
		const fresh = new TweakSession(
			[baselineToken({ name: "--a" })],
			new Map([["--a", "#e07850"]]),
		);

		session.mergeNewTokens(fresh);

		expect(session.reset("--a")).toEqual({
			name: "--a",
			action: "restore",
			value: "#000000",
		});
	});

	it("does not overwrite an already-known token's live override — diff() keeps exporting it", () => {
		const session = new TweakSession([
			baselineToken({ name: "--a", before: "#8839ef" }),
		]);
		session.setOverride("--a", "#e07850");
		const fresh = new TweakSession([
			baselineToken({ name: "--a", before: "#e07850", activeValue: "#e07850" }),
		]);

		session.mergeNewTokens(fresh);

		expect(session.diff()).toEqual({
			"--a": { before: "#8839ef", after: "#e07850" },
		});
	});

	it("uses the new token's own snapshot value for reset (it really is new)", () => {
		const session = new TweakSession([baselineToken({ name: "--a" })]);
		const fresh = new TweakSession(
			[baselineToken({ name: "--b" })],
			new Map([["--b", "#333333"]]),
		);

		session.mergeNewTokens(fresh);
		session.setOverride("--b", "#444444");

		expect(session.reset("--b")).toEqual({
			name: "--b",
			action: "restore",
			value: "#333333",
		});
	});

	it("leaves a token that vanished from the fresh scan in place (harmless)", () => {
		const session = new TweakSession([
			baselineToken({ name: "--a" }),
			baselineToken({ name: "--b" }),
		]);
		const fresh = new TweakSession([baselineToken({ name: "--a" })]); // --b is gone

		session.mergeNewTokens(fresh);

		expect(session.tokens().map((t) => t.name)).toEqual(["--a", "--b"]);
	});
});
