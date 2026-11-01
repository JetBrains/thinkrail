import { platformFamily } from "../lib";

export type ScopeChordEvent = Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey">;

export function scopeChordIndex(event: ScopeChordEvent, platform?: string): number | null {
	if (!event.altKey || event.ctrlKey || event.metaKey) return null;
	if (platformFamily(platform) === "apple" || !/^[1-9]$/.test(event.key)) return null;
	return Number(event.key) - 1;
}
