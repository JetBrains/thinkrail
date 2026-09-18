import {
	type BindClaimRequest,
	type BindClaimResponse,
	type CreateClaimResponse,
	claimLifetimeMs,
	parseBindClaimRequest,
	type RedeemClaimResponse,
} from "./protocol";

export type ClaimRecord = {
	claimId: string;
	challenge: string;
	createdAt: number;
	expiresAt: number;
	bridgeId?: string;
	context?: BindClaimRequest;
};

export type BindResult = "bound" | "missing" | "expired" | "already-bound";
export type CreateResult = "created" | "capacity";

export interface ClaimRepository {
	consumeCreateQuota(now: number): Promise<boolean>;
	deleteExpired(now: number): Promise<void>;
	create(record: ClaimRecord): Promise<CreateResult>;
	bind(
		claimId: string,
		bridgeId: string,
		context: BindClaimRequest,
		boundAt: number,
	): Promise<BindResult>;
	findVerified(claimId: string, challenge: string): Promise<ClaimRecord | undefined>;
	redeemVerified(
		claimId: string,
		challenge: string,
		now: number,
	): Promise<(BindClaimRequest & { bridgeId: string }) | undefined>;
}

export type ServiceResult<Value> =
	| { status: "ok"; value: Value }
	| { status: "not-found" }
	| { status: "pending" }
	| { status: "expired" }
	| { status: "conflict" }
	| { status: "invalid" }
	| { status: "rate-limited" }
	| { status: "capacity" };

type ClaimServiceDependencies = {
	repository: ClaimRepository;
	now(): number;
	randomId(): string;
	challengeForVerifier(verifier: string): Promise<string>;
};

export class ClaimService {
	readonly #repository: ClaimRepository;
	readonly #now: () => number;
	readonly #randomId: () => string;
	readonly #challengeForVerifier: (verifier: string) => Promise<string>;

	constructor(dependencies: ClaimServiceDependencies) {
		this.#repository = dependencies.repository;
		this.#now = dependencies.now;
		this.#randomId = dependencies.randomId;
		this.#challengeForVerifier = dependencies.challengeForVerifier;
	}

	async create(challenge: string): Promise<ServiceResult<CreateClaimResponse>> {
		const now = this.#now();
		if (!(await this.#repository.consumeCreateQuota(now))) return { status: "rate-limited" };
		await this.#repository.deleteExpired(now);
		const claimId = this.#randomId();
		const expiresAt = now + claimLifetimeMs;
		const created = await this.#repository.create({
			claimId,
			challenge,
			createdAt: now,
			expiresAt,
		});
		if (created === "capacity") return { status: "capacity" };
		return {
			status: "ok",
			value: {
				claim_id: claimId,
				claim_url: `/attribution/claim/?id=${claimId}`,
				expires_at: expiresAt,
			},
		};
	}

	async bind(claimId: string, value: unknown): Promise<ServiceResult<BindClaimResponse>> {
		const now = this.#now();
		const context = parseBindClaimRequest(value, now);
		if (context === undefined) return { status: "invalid" };
		const bridgeId = context.bridge_id ?? this.#randomId();
		const result = await this.#repository.bind(claimId, bridgeId, context, now);
		switch (result) {
			case "bound":
				return { status: "ok", value: { bridge_id: bridgeId } };
			case "expired":
				return { status: "expired" };
			case "already-bound":
				return { status: "conflict" };
			case "missing":
				return { status: "not-found" };
		}
	}

	async status(claimId: string, verifier: string): Promise<ServiceResult<{ status: "bound" }>> {
		const challenge = await this.#challengeForVerifier(verifier);
		const record = await this.#repository.findVerified(claimId, challenge);
		if (record === undefined) return { status: "not-found" };
		if (record.expiresAt <= this.#now()) return { status: "expired" };
		if (record.bridgeId === undefined || record.context === undefined) return { status: "pending" };
		return { status: "ok", value: { status: "bound" } };
	}

	async redeem(claimId: string, verifier: string): Promise<ServiceResult<RedeemClaimResponse>> {
		const now = this.#now();
		const challenge = await this.#challengeForVerifier(verifier);
		const redeemed = await this.#repository.redeemVerified(claimId, challenge, now);
		if (redeemed !== undefined) {
			return {
				status: "ok",
				value: {
					bridge_id: redeemed.bridgeId,
					journey_id: redeemed.journey_id,
					first_touch: redeemed.first_touch,
					last_touch: redeemed.last_touch,
				},
			};
		}
		const record = await this.#repository.findVerified(claimId, challenge);
		if (record === undefined) return { status: "not-found" };
		if (record.expiresAt <= now) return { status: "expired" };
		if (record.bridgeId === undefined || record.context === undefined) return { status: "pending" };
		return { status: "not-found" };
	}
}
