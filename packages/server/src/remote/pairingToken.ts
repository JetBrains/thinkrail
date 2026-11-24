import { randomBytes } from "node:crypto";
import { pairingTokenId } from "./pairing";

const DEFAULT_TTL_MS = 2 * 60_000;

export interface PairingRequest {
	projectRef: string;
	expiresAt: number;
	/** The QR secret itself; the device proves it holds it with an HMAC rather than by sending it. */
	token: string;
}

export interface PairingTokens {
	/** Mints a single-use token for a project; it is what the QR carries. */
	issue(projectRef: string, now?: number): { token: string; expiresAt: number };
	/** Returns and removes the request named by a token's id, or null when unknown/expired (single-use). */
	consume(tokenId: string, now?: number): PairingRequest | null;
	readonly size: number;
}

export function createPairingTokens(ttlMs: number = DEFAULT_TTL_MS): PairingTokens {
	const pending = new Map<string, PairingRequest>();
	const prune = (now: number): void => {
		for (const [id, request] of pending) if (request.expiresAt <= now) pending.delete(id);
	};
	return {
		issue(projectRef, now = Date.now()) {
			prune(now);
			const token = randomBytes(32).toString("base64url");
			const expiresAt = now + ttlMs;
			pending.set(pairingTokenId(token), { projectRef, expiresAt, token });
			return { token, expiresAt };
		},
		consume(tokenId, now = Date.now()) {
			const request = pending.get(tokenId);
			if (!request) return null;
			pending.delete(tokenId);
			return request.expiresAt > now ? request : null;
		},
		get size() {
			return pending.size;
		},
	};
}
