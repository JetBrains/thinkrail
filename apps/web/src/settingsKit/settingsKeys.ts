import { isImeComposing, twinArrow } from "@thinkrail/ui/keyboard";

export interface SettingsPress {
	readonly key: string;
	readonly altKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly shiftKey: boolean;
	readonly isComposing: boolean;
	readonly keyCode: number;
}

export type WalkKey = "up" | "down" | "home" | "end" | "left" | "right" | "reset" | "escape";

const ARROW_KEYS: Readonly<Record<string, WalkKey>> = {
	ArrowUp: "up",
	ArrowDown: "down",
	ArrowLeft: "left",
	ArrowRight: "right",
	Home: "home",
	End: "end",
	Escape: "escape",
};

const modified = (press: SettingsPress) =>
	press.altKey || press.ctrlKey || press.metaKey || press.shiftKey;

export function walkKey(press: SettingsPress, local: string | null): WalkKey | null {
	if (isImeComposing(press)) return null;
	if (local === "settings.reset") return "reset";
	const twin = twinArrow(local);
	if (twin !== undefined) return ARROW_KEYS[twin] ?? null;
	return modified(press) ? null : (ARROW_KEYS[press.key] ?? null);
}

export interface WalkContext {
	readonly textEntry: boolean;
	readonly multiline: boolean;
	readonly onSide: boolean;
}

export type WalkAction =
	| { readonly kind: "row"; readonly delta: 1 | -1 }
	| { readonly kind: "edge"; readonly edge: "first" | "last" }
	| { readonly kind: "side"; readonly delta: 1 | -1 }
	| { readonly kind: "nav" }
	| { readonly kind: "reset" }
	| { readonly kind: "escape" };

export function walkAction(key: WalkKey | null, ctx: WalkContext): WalkAction | null {
	switch (key) {
		case "up":
		case "down":
			return ctx.multiline ? null : { kind: "row", delta: key === "down" ? 1 : -1 };
		case "home":
		case "end":
			return ctx.textEntry ? null : { kind: "edge", edge: key === "home" ? "first" : "last" };
		case "right":
			return ctx.textEntry ? null : { kind: "side", delta: 1 };
		case "left":
			if (ctx.textEntry) return null;
			return ctx.onSide ? { kind: "side", delta: -1 } : { kind: "nav" };
		case "reset":
			return { kind: "reset" };
		case "escape":
			return { kind: "escape" };
		default:
			return null;
	}
}

export type NavAction =
	| { readonly kind: "select"; readonly delta: 1 | -1 }
	| { readonly kind: "edge"; readonly edge: "first" | "last" }
	| { readonly kind: "enter" }
	| { readonly kind: "search" }
	| { readonly kind: "stay" };

export function navAction(press: SettingsPress, local: string | null): NavAction | null {
	if (isImeComposing(press)) return null;
	if (local === "settings.nav.search") return { kind: "search" };
	if (!modified(press) && (press.key === "Enter" || press.key === " ")) return { kind: "enter" };
	switch (walkKey(press, local)) {
		case "up":
			return { kind: "select", delta: -1 };
		case "down":
			return { kind: "select", delta: 1 };
		case "home":
			return { kind: "edge", edge: "first" };
		case "end":
			return { kind: "edge", edge: "last" };
		case "right":
			return { kind: "enter" };
		case "left":
			return { kind: "stay" };
		default:
			return null;
	}
}

export function navIndex(action: NavAction, index: number, count: number): number | null {
	if (count === 0) return null;
	if (action.kind === "edge") return action.edge === "first" ? 0 : count - 1;
	if (action.kind !== "select") return null;
	return Math.min(count - 1, Math.max(0, index + action.delta));
}

export type EscapePlace = "content" | "results" | "search" | "nav";

export interface EscapeContext {
	readonly place: EscapePlace;
	readonly jumped: boolean;
	readonly query: boolean;
}

export type EscapeStep = "results" | "clear" | "nav" | "close";

export function escapeStep({ place, jumped, query }: EscapeContext): EscapeStep {
	switch (place) {
		case "content":
			return jumped && query ? "results" : "nav";
		case "results":
			return "clear";
		case "search":
			return query ? "clear" : "nav";
		case "nav":
			return "close";
	}
}
