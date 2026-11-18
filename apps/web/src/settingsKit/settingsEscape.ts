import { SETTING_ATTR } from "./settingsMarkup";

const HOLDS_ESCAPE = `[${SETTING_ATTR.content}], [${SETTING_ATTR.search}]`;

export function holdsSettingsEscape(
	active: { closest(selector: string): unknown } | null,
): boolean {
	return active?.closest(HOLDS_ESCAPE) != null;
}

/** Reads as prevented to Radix only; the flag reverts at the next microtask (SPEC › Esc and Radix). */
export function holdSettingsEscape(
	event: Event,
	active: { closest(selector: string): unknown } | null = document.activeElement,
): void {
	if (!holdsSettingsEscape(active)) return;
	Object.defineProperty(event, "defaultPrevented", { configurable: true, get: () => true });
	queueMicrotask(() => Reflect.deleteProperty(event, "defaultPrevented"));
}
