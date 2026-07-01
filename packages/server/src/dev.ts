// Dev/e2e entry: boot the host from env. The polished `thinkrail-pi` bin lives in apps/cli.
import { bootHost } from "./host";

const host = process.env.THINKRAIL_PI_HOST ?? "localhost";
const staticDir = process.env.THINKRAIL_PI_STATIC_DIR;
// An explicit THINKRAIL_PI_PORT is honored as-is (e2e pins it; the dev launcher pre-picks it so vite's
// proxy can match). With none set, pick a free port so a standalone host never collides with one running.
const envPort = process.env.THINKRAIL_PI_PORT;

const { port } = await bootHost({
	port: envPort ? Number(envPort) : 24242,
	host,
	portMode: envPort ? "exact" : "free",
	...(staticDir ? { staticDir } : {}),
});
console.log(`thinkrail-pi host: http://${host}:${port}`);
