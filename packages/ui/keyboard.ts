const IME_SENTINEL_KEYCODE = 229;

export function isImeComposing(event: { isComposing: boolean; keyCode: number }): boolean {
	return event.isComposing || event.keyCode === IME_SENTINEL_KEYCODE;
}

export function yieldEscapeToIme(
	handler: ((event: KeyboardEvent) => void) | undefined,
): (event: KeyboardEvent) => void {
	return (event) => {
		if (isImeComposing(event)) {
			event.preventDefault();
			return;
		}
		handler?.(event);
	};
}
