import { expect, test } from "bun:test";
import { type RTCDataChannel, RTCPeerConnection } from "werift";
import { toRemoteChannel } from "./weriftRemoteChannel";

// Loopback over real werift peer connections under Bun: proves the adapter round-trips bytes both ways.
test("adapts a werift DataChannel to RemoteChannel and round-trips bytes in both directions", async () => {
	const host = new RTCPeerConnection();
	const device = new RTCPeerConnection();
	host.onIceCandidate.subscribe((c) => c && void device.addIceCandidate(c));
	device.onIceCandidate.subscribe((c) => c && void host.addIceCandidate(c));

	const deviceChannel = new Promise<RTCDataChannel>((resolve) => {
		device.onDataChannel.subscribe((channel) => resolve(channel));
	});
	const dc = host.createDataChannel("wire");
	const hostOpen = new Promise<void>((resolve) => {
		dc.stateChanged.subscribe((state) => state === "open" && resolve());
	});

	const offer = await host.createOffer();
	await host.setLocalDescription(offer);
	await device.setRemoteDescription(offer);
	const answer = await device.createAnswer();
	await device.setLocalDescription(answer);
	await host.setRemoteDescription(answer);
	await hostOpen;

	const hostCh = toRemoteChannel(dc);
	const deviceCh = toRemoteChannel(await deviceChannel);
	const decode = (d: Uint8Array): string => new TextDecoder().decode(d);

	const atDevice = new Promise<string>((r) => deviceCh.onMessage((d) => r(decode(d))));
	hostCh.send(new TextEncoder().encode("to-device"));
	expect(await atDevice).toBe("to-device");

	const atHost = new Promise<string>((r) => hostCh.onMessage((d) => r(decode(d))));
	deviceCh.send(new TextEncoder().encode("to-host"));
	expect(await atHost).toBe("to-host");

	expect(hostCh.open).toBe(true);
	hostCh.close();
	deviceCh.close();
	await host.close();
	await device.close();
}, 20_000);
