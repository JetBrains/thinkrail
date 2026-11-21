import type { KeyValueStore } from "./hostRegistry";

/** The device's Ed25519 identity: a private key that never leaves the platform, and its public key. */
export interface DeviceKey {
	privateKey: CryptoKey;
	/** The raw public key, base64url — what `hello` / `resume` name the device by. */
	publicKeyRaw: string;
}

/** Where the device key persists; IndexedDB holds the non-extractable `CryptoKey` by structured clone. */
export interface DeviceKeyStore {
	load(): Promise<DeviceKey | null>;
	/** Stores `key` unless one is already there, and resolves with the key that is kept. */
	keep(key: DeviceKey): Promise<DeviceKey>;
	/** The store writes the key out as text, so it must be generated extractable. */
	serializes?: boolean;
}

const LEGACY_STORAGE_KEY = "thinkrail.remote.deviceKey";
const DB_NAME = "thinkrail.remote";
const STORE = "deviceKey";
const RECORD = "device";

function bytesToBase64url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function settled<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function openDb(): Promise<IDBDatabase> {
	const request = indexedDB.open(DB_NAME, 1);
	request.onupgradeneeded = () => request.result.createObjectStore(STORE);
	return settled(request);
}

function isDeviceKey(value: unknown): value is DeviceKey {
	if (typeof value !== "object" || value === null) return false;
	const { privateKey, publicKeyRaw } = value as Partial<DeviceKey>;
	return privateKey instanceof CryptoKey && typeof publicKeyRaw === "string";
}

export const indexedDbKeyStore: DeviceKeyStore = {
	async load() {
		const db = await openDb();
		try {
			const value: unknown = await settled(
				db.transaction(STORE, "readonly").objectStore(STORE).get(RECORD),
			);
			return isDeviceKey(value) ? value : null;
		} finally {
			db.close();
		}
	},
	async keep(key) {
		const db = await openDb();
		try {
			const store = db.transaction(STORE, "readwrite").objectStore(STORE);
			const held: unknown = await settled(store.get(RECORD));
			if (isDeviceKey(held)) return held;
			await settled(store.put(key, RECORD));
			return key;
		} finally {
			db.close();
		}
	},
};

interface StoredJwk {
	privateJwk: JsonWebKey;
	publicKeyRaw: string;
}

async function fromJwk(text: string | null, extractable: boolean): Promise<DeviceKey | null> {
	if (!text) return null;
	try {
		const parsed = JSON.parse(text) as StoredJwk;
		const privateKey = await crypto.subtle.importKey(
			"jwk",
			parsed.privateJwk,
			{ name: "Ed25519" },
			extractable,
			["sign"],
		);
		return { privateKey, publicKeyRaw: parsed.publicKeyRaw };
	} catch {
		return null;
	}
}

/** A key from before the IndexedDB store: an extractable JWK in localStorage, imported non-extractable. */
const legacyKey = (): Promise<DeviceKey | null> =>
	fromJwk(globalThis.localStorage?.getItem(LEGACY_STORAGE_KEY) ?? null, false);

/**
 * A text store for a shell whose web storage does not last (the desktop's webview origin changes between
 * launches): the key is kept as a JWK there, so it stays extractable — the store, not the page, is what holds it.
 */
export function textDeviceKeyStore(store: KeyValueStore): DeviceKeyStore {
	return {
		serializes: true,
		load: () => fromJwk(store.read(LEGACY_STORAGE_KEY), true),
		async keep(key) {
			const held = await fromJwk(store.read(LEGACY_STORAGE_KEY), true);
			if (held) return held;
			const privateJwk = await crypto.subtle.exportKey("jwk", key.privateKey);
			const stored: StoredJwk = { privateJwk, publicKeyRaw: key.publicKeyRaw };
			store.write(LEGACY_STORAGE_KEY, JSON.stringify(stored));
			return key;
		},
	};
}

async function generated(extractable: boolean): Promise<DeviceKey> {
	const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, extractable, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
	return { privateKey: pair.privateKey, publicKeyRaw: bytesToBase64url(raw) };
}

/**
 * The stored key, else the one from localStorage moved into the store (its JWK deleted once kept), else a new
 * one. A store that cannot be read yields a key for this session only, never overwriting the stored one.
 */
async function loadOrCreate(store: DeviceKeyStore): Promise<DeviceKey> {
	let stored: DeviceKey | null;
	try {
		stored = await store.load();
	} catch {
		return (await legacyKey()) ?? generated(false);
	}
	if (stored) return stored;
	const legacy = store.serializes ? null : await legacyKey();
	const key = legacy ?? (await generated(store.serializes === true));
	try {
		const kept = await store.keep(key);
		if (legacy) globalThis.localStorage?.removeItem(LEGACY_STORAGE_KEY);
		return kept;
	} catch {
		return key;
	}
}

let keyStore: DeviceKeyStore = indexedDbKeyStore;
let ready: Promise<DeviceKey> | null = null;

/** The device key, loaded once per page however many connections open at the same time. */
export function deviceKey(): Promise<DeviceKey> {
	ready ??= loadOrCreate(keyStore).catch((error: unknown) => {
		ready = null;
		throw error;
	});
	return ready;
}

/** Points the device key at another store and forgets the loaded key (tests, a platform keystore). */
export function setDeviceKeyStore(store: DeviceKeyStore): void {
	keyStore = store;
	ready = null;
}
