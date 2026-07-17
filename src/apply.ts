// T5 — the only module that ever calls `setProperty`/`removeProperty` on
// `documentElement.style` (state.ts's header comment pins this contract:
// state.ts only *decides* what an edit or a reset means and hands back plain
// data — a value to set, or a `ResetInstruction` — this module is what
// actually executes that decision against the DOM).
//
// Kept DOM-light per D8: it talks to a structural interface, so it is unit
// tested with a hand-authored fake style declaration, never a real
// `CSSStyleDeclaration`.

import type { StyleDeclarationLike } from "./extract";
import type { ResetInstruction } from "./state";

/** `extract.ts`'s read-only `StyleDeclarationLike` plus the two write methods
 * apply.ts needs. A real `CSSStyleDeclaration` satisfies this without a cast. */
export interface MutableStyleDeclarationLike extends StyleDeclarationLike {
	setProperty(property: string, value: string): void;
	removeProperty(property: string): string;
}

/** Applies a user edit: sets the inline custom property to `value`. */
export function applyOverride(
	style: MutableStyleDeclarationLike,
	name: string,
	value: string,
): void {
	style.setProperty(name, value);
}

/** Executes one reset instruction (PLAN D12): restore the pre-existing inline
 * snapshot value, or remove the property when there was none. */
export function applyReset(
	style: MutableStyleDeclarationLike,
	instruction: ResetInstruction,
): void {
	if (instruction.action === "restore") {
		style.setProperty(instruction.name, instruction.value);
	} else {
		style.removeProperty(instruction.name);
	}
}

/** Executes every instruction from `TweakSession.resetAll()`, in order. */
export function applyResetAll(
	style: MutableStyleDeclarationLike,
	instructions: readonly ResetInstruction[],
): void {
	for (const instruction of instructions) {
		applyReset(style, instruction);
	}
}
