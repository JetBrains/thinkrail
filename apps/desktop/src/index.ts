import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { channel, version } from "@thinkrail/shared/version";
import Electrobun, {
	ApplicationMenu,
	BrowserView,
	BrowserWindow,
	PATHS,
	Utils,
} from "electrobun/bun";
import { installDesktopApplicationMenu } from "./applicationMenu";
import { externalNavigationUrl } from "./externalNavigation";
import {
	createLinuxResizeStarter,
	createWindowsResizeStarter,
	preserveWindowsNativeFrame,
} from "./nativeWindowChrome";
import {
	injectInitialDesktopPreferences,
	readDesktopPreferenceRemove,
	readDesktopPreferenceWrite,
} from "./preferenceAdapter";
import { PreferenceStore } from "./preferenceStore";
import { injectWindowChromePlatform, readPreloadWindowChromePlatform } from "./preloadWindowChrome";
import { RouteStore } from "./routeStore";
import type { DesktopRpc } from "./rpc";
import { ptyLibraryName, runtimeTarget } from "./runtimeTarget";
import type { DesktopServerRuntime } from "./serverRuntime";
import {
	createDesktopWindowChromeController,
	type DesktopWindowChromeController,
	desktopWindowChromePolicy,
	probeDesktopWindowTransitions,
	readDesktopResizeEdge,
} from "./windowChrome";

const BACKEND_PROFILE_ID = "local";
const WINDOW_ID = "main";

function writeReady(path: string, payload: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(payload));
}

async function start(): Promise<void> {
	const chromePolicy = desktopWindowChromePolicy(process.platform);
	const applicationMenuInstalled = installDesktopApplicationMenu(ApplicationMenu, process.platform);
	const runtimeDir = join(PATHS.RESOURCES_FOLDER, "app", "runtime");
	process.env.BUN_PTY_LIB = join(
		runtimeDir,
		ptyLibraryName(runtimeTarget(process.platform, process.arch)),
	);
	const serverRuntime = (await import(
		pathToFileURL(join(runtimeDir, "server-runtime.ts")).href
	)) as DesktopServerRuntime;
	const host = await serverRuntime.startDesktopHost({
		runtimeDir,
		staticDir: join(PATHS.VIEWS_FOLDER, "web"),
		appVersion: version,
		channel,
	});
	const origin = `http://127.0.0.1:${host.port}`;
	const userData = process.env.THINKRAIL_DESKTOP_USER_DATA ?? Utils.paths.userData;
	const routes = new RouteStore(join(userData, "routes.json"));
	const preferences = new PreferenceStore(join(userData, "preferences.json"));
	const initialRoute = routes.read(BACKEND_PROFILE_ID, WINDOW_ID);
	const initialPreferences = preferences.read(BACKEND_PROFILE_ID, WINDOW_ID);
	const neutral = process.env.THINKRAIL_DESKTOP_E2E_HOST === "1";
	const hidden =
		process.env.THINKRAIL_DESKTOP_HIDDEN === "1" || process.env.THINKRAIL_DESKTOP_E2E_HOST === "1";
	const windowUrl = neutral ? `${origin}/health` : `${origin}/${initialRoute}`;
	let windowChromeController: DesktopWindowChromeController | undefined;
	let windowChromePreloadReady = false;
	let publishReady = () => {};
	const rpc = BrowserView.defineRPC<DesktopRpc>({
		maxRequestTime: 5000,
		handlers: {
			requests: {},
			messages: {
				routeChanged: ({ hash }) => {
					if (!neutral) routes.write(BACKEND_PROFILE_ID, WINDOW_ID, hash);
				},
				preferenceWrite: (payload) => {
					if (neutral) return;
					const preference = readDesktopPreferenceWrite(payload);
					if (
						preference &&
						!preferences.write(BACKEND_PROFILE_ID, WINDOW_ID, preference.key, preference.value)
					) {
						console.error("[desktop] could not save a local preference");
					}
				},
				preferenceRemove: (payload) => {
					if (neutral) return;
					const preference = readDesktopPreferenceRemove(payload);
					if (preference && !preferences.remove(BACKEND_PROFILE_ID, WINDOW_ID, preference.key)) {
						console.error("[desktop] could not remove a local preference");
					}
				},
				windowChromeMinimize: () => windowChromeController?.minimize(),
				windowChromeToggleMaximize: () => windowChromeController?.toggleMaximize(),
				windowChromeRequestClose: () => windowChromeController?.requestClose(),
				windowChromeStartResize: (payload) => {
					const edge = readDesktopResizeEdge(payload);
					if (edge) windowChromeController?.startResize(edge);
				},
				windowChromeReady: (payload) => {
					windowChromePreloadReady =
						readPreloadWindowChromePlatform(
							typeof payload === "object" && payload !== null
								? Reflect.get(payload, "platform")
								: null,
						) === chromePolicy.platform;
					publishReady();
				},
			},
		},
	});
	const preload = neutral
		? null
		: injectWindowChromePlatform(
				injectInitialDesktopPreferences(
					await Bun.file(join(runtimeDir, "preload.js")).text(),
					initialPreferences,
				),
				chromePolicy.platform,
			);
	const mainWindow = new BrowserWindow({
		title: "ThinkRail",
		url: windowUrl,
		preload,
		...(neutral ? {} : { rpc }),
		hidden: true,
		navigationRules: neutral ? null : JSON.stringify(["^*", `${origin}/*`]),
		titleBarStyle: chromePolicy.titleBarStyle,
		...(chromePolicy.trafficLightOffset
			? { trafficLightOffset: chromePolicy.trafficLightOffset }
			: {}),
		frame: { x: 80, y: 60, width: 1440, height: 920 },
	});
	const nativeWindowHandle = mainWindow.ptr;
	if (!nativeWindowHandle) throw new Error("desktop native window handle is unavailable");
	if (chromePolicy.platform === "windows") preserveWindowsNativeFrame(nativeWindowHandle);
	const startNativeResize =
		chromePolicy.platform === "windows"
			? createWindowsResizeStarter(nativeWindowHandle)
			: chromePolicy.platform === "linux"
				? createLinuxResizeStarter(runtimeDir, nativeWindowHandle)
				: () => {};
	windowChromeController = createDesktopWindowChromeController({
		platform: chromePolicy.platform,
		window: mainWindow,
		onState: (snapshot) => {
			if (!neutral) rpc.send.windowChromeState(snapshot);
		},
		startNativeResize,
	});
	mainWindow.on("resize", () => windowChromeController?.publishState());
	if (!hidden) mainWindow.show();
	const openExternal = (detail: unknown) => {
		const url = externalNavigationUrl(detail, origin);
		if (url) Utils.openExternal(url);
	};
	mainWindow.webview.on("will-navigate", (event) => openExternal(event.data.detail));
	mainWindow.webview.on("new-window-open", (event) => openExternal(event.data.detail));

	let ready = false;
	let domReady = false;
	let probingWindowChrome = false;
	let windowChromeProbe:
		| { nativeControls: true }
		| Awaited<ReturnType<typeof probeDesktopWindowTransitions>>
		| undefined;
	publishReady = () => {
		if (ready || !domReady || (!neutral && !windowChromePreloadReady)) return;
		ready = true;
		const readyPath = process.env.THINKRAIL_DESKTOP_READY_FILE;
		if (!readyPath) return;
		writeReady(readyPath, {
			origin,
			runtimeDir,
			applicationMenuInstalled,
			pid: process.pid,
			windowUrl,
			mode: neutral ? "host" : "ui",
			windowChromePlatform: chromePolicy.platform,
			titleBarStyle: chromePolicy.titleBarStyle,
			windowChromePreloadReady,
			windowChromeProbe,
		});
	};
	mainWindow.webview.on("dom-ready", () => {
		if (domReady || probingWindowChrome) return;
		probingWindowChrome = true;
		void (async () => {
			windowChromeController?.publishState();
			if (process.env.THINKRAIL_DESKTOP_WINDOW_CHROME_PROBE === "1") {
				if (!windowChromeController) throw new Error("window chrome controller is unavailable");
				windowChromeProbe =
					chromePolicy.platform === "macos"
						? { nativeControls: true }
						: await probeDesktopWindowTransitions(windowChromeController, mainWindow);
			}
			domReady = true;
			publishReady();
		})().catch((error) => {
			console.error(error instanceof Error ? error.message : String(error));
			Utils.quit();
		});
	});

	let shutdownComplete = false;
	let shutdownPromise: Promise<void> | undefined;
	Electrobun.events.on("before-quit", (event) => {
		if (shutdownComplete) return;
		event.response = { allow: false };
		shutdownPromise ??= host.server.shutdown().finally(() => {
			shutdownComplete = true;
			Utils.quit();
		});
	});
	const controlPath = process.env.THINKRAIL_DESKTOP_CONTROL_FILE;
	if (controlPath) {
		const poll = setInterval(() => {
			if (!existsSync(controlPath)) return;
			clearInterval(poll);
			if (readFileSync(controlPath, "utf8").trim() === "close") {
				windowChromeController?.requestClose();
				return;
			}
			Utils.quit();
		}, 50);
	}
	void mainWindow;
	void shutdownPromise;
}

try {
	await start();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(message);
	await Utils.showMessageBox({
		type: "error",
		title: "ThinkRail could not start",
		message: "ThinkRail could not start",
		detail: message,
		buttons: ["Quit"],
	});
	Utils.quit();
}
