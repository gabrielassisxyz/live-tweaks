// src/main.ts — entry point (PLAN §2).
//
// Orchestrates extract → classify → session → panel mount and exposes
// `window.LiveTweaks.{dump, rescan}`.
//
// D13's noise denylist, the panel-visibility filter, and the edit/reset
// wiring (T9) are ordinary decision logic with no Tweakpane coupling, so they
// live here — and stay TDD, unlike `panel/` (recorded exemption, AGENTS.md).
// The panel itself is created through an injectable `PanelFactory` (defaults
// to the real `createPanelHost`/`createTweaksPanel`) precisely so this
// module's own DOM tests (main.dom.test.ts) can exercise the wiring against
// a fake panel under jsdom, which cannot run a real Tweakpane instance.
//
// `scan()` reuses resolve.ts/state.ts's individual pieces (`resolveDocumentTokens`,
// `buildBaseline`, `snapshotInlineCustomProperties`, `TweakSession`) instead of
// `state.ts`'s `createTweakSession()` convenience wire, because it also needs
// `ResolveResult.unreadableSheets` for the dump/skip counters (PLAN D2), which
// `createTweakSession()` does not surface. That is the only reason this module
// does not just call `createTweakSession()` directly.

import { applyOverride, applyReset, applyResetAll } from "./apply";
import type { TokenKind } from "./classify";
import { saveAndExport } from "./export";
import { createPanelHost, type PanelHost } from "./panel/host";
import {
	createTweaksPanel,
	type PanelToken,
	type TweaksPanel,
	type TweaksPanelCallbacks,
} from "./panel/panel";
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

/**
 * D13 fallback (built after T15 failed the usability gate at kernl scale —
 * daisyUI floods `:root` with ~177 unprefixed tokens the denylist cannot
 * enumerate): an optional caller-provided allowlist of name prefixes.
 * Validates the raw `window.LiveTweaksConfig` value, since it arrives from
 * the host page untyped. Invalid shapes warn and fall back to no allowlist
 * (denylist behavior) rather than throwing — a config typo must never take
 * the panel down.
 */
export function readAllowlist(config: unknown): string[] | undefined {
	if (config === undefined || config === null) return undefined;
	// An array is a plausible typo for the intended shape, so it gets the same
	// explicit warning instead of falling through as "object with no allow".
	if (typeof config !== "object" || Array.isArray(config)) {
		console.warn(
			"live-tweaks: ignoring LiveTweaksConfig — expected an object like { allow: [...] }",
		);
		return undefined;
	}
	const allow = (config as { allow?: unknown }).allow;
	if (allow === undefined) return undefined;
	if (!Array.isArray(allow)) {
		console.warn(
			"live-tweaks: ignoring LiveTweaksConfig.allow — expected an array of custom-property name prefixes",
		);
		return undefined;
	}
	const valid = allow.filter(
		(entry): entry is string =>
			typeof entry === "string" && entry.startsWith("--"),
	);
	if (valid.length < allow.length) {
		console.warn(
			`live-tweaks: dropped ${allow.length - valid.length} LiveTweaksConfig.allow entries — each must be a string starting with "--"`,
		);
	}
	if (valid.length === 0) {
		// A declared-but-empty allowlist is a mistake, not a request to show
		// nothing: falling back silently would flood the panel with zero
		// feedback about why.
		console.warn(
			"live-tweaks: LiveTweaksConfig.allow has no valid entries — falling back to the default noise filter",
		);
		return undefined;
	}
	return valid;
}

/** A trailing-dash entry (`--color-`) matches as a prefix; any other entry
 * matches exactly. Exact entries deliberately do NOT match as prefixes:
 * frameworks shadow app tokens and extend them with suffixes (daisyUI's
 * `--color-primary-content` next to an app's `--color-primary`), so
 * prefix-matching exact names would re-admit precisely the noise the
 * allowlist exists to block — measured on kernl: 104 exact names matched
 * 227 tokens under prefix semantics. */
function matchesAllowlist(name: string, allow: readonly string[]): boolean {
	return allow.some((entry) =>
		entry.endsWith("-") ? name.startsWith(entry) : name === entry,
	);
}

function allowlistIndex(name: string, allow: readonly string[]): number {
	return allow.findIndex((entry) =>
		entry.endsWith("-") ? name.startsWith(entry) : name === entry,
	);
}

/** Tokens worth a control: editable (D3), classified (D5), and past the D13
 * noise filter — the allowlist when one is configured (it supersedes the
 * denylist: an explicit allow is better information than a built-in guess),
 * the `--tw-`/`--un-` denylist otherwise.
 *
 * With an allowlist the result is ordered by allow-entry order (stable
 * within one entry): the list's author ranks tokens by visual prominence
 * and the panel honors it — the /tweaks skill's setup mode writes the list
 * most-prominent-first. Without one, scan order is kept. */
export function panelTokens(
	tokens: readonly BaselineToken[],
	allow?: readonly string[],
): BaselineToken[] {
	const visible = tokens.filter(
		(token) =>
			token.editable &&
			token.kind !== "other" &&
			(allow ? matchesAllowlist(token.name, allow) : !isNoiseToken(token.name)),
	);
	if (!allow) return visible;
	return visible
		.map((token, scanIndex) => ({ token, scanIndex }))
		.sort(
			(a, b) =>
				allowlistIndex(a.token.name, allow) -
					allowlistIndex(b.token.name, allow) || a.scanIndex - b.scanIndex,
		)
		.map((entry) => entry.token);
}

export interface DumpToken {
	readonly name: string;
	readonly kind: TokenKind;
}

export interface DumpSkipped {
	/** Tokens with no root-level definition (PLAN D3) — component-scoped noise. */
	readonly nonRoot: number;
	/** Root tokens matching the D13 denylist (`--tw-`, `--un-`). Always 0 when
	 * an allowlist is active — the allowlist supersedes the denylist. */
	readonly noise: number;
	/** Root tokens (allowed ones, when an allowlist is active) that classify
	 * as `other` (PLAN D5). */
	readonly unclassified: number;
	/** Root tokens outside the configured allowlist (D13 fallback). Only
	 * present when an allowlist is active. */
	readonly notAllowed?: number;
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

/** Pure summary behind `dump()`/`rescan()` (D2, D3, D5, D13 counters). With
 * an allowlist the noise counter is retired (always 0) and `notAllowed`
 * appears instead — the two never overlap, so the counters still partition
 * the skipped root tokens. */
export function buildDumpResult(
	tokens: readonly BaselineToken[],
	unreadableSheets: number,
	allow?: readonly string[],
): DumpResult {
	const rootTokens = tokens.filter((token) => token.editable);
	const dumpTokens = rootTokens.map((token) => ({
		name: token.name,
		kind: token.kind,
	}));
	if (allow) {
		const allowed = rootTokens.filter((token) =>
			matchesAllowlist(token.name, allow),
		);
		return {
			tokens: dumpTokens,
			skipped: {
				nonRoot: tokens.length - rootTokens.length,
				noise: 0,
				unclassified: allowed.filter((token) => token.kind === "other").length,
				notAllowed: rootTokens.length - allowed.length,
				unreadableSheets,
			},
		};
	}
	return {
		tokens: dumpTokens,
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

/** Pure text behind both the console log and the panel's skip-counter line —
 * one source of truth for the D3/D5/D13 summary wording. */
export function formatSkipped(skipped: DumpSkipped): string {
	const parts = [
		`${skipped.nonRoot} non-root`,
		`${skipped.unclassified} unclassified`,
	];
	// The noise counter is retired under an allowlist (always 0) — printing
	// it would only make the summary read like the denylist still applies.
	if (skipped.notAllowed === undefined) {
		parts.push(`${skipped.noise} noise`);
	}
	if (skipped.notAllowed !== undefined && skipped.notAllowed > 0) {
		parts.push(`${skipped.notAllowed} outside allowlist`);
	}
	if (skipped.unreadableSheets > 0) {
		parts.push(`${skipped.unreadableSheets} unreadable sheets`);
	}
	return `${parts.join(", ")} vars skipped`;
}

function logSkipped(skipped: DumpSkipped): void {
	console.log(`live-tweaks: ${formatSkipped(skipped)}`);
}

/** A token converted for the panel's consumption. Throws only if a caller
 * ever passes an unclassified token — unreachable in practice since
 * `panelTokens()` already excludes `kind === "other"`; the guard exists so
 * this stays a real narrowing function instead of an unchecked cast. */
function toPanelToken(token: BaselineToken, value: string): PanelToken {
	if (token.kind === "other") {
		throw new Error(
			`live-tweaks: unexpected unclassified token reached the panel: ${token.name}`,
		);
	}
	return { name: token.name, kind: token.kind, value };
}

/** The panel's current token list: `panelTokens()`'s filter (D3/D5/D13),
 * each with its *live* value (a user override if one exists, else the
 * baseline's resolved value) — so a rescan or a fresh mount always shows
 * what's actually applied to the page, not just the baseline. */
function buildPanelTokens(
	session: TweakSession,
	allow?: readonly string[],
): PanelToken[] {
	return panelTokens(session.tokens(), allow).map((token) =>
		toPanelToken(token, session.currentValue(token.name) ?? token.activeValue),
	);
}

/** Creates the panel host + implementation. Defaults to the real Tweakpane
 * wiring (`panel/host.ts` + `panel/panel.ts`); overridable so tests can
 * supply a fake and exercise `init()`'s wiring without a real Tweakpane
 * instance under jsdom (PLAN §2's panel/ TDD exemption applies to Tweakpane
 * itself, not to the plain glue code in this file). */
export interface PanelFactory {
	createHost(doc: Document): PanelHost;
	createPanel(
		contentMount: HTMLElement,
		shadowRoot: ShadowRoot,
		callbacks: TweaksPanelCallbacks,
	): TweaksPanel;
}

const defaultPanelFactory: PanelFactory = {
	createHost: createPanelHost,
	createPanel: createTweaksPanel,
};

export interface LiveTweaksApi {
	dump(): DumpResult;
	rescan(): DumpResult;
}

/** The subset of `Window` main.ts touches — a plain object satisfies this in
 * tests, a real `Window` satisfies it in production, no cast either way. */
export interface LiveTweaksWindow {
	LiveTweaks?: LiveTweaksApi;
	/** Optional pre-declared config, set by the page BEFORE the script loads
	 * (the analytics-snippet pattern — the one shape that works identically
	 * for the script-tag and bundler injection paths, since the IIFE
	 * auto-mounts and there is no init call to pass options to). Typed
	 * `unknown` on purpose: it crosses from the untyped host page and is
	 * validated by `readAllowlist()`. */
	LiveTweaksConfig?: unknown;
}

interface Scan {
	readonly session: TweakSession;
	readonly dump: DumpResult;
}

/** Walks the document, builds a fresh session, and computes the dump summary
 * (D2/D3/D5 counters) in one pass — see the file header for why this doesn't
 * just call `createTweakSession()`. */
function scan(doc: Document, allow?: readonly string[]): Scan {
	const resolved = resolveDocumentTokens(doc);
	const baseline = buildBaseline(resolved.tokens);
	const snapshot = snapshotInlineCustomProperties(doc.documentElement.style);
	const session = new TweakSession(baseline, snapshot);
	return {
		session,
		dump: buildDumpResult(baseline, resolved.unreadableSheets, allow),
	};
}

/**
 * Builds (or reuses) the live-tweaks session for `doc`, mounts the panel, and
 * exposes `win.LiveTweaks`. Idempotency guard: a second call on the same
 * `win` is a no-op and returns the existing api — double injection must
 * never scan twice, mount a second panel, or double-apply overrides.
 *
 * Edit wiring (T9, PLAN D12): a control change records the override in
 * `TweakSession` and applies it to the DOM in the same step (`apply.ts` is
 * the only thing that ever touches `documentElement.style`); a per-var reset
 * or reset-all asks the session what that means (restore the pre-existing
 * inline snapshot, or remove the property), executes it, and pushes the
 * restored value back into the panel's control via `setValue()` — a reset
 * can be triggered without the user touching the control itself, so the
 * displayed value must be told to catch up.
 */
export function init(
	doc: Document = document,
	win: LiveTweaksWindow = window as unknown as LiveTweaksWindow,
	panelFactory: PanelFactory = defaultPanelFactory,
): LiveTweaksApi {
	if (win.LiveTweaks) return win.LiveTweaks;

	// Read once at init: the config is a page-load-time declaration, not a
	// live channel — changing it after injection requires a reload.
	const allow = readAllowlist(win.LiveTweaksConfig);
	let current = scan(doc, allow);
	logSkipped(current.dump.skipped);

	const host = panelFactory.createHost(doc);
	const panel = panelFactory.createPanel(host.contentMount, host.shadowRoot, {
		onChange(name, value) {
			current.session.setOverride(name, value);
			applyOverride(doc.documentElement.style, name, value);
		},
		onReset(name) {
			const instruction = current.session.reset(name);
			if (!instruction) return; // nothing to undo (D12)
			applyReset(doc.documentElement.style, instruction);
			panel.setValue(name, current.session.currentValue(name) ?? "");
		},
		onResetAll() {
			const instructions = current.session.resetAll();
			applyResetAll(doc.documentElement.style, instructions);
			for (const instruction of instructions) {
				panel.setValue(
					instruction.name,
					current.session.currentValue(instruction.name) ?? "",
				);
			}
		},
		onRescan() {
			rescan();
		},
		onSave() {
			// `navigator.clipboard` may be absent (older browser, insecure
			// context) — export.ts's saveAndExport() treats that identically to a
			// rejected write (T10) and shows the fallback modal either way.
			const clipboard =
				typeof navigator !== "undefined" ? navigator.clipboard : undefined;
			void saveAndExport(doc, current.session, clipboard);
		},
	});

	function renderPanel(): void {
		panel.render(
			buildPanelTokens(current.session, allow),
			formatSkipped(current.dump.skipped),
		);
	}

	/**
	 * Rescan (PLAN T8) exists to pick up tokens from lazily-injected
	 * stylesheets — it must never cost the user their in-flight session
	 * (review-gate fix on T9). A fresh `scan(doc)` re-walks a DOM that may
	 * already carry the user's own inline overrides, so it cannot simply
	 * replace `current.session`: its snapshot would wrongly capture those
	 * overrides as pre-existing (D12 corrupted), its baseline's `before`
	 * would anchor on the edited value (§4 corrupted), and every live
	 * override would vanish (`diff()` empty — breaks SCOPE check #3, Save).
	 * Instead, merge: keep the original session (baseline, snapshot,
	 * overrides all untouched for known tokens) and only add entries for
	 * tokens the fresh scan found that it didn't already know. The fresh
	 * scan's dump counters are used as-is — they describe the page as it is
	 * now, which is exactly what they're for.
	 */
	function rescan(): DumpResult {
		const fresh = scan(doc, allow);
		current.session.mergeNewTokens(fresh.session);
		current = { session: current.session, dump: fresh.dump };
		logSkipped(current.dump.skipped);
		renderPanel();
		return current.dump;
	}

	renderPanel();

	const api: LiveTweaksApi = { dump: () => current.dump, rescan };
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
