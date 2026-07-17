// T10 — the clipboard-facing core of export.ts, exercised with a fake
// `ClipboardLike` (D8 seam): a resolving fake, a rejecting fake, and
// `undefined` (API absent). The DOM-coupled half (the fallback modal,
// `saveAndExport()`) is covered in export.dom.test.ts.

import { describe, expect, it } from "vitest";
import { type ClipboardLike, exportDiff } from "./export";
import { type BaselineToken, TweakSession } from "./state";

function fakeSession(
	diff: Record<string, { before: string; after: string }>,
): Pick<TweakSession, "diff"> {
	return { diff: () => diff };
}

function resolvingClipboard(): ClipboardLike & { written: string[] } {
	const written: string[] = [];
	return {
		written,
		writeText: async (text) => {
			written.push(text);
		},
	};
}

function rejectingClipboard(): ClipboardLike {
	return {
		writeText: async () => {
			throw new Error("NotAllowedError: denied");
		},
	};
}

describe("exportDiff", () => {
	it("serializes session.diff() as the PLAN §4 contract JSON", async () => {
		const session = fakeSession({
			"--color-primary": { before: "#8839ef", after: "#e07850" },
		});
		const result = await exportDiff(session, resolvingClipboard());
		expect(JSON.parse(result.json)).toEqual({
			"--color-primary": { before: "#8839ef", after: "#e07850" },
		});
	});

	it("reports copied: true and writes the json when the clipboard resolves", async () => {
		const session = fakeSession({});
		const clipboard = resolvingClipboard();
		const result = await exportDiff(session, clipboard);
		expect(result.copied).toBe(true);
		expect(clipboard.written).toEqual([result.json]);
	});

	it("reports copied: false when the clipboard API is absent entirely", async () => {
		const session = fakeSession({});
		const result = await exportDiff(session, undefined);
		expect(result.copied).toBe(false);
	});

	it("reports copied: false when clipboard.writeText() rejects — not just when the API is absent", async () => {
		const session = fakeSession({});
		const result = await exportDiff(session, rejectingClipboard());
		expect(result.copied).toBe(false);
		// The json is still produced even though the copy failed — the fallback
		// modal (export.dom.test.ts) needs it to show the user something to
		// copy by hand.
		expect(result.json).toBe("{}");
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

describe("exportDiff — T10 unit verify", () => {
	it("a real session with 2 edits + 1 reset exports exactly the 2, before = raw authored text", async () => {
		const session = new TweakSession([
			baselineToken({ name: "--color-primary", before: "#8839ef" }),
			baselineToken({
				name: "--font-body",
				before: "Inter, sans-serif",
				activeValue: "Inter, sans-serif",
				kind: "font-family",
			}),
			baselineToken({
				name: "--radius-md",
				before: "8px",
				activeValue: "8px",
				kind: "length",
			}),
		]);
		session.setOverride("--color-primary", "#e07850");
		session.setOverride("--font-body", "Georgia, serif");
		session.setOverride("--radius-md", "16px");
		session.reset("--radius-md"); // edited, then reset back — must not appear

		const result = await exportDiff(session, resolvingClipboard());
		const parsed = JSON.parse(result.json);

		expect(Object.keys(parsed)).toEqual(["--color-primary", "--font-body"]);
		expect(parsed).toEqual({
			"--color-primary": { before: "#8839ef", after: "#e07850" },
			"--font-body": { before: "Inter, sans-serif", after: "Georgia, serif" },
		});
	});
});
