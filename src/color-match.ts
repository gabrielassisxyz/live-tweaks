// Pure color matching for the pipette feature (see color-match.test.ts's
// header for the module boundary). Only the two normalized forms are
// parsed on purpose: anything else (keywords, oklch, var chains) must be
// normalized to a computed rgb string by the caller before it gets here —
// a translucent rgba is rejected rather than guessed, because the screen
// pixel the user picked is a blend the token value alone cannot explain.

export interface ResolvedColorToken {
	readonly name: string;
	/** The token's live value, pre-normalized by the caller (computed
	 * `rgb(...)` string) or raw when normalization failed. */
	readonly resolvedValue: string;
}

type Rgb = readonly [number, number, number];

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB_PATTERN =
	/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/;

/** Parses `#rgb` / `#rrggbb` / `rgb()` / opaque `rgba()` to a triple;
 * undefined for every other shape. */
export function parseColorToRgb(value: string): Rgb | undefined {
	const trimmed = value.trim();
	if (HEX_PATTERN.test(trimmed)) {
		const hex = trimmed.slice(1);
		const wide =
			hex.length === 3
				? hex
						.split("")
						.map((c) => c + c)
						.join("")
				: hex;
		return [
			Number.parseInt(wide.slice(0, 2), 16),
			Number.parseInt(wide.slice(2, 4), 16),
			Number.parseInt(wide.slice(4, 6), 16),
		];
	}
	const rgbMatch = RGB_PATTERN.exec(trimmed);
	if (rgbMatch) {
		if (rgbMatch[4] !== undefined && Number.parseFloat(rgbMatch[4]) !== 1) {
			return undefined;
		}
		const triple: Rgb = [
			Number(rgbMatch[1]),
			Number(rgbMatch[2]),
			Number(rgbMatch[3]),
		];
		return triple.every((channel) => channel <= 255) ? triple : undefined;
	}
	return undefined;
}

/** Names of every token whose resolved value equals the picked color, in
 * the given order (the panel's display order, so the first hit is the one
 * the panel scrolls to). */
export function findColorMatches(
	pickedColor: string,
	tokens: readonly ResolvedColorToken[],
): string[] {
	const picked = parseColorToRgb(pickedColor);
	if (!picked) return [];
	return tokens
		.filter((token) => {
			const resolved = parseColorToRgb(token.resolvedValue);
			return (
				resolved !== undefined &&
				resolved[0] === picked[0] &&
				resolved[1] === picked[1] &&
				resolved[2] === picked[2]
			);
		})
		.map((token) => token.name);
}
