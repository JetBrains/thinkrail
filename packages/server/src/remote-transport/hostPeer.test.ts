import { expect, test } from "bun:test";
import { createWeriftHostPeer, type HostPeerSignal } from "./hostPeer";

test("the offer is signalled before any ICE candidate gathered while setting it", async () => {
	const peer = createWeriftHostPeer();
	const signals: HostPeerSignal["kind"][] = [];
	peer.onLocalSignal((signal) => signals.push(signal.kind));

	await peer.start();
	peer.close();

	expect(signals[0]).toBe("offer");
	expect(signals.slice(1).every((kind) => kind === "candidate")).toBe(true);
});
