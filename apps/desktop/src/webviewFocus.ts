export function createWindowWithWebviewFocus<
	Options extends { hidden: boolean },
	Window extends { show(): void },
>(create: (options: Options) => Window, options: Options, platform: NodeJS.Platform): Window {
	const showAfterAttach = platform === "linux" && !options.hidden;
	const window = create(showAfterAttach ? { ...options, hidden: true } : options);
	if (showAfterAttach) window.show();
	return window;
}
