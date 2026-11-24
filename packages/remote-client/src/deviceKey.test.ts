import { afterEach, beforeEach, expect, test } from "bun:test";
import { type DeviceKey, type DeviceKeyStore, deviceKey, setDeviceKeyStore } from "./deviceKey";

const LEGACY = "thinkrail.remote.deviceKey";
const saved = (globalThis as { localStorage?: unknown }).localStorage;
let legacy: Map<string, string>;

function memoryStore(initial: DeviceKey | null = null) {
	let held = initial;
	let keeps = 0;
	const store: DeviceKeyStore = {
		load: async () => held,
		keep: async (key) => {
			keeps += 1;
			held ??= key;
			return held;
		},
	};
	return { store, held: () => held, keeps: () => keeps };
}

beforeEach(() => {
	legacy = new Map();
	Object.assign(globalThis, {
		localStorage: {
			getItem: (key: string) => legacy.get(key) ?? null,
			setItem: (key: string, value: string) => void legacy.set(key, value),
			removeItem: (key: string) => void legacy.delete(key),
		},
	});
});

afterEach(() => {
	Object.assign(globalThis, { localStorage: saved });
});

test("a new device key is non-extractable, kept in the store and reused", async () => {
	const memory = memoryStore();
	setDeviceKeyStore(memory.store);
	const key = await deviceKey();
	expect(key.privateKey.extractable).toBe(false);
	expect(memory.held()).toBe(key);
	expect(legacy.size).toBe(0);
	setDeviceKeyStore(memory.store);
	expect(await deviceKey()).toBe(key);
});

test("connections opening at once share one key", async () => {
	const memory = memoryStore();
	setDeviceKeyStore(memory.store);
	const [first, second] = await Promise.all([deviceKey(), deviceKey()]);
	expect(first).toBe(second);
	expect(memory.keeps()).toBe(1);
});

test("a key from localStorage moves into the store non-extractable and its JWK is deleted", async () => {
	const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
	legacy.set(LEGACY, JSON.stringify({ privateJwk, publicKeyRaw: "PUB" }));
	const memory = memoryStore();
	setDeviceKeyStore(memory.store);
	const key = await deviceKey();
	expect(key.publicKeyRaw).toBe("PUB");
	expect(key.privateKey.extractable).toBe(false);
	expect(memory.held()).toBe(key);
	expect(legacy.has(LEGACY)).toBe(false);
});

test("a store that cannot be read gives a session key and overwrites nothing", async () => {
	let keeps = 0;
	setDeviceKeyStore({
		load: () => Promise.reject(new Error("blocked")),
		keep: async (key) => {
			keeps += 1;
			return key;
		},
	});
	const key = await deviceKey();
	expect(key.privateKey.extractable).toBe(false);
	expect(keeps).toBe(0);
});
