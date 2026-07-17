// Classification (PLAN D5): decides which control kind a custom property's
// resolved value renders as. The caller (T4's state pipeline) is expected to
// pass the *resolved*, already-trimmed active value (PLAN D2); this module also
// trims defensively so it stays correct when called directly, as these tests do.
//
// Check order is pinned by D5's own bullet order — color, font-family, length,
// other — and is load-bearing for one case D5 leaves implicit: a token whose
// *name* looks like a font var (e.g. `--font-color`) but whose *value* is a real
// color is classified by its value, not its name, because color is checked
// first. Font-family's own name check exists precisely because the reverse
// (value-only) is unsound — see the comment below.
//
// --- The CSS.supports seam (decision, recorded per AGENTS.md's no-silent-
//     decisions rule) ---
// D5 requires `CSS.supports('color', value)`. Real browsers (the production
// target) implement it. This repo's DOM test environment, jsdom (package.json),
// does NOT expose a global `CSS` object at all — `typeof CSS` is `"undefined"`,
// confirmed by hand against the installed version — so calling `CSS.supports`
// directly would make every color-classifying test either throw or silently
// fall through to "other", and "unreliable" undersells it: the capability is
// simply absent, not flaky. `classify` therefore takes the color check as an
// injectable `SupportsColor` parameter: production omits it and gets
// `defaultSupportsColor` (the real `CSS.supports`, guarded so it degrades to
// "not a color" rather than throwing if `CSS` is ever absent at runtime); tests
// pass a small fake that recognizes the color syntaxes the fixture table
// exercises (see classify.test.ts). This mirrors D8's test-seam pattern in
// extract.ts, applied to a capability gap instead of a parsing one.

export type TokenKind = "color" | "font-family" | "length" | "other";

export type SupportsColor = (value: string) => boolean;

export const defaultSupportsColor: SupportsColor = (value) =>
	typeof CSS !== "undefined" && typeof CSS.supports === "function"
		? CSS.supports("color", value)
		: false;

// Font-family name check is mandatory (not a nice-to-have): D5 notes
// `CSS.supports('font-family', v)` accepts almost any identifier, so a
// value-only check would misclassify most short color/keyword tokens.
const FONT_NAME_PATTERN = /font|family/i;

// Deliberately narrow per D5: only common absolute/relative CSS length units.
// calc() expressions and unitless numbers do not match on purpose (D5: "known
// limitation, not a T15 bug") — both fall through to "other".
const LENGTH_PATTERN = /^-?[\d.]+(px|rem|em|%|vh|vw|pt)$/;

function isLength(value: string): boolean {
	return LENGTH_PATTERN.test(value);
}

// The "AND value is not a length" clause routes font-named-but-length-valued
// tokens (e.g. `--font-size: 16px`) to the length classifier instead. It does
// not catch every non-family value a font-named token could hold (a font-named
// calc() or unitless value still passes, since neither is a "length" by the
// regex above) — an accepted rough edge of the literal D5 algorithm, not one
// this module tries to smooth over silently.
function isFontFamily(name: string, value: string): boolean {
	return FONT_NAME_PATTERN.test(name) && !isLength(value);
}

export function classify(
	name: string,
	value: string,
	supportsColor: SupportsColor = defaultSupportsColor,
): TokenKind {
	const trimmedName = name.trim();
	const trimmedValue = value.trim();
	if (supportsColor(trimmedValue)) return "color";
	if (isFontFamily(trimmedName, trimmedValue)) return "font-family";
	if (isLength(trimmedValue)) return "length";
	return "other";
}
