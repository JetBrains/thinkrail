export const TABBABLE_SELECTOR = [
	"button:not(:disabled)",
	"a[href]",
	"input:not(:disabled)",
	"select:not(:disabled)",
	"textarea:not(:disabled)",
	'[contenteditable="true"]',
	"details > summary:first-of-type",
	'[tabindex]:not([tabindex="-1"])',
].join(",");

export function focusFirstControl(container: Element): boolean {
	const control = container.querySelector<HTMLElement>(TABBABLE_SELECTOR);
	control?.focus({ preventScroll: true });
	return control !== null;
}
