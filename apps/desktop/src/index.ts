import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { NativeWindowState } from "@thinkrail/contracts";
import { channel, version } from "@thinkrail/shared/version";
import Electrobun, {
	ApplicationMenu,
	BrowserView,
	BrowserWindow,
	PATHS,
	Utils,
} from "electrobun/main";
import { installDesktopApplicationMenu } from "./applicationMenu";
import { attributionClaimOnFirstReadiness } from "./attributionReadiness";
import { installExternalNavigation } from "./externalNavigation";
import { preferNativeHostBridge, usesNativeHostBridge } from "./hostTransport";
import { nextPageZoom } from "./pageZoom";
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
import {
	createTitleBarDoubleClickHandler,
	type TitleBarDoubleClickResult,
} from "./titleBarDoubleClick";
import { createElectrobunQuitCoordinator, createElectrobunUpdateController } from "./updates";
import {
	desktopWindowChrome,
	injectInitialWindowChrome,
	installWindowChromeGeometry,
	installWindowChromePublisher,
	readNativeWindowState,
	sameNativeWindowState,
	windowChromeGeometry,
	windowChromePreloadSeed,
} from "./windowChrome";
import { loadWindowsFrameApi, restoreWindowsFrameControls } from "./windowsFrame";

type BeforeQuitEvent = ReturnType<typeof Electrobun.events.events.app.beforeQuit>;

const BACKEND_PROFILE_ID = "local";
const WINDOW_ID = "main";
const TITLE_BAR_PROBE_TARGETS: Record<string, string[]> = {
	"title-bar-double-click": ["topbar"],
	"title-bar-double-click-no-drag": ["topbar-actions", "topbar"],
};
function titleBarProbeScript(testIds: string[]): string {
	return `(() => {
	const ids = ${JSON.stringify(testIds)};
	const deadline = Date.now() + 15000;
	const fire = (element) =>
		element.dispatchEvent(
			new MouseEvent("dblclick", { bubbles: true, cancelable: true, button: 0, detail: 2 }),
		);
	const poll = () => {
		const header = document.querySelector('[data-testid="topbar"]');
		const elements = ids.map((id) => document.querySelector('[data-testid="' + id + '"]'));
		if (
			header &&
			elements.every((element) => element) &&
			getComputedStyle(header).getPropertyValue("--electrobun-app-region").trim() === "drag"
		) {
			elements.forEach((element) => fire(element));
		} else if (Date.now() < deadline) {
			setTimeout(poll, 50);
		}
	};
	poll();
})();`;
}
let startupQuitCoordinator: ReturnType<typeof createElectrobunQuitCoordinator> | undefined;

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
		...(Electrobun.app.isPackaged
			? { openExternal: (url: string) => Utils.openExternal(url) }
			: {}),
	});
	const quitCoordinator = createElectrobunQuitCoordinator(() => host.server.shutdown());
	startupQuitCoordinator = quitCoordinator;
	Electrobun.events.on("before-quit", (event: BeforeQuitEvent) => {
		quitCoordinator.handleBeforeQuit(event);
	});
	const origin = `http://127.0.0.1:${host.port}`;
	const userData = process.env.THINKRAIL_DESKTOP_USER_DATA ?? Utils.paths.userData;
	const routes = new RouteStore(join(userData, "routes.json"));
	const preferences = new PreferenceStore(join(userData, "preferences.json"));
	const initialRoute = routes.read(BACKEND_PROFILE_ID, WINDOW_ID);
	const initialPreferences = preferences.read(BACKEND_PROFILE_ID, WINDOW_ID);
	const neutral = process.env.THINKRAIL_DESKTOP_E2E_HOST === "1";
	const titleBarProbePath = neutral
		? undefined
		: process.env.THINKRAIL_DESKTOP_TITLE_BAR_PROBE_FILE;
	const titleBarProbe: {
		received: number;
		handled: number;
		result: TitleBarDoubleClickResult | null;
	} = { received: 0, handled: 0, result: null };
	let mainWindow: BrowserWindow;
	const updateController = await createElectrobunUpdateController({
		isPackaged: Electrobun.app.isPackaged,
		version,
		channel,
		platform: process.platform,
		arch: process.arch,
		restartToUpdate: quitCoordinator.restartToUpdate,
	});
	let handleTitleBarDoubleClick: () => Promise<void> = async () => {};
	const rpc = BrowserView.defineRPC<DesktopRpc>({
		maxRequestTime: 5000,
		handlers: {
			requests: {
				getUpdateState: () => updateController.getState(),
				getWindowState: (): NativeWindowState => readNativeWindowState(mainWindow),
				minimizeWindow: (): undefined => {
					mainWindow.minimize();
				},
				toggleMaximizeWindow: (): undefined => {
					if (mainWindow.isMaximized()) mainWindow.unmaximize();
					else mainWindow.maximize();
				},
				closeWindow: (): undefined => {
					mainWindow.requestClose();
				},
				checkForUpdates: async () => {
					await updateController.checkForUpdates();
					return undefined;
				},
				downloadUpdate: async () => {
					await updateController.downloadUpdate();
					return undefined;
				},
				restartToUpdate: async () => {
					await updateController.restartToUpdate();
					return undefined;
				},
			},
			messages: {
				titleBarDoubleClick: () => {
					if (titleBarProbePath) {
						titleBarProbe.received += 1;
						writeReady(titleBarProbePath, titleBarProbe);
					}
					void handleTitleBarDoubleClick();
				},
				pageZoomRequested: ({ action }) => {
					mainWindow.setPageZoom(nextPageZoom(mainWindow.getPageZoom(), action));
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
	const windowChrome = desktopWindowChrome(process.platform);
	const preloadSource = neutral
		? null
		: await Bun.file(join(PATHS.VIEWS_FOLDER, "preload", "index.js")).text();
	const preload =
		preloadSource === null
			? null
			: injectInitialWindowChrome(
					injectInitialDesktopPreferences(
						usesNativeHostBridge(process.platform)
							? preferNativeHostBridge(preloadSource)
							: preloadSource,
						initialPreferences,
					),
					windowChromePreloadSeed(windowChrome),
				);
	mainWindow = new BrowserWindow({
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
	if (!neutral) {
		handleTitleBarDoubleClick = createTitleBarDoubleClickHandler({
			enabled: windowChrome.titleBarDoubleClick,
			window: mainWindow,
			...(titleBarProbePath
				? {
						onHandled: (result) => {
							titleBarProbe.handled += 1;
							titleBarProbe.result = result;
							writeReady(titleBarProbePath, titleBarProbe);
						},
					}
				: {}),
		});
		if (windowChrome.restoreFrameControls) {
			const handle = mainWindow.ptr;
			if (handle) {
				try {
					restoreWindowsFrameControls(handle, loadWindowsFrameApi());
				} catch (error) {
					console.error("[desktop] could not restore the Windows frame controls", error);
				}
			}
		}
		installWindowChromeGeometry(
			mainWindow,
			() => windowChromeGeometry(windowChrome, mainWindow.isFullScreen()),
			(geometry) => rpc.send.windowChromeChanged(geometry),
		);
		if (windowChrome.windowControls) {
			installWindowChromePublisher(
				mainWindow,
				() => readNativeWindowState(mainWindow),
				(state) => rpc.send.windowStateChanged(state),
				sameNativeWindowState,
			);
		}
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
	const startAttributionClaim = attributionClaimOnFirstReadiness(() =>
		host.server.startAttributionClaim(),
	);
	mainWindow.webview.on("dom-ready", () => {
		if (ready) return;
		ready = true;
		startAttributionClaim();
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
		const titleBarProbeCommands = new Set<string>();
		const poll = setInterval(() => {
			if (!existsSync(controlPath)) return;
			if (navigationProbePath || titleBarProbePath) {
				const command = readFileSync(controlPath, "utf8");
				if (command === "navigate" && navigationProbePath && !navigationProbeStarted) {
					navigationProbeStarted = true;
					mainWindow.webview.executeJavascript(
						'window.location.assign("https://example.invalid/thinkrail-navigation-probe");',
					);
				}
				const titleBarTargets =
					titleBarProbePath && Object.hasOwn(TITLE_BAR_PROBE_TARGETS, command)
						? TITLE_BAR_PROBE_TARGETS[command]
						: undefined;
				if (titleBarTargets && !titleBarProbeCommands.has(command)) {
					titleBarProbeCommands.add(command);
					mainWindow.webview.executeJavascript(titleBarProbeScript(titleBarTargets));
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
	try {
		await Utils.showMessageBox({
			type: "error",
			title: "ThinkRail could not start",
			message: "ThinkRail could not start",
			detail: message,
			buttons: ["Quit"],
		});
	} finally {
		if (startupQuitCoordinator) await startupQuitCoordinator.quit();
		else Utils.quit();
	}
}
