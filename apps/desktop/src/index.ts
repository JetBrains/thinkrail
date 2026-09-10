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
} from "electrobun/main";
import { installDesktopApplicationMenu } from "./applicationMenu";
import { installExternalNavigation } from "./externalNavigation";
import {
	injectInitialDesktopPreferences,
	readDesktopPreferenceRemove,
	readDesktopPreferenceWrite,
} from "./preferenceAdapter";
import { PreferenceStore } from "./preferenceStore";
import { RouteStore } from "./routeStore";
import type { DesktopRpc } from "./rpc";
import { ptyLibraryName, runtimeTarget } from "./runtimeTarget";
import type { DesktopServerRuntime } from "./serverRuntime";
import { createElectrobunQuitCoordinator, createElectrobunUpdateController } from "./updates";
import { readWindowChromeAppearance } from "./windowAppearance";
import {
	desktopWindowChrome,
	injectInitialWindowChrome,
	installWindowChromeGeometry,
	WINDOWS_CHROME_SOURCE,
	windowChromeGeometry,
} from "./windowChrome";
import { createWindowsChrome, type WindowsChromeController } from "./windowsChrome";

type BeforeQuitEvent = ReturnType<typeof Electrobun.events.events.app.beforeQuit>;

const BACKEND_PROFILE_ID = "local";
const WINDOW_ID = "main";

function writeReady(path: string, payload: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(payload));
}

async function start(): Promise<void> {
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
	const chromeProbePath =
		!neutral && process.platform === "win32"
			? process.env.THINKRAIL_DESKTOP_CHROME_PROBE_FILE
			: undefined;
	let nativeChrome: WindowsChromeController | null = null;
	const quitCoordinator = createElectrobunQuitCoordinator(() => host.server.shutdown());
	Electrobun.events.on("before-quit", (event: BeforeQuitEvent) => {
		quitCoordinator.handleBeforeQuit(event);
	});
	const updateController = await createElectrobunUpdateController({
		isPackaged: Electrobun.app.isPackaged,
		version,
		channel,
		platform: process.platform,
		arch: process.arch,
		restartToUpdate: quitCoordinator.restartToUpdate,
	});
	const rpc = BrowserView.defineRPC<DesktopRpc>({
		maxRequestTime: 5000,
		handlers: {
			requests: {
				getUpdateState: () => updateController.getState(),
				checkForUpdates: async () => {
					await updateController.checkForUpdates();
					return undefined;
				},
				restartToUpdate: async () => {
					await updateController.restartToUpdate();
					return undefined;
				},
			},
			messages: {
				windowAppearanceChanged: (payload) => {
					const appearance = readWindowChromeAppearance(payload);
					if (!appearance || !nativeChrome) return;
					try {
						nativeChrome.setAppearance(appearance);
					} catch (error) {
						console.error("[desktop] could not update native window appearance", error);
					}
				},
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
			},
		},
	});
	const windowChrome = desktopWindowChrome(process.platform, Boolean(chromeProbePath));
	const preload = neutral
		? null
		: injectInitialWindowChrome(
				injectInitialDesktopPreferences(
					await Bun.file(join(PATHS.VIEWS_FOLDER, "preload", "index.js")).text(),
					initialPreferences,
				),
				windowChrome.geometry,
				Boolean(chromeProbePath),
				windowChrome.dragRegion,
			);
	const mainWindow = new BrowserWindow({
		title: "ThinkRail",
		url: neutral ? "about:blank" : `${origin}/${initialRoute}`,
		preload,
		...(neutral ? {} : { rpc }),
		hidden:
			process.env.THINKRAIL_DESKTOP_HIDDEN === "1" ||
			process.env.THINKRAIL_DESKTOP_E2E_HOST === "1",
		navigationRules: neutral ? null : JSON.stringify(["^*", `${origin}/*`]),
		frame: { x: 80, y: 60, width: 1440, height: 920 },
		...(neutral
			? {}
			: {
					titleBarStyle: windowChrome.titleBarStyle,
					...(windowChrome.trafficLightOffset
						? { trafficLightOffset: windowChrome.trafficLightOffset }
						: {}),
				}),
	});
	if (chromeProbePath) {
		if (!mainWindow.ptr) throw new Error("The native chrome probe has no window handle");
		nativeChrome = createWindowsChrome(mainWindow.ptr, join(runtimeDir, WINDOWS_CHROME_SOURCE));
	}
	if (!neutral) {
		let documentCount = 0;
		if (chromeProbePath) mainWindow.webview.on("dom-ready", () => documentCount++);
		installWindowChromeGeometry(
			mainWindow,
			() => {
				const geometry = nativeChrome
					? nativeChrome.readGeometry()
					: windowChromeGeometry(windowChrome, mainWindow.isFullScreen());
				if (chromeProbePath) {
					writeReady(chromeProbePath, {
						pid: process.pid,
						hwnd: Number(mainWindow.ptr),
						documentCount,
						frame: mainWindow.getFrame(),
						fullScreen: mainWindow.isFullScreen(),
						maximized: mainWindow.isMaximized(),
						minimized: mainWindow.isMinimized(),
						geometry,
					});
				}
				return geometry;
			},
			(geometry) => rpc.send.windowChromeChanged(geometry),
		);
	}
	const navigationProbePath = neutral
		? undefined
		: process.env.THINKRAIL_DESKTOP_NAVIGATION_PROBE_FILE;
	const removeNavigationListeners = installExternalNavigation(
		Electrobun.events,
		mainWindow.webview.id,
		origin,
		(url) => {
			if (navigationProbePath) writeReady(navigationProbePath, { url });
			else Utils.openExternal(url);
		},
	);
	mainWindow.on("close", removeNavigationListeners);
	updateController.subscribe((state) => rpc.send.updateStateChanged(state));

	let ready = false;
	mainWindow.webview.on("dom-ready", () => {
		if (ready) return;
		ready = true;
		updateController.start();
		const readyPath = process.env.THINKRAIL_DESKTOP_READY_FILE;
		if (readyPath) {
			writeReady(readyPath, {
				origin,
				runtimeDir,
				applicationMenuInstalled,
				pid: process.pid,
				launcherPid: Number(process.env.ELECTROBUN_LAUNCHER_PID),
				windowUrl: neutral ? "about:blank" : `${origin}/${initialRoute}`,
				mode: neutral ? "host" : "ui",
			});
		}
	});

	const controlPath = process.env.THINKRAIL_DESKTOP_CONTROL_FILE;
	if (controlPath) {
		let navigationProbeStarted = false;
		let lastChromeCommand: string | undefined;
		const poll = setInterval(() => {
			if (!existsSync(controlPath)) return;
			if (navigationProbePath || chromeProbePath) {
				const command = readFileSync(controlPath, "utf8");
				if (chromeProbePath && command !== lastChromeCommand) {
					lastChromeCommand = command;
					switch (command) {
						case "chrome:maximize":
							mainWindow.maximize();
							break;
						case "chrome:restore":
							mainWindow.unmaximize();
							break;
						case "chrome:fullscreen-on":
							mainWindow.setFullScreen(true);
							break;
						case "chrome:fullscreen-off":
							mainWindow.setFullScreen(false);
							break;
						case "chrome:reload":
							mainWindow.webview.executeJavascript("window.location.reload();");
					}
				}
				if (navigationProbePath && command === "navigate" && !navigationProbeStarted) {
					navigationProbeStarted = true;
					mainWindow.webview.executeJavascript(
						'window.location.assign("https://example.invalid/thinkrail-navigation-probe");',
					);
				}
				if (command !== "stop") return;
			}
			clearInterval(poll);
			Utils.quit();
		}, 50);
	}
	void mainWindow;
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
