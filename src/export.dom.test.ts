// @vitest-environment jsdom

// T10 — the DOM-coupled half of export.ts: the fallback modal and
// `saveAndExport()`'s decision to show it. Mirrors the rest of the codebase's
// pure/dom split (D8) — export.test.ts already covers `exportDiff()`'s own
// logic with fake clipboards; this file only checks the DOM plumbing on top.

import { afterEach, describe, expect, it } from "vitest";
import type { ClipboardLike } from "./export";
import { saveAndExport, showFallbackModal } from "./export";
import type { TweakSession } from "./state";

function fakeSession(
	diff: Record<string, { before: string; after: string }>,
): Pick<TweakSession, "diff"> {
	return { diff: () => diff };
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("showFallbackModal", () => {
	it("appends an overlay with the JSON pre-filled in a textarea", () => {
		const modal = showFallbackModal(
			document,
			'{"--a":{"before":"1","after":"2"}}',
		);
		expect(document.body.contains(modal)).toBe(true);
		const textarea = modal.querySelector("textarea");
		expect(textarea?.value).toBe('{"--a":{"before":"1","after":"2"}}');
	});

	it("pre-selects the textarea contents so a plain Ctrl/Cmd+C works", () => {
		showFallbackModal(document, "{}");
		const textarea = document.querySelector("textarea");
		expect(document.activeElement).toBe(textarea);
		expect(textarea?.selectionStart).toBe(0);
		expect(textarea?.selectionEnd).toBe(2);
	});

	it("replaces a previous instance instead of stacking", () => {
		showFallbackModal(document, "{}");
		showFallbackModal(document, '{"--a":{"before":"1","after":"2"}}');
		const modals = document.querySelectorAll("#live-tweaks-export-fallback");
		expect(modals).toHaveLength(1);
		expect(modals[0]?.querySelector("textarea")?.value).toBe(
			'{"--a":{"before":"1","after":"2"}}',
		);
	});

	it("the close button removes the modal", () => {
		const modal = showFallbackModal(document, "{}");
		modal
			.querySelector("button")
			?.dispatchEvent(new Event("click", { bubbles: true }));
		expect(document.body.contains(modal)).toBe(false);
	});
});

describe("saveAndExport", () => {
	it("shows the fallback modal when the clipboard write rejects", async () => {
		const session = fakeSession({ "--a": { before: "1", after: "2" } });
		const clipboard: ClipboardLike = {
			writeText: async () => {
				throw new Error("denied");
			},
		};
		await saveAndExport(document, session, clipboard);
		expect(
			document.getElementById("live-tweaks-export-fallback"),
		).not.toBeNull();
	});

	it("shows the fallback modal when the clipboard API is absent", async () => {
		await saveAndExport(document, fakeSession({}), undefined);
		expect(
			document.getElementById("live-tweaks-export-fallback"),
		).not.toBeNull();
	});

	it("does not show the fallback modal when the write succeeds", async () => {
		const clipboard: ClipboardLike = { writeText: async () => {} };
		await saveAndExport(document, fakeSession({}), clipboard);
		expect(document.getElementById("live-tweaks-export-fallback")).toBeNull();
	});
});
