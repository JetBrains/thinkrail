#!/usr/bin/env bun
// `bun run dev`: pick free host + web ports, run the web (vite) + server (host) dev tasks, and open the
// default browser at the vite URL once it's serving. The host reads THINKRAIL_PI_PORT (vite proxies `/ws`
// to it); vite reads THINKRAIL_PI_WEB_PORT — both pre-picked here, so a second dev session (e.g. another
// branch) lands on its own ports instead of silently sharing one. apps/cli is excluded: it's the
// standalone product launcher (free-picks its own port + serves a built SPA), so running it here would
// boot a redundant second host that nothing connects to.

import { findFreePort } from "@thinkrail-pi/shared/freePort";

const host = process.env.THINKRAIL_PI_HOST ?? "localhost";
const preferred = Number(process.env.THINKRAIL_PI_PORT ?? 24242);
const port = await findFreePort(preferred, host);
if (port !== preferred) {
	console.log(`thinkrail-pi dev: host port ${preferred} is in use → using ${port}`);
}
const webPort = await findFreePort(24269, host);

const turbo = Bun.spawn(
	["bunx", "turbo", "run", "dev", "--filter=@thinkrail-pi/web", "--filter=@thinkrail-pi/server"],
	{
		env: {
			...process.env,
			THINKRAIL_PI_PORT: String(port),
			THINKRAIL_PI_WEB_PORT: String(webPort),
		},
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	},
);

const stop = (): void => {
	turbo.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

// Open the browser ourselves — the OS default (via `open`/`xdg-open`/`start`) — rather than via vite,
// whose macOS heuristic opens a running Chrome regardless of the user's default browser.
const openHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
void openWhenReady(`http://${openHost}:${webPort}/`);

process.exit(await turbo.exited);

/** Poll `url` until the dev server answers, then open it in the default browser. Gives up quietly. */
async function openWhenReady(url: string): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			await fetch(url);
			openBrowser(url);
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	}
}

/** Open `url` in the OS default browser, best-effort (never blocks or keeps the process alive). */
function openBrowser(url: string): void {
	const command =
		process.platform === "darwin"
			? ["open", url]
			: process.platform === "win32"
				? ["cmd", "/c", "start", "", url]
				: ["xdg-open", url];
	try {
		Bun.spawn(command, { stdout: "ignore", stderr: "ignore" }).unref();
	} catch {
		// Headless / no browser available — vite prints the URL, so this is non-fatal.
	}
}
