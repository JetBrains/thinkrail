import { describe, expect, test } from "bun:test";
import type { BindClaimRequest } from "./protocol";
import { type ClaimRecord, type ClaimRepository, ClaimService } from "./service";

const claimId = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const bridgeId = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA";
const now = 2_000_000_000_000;

const context: BindClaimRequest = {
	journey_id: "01890f47-75a3-4d8f-9a72-4f0e35be292b",
	first_touch: {
		source: "newsletter",
		referrer_class: "direct",
		landing_content_key: "landing",
		touched_at: now - 1,
		policy_version: 1,
	},
	last_touch: {
		medium: "email",
		referrer_class: "internal",
		landing_content_key: "blog/index",
		touched_at: now,
		policy_version: 1,
	},
};

class FakeRepository implements ClaimRepository {
	readonly records = new Map<string, ClaimRecord>();
	quotaCalls: number[] = [];
	cleanupCalls: number[] = [];
	quotaAvailable = true;
	capacity = 50_000;

	async consumeCreateQuota(at: number): Promise<boolean> {
		this.quotaCalls.push(at);
		return this.quotaAvailable;
	}

	async deleteExpired(at: number): Promise<void> {
		this.cleanupCalls.push(at);
		for (const [id, record] of this.records) {
			if (record.expiresAt <= at) this.records.delete(id);
		}
	}

	async create(record: ClaimRecord) {
		if (this.records.size >= this.capacity) return "capacity" as const;
		this.records.set(record.claimId, { ...record });
		return "created" as const;
	}

	async bind(id: string, boundBridgeId: string, boundContext: BindClaimRequest, at: number) {
		const record = this.records.get(id);
		if (record === undefined) return "missing" as const;
		if (record.expiresAt <= at) return "expired" as const;
		if (record.bridgeId !== undefined) return "already-bound" as const;
		record.bridgeId = boundBridgeId;
		record.context = boundContext;
		return "bound" as const;
	}

	async findVerified(id: string, challenge: string): Promise<ClaimRecord | undefined> {
		const record = this.records.get(id);
		return record?.challenge === challenge ? record : undefined;
	}

	async redeemVerified(id: string, challenge: string, at: number) {
		const record = this.records.get(id);
		if (
			record === undefined ||
			record.challenge !== challenge ||
			record.expiresAt <= at ||
			record.bridgeId === undefined ||
			record.context === undefined
		) {
			return undefined;
		}
		this.records.delete(id);
		return { bridgeId: record.bridgeId, ...record.context };
	}
}

function fixture(initialNow = now) {
	const repository = new FakeRepository();
	let clock = initialNow;
	let random = claimId;
	let randomCalls = 0;
	const service = new ClaimService({
		repository,
		now: () => clock,
		randomId: () => {
			randomCalls += 1;
			return random;
		},
		challengeForVerifier: async (verifier) => `challenge:${verifier}`,
	});
	return {
		repository,
		service,
		setNow(value: number) {
			clock = value;
		},
		setRandom(value: string) {
			random = value;
		},
		randomCalls: () => randomCalls,
	};
}

function pendingRecord(expiresAt = now + 600_000): ClaimRecord {
	return { claimId, challenge: "challenge:correct", createdAt: now, expiresAt };
}

describe("claim service", () => {
	test("consumes aggregate quota before cleanup and creates a ten-minute random claim", async () => {
		const { repository, service } = fixture();
		const result = await service.create("challenge-value");
		expect(result).toEqual({
			status: "ok",
			value: {
				claim_id: claimId,
				claim_url: `/attribution/claim/?id=${claimId}`,
				expires_at: now + 600_000,
			},
		});
		expect(repository.quotaCalls).toEqual([now]);
		expect(repository.cleanupCalls).toEqual([now]);
		expect(repository.records.get(claimId)?.challenge).toBe("challenge-value");
	});

	test("returns rate limited without cleanup, randomness, or insertion when quota is exhausted", async () => {
		const fixtureValue = fixture();
		fixtureValue.repository.quotaAvailable = false;

		expect(await fixtureValue.service.create("challenge-value")).toEqual({
			status: "rate-limited",
		});
		expect(fixtureValue.repository.quotaCalls).toEqual([now]);
		expect(fixtureValue.repository.cleanupCalls).toEqual([]);
		expect(fixtureValue.randomCalls()).toBe(0);
		expect(fixtureValue.repository.records.size).toBe(0);
	});

	test("returns capacity without inserting when the active-row cap is reached", async () => {
		const { repository, service } = fixture();
		repository.capacity = 1;
		repository.records.set("existing", {
			claimId: "existing",
			challenge: "existing",
			createdAt: now,
			expiresAt: now + 1,
		});

		expect(await service.create("challenge-value")).toEqual({ status: "capacity" });
		expect(repository.records.has(claimId)).toBeFalse();
	});

	test("cleanup removes every expired row before the capacity check", async () => {
		const { repository, service } = fixture();
		repository.capacity = 1;
		repository.records.set("expired", {
			claimId: "expired",
			challenge: "expired",
			createdAt: now - 600_001,
			expiresAt: now,
		});

		expect((await service.create("challenge-value")).status).toBe("ok");
		expect(repository.records.has("expired")).toBeFalse();
		expect(repository.records.has(claimId)).toBeTrue();
	});

	test("bind generates a missing bridge, is first-write-wins, and validates context", async () => {
		const fixtureValue = fixture();
		fixtureValue.repository.records.set(claimId, pendingRecord());
		fixtureValue.setRandom(bridgeId);
		expect(await fixtureValue.service.bind(claimId, context)).toEqual({
			status: "ok",
			value: { bridge_id: bridgeId },
		});
		expect(fixtureValue.randomCalls()).toBe(1);
		expect(await fixtureValue.service.bind(claimId, context)).toEqual({ status: "conflict" });
		expect(
			await fixtureValue.service.bind(claimId, {
				...context,
				extra: "not allowed",
			}),
		).toEqual({ status: "invalid" });
		expect(
			await fixtureValue.service.bind(claimId, {
				...context,
				first_touch: { ...context.first_touch, touched_at: now - 30 * 24 * 60 * 60 * 1000 - 1 },
			}),
		).toEqual({ status: "invalid" });
	});

	test("bind preserves a supplied download bridge without generating a replacement", async () => {
		const fixtureValue = fixture();
		fixtureValue.repository.records.set(claimId, pendingRecord());
		const contextWithBridge = { ...context, bridge_id: bridgeId };

		expect(await fixtureValue.service.bind(claimId, contextWithBridge)).toEqual({
			status: "ok",
			value: { bridge_id: bridgeId },
		});
		expect(fixtureValue.repository.records.get(claimId)?.bridgeId).toBe(bridgeId);
		expect(fixtureValue.randomCalls()).toBe(0);
	});

	test("rejects a non-canonical supplied download bridge", async () => {
		const fixtureValue = fixture();
		fixtureValue.repository.records.set(claimId, pendingRecord());

		expect(
			await fixtureValue.service.bind(claimId, { ...context, bridge_id: "not-canonical" }),
		).toEqual({ status: "invalid" });
		expect(fixtureValue.randomCalls()).toBe(0);
	});

	test("reports authenticated pending and expiry, but hides wrong verifiers", async () => {
		const fixtureValue = fixture();
		fixtureValue.repository.records.set(claimId, pendingRecord());
		expect(await fixtureValue.service.status(claimId, "wrong")).toEqual({
			status: "not-found",
		});
		expect(await fixtureValue.service.status(claimId, "correct")).toEqual({ status: "pending" });
		fixtureValue.setNow(now + 600_000);
		expect(await fixtureValue.service.status(claimId, "correct")).toEqual({ status: "expired" });
		expect(await fixtureValue.service.redeem(claimId, "correct")).toEqual({ status: "expired" });
	});

	test("atomically redeems one bound claim and makes replay indistinguishable from unknown", async () => {
		const fixtureValue = fixture();
		fixtureValue.repository.records.set(claimId, {
			...pendingRecord(),
			bridgeId,
			context,
		});
		expect(await fixtureValue.service.redeem(claimId, "correct")).toEqual({
			status: "ok",
			value: { bridge_id: bridgeId, ...context },
		});
		expect(await fixtureValue.service.redeem(claimId, "correct")).toEqual({
			status: "not-found",
		});
		expect(await fixtureValue.service.redeem("unknown", "correct")).toEqual({
			status: "not-found",
		});
	});
});
