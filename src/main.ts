// src/main.ts — entry point (PLAN §2).
//
// At T5 this orchestrates extract → classify → session and exposes
// `window.LiveTweaks.{dump, rescan}`; T8/T9 add the panel mount on top of the
// same `init()`/`scan()` seam.
//
// D13's noise denylist and the panel-visibility filter are ordinary decision
// logic with no Tweakpane coupling, so they live here — and stay TDD, unlike
// `panel/` (recorded exemption, AGENTS.md).
//
// `scan()` reuses resolve.ts/state.ts's individual pieces (`resolveDocumentTokens`,
// `buildBaseline`, `snapshotInlineCustomProperties`, `TweakSession`) instead of
// `state.ts`'s `createTweakSession()` convenience wire, because it also needs
// `ResolveResult.unreadableSheets` for the dump/skip counters (PLAN D2), which
// `createTweakSession()` does not surface. That is the only reason this module
// does not just call `createTweakSession()` directly.

import type { TokenKind } from "./classify";
import { resolveDocumentTokens } from "./resolve";
import type { BaselineToken } from "./state";
import {
	buildBaseline,
	snapshotInlineCustomProperties,
	TweakSession,
} from "./state";

export const LIVE_TWEAKS_VERSION = "0.0.0";

// D13: known framework-internal root-token prefixes — noise, not design
// tokens, filtered from the panel regardless of how they classify.
const NOISE_PREFIXES = ["--tw-", "--un-"];

/** D13: true when a token name is known framework-internal noise. */
export function isNoiseToken(name: string): boolean {
	return NOISE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** Tokens worth a control: editable (D3), classified (D5), not noise (D13). */
export function panelTokens(tokens: readonly BaselineToken[]): BaselineToken[] {
	return tokens.filter(
		(token) =>
			token.editable && token.kind !== "other" && !isNoiseToken(token.name),
	);
}

export interface DumpToken {
	readonly name: string;
	readonly kind: TokenKind;
}

export interface DumpSkipped {
	/** Tokens with no root-level definition (PLAN D3) — component-scoped noise. */
	readonly nonRoot: number;
	/** Root tokens matching the D13 denylist (`--tw-`, `--un-`). */
	readonly noise: number;
	/** Root, non-noise tokens that classify as `other` (PLAN D5). */
	readonly unclassified: number;
	/** Cross-origin stylesheets the walk could not read (PLAN D2). */
	readonly unreadableSheets: number;
}

export interface DumpResult {
	/** Every root-level token, with its classified kind — includes noise and
	 * unclassified entries (this is the debug view; `panelTokens()` is the
	 * narrower list the panel actually renders). */
	readonly tokens: DumpToken[];
	readonly skipped: DumpSkipped;
}

/** Pure summary behind `dump()`/`rescan()` (D2, D3, D5, D13 counters). */
export function buildDumpResult(
	tokens: readonly BaselineToken[],
	unreadableSheets: number,
): DumpResult {
	const rootTokens = tokens.filter((token) => token.editable);
	return {
		tokens: rootTokens.map((token) => ({ name: token.name, kind: token.kind })),
		skipped: {
			nonRoot: tokens.length - rootTokens.length,
			noise: rootTokens.filter((token) => isNoiseToken(token.name)).length,
			unclassified: rootTokens.filter(
				(token) => token.kind === "other" && !isNoiseToken(token.name),
			).length,
			unreadableSheets,
		},
	};
}

function logSkipped(skipped: DumpSkipped): void {
	const parts = [
		`${skipped.nonRoot} non-root vars`,
		`${skipped.unclassified} unclassified vars`,
		`${skipped.noise} framework-noise vars`,
	];
	if (skipped.unreadableSheets > 0) {
		parts.push(
			`${skipped.unreadableSheets} unreadable stylesheets (cross-origin)`,
		);
	}
	console.log(`live-tweaks: skipped ${parts.join(", ")}`);
}

export interface LiveTweaksApi {
	dump(): DumpResult;
	rescan(): DumpResult;
}

/** The subset of `Window` main.ts touches — a plain object satisfies this in
 * tests, a real `Window` satisfies it in production, no cast either way. */
export interface LiveTweaksWindow {
	LiveTweaks?: LiveTweaksApi;
}

interface Scan {
	readonly session: TweakSession;
	readonly dump: DumpResult;
}

/** Walks the document, builds a fresh session, and computes the dump summary
 * (D2/D3/D5 counters) in one pass — see the file header for why this doesn't
 * just call `createTweakSession()`. */
function scan(doc: Document): Scan {
	const resolved = resolveDocumentTokens(doc);
	const baseline = buildBaseline(resolved.tokens);
	const snapshot = snapshotInlineCustomProperties(doc.documentElement.style);
	const session = new TweakSession(baseline, snapshot);
	return {
		session,
		dump: buildDumpResult(baseline, resolved.unreadableSheets),
	};
}

/**
 * Builds (or reuses) the live-tweaks session for `doc` and exposes
 * `win.LiveTweaks`. Idempotency guard: a second call on the same `win` is a
 * no-op and returns the existing api — double injection must never scan
 * twice or double-apply overrides.
 */
export function init(
	doc: Document = document,
	win: LiveTweaksWindow = window as unknown as LiveTweaksWindow,
): LiveTweaksApi {
	if (win.LiveTweaks) return win.LiveTweaks;

	let current = scan(doc);
	logSkipped(current.dump.skipped);

	const api: LiveTweaksApi = {
		dump: () => current.dump,
		rescan: () => {
			current = scan(doc);
			logSkipped(current.dump.skipped);
			return current.dump;
		},
	};
	win.LiveTweaks = api;
	return api;
}

// Auto-mount on script load (PLAN §2) — the IIFE build's whole point: dropping
// <script src="live-tweaks.js"> into a page must "just work" with no
// caller-side init call. Guarded out under Vitest so unit tests can import
// this module and call `init()` themselves against a document/window they
// control, without a real-DOM side effect racing ahead of them (Vitest
// imports a test file's modules once, not once per test, so an unconditional
// top-level `init()` would run against whatever the very first test's
// document looked like and then idempotency-guard every later test out).
// Vitest sets `process.env.VITEST` — read via a loose structural cast so this
// file needs no `@types/node` dependency for one boolean check.
const runningUnderVitest =
	(globalThis as { process?: { env?: Record<string, string | undefined> } })
		.process?.env?.VITEST === "true";

if (!runningUnderVitest && typeof document !== "undefined") {
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", () => init(), {
			once: true,
		});
	} else {
		init();
	}
}
