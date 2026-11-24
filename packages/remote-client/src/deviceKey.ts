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

/** A key from before the IndexedDB store: an extractable JWK in localStorage, imported non-extractable. */
async function legacyKey(): Promise<DeviceKey | null> {
	const stored = globalThis.localStorage?.getItem(LEGACY_STORAGE_KEY);
	if (!stored) return null;
	try {
		const parsed = JSON.parse(stored) as { privateJwk: JsonWebKey; publicKeyRaw: string };
		const privateKey = await crypto.subtle.importKey(
			"jwk",
			parsed.privateJwk,
			{ name: "Ed25519" },
			false,
			["sign"],
		);
		return { privateKey, publicKeyRaw: parsed.publicKeyRaw };
	} catch {
		return null;
	}
}

async function generated(): Promise<DeviceKey> {
	const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
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
		return (await legacyKey()) ?? generated();
	}
	if (stored) return stored;
	const legacy = await legacyKey();
	const key = legacy ?? (await generated());
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
