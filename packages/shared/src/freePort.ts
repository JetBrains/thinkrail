// Free-port selection for the host. `Bun.serve` does not report `EADDRINUSE` for a busy `localhost` port
// on every platform — it can silently share the port via `SO_REUSEPORT` — so occupancy is detected by
// probing with a TCP connect (a refused connection means nothing is listening), not by catching a bind error.

import { connect, createServer } from "node:net";

const DEFAULT_HOST = "localhost";
const PROBE_TIMEOUT_MS = 300;
const DEFAULT_SCAN_ATTEMPTS = 20;

/** True when an error (or every address of an `autoSelectFamily` aggregate) is a connection refusal. */
function isConnectionRefused(err: unknown): boolean {
	const e = err as NodeJS.ErrnoException & { errors?: NodeJS.ErrnoException[] };
	if (e.code === "ECONNREFUSED") return true;
	if (Array.isArray(e.errors) && e.errors.length > 0) {
		return e.errors.every((inner) => inner.code === "ECONNREFUSED");
	}
	return false;
}

/**
 * Resolve `true` when nothing is listening on `host:port`. A successful connect means the port is taken;
 * a refused connection means it's free; a timeout or any other error is treated as taken (so a port we
 * can't positively confirm free is skipped).
 */
export function isPortFree(port: number, host: string = DEFAULT_HOST): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect({ port, host, autoSelectFamily: true });
		let settled = false;
		const finish = (free: boolean): void => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(free);
		};
		socket.setTimeout(PROBE_TIMEOUT_MS);
		socket.once("connect", () => finish(false));
		socket.once("timeout", () => finish(false));
		socket.once("error", (err) => finish(isConnectionRefused(err)));
	});
}

/** Ask the OS for an unused ephemeral port (always free) — the fallback when the scan range is exhausted. */
function osAssignedPort(host: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once("error", reject);
		probe.listen(0, host, () => {
			const address = probe.address();
			const port = typeof address === "object" && address ? address.port : 0;
			probe.close(() => resolve(port));
		});
	});
}

/**
 * The first free port at or above `preferred`, scanning up to `attempts` ports. Falls back to an
 * OS-assigned ephemeral port if every port in the range is taken.
 */
export async function findFreePort(
	preferred: number,
	host: string = DEFAULT_HOST,
	attempts: number = DEFAULT_SCAN_ATTEMPTS,
): Promise<number> {
	for (let port = preferred; port < preferred + attempts && port <= 65535; port += 1) {
		if (await isPortFree(port, host)) return port;
	}
	return osAssignedPort(host);
}
