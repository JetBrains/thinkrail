import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../persistence";

const DEVICES_FILE = "remote-devices.json";
const DEVICES_VERSION = 1;

export interface PairedDevice {
	id: string;
	label: string;
	/** base64url raw Ed25519 public key. */
	publicKey: string;
	pairedAt: number;
	lastSeenAt?: number;
}

interface StoredDevices {
	version: number;
	devices: PairedDevice[];
}

function filePath(dir: string): string {
	return join(dir, DEVICES_FILE);
}

export function loadDevices(dir: string = dataDir()): PairedDevice[] {
	const path = filePath(dir);
	if (!existsSync(path)) return [];
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as StoredDevices;
		return parsed.version === DEVICES_VERSION && Array.isArray(parsed.devices)
			? parsed.devices
			: [];
	} catch {
		return [];
	}
}

function save(dir: string, devices: PairedDevice[]): void {
	mkdirSync(dir, { recursive: true });
	const payload: StoredDevices = { version: DEVICES_VERSION, devices };
	writeFileSync(filePath(dir), `${JSON.stringify(payload, null, "\t")}\n`, { mode: 0o600 });
}

/** Adds a device, replacing any prior entry with the same public key or id (re-pairing refreshes it). */
export function addDevice(device: PairedDevice, dir: string = dataDir()): PairedDevice[] {
	const devices = loadDevices(dir).filter(
		(d) => d.publicKey !== device.publicKey && d.id !== device.id,
	);
	devices.push(device);
	save(dir, devices);
	return devices;
}

export function revokeDevice(deviceId: string, dir: string = dataDir()): PairedDevice[] {
	const devices = loadDevices(dir).filter((d) => d.id !== deviceId);
	save(dir, devices);
	return devices;
}

export function findDeviceByKey(publicKey: string, dir: string = dataDir()): PairedDevice | null {
	return loadDevices(dir).find((d) => d.publicKey === publicKey) ?? null;
}
