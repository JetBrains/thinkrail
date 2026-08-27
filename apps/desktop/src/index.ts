import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
import { RouteStore } from "./routeStore";
import type { DesktopRpc } from "./rpc";
import { ptyLibraryName, runtimeTarget } from "./runtimeTarget";
import type { DesktopServerRuntime } from "./serverRuntime";

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
	const routePath = join(
		process.env.THINKRAIL_DESKTOP_USER_DATA ?? Utils.paths.userData,
		"routes.json",
	);
	const routes = new RouteStore(routePath);
	const initialRoute = routes.read(BACKEND_PROFILE_ID, WINDOW_ID);
	const neutral = process.env.THINKRAIL_DESKTOP_E2E_HOST === "1";
	const rpc = BrowserView.defineRPC<DesktopRpc>({
		maxRequestTime: 5000,
		handlers: {
			requests: {},
			messages: {
				routeChanged: ({ hash }) => {
					if (!neutral) routes.write(BACKEND_PROFILE_ID, WINDOW_ID, hash);
				},
			},
		},
	});
	const preload = neutral ? null : await Bun.file(join(runtimeDir, "preload.js")).text();
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
	});
	const openExternal = (detail: unknown) => {
		const url = externalNavigationUrl(detail, origin);
		if (url) Utils.openExternal(url);
	};
	mainWindow.webview.on("will-navigate", (event) => openExternal(event.data.detail));
	mainWindow.webview.on("new-window-open", (event) => openExternal(event.data.detail));

	let ready = false;
	mainWindow.webview.on("dom-ready", () => {
		if (ready) return;
		ready = true;
		const readyPath = process.env.THINKRAIL_DESKTOP_READY_FILE;
		if (readyPath) {
			writeReady(readyPath, {
				origin,
				runtimeDir,
				applicationMenuInstalled,
				pid: process.pid,
				windowUrl: neutral ? "about:blank" : `${origin}/${initialRoute}`,
				mode: neutral ? "host" : "ui",
			});
		}
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
