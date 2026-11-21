import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	addDevice,
	findDeviceByKey,
	loadDevices,
	type PairedDevice,
	revokeDevice,
} from "./deviceRegistry";

function withTmp(run: (dir: string) => void): void {
	const dir = mkdtempSync(join(tmpdir(), "trpi-remote-devices-"));
	try {
		run(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const device = (over: Partial<PairedDevice> = {}): PairedDevice => ({
	id: "dev-1",
	label: "Olga's phone",
	publicKey: "KEY_A",
	pairedAt: 1000,
	...over,
});

test("empty when nothing stored; add then load round-trips", () => {
	withTmp((dir) => {
		expect(loadDevices(dir)).toEqual([]);
		addDevice(device(), dir);
		expect(loadDevices(dir)).toEqual([device()]);
	});
});

test("re-pairing the same public key replaces the prior entry", () => {
	withTmp((dir) => {
		addDevice(device(), dir);
		addDevice(device({ id: "dev-2", label: "renamed", pairedAt: 2000 }), dir);
		const stored = loadDevices(dir);
		expect(stored).toHaveLength(1);
		expect(stored[0]?.label).toBe("renamed");
	});
});

test("findDeviceByKey and revokeDevice", () => {
	withTmp((dir) => {
		addDevice(device(), dir);
		addDevice(device({ id: "dev-2", publicKey: "KEY_B" }), dir);
		expect(findDeviceByKey("KEY_B", dir)?.id).toBe("dev-2");
		revokeDevice("dev-1", dir);
		expect(loadDevices(dir).map((d) => d.id)).toEqual(["dev-2"]);
		expect(findDeviceByKey("KEY_A", dir)).toBeNull();
	});
});

test("loadDevices sees a change written behind its back", () => {
	const dir = mkdtempSync(join(tmpdir(), "trdev-"));
	addDevice({ id: "a", label: "A", publicKey: "K", pairedAt: 1 }, dir);
	expect(loadDevices(dir).map((d) => d.label)).toEqual(["A"]);
	writeFileSync(
		join(dir, "remote-devices.json"),
		JSON.stringify({
			version: 1,
			devices: [{ id: "a", label: "Renamed elsewhere", publicKey: "K", pairedAt: 1 }],
		}),
	);
	expect(loadDevices(dir).map((d) => d.label)).toEqual(["Renamed elsewhere"]);
	rmSync(dir, { recursive: true, force: true });
	expect(loadDevices(dir)).toEqual([]);
});
