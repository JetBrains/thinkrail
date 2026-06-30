#!/usr/bin/env bun
// `bun run dev`: pick a free host port, then run `turbo run dev`. The host and vite both read
// THINKRAIL_PI_PORT — the host binds it, vite proxies `/ws` to it — so a second dev session (e.g. another
// branch) lands on its own port instead of silently sharing one already in use.

import { findFreePort } from "@thinkrail-pi/shared/freePort";

const host = process.env.THINKRAIL_PI_HOST ?? "localhost";
const preferred = Number(process.env.THINKRAIL_PI_PORT ?? 24242);
const port = await findFreePort(preferred, host);
if (port !== preferred) {
	console.log(`thinkrail-pi dev: host port ${preferred} is in use → using ${port}`);
}

const turbo = Bun.spawn(["bunx", "turbo", "run", "dev"], {
	env: { ...process.env, THINKRAIL_PI_PORT: String(port) },
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit",
});

const stop = (): void => {
	turbo.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

process.exit(await turbo.exited);
