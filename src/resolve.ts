// T2 — resolution layer over T1's pure walker (src/extract.ts).
//
// It takes the walker's RawToken[] plus the document root's computed style and
// produces ResolvedToken[]: each definition flagged root-level (PLAN D3), the
// trimmed active value, an `editable` verdict, and the `before` anchor per the
// contract algorithm (PLAN §4, all three branches). It also runs the computed
// supplement (D2) — root-level tokens the walk can't see (cross-origin sheets,
// JS-set inline vars) surface here with no raw source.
//
// This file is deliberately separate from the pure walker: the walker needs no
// DOM, while resolution is coupled to `getComputedStyle`. The pure core
// (`resolveTokens`) is fed a fake computed style in tests — the D8 seam — because
// jsdom's getComputedStyle does NOT resolve var() chains (T2 probe, 2026-07-17),
// so the branch-2 substitution/match could never be tested through a live engine.

import {
	type ExtractResult,
	extractRawTokens,
	type RawDefinition,
	type StyleDeclarationLike,
} from "./extract";

/** A definition annotated with whether its selector targets the document root. */
export interface ResolvedDefinition extends RawDefinition {
	readonly rootLevel: boolean;
}

/** A token after active-value resolution and before-anchor computation. */
export interface ResolvedToken {
	readonly name: string;
	/** Deduped definitions, in document order, each root-level flagged. */
	readonly definitions: ResolvedDefinition[];
	/** Trimmed `getComputedStyle(root).getPropertyValue(name)`; "" if not set. */
	readonly activeValue: string;
	/** Has a root-level definition, or is a computed-supplement (root-only) token. */
	readonly editable: boolean;
	/** The contract anchor (PLAN §4): raw authored text, or computed fallback. */
	readonly before: string;
}

export interface ResolveResult {
	readonly tokens: ResolvedToken[];
	/** Cross-origin sheets the walk could not read (passed through from T1). */
	readonly unreadableSheets: number;
}

/**
 * True when a selector's subject is the document root (`:root`, `html`, or a bare
 * attribute selector like `[data-theme="dark"]`, which the theme pattern applies
 * to <html>). A selector group is root-level if any of its comma parts is.
 *
 * Being liberal here is safe: a non-active theme definition wrongly flagged
 * root-level simply fails the branch-2 active-value match, so it is never chosen
 * as the anchor; and editability is decided by the presence of *some* root-level
 * definition. Element/class-scoped selectors and any descendant combinator are
 * rejected — that is what filters framework noise (`--tw-*`, Vue hash vars).
 */
export function isRootLevelSelector(selector: string): boolean {
	return selector.split(",").some(isRootLevelSelectorPart);
}

function isRootLevelSelectorPart(part: string): boolean {
	const trimmed = part.trim();
	if (trimmed === "") return false;
	// Attribute values may contain whitespace/combinator chars; drop them before
	// scanning for a real combinator that would target a nested element.
	const withoutAttributes = trimmed.replace(/\[[^\]]*\]/g, "");
	if (/[\s>+~]/.test(withoutAttributes)) return false;
	if (/(^|[^\w-]):root(\b|$)/.test(trimmed)) return true;
	if (/^html(\b|[.:#[]|$)/.test(trimmed)) return true;
	// Bare attribute/pseudo selector with no element, class or id => the theme
	// block convention (`[data-theme="dark"]` on <html>).
	const withoutPseudos = withoutAttributes.replace(
		/::?[\w-]+(\([^)]*\))?/g,
		"",
	);
	return withoutPseudos === "";
}

/** Production wire: walk the document, then resolve against its root computed style. */
export function resolveDocumentTokens(document: Document): ResolveResult {
	const rawTokens = extractRawTokens(document);
	const rootComputedStyle = getComputedStyle(document.documentElement);
	return resolveTokens(rawTokens, rootComputedStyle);
}

/**
 * Pure core: resolve walked tokens against a computed style. `rootComputedStyle`
 * is `getComputedStyle(documentElement)` in production and a hand-authored fake in
 * tests. It doubles as the var()-substitution oracle for the branch-2 match.
 */
export function resolveTokens(
	rawTokens: ExtractResult,
	rootComputedStyle: StyleDeclarationLike,
): ResolveResult {
	const seen = new Set<string>();
	const tokens: ResolvedToken[] = [];

	for (const rawToken of rawTokens.tokens) {
		seen.add(rawToken.name);
		const definitions = dedupeDefinitions(rawToken.definitions).map(
			(definition) => ({
				...definition,
				rootLevel: isRootLevelSelector(definition.selector),
			}),
		);
		const activeValue = rootComputedStyle
			.getPropertyValue(rawToken.name)
			.trim();
		const rootDefinitions = definitions.filter(
			(definition) => definition.rootLevel,
		);
		tokens.push({
			name: rawToken.name,
			definitions,
			activeValue,
			editable: rootDefinitions.length > 0,
			before: computeBefore(rootDefinitions, activeValue, rootComputedStyle),
		});
	}

	appendComputedSupplement(tokens, seen, rootComputedStyle);
	return { tokens, unreadableSheets: rawTokens.unreadableSheets };
}

/** Remove exact-duplicate definitions (same selector and same raw value). */
function dedupeDefinitions(definitions: RawDefinition[]): RawDefinition[] {
	const seen = new Set<string>();
	const unique: RawDefinition[] = [];
	for (const definition of definitions) {
		const key = `${definition.selector}\n${definition.rawValue}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(definition);
	}
	return unique;
}

/** The PLAN §4 `before` algorithm over a token's root-level definitions. */
function computeBefore(
	rootDefinitions: ResolvedDefinition[],
	activeValue: string,
	rootComputedStyle: StyleDeclarationLike,
): string {
	// Branch 3 (no raw source at root): cross-origin / JS-set — anchor on computed.
	if (rootDefinitions.length === 0) return activeValue;
	// Branch 1 (single root definition): its raw text is the anchor, unconditionally.
	if (rootDefinitions.length === 1) return rootDefinitions[0].rawValue.trim();
	// Branch 2 (multiple root definitions, e.g. themes): the one whose value —
	// var() references substituted via computed values — matches the active value.
	const target = normalizeWhitespace(activeValue);
	const match = rootDefinitions.find(
		(definition) =>
			normalizeWhitespace(
				substituteVars(definition.rawValue, rootComputedStyle),
			) === target,
	);
	// No match => branch 3 (the skill's "no source match -> stop and ask" catches it).
	return match ? match.rawValue.trim() : activeValue;
}

/**
 * Replace each `var(--name[, fallback])` with the computed value of `--name`, or
 * the fallback text when that value is empty. The loop re-scans after every
 * replacement, which resolves nested fallbacks (`var(--a, var(--b))`). One level
 * of lookup suffices because computed values are themselves already fully
 * resolved by the engine.
 */
function substituteVars(
	value: string,
	rootComputedStyle: StyleDeclarationLike,
): string {
	const varReference = /var\(\s*(--[\w-]+)\s*(?:,([^()]*))?\)/;
	let result = value;
	for (let guard = 0; guard < 32; guard++) {
		const match = varReference.exec(result);
		if (!match) break;
		const resolved = rootComputedStyle.getPropertyValue(match[1]).trim();
		const replacement = resolved !== "" ? resolved : (match[2] ?? "").trim();
		result =
			result.slice(0, match.index) +
			replacement +
			result.slice(match.index + match[0].length);
	}
	return result;
}

function normalizeWhitespace(value: string): string {
	return value.trim().replace(/\s+/g, " ");
}

/**
 * Computed supplement (D2): root-level custom properties present in the computed
 * style but never found by the walk (cross-origin sheets, JS-set inline vars).
 * They carry no raw source, so `before` is the computed value (branch 3).
 */
function appendComputedSupplement(
	tokens: ResolvedToken[],
	seen: Set<string>,
	rootComputedStyle: StyleDeclarationLike,
): void {
	for (let index = 0; index < rootComputedStyle.length; index++) {
		const name = rootComputedStyle.item(index);
		if (!name.startsWith("--") || seen.has(name)) continue;
		seen.add(name);
		const activeValue = rootComputedStyle.getPropertyValue(name).trim();
		tokens.push({
			name,
			definitions: [],
			activeValue,
			editable: true,
			before: activeValue,
		});
	}
}
