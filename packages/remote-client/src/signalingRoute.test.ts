import { describe, expect, test } from "bun:test";
import type { IceServer } from "@thinkrail/contracts";
import { generateNostrSecret, openNostrSignal } from "@thinkrail/nostr-signaling";
import { startTestNostrRelay } from "@thinkrail/nostr-signaling/testing";
import { RemoteConnectError } from "./connectError";
import { RelayUnreachableError } from "./relayPicker";
import { createNostrPipe, pickSignalingPipe, type SignalingPipe } from "./signalingRoute";

function fakePipe(route: "relay" | "nostr") {
	let settle: (ice: readonly IceServer[] | undefined) => void = () => {};
	let fail: (error: unknown) => void = () => {};
	const ready = new Promise<readonly IceServer[] | undefined>((resolve, reject) => {
		settle = resolve;
		fail = reject;
	});
	ready.catch(() => {});
	const state = { closed: false };
	const pipe: SignalingPipe = {
		route,
		url: route,
		ready,
		listen: () => {},
		send: () => {},
		close: () => {
			state.closed = true;
		},
	};
	return { pipe, state, settle, fail };
}

const unreachable = () => new RelayUnreachableError(["x"]);
const tick = () => Bun.sleep(5);

describe("pickSignalingPipe", () => {
	test("the host's own relay wins when it answers within the grace window", async () => {
		const relay = fakePipe("relay");
		const nostr = fakePipe("nostr");
		const picked = pickSignalingPipe({
			broker: Promise.resolve(relay.pipe),
			nostr: nostr.pipe,
			graceMs: 50,
			unreachable,
		});
		nostr.settle(undefined);
		await tick();
		const ice = [{ urls: ["turn:t"] }];
		relay.settle(ice);
		const result = await picked;
		expect(result.pipe).toBe(relay.pipe);
		expect(result.ice).toEqual(ice);
		expect(nostr.state.closed).toBe(true);
	});

	test("Nostr wins once the grace window passes with no relay", async () => {
		const relay = fakePipe("relay");
		const nostr = fakePipe("nostr");
		const picked = pickSignalingPipe({
			broker: Promise.resolve(relay.pipe),
			nostr: nostr.pipe,
			graceMs: 20,
			unreachable,
		});
		nostr.settle(undefined);
		expect((await picked).pipe).toBe(nostr.pipe);
		expect(relay.state.closed).toBe(true);
	});

	test("Nostr wins at once when every relay address failed", async () => {
		const nostr = fakePipe("nostr");
		const picked = pickSignalingPipe({
			broker: Promise.reject(unreachable()),
			nostr: nostr.pipe,
			graceMs: 10_000,
			unreachable,
		});
		nostr.settle(undefined);
		expect((await picked).pipe).toBe(nostr.pipe);
	});

	test("both failing keeps the relay's own refusal, else reports every route unreachable", async () => {
		const busy = new RemoteConnectError("host_busy", "host busy");
		const a = fakePipe("nostr");
		const refused = pickSignalingPipe({ broker: Promise.reject(busy), nostr: a.pipe, unreachable });
		a.fail(new Error("no relay"));
		await expect(refused).rejects.toBe(busy);

		const b = fakePipe("nostr");
		const offline = pickSignalingPipe({
			broker: Promise.reject(new Error("socket")),
			nostr: b.pipe,
			unreachable,
		});
		b.fail(new Error("no relay"));
		await expect(offline).rejects.toBeInstanceOf(RelayUnreachableError);
		expect(a.state.closed).toBe(true);
		expect(b.state.closed).toBe(true);
	});

	test("with no Nostr route a relay failure surfaces as is", async () => {
		const offline = new RemoteConnectError("host_offline", "no host available");
		await expect(
			pickSignalingPipe({ broker: Promise.reject(offline), nostr: null, unreachable }),
		).rejects.toBe(offline);
	});
});

test("a Nostr pipe exchanges frames with the host key only", async () => {
	const relay = startTestNostrRelay();
	const hostSecret = generateNostrSecret();
	const hostInbox: [string, string][] = [];
	const host = openNostrSignal({
		secretKey: hostSecret,
		relays: [relay.url],
		onMessage: (from, data) => hostInbox.push([from, data]),
	});
	const pipe = createNostrPipe({ publicKey: host.publicKey, relays: [relay.url] });
	const frames: string[] = [];
	pipe.listen(
		(data) => frames.push(data),
		() => {},
	);
	try {
		await Promise.all([host.ready, pipe.ready]);
		expect(pipe.route).toBe("nostr");
		pipe.send("hello");
		const deadline = Date.now() + 3_000;
		while (hostInbox.length === 0 && Date.now() < deadline) await Bun.sleep(10);
		const [deviceKey, data] = hostInbox[0] ?? ["", ""];
		expect(data).toBe("hello");

		const stranger = openNostrSignal({
			secretKey: generateNostrSecret(),
			relays: [relay.url],
			onMessage: () => {},
		});
		await stranger.ready;
		await stranger.send(deviceKey, "spoofed");
		await host.send(deviceKey, "challenge");
		while (frames.length === 0 && Date.now() < deadline) await Bun.sleep(10);
		await Bun.sleep(50);
		expect(frames).toEqual(["challenge"]);
		stranger.close();
	} finally {
		pipe.close();
		host.close();
		relay.stop();
	}
});
