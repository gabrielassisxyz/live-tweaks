// T4 — session bookkeeping over T2/T3's pure layers (PLAN §2, D4, D12).
//
// `TweakSession` is the single source of truth the panel (T8/T9) reads and
// writes: a baseline built from `resolve.ts`'s `ResolvedToken[]` (already
// carrying both the raw anchor and the resolved active value, D4) classified
// via `classify.ts`, a one-time snapshot of any *pre-existing* inline `--*`
// values on `documentElement` (D12 — theme managers set these before we ever
// run), and the live `overrides` a user has typed into the panel.
//
// DOM access is confined to two places, both already-existing seams so this
// module invents no new abstraction:
//   - `resolveDocumentTokens(document)` (T2) for the baseline.
//   - `document.documentElement.style`, read through `StyleDeclarationLike`
//     (T1's structural interface — a real `CSSStyleDeclaration` satisfies it
//     without a cast) for the pre-existing snapshot.
// Everything else (`TweakSession`, `buildBaseline`) is pure and takes plain
// data, which is what keeps this module unit-testable without a DOM (AGENTS.md
// TDD rule, PLAN §2: "everything left of panel/ is framework-free, DOM-light").
//
// `apply.ts` (T5) is the only place that ever calls `setProperty`/
// `removeProperty`. This module only decides *what* a reset means — restore
// the snapshot value, or remove the property when there was none (D12) — and
// hands that decision back as a `ResetInstruction` for T5 to execute.

import {
	classify,
	defaultSupportsColor,
	type SupportsColor,
	type TokenKind,
} from "./classify";
import type { StyleDeclarationLike } from "./extract";
import { type ResolvedToken, resolveDocumentTokens } from "./resolve";

/** A token's baseline: its contract anchor, its initial resolved value, and how
 * the panel should render it. Built once per session and never mutated. */
export interface BaselineToken {
	readonly name: string;
	/** Contract anchor (PLAN §4): raw authored text, or the computed fallback. */
	readonly before: string;
	/** Trimmed active value at session start (D4) — what a control shows initially. */
	readonly activeValue: string;
	readonly kind: TokenKind;
	/** Has a root-level definition, or is a computed-supplement token (PLAN D3). */
	readonly editable: boolean;
}

/** One entry of the PLAN §4 contract diff. */
export interface DiffEntry {
	readonly before: string;
	readonly after: string;
}

/** The PLAN §4 contract shape: a flat map, no envelope. */
export type TweakDiff = Record<string, DiffEntry>;

/**
 * What a reset should do to the DOM (D12), decided by state, executed by
 * `apply.ts` (T5): restore the pre-existing inline value that was there before
 * this session touched the token, or remove the property when there wasn't one.
 */
export type ResetInstruction =
	| {
			readonly name: string;
			readonly action: "restore";
			readonly value: string;
	  }
	| { readonly name: string; readonly action: "remove" };

/** Classifies each resolved token into a baseline entry (D4, D5). Pure. */
export function buildBaseline(
	tokens: readonly ResolvedToken[],
	supportsColor: SupportsColor = defaultSupportsColor,
): BaselineToken[] {
	return tokens.map((token) => ({
		name: token.name,
		before: token.before,
		activeValue: token.activeValue,
		kind: classify(token.name, token.activeValue, supportsColor),
		editable: token.editable,
	}));
}

/**
 * D12's snapshot: every `--*` property already set inline on `style` (e.g. a
 * theme manager's `documentElement.style.setProperty(...)` that ran before
 * this session started). Read once, at session creation, never refreshed.
 */
export function snapshotInlineCustomProperties(
	style: StyleDeclarationLike,
): Map<string, string> {
	const snapshot = new Map<string, string>();
	for (let index = 0; index < style.length; index++) {
		const name = style.item(index);
		if (name.startsWith("--")) {
			snapshot.set(name, style.getPropertyValue(name).trim());
		}
	}
	return snapshot;
}

/**
 * A single edit session: baseline + pre-existing snapshot are fixed at
 * construction; `overrides` is the only mutable state, keyed by token name.
 */
export class TweakSession {
	private readonly baseline: ReadonlyMap<string, BaselineToken>;
	private readonly snapshot: ReadonlyMap<string, string>;
	private readonly overrides = new Map<string, string>();

	constructor(
		baseline: readonly BaselineToken[],
		snapshot: ReadonlyMap<string, string> = new Map(),
	) {
		this.baseline = new Map(baseline.map((token) => [token.name, token]));
		this.snapshot = snapshot;
	}

	/** All known tokens (editable and not), in baseline order — for the panel to filter. */
	tokens(): BaselineToken[] {
		return [...this.baseline.values()];
	}

	/** The live override if one exists, else the baseline's resolved value. */
	currentValue(name: string): string | undefined {
		return this.overrides.has(name)
			? this.overrides.get(name)
			: this.baseline.get(name)?.activeValue;
	}

	/** Records a user edit. Throws on an unknown token name (a panel/wiring bug). */
	setOverride(name: string, value: string): void {
		if (!this.baseline.has(name)) {
			throw new Error(`live-tweaks: cannot override unknown token "${name}"`);
		}
		this.overrides.set(name, value);
	}

	/**
	 * Clears one token's override and reports the D12 restore/remove instruction
	 * for `apply.ts` to execute — `undefined` when the token had no override
	 * (nothing to undo, so nothing for the caller to apply).
	 */
	reset(name: string): ResetInstruction | undefined {
		if (!this.overrides.has(name)) return undefined;
		this.overrides.delete(name);
		return this.resetInstruction(name);
	}

	/** Clears every override and reports one instruction per token that had one. */
	resetAll(): ResetInstruction[] {
		const names = [...this.overrides.keys()];
		this.overrides.clear();
		return names.map((name) => this.resetInstruction(name));
	}

	private resetInstruction(name: string): ResetInstruction {
		const snapshotValue = this.snapshot.get(name);
		return snapshotValue === undefined
			? { name, action: "remove" }
			: { name, action: "restore", value: snapshotValue };
	}

	/**
	 * PLAN §4 contract diff: only tokens with a live override appear (a reset
	 * token is removed from `overrides`, so it is absent here by construction).
	 * `before` is each token's anchor (`BaselineToken.before`), never the
	 * resolved `activeValue` — that distinction is D4's whole point.
	 */
	diff(): TweakDiff {
		const diff: TweakDiff = {};
		for (const [name, after] of this.overrides) {
			diff[name] = { before: this.baseline.get(name)?.before ?? "", after };
		}
		return diff;
	}
}

/** Production wire: resolve the live document, classify, snapshot, and build a session. */
export function createTweakSession(
	document: Document,
	supportsColor?: SupportsColor,
): TweakSession {
	const resolved = resolveDocumentTokens(document);
	const baseline = buildBaseline(resolved.tokens, supportsColor);
	const snapshot = snapshotInlineCustomProperties(
		document.documentElement.style,
	);
	return new TweakSession(baseline, snapshot);
}
