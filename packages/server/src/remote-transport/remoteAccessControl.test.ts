import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NOSTR_RELAYS } from "@thinkrail/nostr-signaling";
import type { PairedDevice } from "../remote";
import { addDevice, loadRemoteAccessEnabled, saveRemoteAccessEnabled } from "../remote";
import type { RemoteChannel } from "./channel";
import type { LocalRelay } from "./localRelay";
import type { RemoteAccess, RemoteAccessOptions } from "./remoteAccess";
import { createRemoteAccessControl, type RemoteAccessControlOptions } from "./remoteAccessControl";

function fixture(over: Partial<RemoteAccessControlOptions> = {}) {
	const dir = mkdtempSync(join(tmpdir(), "trpi-remote-control-"));
	const events: string[] = [];
	const started: RemoteAccessOptions[] = [];
	const startLocal = (): LocalRelay => {
		events.push("relay:start");
		return {
			connectUrl: "ws://127.0.0.1:1",
			port: 1,
			addresses: [{ url: "ws://192.168.0.2:1", route: "lan" }],
			publicCheck: { state: "closed", ip: "203.0.113.7" },
			ready: Promise.resolve(),
			stop: () => events.push("relay:stop"),
		};
	};
	const startAccess = (options: RemoteAccessOptions): RemoteAccess => {
		started.push(options);
		events.push("access:start");
		return {
			identity: {
				publicKey: "K",
				fingerprint: "f",
				sign: () => new Uint8Array(),
				nostrSecret: new Uint8Array(32),
			},
			addresses: options.advertised?.() ?? [{ url: options.relayUrl, route: "relay" }],
			nostr: options.nostrRelays?.length ? { relays: options.nostrRelays, connected: 2 } : null,
			routes: () => ({ signalingUrls: [options.relayUrl] }),
			issueLink: () => ({ link: "thinkrail://pair?v=1", expiresAt: 5 }),
			stop: () => events.push("access:stop"),
		};
	};
	const control = createRemoteAccessControl({
		onPaired: () => {},
		dataDir: dir,
		startLocal,
		startAccess,
		...over,
	});
	return {
		dir,
		control,
		events,
		started,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

test("access is off by default and pairing needs it on", () => {
	const f = fixture();
	try {
		expect(f.control.state()).toEqual({ enabled: false, addresses: [], devices: [] });
		expect(f.control.state().relay).toBeUndefined();
		expect(() => f.control.issueLink("default")).toThrow();
		expect(f.control.routes()).toBeNull();
		expect(f.events).toEqual([]);
	} finally {
		f.cleanup();
	}
});

test("turning it on starts the host's own relay and remembers the choice; off tears both down", () => {
	const f = fixture();
	try {
		const on = f.control.setEnabled(true);
		expect(on.enabled).toBe(true);
		expect(on.addresses).toEqual([{ url: "ws://192.168.0.2:1", route: "lan" }]);
		expect(on.relay).toEqual({
			kind: "builtIn",
			port: 1,
			publicCheck: { state: "closed", ip: "203.0.113.7" },
		});
		expect(f.started[0]?.relayUrl).toBe("ws://127.0.0.1:1");
		expect(loadRemoteAccessEnabled(f.dir)).toBe(true);
		expect(f.control.issueLink("default").link).toStartWith("thinkrail://pair");
		expect(f.control.routes()?.signalingUrls).toHaveLength(1);

		f.control.setEnabled(true);
		expect(f.events.filter((e) => e === "access:start")).toHaveLength(1);

		expect(f.control.setEnabled(false).enabled).toBe(false);
		expect(f.events).toEqual(["relay:start", "access:start", "access:stop", "relay:stop"]);
		expect(loadRemoteAccessEnabled(f.dir)).toBe(false);
	} finally {
		f.cleanup();
	}
});

test("a configured relay is used instead of a local one, and a one-run start is not remembered", () => {
	const f = fixture({ relayUrl: "wss://relay.example" });
	try {
		f.control.setEnabled(true, { persist: false });
		expect(f.events).toEqual(["access:start"]);
		expect(f.started[0]?.relayUrl).toBe("wss://relay.example");
		expect(f.control.state().relay).toEqual({ kind: "external", url: "wss://relay.example" });
		expect(loadRemoteAccessEnabled(f.dir)).toBe(false);
	} finally {
		f.cleanup();
	}
});

test("restore brings access back only when it was left on", () => {
	const f = fixture();
	try {
		expect(f.control.restore().enabled).toBe(false);
		saveRemoteAccessEnabled(true, f.dir);
		expect(f.control.restore().enabled).toBe(true);
	} finally {
		f.cleanup();
	}
});

function fakeChannel() {
	const closers: (() => void)[] = [];
	const channel: RemoteChannel = {
		send: () => {},
		onMessage: () => {},
		onClose: (handler) => closers.push(handler),
		close: () => {
			for (const handler of closers) handler();
		},
		open: true,
	};
	return channel;
}

test("a device shows connected while it has a live channel, and revoking closes it", () => {
	const f = fixture();
	try {
		const phone: PairedDevice = { id: "d1", label: "Phone", publicKey: "P1", pairedAt: 1 };
		addDevice(phone, f.dir);
		addDevice({ id: "d2", label: "Tablet", publicKey: "P2", pairedAt: 2 }, f.dir);
		f.control.setEnabled(true, { persist: false });
		const channel = fakeChannel();
		let closed = false;
		channel.onClose(() => {
			closed = true;
		});
		f.started[0]?.onPaired?.(phone, channel);
		expect(f.control.state().devices.map((d) => [d.id, d.connected])).toEqual([
			["d1", true],
			["d2", false],
		]);

		const after = f.control.revokeDevice("d1");
		expect(after.devices.map((d) => d.id)).toEqual(["d2"]);
		expect(closed).toBe(true);
	} finally {
		f.cleanup();
	}
});

test("a closed channel leaves the device paired but no longer connected", () => {
	const f = fixture();
	try {
		const phone: PairedDevice = { id: "d1", label: "Phone", publicKey: "P1", pairedAt: 1 };
		addDevice(phone, f.dir);
		f.control.setEnabled(true, { persist: false });
		const channel = fakeChannel();
		f.started[0]?.onPaired?.(phone, channel);
		channel.close();
		expect(f.control.state().devices).toEqual([{ ...phone, access: "write", connected: false }]);
	} finally {
		f.cleanup();
	}
});

test("a device made read-only may only read from then on, its channels hear of it, and a revoked one may do nothing", () => {
	const changes: string[] = [];
	const f = fixture({ onAccessChanged: (id, access) => changes.push(`${id}:${access}`) });
	try {
		addDevice({ id: "d1", label: "Phone", publicKey: "P1", pairedAt: 1 }, f.dir);
		expect(f.control.mayRequest("d1", "session.prompt")).toBe("allowed");
		f.control.setDeviceAccess("d1", "read");
		expect(changes).toEqual(["d1:read"]);
		expect(f.control.mayRequest("d1", "session.prompt")).toBe("readOnly");
		expect(f.control.mayRequest("d1", "session.getMessages")).toBe("allowed");
		f.control.renameDevice("d1", "iPhone");
		expect(f.control.state().devices).toMatchObject([{ label: "iPhone", access: "read" }]);
		f.control.revokeDevice("d1");
		expect(f.control.mayRequest("d1", "session.getMessages")).toBe("revoked");
	} finally {
		f.cleanup();
	}
});

test("the Nostr route is on by default with the public relays, and an empty list turns it off", () => {
	const on = fixture();
	const off = fixture({ nostrRelays: [] });
	try {
		const state = on.control.setEnabled(true, { persist: false });
		expect(on.started[0]?.nostrRelays).toEqual(DEFAULT_NOSTR_RELAYS);
		expect(state.nostr).toEqual({ relays: [...DEFAULT_NOSTR_RELAYS], connected: 2 });
		expect(off.control.setEnabled(true, { persist: false }).nostr).toBeUndefined();
	} finally {
		on.control.stop();
		off.control.stop();
		on.cleanup();
		off.cleanup();
	}
});
