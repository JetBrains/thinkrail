// Dev/e2e entry: boot the host from env. The polished `thinkrail-pi` bin lives in apps/cli (M15).
import { resolveShellEnv } from "@thinkrail-pi/shared/shellEnv";
import { createServer } from "./host";

resolveShellEnv();

const port = Number(process.env.THINKRAIL_PI_PORT ?? 24242);
const host = process.env.THINKRAIL_PI_HOST ?? "localhost";
const staticDir = process.env.THINKRAIL_PI_STATIC_DIR;

const server = createServer({ port, host, ...(staticDir ? { staticDir } : {}) });
console.log(`thinkrail-pi host: http://${host}:${server.port}`);
