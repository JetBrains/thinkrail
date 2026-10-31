import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { NativeCommand, NativeQuitHint, NativeWindowState } from "@thinkrail/contracts";
import { resolveShellEnv } from "@thinkrail/shared/shellEnv";
import { channel, posthogProjectKey, version } from "@thinkrail/shared/version";
import Electrobun, {
	ApplicationMenu,
	BrowserView,
	BrowserWindow,
	PATHS,
	Utils,
} from "electrobun/main";
import {
	installDesktopApplicationMenu,
	isNativeCommand,
	QUIT_SHORTCUT_ACTION,
	readMenuAction,
	readMenuLabels,
} from "./applicationMenu";
import { attributionClaimOnFirstReadiness } from "./attributionReadiness";
import { readClipboardFiles } from "./clipboard";
import { desktopError, setDesktopErrorReporter } from "./errorReporting";
import { installExternalNavigation } from "./externalNavigation";
import { createKeyStateReader } from "./keyState";
import {
	type DesktopDialogLabels,
	readDialogLabels,
	readNativeLabels,
	writeNativeLabels,
} from "./nativeLabels";
import { createPageZoomGestureHandler, nextPageZoom } from "./pageZoom";
import {
	injectInitialDesktopPreferences,
	readDesktopPreferenceRemove,
	readDesktopPreferenceWrite,
} from "./preferenceAdapter";
import { PreferenceStore } from "./preferenceStore";
import { createQuitShortcut } from "./quitShortcut";
import { createRepeatGate } from "./repeatGate";
import { RouteStore } from "./routeStore";
import type { DesktopRpc } from "./rpc";
import { ptyLibraryName, runtimeTarget } from "./runtimeTarget";
import type { DesktopServerRuntime } from "./serverRuntime";
import {
	handOffStartupSplash,
	openStartupSplash,
	type StartupSplash,
	splashMessage,
} from "./splash";
import {
	createTitleBarDoubleClickHandler,
	type TitleBarDoubleClickResult,
} from "./titleBarDoubleClick";
import {
	createElectrobunQuitCoordinator,
	createElectrobunUpdateController,
	readPendingInstallVersion,
} from "./updates";
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
import {
	desktopAppUserModelId,
	loadWindowsShellApi,
	stampTaskbarShortcuts,
	taskbarShortcutCandidates,
} from "./windowsTaskbarIdentity";
import {
	applyWindowsWindowIcon,
	loadWindowsIconApi,
	type WindowsHandle,
} from "./windowsWindowIcon";

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
const WINDOW_CONTROLS_PROBE_TARGETS: Record<string, { testId: string; label: string }> = {
	"window-controls-maximize": { testId: "window-maximize", label: "Maximize" },
	"window-controls-restore": { testId: "window-maximize", label: "Restore" },
};
function windowControlsProbeScript(target: { testId: string; label: string }): string {
	return `(() => {
	const selector = ${JSON.stringify(`[data-testid="${target.testId}"][aria-label="${target.label}"]`)};
	const deadline = Date.now() + 15000;
	const poll = () => {
		const element = document.querySelector(selector);
		if (element) element.click();
		else if (Date.now() < deadline) setTimeout(poll, 50);
	};
	poll();
})();`;
}
let startupQuitCoordinator: ReturnType<typeof createElectrobunQuitCoordinator> | undefined;
let startupSplash: StartupSplash | undefined;

function setWindowsAppUserModelId(): void {
	if (process.platform !== "win32") return;
	try {
		loadWindowsShellApi().setProcessAppUserModelId(desktopAppUserModelId(channel));
	} catch (error) {
		desktopError("windows_app_id", "could not set the Windows AppUserModelID", error);
	}
}

function stampWindowsTaskbarShortcuts(): void {
	if (process.platform !== "win32") return;
	try {
		const appDir = dirname(PATHS.RESOURCES_FOLDER);
		const shell = loadWindowsShellApi();
		const candidates = taskbarShortcutCandidates(appDir, process.env.APPDATA);
		const { failures } = shell.withComApartment(() =>
			stampTaskbarShortcuts(
				candidates.paths,
				join(appDir, "bin", "launcher.exe"),
				desktopAppUserModelId(channel),
				shell.openShortcut,
			),
		);
		const [failure] = [...candidates.failures, ...failures];
		if (failure) {
			desktopError(
				"windows_app_id",
				"could not stamp a Windows shortcut's AppUserModelID",
				failure,
			);
		}
	} catch (error) {
		desktopError("windows_app_id", "could not stamp the Windows shortcuts' AppUserModelID", error);
	}
}

function setWindowsWindowIcon(window: { readonly ptr: WindowsHandle | null }): void {
	if (process.platform !== "win32" || !window.ptr) return;
	try {
		applyWindowsWindowIcon(
			window.ptr,
			join(PATHS.RESOURCES_FOLDER, "app.ico"),
			loadWindowsIconApi(),
		);
	} catch (error) {
		desktopError("windows_icon", "could not set the Windows window icon", error);
	}
}

function desktopUserData(): string {
	return process.env.THINKRAIL_DESKTOP_USER_DATA ?? Utils.paths.userData;
}

function nativeLabelsPath(): string {
	return join(desktopUserData(), "native-labels.json");
}

function writeReady(path: string, payload: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(payload));
}

async function start(): Promise<void> {
	setWindowsAppUserModelId();
	const savedLabels = readNativeLabels(nativeLabelsPath());
	let dialogLabels: DesktopDialogLabels = readDialogLabels(savedLabels);
	const applicationMenuInstalled = installDesktopApplicationMenu(
		ApplicationMenu,
		process.platform,
		readMenuLabels(savedLabels),
	);
	let menuTarget: {
		hintVisible(): boolean;
		showHint(hint: NativeQuitHint): void;
		command(command: NativeCommand): void;
	} | null = null;
	const readKeys = createKeyStateReader(process.platform);
	function every(callback: () => void, ms: number) {
		const timer = setInterval(callback, ms);
		return () => clearInterval(timer);
	}
	const quitShortcut = createQuitShortcut({
		readKeys,
		canShowHint: () => menuTarget?.hintVisible() ?? false,
		quit: () => {
			if (startupQuitCoordinator) void startupQuitCoordinator.quit();
			else Utils.quit();
		},
		onHint: (hint) => menuTarget?.showHint(hint),
		now: () => performance.now(),
		every,
	});
	const commandGate = createRepeatGate({ isKeyDown: () => readKeys()?.keyDown ?? null, every });
	ApplicationMenu.on("application-menu-clicked", (event) => {
		const action = readMenuAction(event);
		const target = menuTarget;
		if (action === QUIT_SHORTCUT_ACTION) quitShortcut.press();
		else if (target && isNativeCommand(action)) commandGate(() => target.command(action));
	});
	const runtimeDir = join(PATHS.RESOURCES_FOLDER, "app", "runtime");
	process.env.BUN_PTY_LIB = join(
		runtimeDir,
		ptyLibraryName(runtimeTarget(process.platform, process.arch)),
	);
	const userData = desktopUserData();
	const pendingInstallVersion = readPendingInstallVersion(userData);
	const neutral = process.env.THINKRAIL_DESKTOP_E2E_HOST === "1";
	const updateController = await createElectrobunUpdateController({
		isPackaged: Electrobun.app.isPackaged,
		version,
		channel,
		platform: process.platform,
		arch: process.arch,
		userData,
		restartToUpdate: () => quitCoordinator.restartToUpdate(),
	});
	// Electrobun resolves and caches ../Resources from cwd; leave the bundle only after those reads.
	try {
		process.chdir(homedir());
	} catch (error) {
		desktopError("cwd", "could not leave the app bundle working directory", error);
	}
	const shellEnv = resolveShellEnv();
	if (!neutral && process.env.THINKRAIL_DESKTOP_HIDDEN !== "1") {
		startupSplash = await openStartupSplash(
			(options) => {
				const splash = new BrowserWindow(options);
				setWindowsWindowIcon(splash);
				return splash;
			},
			splashMessage(dialogLabels, pendingInstallVersion),
		);
	}
	const serverRuntime = (await import(
		pathToFileURL(join(runtimeDir, "server-runtime.ts")).href
	)) as DesktopServerRuntime;
	await shellEnv;
	const host = await serverRuntime.startDesktopHost({
		runtimeDir,
		staticDir: join(PATHS.VIEWS_FOLDER, "web"),
		appVersion: version,
		channel,
		posthogProjectKey,
		...(Electrobun.app.isPackaged
			? { openExternal: (url: string) => Utils.openExternal(url) }
			: {}),
	});
	setDesktopErrorReporter(host.reportError);
	const quitCoordinator = createElectrobunQuitCoordinator(
		() => host.server.shutdown(),
		() => dialogLabels,
	);
	startupQuitCoordinator = quitCoordinator;
	Electrobun.events.on("before-quit", (event: BeforeQuitEvent) => {
		quitCoordinator.handleBeforeQuit(event);
	});
	const origin = `http://127.0.0.1:${host.port}`;
	const routes = new RouteStore(join(userData, "routes.json"));
	const preferences = new PreferenceStore(join(userData, "preferences.json"));
	const initialRoute = routes.read(BACKEND_PROFILE_ID, WINDOW_ID);
	const initialPreferences = preferences.read(BACKEND_PROFILE_ID, WINDOW_ID);
	const titleBarProbePath = neutral
		? undefined
		: process.env.THINKRAIL_DESKTOP_TITLE_BAR_PROBE_FILE;
	const titleBarProbe: {
		received: number;
		handled: number;
		result: TitleBarDoubleClickResult | null;
	} = { received: 0, handled: 0, result: null };
	const windowControlsProbePath = neutral
		? undefined
		: process.env.THINKRAIL_DESKTOP_WINDOW_CONTROLS_PROBE_FILE;
	const windowControlsProbe: { requests: string[]; state: NativeWindowState | null } = {
		requests: [],
		state: null,
	};
	const recordWindowControlsProbe = (update: { request?: string; state?: NativeWindowState }) => {
		if (!windowControlsProbePath) return;
		if (update.request) windowControlsProbe.requests.push(update.request);
		if (update.state) windowControlsProbe.state = update.state;
		writeReady(windowControlsProbePath, windowControlsProbe);
	};
	let mainWindow: BrowserWindow;
	const handlePageZoomGesture = createPageZoomGestureHandler({
		getPageZoom: () => mainWindow.getPageZoom(),
		setPageZoom: (zoom) => mainWindow.setPageZoom(zoom),
	});
	let handleTitleBarDoubleClick: () => Promise<void> = async () => {};
	const rpc = BrowserView.defineRPC<DesktopRpc>({
		maxRequestTime: 5000,
		handlers: {
			requests: {
				readClipboardFiles: async () => {
					try {
						return await readClipboardFiles();
					} catch (error) {
						desktopError("clipboard", "could not read clipboard files", error);
						throw error;
					}
				},
				getUpdateState: () => updateController.getState(),
				getWindowState: (): NativeWindowState => readNativeWindowState(mainWindow),
				minimizeWindow: (): undefined => {
					recordWindowControlsProbe({ request: "minimize" });
					mainWindow.minimize();
				},
				toggleMaximizeWindow: (): undefined => {
					recordWindowControlsProbe({ request: "toggleMaximize" });
					if (mainWindow.isMaximized()) mainWindow.unmaximize();
					else mainWindow.maximize();
				},
				closeWindow: (): undefined => {
					recordWindowControlsProbe({ request: "close" });
					mainWindow.requestClose();
				},
				quitApp: (): undefined => {
					void quitCoordinator.quit();
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
				dismissInstallResult: async () => {
					await updateController.dismissInstallResult();
					return undefined;
				},
				showNotification: (input): undefined => {
					Utils.showNotification({
						title: input.title,
						body: input.body,
						...(input.subtitle === undefined ? {} : { subtitle: input.subtitle }),
						...(input.silent === undefined ? {} : { silent: input.silent }),
					});
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
				pageZoomGestureRequested: handlePageZoomGesture,
				menuLabelsChanged: ({ labels }) => {
					const menuLabels = readMenuLabels(labels);
					dialogLabels = readDialogLabels(labels);
					if (!neutral) writeNativeLabels(nativeLabelsPath(), { ...menuLabels, ...dialogLabels });
					if (applicationMenuInstalled) {
						installDesktopApplicationMenu(ApplicationMenu, process.platform, menuLabels);
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
	const windowChrome = desktopWindowChrome(process.platform);
	const preloadSource = neutral
		? null
		: await Bun.file(join(PATHS.VIEWS_FOLDER, "preload", "index.js")).text();
	const preload =
		preloadSource === null
			? null
			: injectInitialWindowChrome(
					injectInitialDesktopPreferences(preloadSource, initialPreferences),
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
	setWindowsWindowIcon(mainWindow);
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
					desktopError("windows_frame", "could not restore the Windows frame controls", error);
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
				(state) => {
					recordWindowControlsProbe({ state });
					rpc.send.windowStateChanged(state);
				},
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
	const releaseStartupSplash = startupSplash
		? handOffStartupSplash(startupSplash, mainWindow)
		: undefined;
	mainWindow.on("focus", () => rpc.send.windowFocusChanged({ focused: true }));
	mainWindow.on("blur", () => rpc.send.windowFocusChanged({ focused: false }));
	updateController.subscribe((state) => rpc.send.updateStateChanged(state));
	menuTarget = {
		hintVisible: () => !mainWindow.isMinimized(),
		showHint: (hint) => rpc.send.quitHintChanged({ hint }),
		command: (command) => rpc.send.nativeCommand({ command }),
	};

	let ready = false;
	const startAttributionClaim = attributionClaimOnFirstReadiness(() =>
		host.server.startAttributionClaim(),
	);
	mainWindow.webview.on("dom-ready", () => {
		if (ready) return;
		ready = true;
		releaseStartupSplash?.();
		startupSplash = undefined;
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
		setTimeout(stampWindowsTaskbarShortcuts, 0);
	});

	const controlPath = process.env.THINKRAIL_DESKTOP_CONTROL_FILE;
	if (controlPath) {
		let navigationProbeStarted = false;
		const titleBarProbeCommands = new Set<string>();
		const windowControlsProbeCommands = new Set<string>();
		const poll = setInterval(() => {
			if (!existsSync(controlPath)) return;
			if (navigationProbePath || titleBarProbePath || windowControlsProbePath) {
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
				const windowControlsTarget =
					windowControlsProbePath && Object.hasOwn(WINDOW_CONTROLS_PROBE_TARGETS, command)
						? WINDOW_CONTROLS_PROBE_TARGETS[command]
						: undefined;
				if (windowControlsTarget && !windowControlsProbeCommands.has(command)) {
					windowControlsProbeCommands.add(command);
					mainWindow.webview.executeJavascript(windowControlsProbeScript(windowControlsTarget));
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
	desktopError("startup", message, error);
	startupSplash?.hide();
	try {
		const labels = readDialogLabels(readNativeLabels(nativeLabelsPath()));
		await Utils.showMessageBox({
			type: "error",
			title: labels["desktop.dialog.startFailed"],
			message: labels["desktop.dialog.startFailed"],
			detail: message,
			buttons: [labels["desktop.dialog.quit"]],
		});
	} finally {
		if (startupQuitCoordinator) await startupQuitCoordinator.quit();
		else Utils.quit();
	}
}
