// Dev/e2e entry: boot the host from env. The polished `thinkrail-pi` bin lives in apps/cli (M15).
import { findFreePort } from "@thinkrail-pi/shared/freePort";
import { resolveShellEnv } from "@thinkrail-pi/shared/shellEnv";
import { createServer } from "./host";

resolveShellEnv();

const host = process.env.THINKRAIL_PI_HOST ?? "localhost";
const staticDir = process.env.THINKRAIL_PI_STATIC_DIR;
// An explicit THINKRAIL_PI_PORT is honored as-is (e2e pins it; the dev launcher pre-picks it so vite's
// proxy can match). With none set, pick a free port so a standalone host never collides with one running.
const port = process.env.THINKRAIL_PI_PORT
	? Number(process.env.THINKRAIL_PI_PORT)
	: await findFreePort(24242, host);

const server = createServer({ port, host, ...(staticDir ? { staticDir } : {}) });
console.log(`thinkrail-pi host: http://${host}:${server.port}`);
