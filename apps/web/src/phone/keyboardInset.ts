/** The height iOS reports for the keyboard about to show; 0 for anything unreadable. */
export function keyboardHeightOf(event: Event): number {
	const height = (event as Event & { keyboardHeight?: unknown }).keyboardHeight;
	return typeof height === "number" && Number.isFinite(height) && height > 0
		? Math.round(height)
		: 0;
}

/**
 * Mirrors the native keyboard into `--keyboard-height` from the Keyboard plugin's window events, which fire as
 * the keyboard starts to move, so `phone.css` can give up the app's height in step with it.
 */
export function followKeyboard(root: HTMLElement = document.documentElement): () => void {
	const set = (height: number): void => root.style.setProperty("--keyboard-height", `${height}px`);
	const show = (event: Event): void => set(keyboardHeightOf(event));
	const hide = (): void => set(0);
	window.addEventListener("keyboardWillShow", show);
	window.addEventListener("keyboardWillHide", hide);
	return () => {
		window.removeEventListener("keyboardWillShow", show);
		window.removeEventListener("keyboardWillHide", hide);
	};
}
