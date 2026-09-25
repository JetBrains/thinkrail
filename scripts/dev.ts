#!/usr/bin/env bun

import { randomBytes } from "node:crypto";
import { launchPathFor } from "@thinkrail/contracts";
import { findFreePort } from "@thinkrail/shared/freePort";
import { printStartupMark } from "@thinkrail/shared/startupMark";

const host = process.env.THINKRAIL_HOST ?? "localhost";
const preferred = Number(process.env.THINKRAIL_PORT ?? 24242);
const port = await findFreePort(preferred, host);
if (port !== preferred) {
	console.log(`thinkrail dev: host port ${preferred} is in use → using ${port}`);
}
const webPort = await findFreePort(24269, host);

const openHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
const webOrigin = `http://${openHost}:${webPort}`;
const webUrl = `${webOrigin}/`;
const launchToken = process.env.THINKRAIL_LAUNCH_TOKEN || randomBytes(32).toString("base64url");
const launchUrl = `${webOrigin}${launchPathFor(launchToken)}`;
printStartupMark({ status: "starting", endpoint: webUrl });
console.log(`thinkrail dev → ${launchUrl}`);

const turbo = Bun.spawn(
	["bunx", "turbo", "run", "dev", "--filter=@thinkrail/web", "--filter=@thinkrail/server"],
	{
		env: {
			...process.env,
			THINKRAIL_PORT: String(port),
			THINKRAIL_WEB_PORT: String(webPort),
			THINKRAIL_LAUNCH_TOKEN: launchToken,
			THINKRAIL_ALLOWED_ORIGINS: [openHost, "localhost", "127.0.0.1"]
				.map((name) => `http://${name}:${webPort}`)
				.join(","),
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

void openWhenReady(webUrl, launchUrl);

process.exit(await turbo.exited);

async function openWhenReady(url: string, openUrl: string): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			await fetch(url);
			openBrowser(openUrl);
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	}
}

function openBrowser(url: string): void {
	const command =
		process.platform === "darwin"
			? ["open", url]
			: process.platform === "win32"
				? ["cmd", "/c", "start", "", url]
				: ["xdg-open", url];
	try {
		Bun.spawn(command, { stdout: "ignore", stderr: "ignore" }).unref();
	} catch {}
}
