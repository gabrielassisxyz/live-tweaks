// T5 — apply.ts is the only module that ever mutates `documentElement.style`
// (state.ts's header comment). It is pure with respect to the DOM: it talks to
// a structural `MutableStyleDeclarationLike`, the same D8 seam T1-T4 use, so it
// is unit-tested with a hand-authored fake, never a real CSSStyleDeclaration.

import { describe, expect, it } from "vitest";
import {
	applyOverride,
	applyReset,
	applyResetAll,
	type MutableStyleDeclarationLike,
} from "./apply";

function fakeStyle(): MutableStyleDeclarationLike & {
	values: Map<string, string>;
} {
	const values = new Map<string, string>();
	return {
		values,
		get length() {
			return values.size;
		},
		item: (index) => [...values.keys()][index] ?? "",
		getPropertyValue: (name) => values.get(name) ?? "",
		setProperty: (name, value) => {
			values.set(name, value);
		},
		removeProperty: (name) => {
			const previous = values.get(name) ?? "";
			values.delete(name);
			return previous;
		},
	};
}

describe("applyOverride", () => {
	it("sets the inline custom property to the given value", () => {
		const style = fakeStyle();
		applyOverride(style, "--color-primary", "#e07850");
		expect(style.values.get("--color-primary")).toBe("#e07850");
	});

	it("a later call replaces the earlier value", () => {
		const style = fakeStyle();
		applyOverride(style, "--color-primary", "#111111");
		applyOverride(style, "--color-primary", "#222222");
		expect(style.values.get("--color-primary")).toBe("#222222");
	});
});

describe("applyReset", () => {
	it("restores the pre-existing inline value on a 'restore' instruction (D12)", () => {
		const style = fakeStyle();
		applyOverride(style, "--color-primary", "#e07850");
		applyReset(style, {
			name: "--color-primary",
			action: "restore",
			value: "#000000",
		});
		expect(style.values.get("--color-primary")).toBe("#000000");
	});

	it("removes the inline property on a 'remove' instruction (D12)", () => {
		const style = fakeStyle();
		applyOverride(style, "--color-primary", "#e07850");
		applyReset(style, { name: "--color-primary", action: "remove" });
		expect(style.values.has("--color-primary")).toBe(false);
	});
});

describe("applyResetAll", () => {
	it("executes every instruction in order", () => {
		const style = fakeStyle();
		applyOverride(style, "--a", "#111111");
		applyOverride(style, "--b", "#222222");
		applyResetAll(style, [
			{ name: "--a", action: "restore", value: "#000000" },
			{ name: "--b", action: "remove" },
		]);
		expect(style.values.get("--a")).toBe("#000000");
		expect(style.values.has("--b")).toBe(false);
	});

	it("is a no-op on an empty instruction list", () => {
		const style = fakeStyle();
		applyOverride(style, "--a", "#111111");
		applyResetAll(style, []);
		expect(style.values.get("--a")).toBe("#111111");
	});
});
