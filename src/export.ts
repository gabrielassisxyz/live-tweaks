// src/export.ts — T10: Save → PLAN §4 contract JSON → clipboard.
//
// `exportDiff()` is the core: serialize a `TweakSession`'s `diff()` to the
// contract JSON and attempt a clipboard write, reporting whether it actually
// landed. "Attempt" is deliberate: `navigator.clipboard.writeText` can
// reject even when the API exists (no user gesture, denied permission,
// insecure context, the Clipboard API disabled by policy) — the fallback
// modal must trigger on that rejection, not just on the API being absent
// entirely, which is why `copied` is decided by awaiting the write, never by
// a feature-detection check alone.
//
// `showFallbackModal()`/`saveAndExport()` are plain DOM, not Tweakpane —
// still TDD per AGENTS.md (only `src/panel/` is exempted).

import type { TweakSession } from "./state";

/** The subset of the Clipboard API this module needs — real
 * `navigator.clipboard` satisfies it without a cast; tests inject a fake
 * that resolves or rejects on demand (D8 seam). */
export interface ClipboardLike {
	writeText(text: string): Promise<void>;
}

export interface ExportResult {
	/** PLAN §4 contract JSON, pretty-printed. */
	readonly json: string;
	/** True only if `clipboard.writeText()` actually resolved. */
	readonly copied: boolean;
}

/**
 * Serializes `session.diff()` (PLAN §4) and attempts a clipboard write.
 * `clipboard` is `undefined` when the API isn't present at all — both that
 * case and a write rejection report `copied: false` identically, so callers
 * can react the same way to either failure mode (show the fallback modal).
 */
export async function exportDiff(
	session: Pick<TweakSession, "diff">,
	clipboard: ClipboardLike | undefined,
): Promise<ExportResult> {
	const json = JSON.stringify(session.diff(), null, 2);
	if (!clipboard) {
		return { json, copied: false };
	}
	try {
		await clipboard.writeText(json);
		return { json, copied: true };
	} catch {
		return { json, copied: false };
	}
}

const FALLBACK_MODAL_ID = "live-tweaks-export-fallback";

/**
 * Shows a copy-paste fallback when the clipboard write didn't land: a
 * fixed-position overlay with the JSON pre-filled and pre-selected in a
 * `<textarea>`, plus a close button. Appended directly to `doc.body` (not
 * the panel's shadow root) so it stays visible even if the panel is
 * collapsed. Replaces any previous instance instead of stacking — Save can
 * be clicked more than once.
 */
export function showFallbackModal(doc: Document, json: string): HTMLElement {
	doc.getElementById(FALLBACK_MODAL_ID)?.remove();

	const overlay = doc.createElement("div");
	overlay.id = FALLBACK_MODAL_ID;
	Object.assign(overlay.style, {
		position: "fixed",
		inset: "0",
		background: "rgba(0, 0, 0, 0.5)",
		zIndex: "2147483647",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		fontFamily: "system-ui, sans-serif",
	});

	const box = doc.createElement("div");
	Object.assign(box.style, {
		background: "#ffffff",
		color: "#1e1e2e",
		padding: "16px",
		borderRadius: "6px",
		width: "min(480px, 90vw)",
	});

	const message = doc.createElement("p");
	message.textContent =
		"Couldn't copy to the clipboard automatically. Copy the diff below and paste it into /tweaks implement:";
	Object.assign(message.style, { margin: "0 0 8px 0", fontSize: "13px" });

	const textarea = doc.createElement("textarea");
	textarea.value = json;
	textarea.readOnly = true;
	Object.assign(textarea.style, {
		width: "100%",
		height: "200px",
		boxSizing: "border-box",
		fontFamily: "ui-monospace, monospace",
		fontSize: "12px",
	});

	const closeButton = doc.createElement("button");
	closeButton.type = "button";
	closeButton.textContent = "Close";
	closeButton.style.marginTop = "8px";
	closeButton.addEventListener("click", () => overlay.remove());

	box.append(message, textarea, closeButton);
	overlay.append(box);
	doc.body.append(overlay);

	textarea.focus();
	textarea.select();

	return overlay;
}

/**
 * The whole Save action: export the diff, attempt the clipboard, and fall
 * back to the copy-paste modal on any failure — absent API or rejected
 * write alike (T10's requirement).
 */
export async function saveAndExport(
	doc: Document,
	session: Pick<TweakSession, "diff">,
	clipboard: ClipboardLike | undefined,
): Promise<ExportResult> {
	const result = await exportDiff(session, clipboard);
	if (!result.copied) {
		showFallbackModal(doc, result.json);
	}
	return result;
}
