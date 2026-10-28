const IME_SENTINEL_KEYCODE = 229;

export function isImeComposing(event: { isComposing: boolean; keyCode: number }): boolean {
	return event.isComposing || event.keyCode === IME_SENTINEL_KEYCODE;
}
