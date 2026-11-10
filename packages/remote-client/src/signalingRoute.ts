import {
	encodeBrokerFrame,
	type IceServer,
	type PairingNostrRoute,
	parseBrokerMessage,
} from "@thinkrail/contracts";
import { generateNostrSecret, type NostrSignal, openNostrSignal } from "@thinkrail/nostr-signaling";
import { brokerFailure, RemoteConnectError } from "./connectError";
import { openFirstRelay, RelayUnreachableError } from "./relayPicker";

/** One way to exchange signaling frames with the host: a relay broker, or public Nostr relays. */
export interface SignalingPipe {
	readonly route: "relay" | "nostr";
	/** The broker address, or the first Nostr relay. */
	readonly url: string;
	/** Settles once frames can flow, with any TURN servers the route hands out. */
	readonly ready: Promise<readonly IceServer[] | undefined>;
	/** Where host frames and a lost route go; set once, after the pipe was picked. */
	listen(onFrame: (data: string) => void, onLost: (error: RemoteConnectError) => void): void;
	send(data: string): void;
	close(): void;
}

/** A broker connection over an open socket: `connect` to the host key, then frames once it is `ready`. */
export function createBrokerPipe(socket: WebSocket, url: string, hostKey: string): SignalingPipe {
	let onFrame: (data: string) => void = () => {};
	let onLost: (error: RemoteConnectError) => void = () => {};
	let settle: (ice: readonly IceServer[] | undefined) => void = () => {};
	let fail: (error: RemoteConnectError) => void = () => {};
	let isReady = false;
	const ready = new Promise<readonly IceServer[] | undefined>((resolve, reject) => {
		settle = resolve;
		fail = reject;
	});
	ready.catch(() => {});
	const lost = (error: RemoteConnectError): void => (isReady ? onLost(error) : fail(error));

	socket.addEventListener("error", () =>
		lost(new RemoteConnectError("relay_lost", "relay connection failed")),
	);
	socket.addEventListener("close", () =>
		lost(new RemoteConnectError("relay_lost", "relay connection closed")),
	);
	socket.addEventListener("message", (event: MessageEvent) => {
		if (typeof event.data !== "string") return;
		const frame = parseBrokerMessage(event.data);
		if (!frame) return;
		if (frame.t === "error") lost(brokerFailure(frame.reason));
		else if (frame.t === "ready") {
			isReady = true;
			settle(frame.ice);
		} else if (frame.t === "frame") onFrame(frame.data);
	});
	socket.send(encodeBrokerFrame({ t: "connect", hostKey }));

	return {
		route: "relay",
		url,
		ready,
		listen(frame, gone) {
			onFrame = frame;
			onLost = gone;
		},
		send: (data) => socket.send(encodeBrokerFrame({ t: "frame", data })),
		close: () => socket.close(),
	};
}

/**
 * The host's Nostr route under a fresh key per attempt, so relays cannot link one phone's attempts; the
 * device is still known to the host by its paired Ed25519 key inside the handshake.
 */
export function createNostrPipe(
	route: PairingNostrRoute,
	openSignal: typeof openNostrSignal = openNostrSignal,
): SignalingPipe {
	let onFrame: (data: string) => void = () => {};
	let onLost: (error: RemoteConnectError) => void = () => {};
	const signal: NostrSignal = openSignal({
		secretKey: generateNostrSecret(),
		relays: route.relays,
		onMessage: (from, data) => {
			if (from === route.publicKey) onFrame(data);
		},
	});
	return {
		route: "nostr",
		url: route.relays[0] ?? "",
		ready: signal.ready.then(() => undefined),
		listen(frame, gone) {
			onFrame = frame;
			onLost = gone;
		},
		send(data) {
			signal
				.send(route.publicKey, data)
				.catch(() =>
					onLost(new RemoteConnectError("relay_lost", "no Nostr relay took the message")),
				);
		},
		close: () => signal.close(),
	};
}

/** How long a ready Nostr route waits for the host's own relay (same Wi‑Fi or tailnet) to answer first. */
export const LOCAL_ROUTE_GRACE_MS = 1_500;

/**
 * Races the host's relay addresses against its Nostr route. A reachable relay wins: it is the host itself on a
 * shared network, and brings TURN when hosted. Nostr wins once ready if no relay answered within the grace
 * window or every relay failed. The loser is closed; both failing rejects with the relay's own refusal (host
 * offline or busy) when it gave one, else an unreachable error naming every address tried.
 */
export function pickSignalingPipe(options: {
	broker: Promise<SignalingPipe> | null;
	nostr: SignalingPipe | null;
	graceMs?: number;
	unreachable: () => Error;
}): Promise<{ pipe: SignalingPipe; ice: readonly IceServer[] | undefined }> {
	const graceMs = options.graceMs ?? LOCAL_ROUTE_GRACE_MS;
	return new Promise((resolve, reject) => {
		let done = false;
		let brokerPipe: SignalingPipe | null = null;
		let brokerError: unknown = options.broker ? null : options.unreachable();
		let nostrError: unknown = options.nostr ? null : options.unreachable();
		let nostrIce: { ice: readonly IceServer[] | undefined } | null = null;
		let graceOver = false;

		const finish = (pipe: SignalingPipe, ice: readonly IceServer[] | undefined): void => {
			if (done) {
				pipe.close();
				return;
			}
			done = true;
			clearTimeout(timer);
			if (pipe !== options.nostr) options.nostr?.close();
			if (brokerPipe && pipe !== brokerPipe) brokerPipe.close();
			resolve({ pipe, ice });
		};
		const settleNostr = (): void => {
			if (!done && nostrIce && options.nostr && (graceOver || brokerError))
				finish(options.nostr, nostrIce.ice);
		};
		const failIfBoth = (): void => {
			if (done || !brokerError || !nostrError) return;
			done = true;
			clearTimeout(timer);
			reject(
				brokerError instanceof RemoteConnectError || !options.nostr
					? brokerError
					: options.unreachable(),
			);
		};
		const timer = setTimeout(() => {
			graceOver = true;
			settleNostr();
		}, graceMs);

		options.broker
			?.then((pipe) => {
				brokerPipe = pipe;
				if (done) return pipe.close();
				return pipe.ready.then(
					(ice) => finish(pipe, ice),
					(error: unknown) => {
						pipe.close();
						throw error;
					},
				);
			})
			.catch((error: unknown) => {
				brokerError = error;
				settleNostr();
				failIfBoth();
			});
		options.nostr?.ready.then(
			(ice) => {
				nostrIce = { ice };
				settleNostr();
			},
			(error: unknown) => {
				nostrError = error;
				failIfBoth();
			},
		);
	});
}

/** Opens every route the host advertised and keeps the best one, as `pickSignalingPipe` decides. */
export function openSignaling(
	relayUrls: readonly string[],
	hostKey: string,
	nostr: PairingNostrRoute | undefined,
): Promise<{ pipe: SignalingPipe; ice: readonly IceServer[] | undefined }> {
	const broker =
		relayUrls.length > 0
			? openFirstRelay(relayUrls, (url) => new WebSocket(url)).then(({ socket, url }) =>
					createBrokerPipe(socket, url, hostKey),
				)
			: null;
	return pickSignalingPipe({
		broker,
		nostr: nostr ? createNostrPipe(nostr) : null,
		unreachable: () => new RelayUnreachableError([...relayUrls, ...(nostr?.relays ?? [])]),
	});
}
