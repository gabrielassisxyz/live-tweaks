// Recursive CSSOM walker (PLAN D2). It collects every CSS custom property
// definition reachable from a document's stylesheets, grouped by name.
//
// Two rules govern this file, both load-bearing:
//   1. Custom values are read via CSSOM iteration (`style.item(i)` +
//      `getPropertyValue`), NEVER by splitting `cssText`. A custom value may
//      legally contain ';' or '}' inside a string (e.g. `url("a;b}c")`), which
//      makes textual splitting unsound — the engine has already parsed it, so we
//      ask the engine.
//   2. The rule dispatch is by *shape*, not by numeric `CSSRule.type` (which is
//      deprecated) nor by `instanceof` against a specific realm's constructors
//      (fragile across windows and impossible to feed authored fixtures). A rule
//      that carries declarations exposes `.style`; a grouping rule (@media,
//      @supports, @layer, container queries, CSS nesting) exposes `.cssRules`; an
//      @import rule exposes `.styleSheet`. A nested style rule exposes both
//      `.style` and `.cssRules`, so those branches are independent, not a switch.
//
// The structural interfaces below are the seam that lets the pure logic be tested
// with hand-authored fakes (PLAN D8) while a real `Document`/`CSSStyleSheet`
// remains assignable to them without a cast.

export interface StyleDeclarationLike {
	readonly length: number;
	item(index: number): string;
	getPropertyValue(property: string): string;
}

export interface CSSRuleLike {
	// Never read. It exists so a real `CSSRule` — whose distinguishing members
	// (`style`, `cssRules`, ...) all live on its subtypes, not the base — shares a
	// property name with this otherwise all-optional interface, defeating
	// TypeScript's weak-type guard so a real `Document` stays assignable, no cast.
	readonly cssText?: string;
	readonly style?: StyleDeclarationLike;
	readonly selectorText?: string;
	readonly cssRules?: Iterable<CSSRuleLike>;
	readonly styleSheet?: StyleSheetLike | null;
}

export interface StyleSheetLike {
	// Accessing this getter throws (SecurityError) for a cross-origin sheet;
	// every read site wraps it in try/catch and counts the failure.
	readonly cssRules: Iterable<CSSRuleLike>;
}

export interface DocumentLike {
	readonly styleSheets: Iterable<StyleSheetLike>;
	readonly adoptedStyleSheets?: Iterable<StyleSheetLike>;
}

/** A single custom-property declaration found at one definition site. */
export interface RawDefinition {
	readonly rawValue: string;
	readonly selector: string;
}

/** All definitions of one custom property, in document order. */
export interface RawToken {
	readonly name: string;
	readonly definitions: RawDefinition[];
}

export interface ExtractResult {
	readonly tokens: RawToken[];
	/** Cross-origin sheets (top-level or @import-ed) that could not be read. */
	readonly unreadableSheets: number;
}

/**
 * Pure filter: the custom-property declarations of one style declaration, in
 * order, read strictly via CSSOM iteration so string values stay intact.
 */
export function customPropertyDeclarations(
	declaration: StyleDeclarationLike,
): Array<{ name: string; value: string }> {
	const declarations: Array<{ name: string; value: string }> = [];
	for (let index = 0; index < declaration.length; index++) {
		const name = declaration.item(index);
		if (name.startsWith("--")) {
			declarations.push({ name, value: declaration.getPropertyValue(name) });
		}
	}
	return declarations;
}

export function extractRawTokens(document: DocumentLike): ExtractResult {
	const walker = new StyleSheetWalker();
	for (const sheet of document.styleSheets) {
		walker.walkSheet(sheet);
	}
	if (document.adoptedStyleSheets) {
		for (const sheet of document.adoptedStyleSheets) {
			walker.walkSheet(sheet);
		}
	}
	return walker.result();
}

// A short-lived accumulator: grouping-by-name and the unreadable counter are
// mutable walk state, kept off the public surface.
class StyleSheetWalker {
	// Map preserves first-seen name order while grouping same-name definitions.
	private readonly byName = new Map<string, RawDefinition[]>();
	private unreadableSheets = 0;

	walkSheet(sheet: StyleSheetLike): void {
		let rules: Iterable<CSSRuleLike>;
		try {
			rules = sheet.cssRules;
		} catch {
			// Cross-origin: the browser forbids reading `.cssRules`. Count and move on.
			this.unreadableSheets++;
			return;
		}
		for (const rule of rules) {
			this.walkRule(rule);
		}
	}

	private walkRule(rule: CSSRuleLike): void {
		// @import: recurse into the imported sheet with its own guard (D2). A null
		// styleSheet means "not loaded", which is not a cross-origin failure.
		if (rule.styleSheet != null) {
			this.walkSheet(rule.styleSheet);
		}
		// A style rule (possibly nested) carries the declarations we collect.
		if (rule.style && rule.selectorText !== undefined) {
			this.collect(rule.style, rule.selectorText);
		}
		// A grouping rule (or a nesting style rule) carries child rules.
		if (rule.cssRules) {
			for (const child of rule.cssRules) {
				this.walkRule(child);
			}
		}
	}

	private collect(declaration: StyleDeclarationLike, selector: string): void {
		for (const { name, value } of customPropertyDeclarations(declaration)) {
			const definitions = this.byName.get(name) ?? [];
			if (definitions.length === 0) {
				this.byName.set(name, definitions);
			}
			definitions.push({ rawValue: value, selector });
		}
	}

	result(): ExtractResult {
		const tokens: RawToken[] = [];
		for (const [name, definitions] of this.byName) {
			tokens.push({ name, definitions });
		}
		return { tokens, unreadableSheets: this.unreadableSheets };
	}
}
