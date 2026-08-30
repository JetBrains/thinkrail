import { createHash } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { connect, createServer, type Server } from "node:net";

const HANDSHAKE_PREFIX = "THINKRAIL_HOST_OWNER_V1 ";
const FIRST_PORT = 26000;
const PORT_COUNT = 4000;
const CANDIDATE_COUNT = 8;
const PROBE_TIMEOUT_MS = 750;

export class HostAlreadyRunningError extends Error {
	readonly code = "HOST_ALREADY_RUNNING";
}

export class HostOwnershipUnavailableError extends Error {
	readonly code = "HOST_OWNERSHIP_UNAVAILABLE";
}

export interface HostOwnershipLease {
	readonly fingerprint: string;
	readonly port: number;
	release(): Promise<void>;
}

function dataDirectoryFingerprint(path: string): string {
	mkdirSync(path, { recursive: true });
	return createHash("sha256").update(realpathSync.native(path)).digest("hex");
}

function candidatePorts(fingerprint: string): number[] {
	const ports: number[] = [];
	for (let index = 0; ports.length < CANDIDATE_COUNT; index += 1) {
		const offset = Number.parseInt(fingerprint.slice(index * 4, index * 4 + 4), 16) % PORT_COUNT;
		const port = FIRST_PORT + offset;
		if (!ports.includes(port)) ports.push(port);
	}
	return ports;
}

function listen(server: Server, port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const onError = (error: Error & { code?: string }) => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.off("error", onError);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen({ port, host: "127.0.0.1", exclusive: true });
	});
}

function probe(port: number): Promise<string | null> {
	return new Promise((resolve) => {
		let settled = false;
		let data = "";
		const socket = connect({ port, host: "127.0.0.1" });
		const finish = (value: string | null) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(value);
		};
		socket.setTimeout(PROBE_TIMEOUT_MS);
		socket.on("data", (chunk) => {
			data += chunk.toString();
			if (data.startsWith(HANDSHAKE_PREFIX) && data.length >= HANDSHAKE_PREFIX.length + 64) {
				finish(data.slice(HANDSHAKE_PREFIX.length, HANDSHAKE_PREFIX.length + 64));
			}
		});
		socket.on("timeout", () => finish(null));
		socket.on("error", () => finish(null));
		socket.on("end", () => finish(null));
	});
}

export function hostOwnershipCandidates(path: string): {
	fingerprint: string;
	ports: number[];
} {
	const fingerprint = dataDirectoryFingerprint(path);
	return { fingerprint, ports: candidatePorts(fingerprint) };
}

export async function acquireHostOwnership(path: string): Promise<HostOwnershipLease> {
	const fingerprint = dataDirectoryFingerprint(path);
	for (const port of candidatePorts(fingerprint)) {
		const server = createServer((socket) => socket.end(`${HANDSHAKE_PREFIX}${fingerprint}\n`));
		try {
			await listen(server, port);
			let releasePromise: Promise<void> | undefined;
			return {
				fingerprint,
				port,
				release() {
					releasePromise ??= new Promise((resolve, reject) => {
						server.close((error) => (error ? reject(error) : resolve()));
					});
					return releasePromise;
				},
			};
		} catch (error) {
			server.close();
			if (!(error instanceof Error) || !("code" in error) || error.code !== "EADDRINUSE") {
				throw error;
			}
			const owner = await probe(port);
			if (owner === fingerprint) {
				throw new HostAlreadyRunningError(`ThinkRail is already running for ${path}`);
			}
			if (owner === null) {
				throw new HostOwnershipUnavailableError(
					`ThinkRail could not verify the process occupying ownership port ${port}`,
				);
			}
		}
	}
	throw new HostOwnershipUnavailableError(`ThinkRail could not acquire ownership for ${path}`);
}
