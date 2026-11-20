import { expect, test } from "bun:test";
import { type RTCDataChannel, RTCPeerConnection } from "./werift";
import { type RemoteChannelLimits, toRemoteChannel } from "./weriftRemoteChannel";

const decode = (d: Uint8Array): string => new TextDecoder().decode(d);
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

async function loopback(limits?: { host?: RemoteChannelLimits; device?: RemoteChannelLimits }) {
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

	return {
		hostCh: toRemoteChannel(dc, limits?.host),
		deviceCh: toRemoteChannel(await deviceChannel, limits?.device),
		stop: async () => {
			await host.close();
			await device.close();
		},
	};
}

// Loopback over real werift peer connections under Bun: proves the adapter round-trips bytes both ways.
test("adapts a werift DataChannel to RemoteChannel and round-trips bytes in both directions", async () => {
	const { hostCh, deviceCh, stop } = await loopback();

	const atDevice = new Promise<string>((r) => deviceCh.onMessage((d) => r(decode(d))));
	hostCh.send(encode("to-device"));
	expect(await atDevice).toBe("to-device");

	const atHost = new Promise<string>((r) => hostCh.onMessage((d) => r(decode(d))));
	deviceCh.send(encode("to-host"));
	expect(await atHost).toBe("to-host");

	const transcript = JSON.stringify({ result: "строка ".repeat(200_000) });
	const atDeviceLarge = new Promise<string>((r) => deviceCh.onMessage((d) => r(decode(d))));
	hostCh.send(encode(transcript));
	expect(await atDeviceLarge).toBe(transcript);

	expect(hostCh.open).toBe(true);
	hostCh.close();
	deviceCh.close();
	await stop();
}, 20_000);

test("a device message reassembling past the cap closes the channel instead of reaching the handler", async () => {
	const { hostCh, deviceCh, stop } = await loopback({ host: { maxMessageBytes: 64 * 1024 } });
	const heard: string[] = [];
	const closed = new Promise<void>((r) => hostCh.onClose(r));
	hostCh.onMessage((d) => heard.push(decode(d)));

	deviceCh.send(encode(JSON.stringify({ big: "x".repeat(256 * 1024) })));
	await closed;
	expect(hostCh.open).toBe(false);
	expect(heard).toEqual([]);
	await stop();
}, 20_000);

test("a send while too much is still buffered toward the device closes the channel", async () => {
	const { hostCh, stop } = await loopback({ host: { maxBufferedBytes: 64 * 1024 } });
	hostCh.send(encode(JSON.stringify({ big: "x".repeat(1024 * 1024) })));
	expect(hostCh.open).toBe(true);
	hostCh.send(encode('{"next":true}'));
	expect(hostCh.open).toBe(false);
	await stop();
}, 20_000);
