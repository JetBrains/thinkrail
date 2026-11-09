import { withPublicStun } from "@thinkrail/contracts";
import { RTCPeerConnection } from "werift";

const withTimeout = <T>(work: Promise<T>, ms: number, fallback: T): Promise<T> =>
	Promise.race([work, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

/** The IPv4 address STUN reports for this machine (its NAT's public side), or undefined when STUN is unreachable. */
export async function stunMappedAddress(timeoutMs = 3000): Promise<string | undefined> {
	const pc = new RTCPeerConnection({ iceServers: withPublicStun() });
	const gather = async (): Promise<string | undefined> => {
		pc.createDataChannel("probe");
		await pc.setLocalDescription(await pc.createOffer());
		const sdp = pc.localDescription?.sdp ?? "";
		const match = /^a=candidate:\S+ \d+ udp \d+ (\d+\.\d+\.\d+\.\d+) \d+ typ srflx/im.exec(sdp);
		return match?.[1];
	};
	try {
		return await withTimeout(gather(), timeoutMs, undefined);
	} catch {
		return undefined;
	} finally {
		void pc.close();
	}
}

/** Whether the relay answers on `ip` — only true when that address really routes back to this machine. */
export async function relayAnswersAt(ip: string, port: number, timeoutMs = 2000): Promise<boolean> {
	try {
		const response = await fetch(`http://${ip}:${port}/health`, {
			signal: AbortSignal.timeout(timeoutMs),
		});
		return (await response.text()) === "ok";
	} catch {
		return false;
	}
}

export interface PublicAddressDeps {
	mappedAddress?: () => Promise<string | undefined>;
	answersAt?: (ip: string, port: number) => Promise<boolean>;
}

/** What the internet-facing check found, once it has run. */
export type PublicDiscovery = { state: "reachable" | "closed"; ip: string } | { state: "offline" };

/**
 * The public address of a host behind 1:1 NAT (a cloud VM whose interface carries only a private IP): the
 * STUN-mapped address, `reachable` only when the relay answers there, so a home router's address — which does
 * not forward the port — is reported `closed` and never advertised.
 */
export async function discoverPublicAddress(
	port: number,
	deps: PublicAddressDeps = {},
): Promise<PublicDiscovery> {
	const ip = await (deps.mappedAddress ?? stunMappedAddress)();
	if (ip === undefined) return { state: "offline" };
	const reachable = await (deps.answersAt ?? relayAnswersAt)(ip, port);
	return { state: reachable ? "reachable" : "closed", ip };
}
