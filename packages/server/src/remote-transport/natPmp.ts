import { execFile } from "node:child_process";
import dgram from "node:dgram";
import { readFile } from "node:fs/promises";

/** A public address the router forwards to one local UDP port, kept until released. */
export interface PortLease {
	readonly address: string;
	readonly port: number;
	release(): void;
}

/** Asks the local router to forward a public port to a local UDP port; null when it cannot. */
export interface PortMapper {
	open(internalPort: number): Promise<PortLease | null>;
}

const NAT_PMP_PORT = 5351;
const OP_ADDRESS = 0;
const OP_MAP_UDP = 1;

export const encodeAddressRequest = (): Buffer => Buffer.from([0, OP_ADDRESS]);

export function encodeMapRequest(
	internalPort: number,
	externalPort: number,
	lifetime: number,
): Buffer {
	const request = Buffer.alloc(12);
	request.writeUInt8(0, 0);
	request.writeUInt8(OP_MAP_UDP, 1);
	request.writeUInt16BE(internalPort, 4);
	request.writeUInt16BE(externalPort, 6);
	request.writeUInt32BE(lifetime, 8);
	return request;
}

/** The router's public IPv4 address from an address response; null for anything else or a refusal. */
export function parseAddressResponse(message: Buffer): string | null {
	if (message.length < 12 || message[0] !== 0 || message[1] !== 128 + OP_ADDRESS) return null;
	if (message.readUInt16BE(2) !== 0) return null;
	const address = [...message.subarray(8, 12)].join(".");
	return address === "0.0.0.0" ? null : address;
}

export function parseMapResponse(
	message: Buffer,
	internalPort: number,
): { port: number; lifetime: number } | null {
	if (message.length < 16 || message[0] !== 0 || message[1] !== 128 + OP_MAP_UDP) return null;
	if (message.readUInt16BE(2) !== 0 || message.readUInt16BE(8) !== internalPort) return null;
	const port = message.readUInt16BE(10);
	const lifetime = message.readUInt32BE(12);
	return port === 0 ? null : { port, lifetime };
}

function run(command: string, args: string[]): Promise<string> {
	return new Promise((resolve) => {
		execFile(command, args, { timeout: 2_000 }, (error, stdout) =>
			resolve(error ? "" : String(stdout)),
		);
	});
}

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

/** The default IPv4 gateway, read from the OS route table; null when there is none or it cannot be read. */
export async function defaultGateway(
	platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
	if (platform === "darwin") {
		const match = /gateway:\s*(\S+)/.exec(await run("route", ["-n", "get", "default"]));
		return match?.[1] && IPV4.test(match[1]) ? match[1] : null;
	}
	if (platform === "linux") {
		const table = await readFile("/proc/net/route", "utf8").catch(() => "");
		for (const line of table.split("\n").slice(1)) {
			const [, destination, gateway] = line.trim().split(/\s+/);
			if (destination !== "00000000" || !gateway || gateway === "00000000") continue;
			const bytes = gateway.match(/../g)?.map((byte) => Number.parseInt(byte, 16)) ?? [];
			return bytes.reverse().join(".");
		}
		return null;
	}
	if (platform === "win32") {
		const match = /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\S+)/m.exec(
			await run("route", ["print", "-4", "0.0.0.0"]),
		);
		return match?.[1] && IPV4.test(match[1]) ? match[1] : null;
	}
	return null;
}

export interface NatPmpOptions {
	gateway?: () => Promise<string | null>;
	/** The router's NAT-PMP port; a test points it at a fake. */
	port?: number;
	/** Seconds a mapping is asked for; it is renewed at half of what the router grants while held. */
	lifetimeSeconds?: number;
	/** Per-try wait; NAT-PMP retries once at double. */
	timeoutMs?: number;
	/** After a router did not answer, how long to skip asking it again. */
	unsupportedForMs?: number;
	now?: () => number;
}

/**
 * NAT-PMP (RFC 6886) against the default gateway: the port mapping Tailscale and others use so a peer
 * behind a strict NAT (a phone on a carrier's CGNAT) can still reach this host directly. A router that does
 * not answer is left alone for a while, so a network without it costs one short wait, not one per session.
 */
export function createNatPmpMapper(options: NatPmpOptions = {}): PortMapper {
	const findGateway = options.gateway ?? (() => defaultGateway());
	const routerPort = options.port ?? NAT_PMP_PORT;
	const lifetime = options.lifetimeSeconds ?? 600;
	const timeoutMs = options.timeoutMs ?? 250;
	const unsupportedForMs = options.unsupportedForMs ?? 60_000;
	const now = options.now ?? Date.now;
	let skipUntil = 0;

	const ask = (gateway: string, request: Buffer, accept: (reply: Buffer) => boolean) =>
		new Promise<Buffer | null>((resolve) => {
			const socket = dgram.createSocket("udp4");
			let done = false;
			const timers: ReturnType<typeof setTimeout>[] = [];
			const finish = (reply: Buffer | null): void => {
				if (done) return;
				done = true;
				for (const timer of timers) clearTimeout(timer);
				socket.close();
				resolve(reply);
			};
			socket.on("error", () => finish(null));
			socket.on("message", (reply, from) => {
				if (from.address === gateway && accept(reply)) finish(reply);
			});
			const send = (): void => {
				if (!done) socket.send(request, routerPort, gateway, () => {});
			};
			send();
			timers.push(setTimeout(send, timeoutMs));
			timers.push(setTimeout(() => finish(null), timeoutMs * 3));
		});

	return {
		async open(internalPort) {
			if (now() < skipUntil) return null;
			const gateway = await findGateway();
			if (!gateway) return null;
			const addressReply = await ask(
				gateway,
				encodeAddressRequest(),
				(reply) => reply[1] === 128 + OP_ADDRESS,
			);
			const address = addressReply ? parseAddressResponse(addressReply) : null;
			if (!address) {
				skipUntil = now() + unsupportedForMs;
				return null;
			}
			const map = async (externalPort: number, seconds: number) => {
				const reply = await ask(
					gateway,
					encodeMapRequest(internalPort, externalPort, seconds),
					(message) => message[1] === 128 + OP_MAP_UDP,
				);
				return reply ? parseMapResponse(reply, internalPort) : null;
			};
			const granted = await map(internalPort, lifetime);
			if (!granted) return null;

			let released = false;
			let renewal: ReturnType<typeof setTimeout> | null = null;
			const scheduleRenewal = (seconds: number): void => {
				renewal = setTimeout(() => {
					if (released) return;
					void map(granted.port, lifetime).then((next) => {
						if (next && !released) scheduleRenewal(next.lifetime);
					});
				}, Math.max(seconds, 2) * 500);
				renewal.unref?.();
			};
			scheduleRenewal(granted.lifetime);
			return {
				address,
				port: granted.port,
				release() {
					if (released) return;
					released = true;
					if (renewal) clearTimeout(renewal);
					void map(0, 0);
				},
			};
		},
	};
}
