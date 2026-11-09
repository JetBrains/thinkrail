import {
	createHash,
	createPrivateKey,
	createPublicKey,
	sign as edSign,
	verify as edVerify,
	generateKeyPairSync,
	type KeyObject,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../persistence";

const IDENTITY_FILE = "remote-identity.json";
const IDENTITY_VERSION = 1;

interface StoredIdentity {
	version: number;
	privateKeyPem: string;
	/** base64url raw Ed25519 public key (32 bytes). */
	publicKeyRaw: string;
}

export interface HostIdentity {
	/** base64url raw Ed25519 public key — what the QR carries and devices verify against. */
	publicKey: string;
	/** Short, human-comparable fingerprint of the public key. */
	fingerprint: string;
	sign(data: Uint8Array): Uint8Array;
}

function rawPublicKey(key: KeyObject): string {
	const jwk = key.export({ format: "jwk" }) as { x?: string };
	if (!jwk.x) throw new Error("ed25519 public key missing jwk.x");
	return jwk.x;
}

export function fingerprintOf(publicKeyRaw: string): string {
	return createHash("sha256")
		.update(Buffer.from(publicKeyRaw, "base64url"))
		.digest("base64url")
		.slice(0, 16);
}

/** Rebuilds a public KeyObject from a base64url raw Ed25519 key (e.g. a paired device's key). */
export function publicKeyFromRaw(publicKeyRaw: string): KeyObject {
	return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publicKeyRaw }, format: "jwk" });
}

export function verifySignature(
	publicKeyRaw: string,
	data: Uint8Array,
	signature: Uint8Array,
): boolean {
	try {
		return edVerify(null, data, publicKeyFromRaw(publicKeyRaw), signature);
	} catch {
		return false;
	}
}

/** Loads the host's long-term Ed25519 identity, creating and persisting it (0600) on first use. */
export function loadOrCreateIdentity(dir: string = dataDir()): HostIdentity {
	const path = join(dir, IDENTITY_FILE);
	let stored: StoredIdentity | null = null;
	if (existsSync(path)) {
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8")) as StoredIdentity;
			if (parsed.version === IDENTITY_VERSION && parsed.privateKeyPem && parsed.publicKeyRaw) {
				stored = parsed;
			}
		} catch {
			stored = null;
		}
	}
	if (!stored) {
		const { publicKey, privateKey } = generateKeyPairSync("ed25519");
		stored = {
			version: IDENTITY_VERSION,
			privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
			publicKeyRaw: rawPublicKey(publicKey),
		};
		mkdirSync(dir, { recursive: true });
		writeFileSync(path, `${JSON.stringify(stored, null, "\t")}\n`, { mode: 0o600 });
	}
	const privateKey = createPrivateKey(stored.privateKeyPem);
	const publicKeyRaw = stored.publicKeyRaw;
	return {
		publicKey: publicKeyRaw,
		fingerprint: fingerprintOf(publicKeyRaw),
		sign: (data) => edSign(null, data, privateKey),
	};
}
