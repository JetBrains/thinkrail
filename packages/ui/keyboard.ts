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

const APPLE_PLATFORM = /Mac|iPhone|iPad|iPod/;

export function browserPlatform(): string {
	return typeof navigator === "undefined" ? "" : (navigator.platform ?? "");
}

export function isApplePlatform(platform = browserPlatform()): boolean {
	return APPLE_PLATFORM.test(platform);
}

export function hasPlatformModifier(
	event: Pick<KeyboardEvent, "ctrlKey" | "metaKey">,
	platform = browserPlatform(),
): boolean {
	return isApplePlatform(platform)
		? event.metaKey && !event.ctrlKey
		: event.ctrlKey && !event.metaKey;
}
