export const ELECTROBUN_APP_REGION_PROPERTY = "--electrobun-app-region";

export type TitleBarDoubleClickAction = "zoom" | "minimize" | "none";

type ComputedStyleReader = (element: Element) => Pick<CSSStyleDeclaration, "getPropertyValue">;

export type TitleBarWindowState = {
	maximized: boolean;
	minimized: boolean;
	frame: { x: number; y: number; width: number; height: number };
};

export type TitleBarWindow = {
	isFullScreen(): boolean;
	isMaximized(): boolean;
	isMinimized(): boolean;
	maximize(): void;
	unmaximize(): void;
	minimize(): void;
	getFrame(): { x: number; y: number; width: number; height: number };
};

export type TitleBarDoubleClickResult = {
	preference: string | null;
	action: TitleBarDoubleClickAction;
	before: TitleBarWindowState;
	after: TitleBarWindowState;
};

function isElement(target: EventTarget | null): target is Element {
	return (
		target !== null && typeof target === "object" && "nodeType" in target && target.nodeType === 1
	);
}

export function isTitleBarDoubleClick(
	event: Pick<MouseEvent, "button" | "defaultPrevented" | "target">,
	readComputedStyle: ComputedStyleReader = (element) => getComputedStyle(element),
): boolean {
	if (event.button !== 0 || event.defaultPrevented || !isElement(event.target)) return false;
	try {
		return (
			readComputedStyle(event.target)
				.getPropertyValue(ELECTROBUN_APP_REGION_PROPERTY)
				.trim()
				.toLowerCase() === "drag"
		);
	} catch {
		return false;
	}
}

export function installTitleBarDoubleClick(
	target: Pick<EventTarget, "addEventListener">,
	send: () => void,
	readComputedStyle?: ComputedStyleReader,
): void {
	target.addEventListener("dblclick", (event) => {
		if (isTitleBarDoubleClick(event as MouseEvent, readComputedStyle)) send();
	});
}

export function titleBarDoubleClickAction(preference: string | null): TitleBarDoubleClickAction {
	if (preference === null || preference === "Maximize" || preference === "Fill") return "zoom";
	if (preference === "Minimize") return "minimize";
	return "none";
}

async function runCommand(command: string[]): Promise<{ exitCode: number; stdout: string }> {
	const proc = Bun.spawn(command, {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "ignore",
	});
	const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
	return { exitCode, stdout };
}

export async function readTitleBarDoubleClickPreference(
	run: (command: string[]) => Promise<{ exitCode: number; stdout: string }> = runCommand,
): Promise<string | null> {
	try {
		const { exitCode, stdout } = await run([
			"/usr/bin/defaults",
			"read",
			"-g",
			"AppleActionOnDoubleClick",
		]);
		if (exitCode !== 0) return null;
		const preference = stdout.trim();
		return preference.length > 0 ? preference : null;
	} catch {
		return null;
	}
}

export function performTitleBarDoubleClick(
	window: TitleBarWindow,
	action: TitleBarDoubleClickAction,
): void {
	if (action === "zoom") {
		if (window.isMaximized()) window.unmaximize();
		else window.maximize();
	} else if (action === "minimize") {
		window.minimize();
	}
}

function snapshotWindow(window: TitleBarWindow): TitleBarWindowState {
	return {
		maximized: window.isMaximized(),
		minimized: window.isMinimized(),
		frame: window.getFrame(),
	};
}

export function createTitleBarDoubleClickHandler(options: {
	enabled: boolean;
	window: TitleBarWindow;
	readPreference?: () => Promise<string | null>;
	onHandled?: (result: TitleBarDoubleClickResult) => void;
}): () => Promise<void> {
	if (!options.enabled) return async () => {};
	let pending = false;
	return async () => {
		if (pending) return;
		pending = true;
		try {
			const preference = await (options.readPreference ?? readTitleBarDoubleClickPreference)();
			const action = options.window.isFullScreen() ? "none" : titleBarDoubleClickAction(preference);
			const before = snapshotWindow(options.window);
			performTitleBarDoubleClick(options.window, action);
			const after = snapshotWindow(options.window);
			options.onHandled?.({ preference, action, before, after });
		} catch (error) {
			console.error("[desktop] title-bar double-click failed", error);
		} finally {
			pending = false;
		}
	};
}
