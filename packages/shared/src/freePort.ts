import { connect, createServer } from "node:net";

const DEFAULT_HOST = "localhost";
const PROBE_TIMEOUT_MS = 300;
const DEFAULT_SCAN_ATTEMPTS = 20;

function isConnectionRefused(err: unknown): boolean {
	const e = err as NodeJS.ErrnoException & { errors?: NodeJS.ErrnoException[] };
	if (e.code === "ECONNREFUSED") return true;
	if (Array.isArray(e.errors) && e.errors.length > 0) {
		return e.errors.every((inner) => inner.code === "ECONNREFUSED");
	}
	return false;
}

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
