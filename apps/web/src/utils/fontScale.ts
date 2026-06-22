/** Writes the JS-controlled font sizes the token scale derives spacing from. Call once on load. */
export function applyFontScale(base = 13, compactBase = 9): void {
	const root = document.documentElement;
	root.style.setProperty("--font-base", `${base}px`);
	root.style.setProperty("--compact-font-base", `${compactBase}px`);
}
