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

export type WalkKey =
	| "up"
	| "down"
	| "home"
	| "end"
	| "left"
	| "right"
	| "enter"
	| "space"
	| "reset"
	| "escape";

const PLAIN_KEYS: Readonly<Record<string, WalkKey>> = {
	ArrowUp: "up",
	ArrowDown: "down",
	ArrowLeft: "left",
	ArrowRight: "right",
	Home: "home",
	End: "end",
	Enter: "enter",
	" ": "space",
	Escape: "escape",
};

const modified = (press: SettingsPress) =>
	press.altKey || press.ctrlKey || press.metaKey || press.shiftKey;

export function walkKey(press: SettingsPress, local: string | null): WalkKey | null {
	if (isImeComposing(press)) return null;
	if (local === "settings.reset") return "reset";
	const twin = twinArrow(local);
	if (twin !== undefined) return PLAIN_KEYS[twin] ?? null;
	return modified(press) ? null : (PLAIN_KEYS[press.key] ?? null);
}

export type WalkPlace = "row" | "button" | "control" | "outside";

export interface WalkContext {
	readonly place: WalkPlace;
	readonly textEntry: boolean;
	readonly multiline: boolean;
	readonly caretAtEnd: boolean;
	readonly native: boolean;
	readonly inForm: boolean;
}

export type WalkAction =
	| { readonly kind: "row"; readonly delta: 1 | -1 }
	| { readonly kind: "edge"; readonly edge: "first" | "last" }
	| { readonly kind: "forward" }
	| { readonly kind: "button"; readonly delta: 1 | -1 }
	| { readonly kind: "activate"; readonly space: boolean }
	| { readonly kind: "along"; readonly delta: 1 | -1 }
	| { readonly kind: "exit" }
	| { readonly kind: "nav" }
	| { readonly kind: "reset" }
	| { readonly kind: "escape" };

const sideways = (place: WalkPlace, delta: 1 | -1): WalkAction | null => {
	switch (place) {
		case "row":
			return delta === 1 ? { kind: "forward" } : { kind: "nav" };
		case "button":
			return { kind: "button", delta };
		case "control":
			return { kind: "along", delta };
		case "outside":
			return delta === 1 ? null : { kind: "nav" };
	}
};

const press = (ctx: WalkContext, space: boolean): WalkAction | null => {
	if (ctx.native) return null;
	if (ctx.place === "row") return { kind: "activate", space };
	if (ctx.place !== "control") return null;
	if (space ? ctx.textEntry : ctx.multiline || (ctx.textEntry && ctx.inForm)) return null;
	return { kind: "exit" };
};

export function walkAction(key: WalkKey | null, ctx: WalkContext): WalkAction | null {
	switch (key) {
		case "up":
		case "down":
			return ctx.multiline ? null : { kind: "row", delta: key === "down" ? 1 : -1 };
		case "home":
		case "end":
			return ctx.textEntry ? null : { kind: "edge", edge: key === "home" ? "first" : "last" };
		case "right":
		case "left":
			if (!ctx.textEntry) return sideways(ctx.place, key === "right" ? 1 : -1);
			return key === "right" && ctx.caretAtEnd && !ctx.multiline && ctx.place === "control"
				? { kind: "along", delta: 1 }
				: null;
		case "enter":
		case "space":
			return press(ctx, key === "space");
		case "reset":
			return { kind: "reset" };
		case "escape":
			return ctx.place === "control" || ctx.place === "button"
				? { kind: "exit" }
				: { kind: "escape" };
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
		case "enter":
		case "space":
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
