import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addDevice, loadRemoteAccessEnabled, saveRemoteAccessEnabled } from "../remote";
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
			addresses: [{ url: "ws://192.168.0.2:1", route: "lan" }],
			ready: Promise.resolve(),
			stop: () => events.push("relay:stop"),
		};
	};
	const startAccess = (options: RemoteAccessOptions): RemoteAccess => {
		started.push(options);
		events.push("access:start");
		return {
			identity: { publicKey: "K", fingerprint: "f", sign: () => new Uint8Array() },
			addresses: options.advertised?.() ?? [{ url: options.relayUrl, route: "relay" }],
			issueLink: () => ({ link: "thinkrail://pair?v=1", expiresAt: 5 }),
			stop: () => events.push("access:stop"),
		};
	};
	const revoked: string[] = [];
	const control = createRemoteAccessControl({
		onPaired: () => {},
		onRevoked: (id) => revoked.push(id),
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
		revoked,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

test("access is off by default and pairing needs it on", () => {
	const f = fixture();
	try {
		expect(f.control.state()).toEqual({ enabled: false, addresses: [], devices: [] });
		expect(() => f.control.issueLink("default")).toThrow();
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
		expect(f.started[0]?.relayUrl).toBe("ws://127.0.0.1:1");
		expect(loadRemoteAccessEnabled(f.dir)).toBe(true);
		expect(f.control.issueLink("default").link).toStartWith("thinkrail://pair");

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

test("revoking a device drops it from the registry and closes its live connections", () => {
	const f = fixture();
	try {
		addDevice({ id: "d1", label: "Phone", publicKey: "P1", pairedAt: 1 }, f.dir);
		addDevice({ id: "d2", label: "Tablet", publicKey: "P2", pairedAt: 2 }, f.dir);
		const after = f.control.revokeDevice("d1");
		expect(after.devices.map((d) => d.id)).toEqual(["d2"]);
		expect(f.revoked).toEqual(["d1"]);
	} finally {
		f.cleanup();
	}
});
