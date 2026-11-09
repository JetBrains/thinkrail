import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprintOf, loadOrCreateIdentity, verifySignature } from "./identity";

function withTmp(run: (dir: string) => void): void {
	const dir = mkdtempSync(join(tmpdir(), "trpi-remote-identity-"));
	try {
		run(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("loadOrCreateIdentity", () => {
	test("creates and reloads a stable identity, persisted 0600", () => {
		withTmp((dir) => {
			const a = loadOrCreateIdentity(dir);
			expect(a.publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
			if (process.platform !== "win32") {
				expect(statSync(join(dir, "remote-identity.json")).mode & 0o777).toBe(0o600);
			}
			const b = loadOrCreateIdentity(dir);
			expect(b.publicKey).toBe(a.publicKey);
			expect(b.fingerprint).toBe(a.fingerprint);
		});
	});

	test("signs data its public key verifies, and rejects tampering", () => {
		withTmp((dir) => {
			const id = loadOrCreateIdentity(dir);
			const data = Buffer.from("challenge-bytes");
			const sig = id.sign(data);
			expect(verifySignature(id.publicKey, data, sig)).toBe(true);
			expect(verifySignature(id.publicKey, Buffer.from("tampered"), sig)).toBe(false);
		});
	});

	test("regenerates when the stored file is corrupt", () => {
		withTmp((dir) => {
			const first = loadOrCreateIdentity(dir).publicKey;
			writeFileSync(join(dir, "remote-identity.json"), "not json");
			expect(loadOrCreateIdentity(dir).publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
			expect(typeof first).toBe("string");
		});
	});
});

describe("fingerprintOf", () => {
	test("is deterministic and short", () => {
		withTmp((dir) => {
			const { publicKey } = loadOrCreateIdentity(dir);
			expect(fingerprintOf(publicKey)).toBe(fingerprintOf(publicKey));
			expect(fingerprintOf(publicKey)).toHaveLength(16);
		});
	});
});
