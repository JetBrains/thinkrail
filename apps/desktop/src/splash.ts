const SPLASH_SIZE = { width: 360, height: 200 } as const;
export const SPLASH_READY_TIMEOUT_MS = 500;

export interface SplashWindow {
	center(): void;
	hide(): void;
	close(): void;
	on(event: "close", listener: () => void): void;
	webview: { on(event: "dom-ready", listener: () => void): void };
}

export interface SplashMainWindow {
	on(event: "close", listener: () => void): void;
	activate(): void;
}

export interface SplashWindowOptions {
	title: string;
	url: string;
	frame: { x: number; y: number; width: number; height: number };
	titleBarStyle: "hidden";
}

export interface StartupSplash {
	hide(): void;
	close(): void;
}

function escapeHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

export function splashMessage(pendingInstallVersion: string | null): string {
	return pendingInstallVersion
		? `Finishing update to ${pendingInstallVersion}…`
		: "Starting ThinkRail…";
}

export function splashDocument(message: string): string {
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="dark light"><title>ThinkRail</title><style>
:root{--bg:#09090b;--fg:#f4f4f5;--muted:#babac1;--accent:#8dff4f;--track:#27272a}
@media (prefers-color-scheme: light){:root{--bg:#ffffff;--fg:#27272a;--muted:#52525b;--accent:#2a7314;--track:#e4e4e7}}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);cursor:default;user-select:none;-webkit-user-select:none}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font:13px/1.4 system-ui,"Segoe UI",sans-serif}
.mark{font-size:28px;font-weight:700;color:var(--accent)}
.message{color:var(--muted)}
.bar{width:220px;height:3px;border-radius:2px;background:var(--track);overflow:hidden}
.bar i{display:block;width:35%;height:100%;border-radius:2px;background:var(--accent);animation:slide 1.2s ease-in-out infinite}
@keyframes slide{from{transform:translateX(-100%)}to{transform:translateX(290%)}}
@media (prefers-reduced-motion: reduce){.bar i{animation:none;width:100%;opacity:.5}}
</style></head><body><div class="mark">ThinkRail</div><div class="message" role="status">${escapeHtml(message)}</div><div class="bar"><i></i></div></body></html>`;
}

export async function openStartupSplash(
	createWindow: (options: SplashWindowOptions) => SplashWindow,
	message: string,
	readyTimeoutMs = SPLASH_READY_TIMEOUT_MS,
): Promise<StartupSplash> {
	const window = createWindow({
		title: "ThinkRail",
		url: `data:text/html;charset=utf-8,${encodeURIComponent(splashDocument(message))}`,
		frame: { x: 0, y: 0, ...SPLASH_SIZE },
		titleBarStyle: "hidden",
	});
	window.center();
	await new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, readyTimeoutMs);
		window.webview.on("dom-ready", () => {
			clearTimeout(timer);
			resolve();
		});
	});
	let closed = false;
	window.on("close", () => {
		closed = true;
	});
	return {
		hide: () => {
			if (!closed) window.hide();
		},
		close: () => {
			if (closed) return;
			closed = true;
			window.close();
		},
	};
}

export function handOffStartupSplash(
	splash: StartupSplash,
	mainWindow: SplashMainWindow,
): () => void {
	let released = false;
	const release = (activate: boolean): void => {
		if (released) return;
		released = true;
		splash.close();
		if (activate) mainWindow.activate();
	};
	mainWindow.on("close", () => release(false));
	return () => release(true);
}
