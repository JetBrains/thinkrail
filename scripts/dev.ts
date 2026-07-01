#!/usr/bin/env bun
// `bun run dev`: pick a free host port, then run the web (vite) + server (host) dev tasks. Both read
// THINKRAIL_PI_PORT — the host binds it, vite proxies `/ws` to it — so a second dev session (e.g. another
// branch) lands on its own port instead of silently sharing one. THINKRAIL_PI_DEV_OPEN tells vite to open
// the browser at its own URL — scoped to this launcher, so a bare `dev:web` stays quiet. apps/cli is
// excluded: it's the standalone product launcher (free-picks its own port + serves a built SPA), so
// running it here would boot a redundant second host that nothing connects to.

import { findFreePort } from "@thinkrail-pi/shared/freePort";

const host = process.env.THINKRAIL_PI_HOST ?? "localhost";
const preferred = Number(process.env.THINKRAIL_PI_PORT ?? 24242);
const port = await findFreePort(preferred, host);
if (port !== preferred) {
	console.log(`thinkrail-pi dev: host port ${preferred} is in use → using ${port}`);
}

const turbo = Bun.spawn(
	["bunx", "turbo", "run", "dev", "--filter=@thinkrail-pi/web", "--filter=@thinkrail-pi/server"],
	{
		env: { ...process.env, THINKRAIL_PI_PORT: String(port), THINKRAIL_PI_DEV_OPEN: "1" },
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

process.exit(await turbo.exited);
