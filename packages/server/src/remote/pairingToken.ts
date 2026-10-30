import { randomBytes } from "node:crypto";

const DEFAULT_TTL_MS = 2 * 60_000;

export interface PairingRequest {
	projectRef: string;
	expiresAt: number;
}

export interface PairingTokens {
	/** Mints a single-use token for a project; it is what the QR carries. */
	issue(projectRef: string, now?: number): { token: string; expiresAt: number };
	/** Returns and removes the request for a token, or null when unknown/expired (single-use). */
	consume(token: string, now?: number): PairingRequest | null;
	readonly size: number;
}

/**
 * In-memory store of pending QR pairings. Tokens are one-time and short-lived, so a leaked QR cannot be
 * replayed and nothing persists across restarts. Transport-agnostic — the signaling layer carries it (Ф4).
 */
export function createPairingTokens(ttlMs: number = DEFAULT_TTL_MS): PairingTokens {
	const pending = new Map<string, PairingRequest>();
	const prune = (now: number): void => {
		for (const [token, request] of pending) if (request.expiresAt <= now) pending.delete(token);
	};
	return {
		issue(projectRef, now = Date.now()) {
			prune(now);
			const token = randomBytes(32).toString("base64url");
			const expiresAt = now + ttlMs;
			pending.set(token, { projectRef, expiresAt });
			return { token, expiresAt };
		},
		consume(token, now = Date.now()) {
			const request = pending.get(token);
			if (!request) return null;
			pending.delete(token);
			return request.expiresAt > now ? request : null;
		},
		get size() {
			return pending.size;
		},
	};
}
