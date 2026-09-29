import type { AttributionTouch, BindClaimRequest, ReferrerClass } from "./protocol";
import type { BindResult, ClaimRecord, ClaimRepository, CreateResult } from "./service";

export interface D1Result {
	meta: { changes?: number };
}

export interface D1PreparedStatement {
	bind(...values: unknown[]): D1PreparedStatement;
	run(): Promise<D1Result>;
	first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface D1Database {
	prepare(query: string): D1PreparedStatement;
}

type ClaimRow = {
	claim_id: string;
	challenge: string;
	created_at: number;
	expires_at: number;
	bridge_id: string | null;
	journey_id: string | null;
	first_source: string | null;
	first_medium: string | null;
	first_campaign: string | null;
	first_content: string | null;
	first_referrer_class: ReferrerClass | null;
	first_landing_content_key: AttributionTouch["landing_content_key"] | null;
	first_touched_at: number | null;
	first_policy_version: 1 | null;
	last_source: string | null;
	last_medium: string | null;
	last_campaign: string | null;
	last_content: string | null;
	last_referrer_class: ReferrerClass | null;
	last_landing_content_key: AttributionTouch["landing_content_key"] | null;
	last_touched_at: number | null;
	last_policy_version: 1 | null;
};

const returnedColumns = `
	claim_id, challenge, created_at, expires_at, bridge_id, journey_id,
	first_source, first_medium, first_campaign, first_content, first_referrer_class,
	first_landing_content_key, first_touched_at, first_policy_version,
	last_source, last_medium, last_campaign, last_content, last_referrer_class,
	last_landing_content_key, last_touched_at, last_policy_version`;

function touchFromRow(row: ClaimRow, prefix: "first" | "last"): AttributionTouch | undefined {
	const referrerClass = row[`${prefix}_referrer_class`];
	const landingContentKey = row[`${prefix}_landing_content_key`];
	const touchedAt = row[`${prefix}_touched_at`];
	const policyVersion = row[`${prefix}_policy_version`];
	if (
		referrerClass === null ||
		landingContentKey === null ||
		touchedAt === null ||
		policyVersion !== 1
	) {
		return undefined;
	}
	const source = row[`${prefix}_source`];
	const medium = row[`${prefix}_medium`];
	const campaign = row[`${prefix}_campaign`];
	const content = row[`${prefix}_content`];
	return {
		...(source === null ? {} : { source }),
		...(medium === null ? {} : { medium }),
		...(campaign === null ? {} : { campaign }),
		...(content === null ? {} : { content }),
		referrer_class: referrerClass,
		landing_content_key: landingContentKey,
		touched_at: touchedAt,
		policy_version: 1,
	};
}

function recordFromRow(row: ClaimRow): ClaimRecord {
	const firstTouch = touchFromRow(row, "first");
	const lastTouch = touchFromRow(row, "last");
	return {
		claimId: row.claim_id,
		challenge: row.challenge,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		...(row.bridge_id === null ? {} : { bridgeId: row.bridge_id }),
		...(firstTouch === undefined || lastTouch === undefined || row.journey_id === null
			? {}
			: {
					context: {
						journey_id: row.journey_id,
						first_touch: firstTouch,
						last_touch: lastTouch,
					},
				}),
	};
}

function touchValues(touch: AttributionTouch): unknown[] {
	return [
		touch.source ?? null,
		touch.medium ?? null,
		touch.campaign ?? null,
		touch.content ?? null,
		touch.referrer_class,
		touch.landing_content_key,
		touch.touched_at,
		touch.policy_version,
	];
}

export class D1ClaimRepository implements ClaimRepository {
	readonly #database: D1Database;

	constructor(database: D1Database) {
		this.#database = database;
	}

	async consumeCreateQuota(now: number): Promise<boolean> {
		const minuteBucket = Math.floor(now / 60_000);
		const consumed = await this.#database
			.prepare(`INSERT INTO attribution_create_quota (minute_bucket, create_count) VALUES (?, 1)
			ON CONFLICT (minute_bucket) DO UPDATE SET create_count = create_count + 1
			WHERE create_count < 1000
			RETURNING create_count`)
			.bind(minuteBucket)
			.first<{ create_count: number }>();
		try {
			await this.#database
				.prepare("DELETE FROM attribution_create_quota WHERE minute_bucket < ?")
				.bind(minuteBucket)
				.run();
		} catch {}
		return consumed !== null;
	}

	async deleteExpired(now: number): Promise<void> {
		await this.#database
			.prepare("DELETE FROM attribution_claims WHERE expires_at <= ?")
			.bind(now)
			.run();
	}

	async create(record: ClaimRecord): Promise<CreateResult> {
		const result = await this.#database
			.prepare(`INSERT INTO attribution_claims (claim_id, challenge, created_at, expires_at)
			SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM attribution_claims) < 50000`)
			.bind(record.claimId, record.challenge, record.createdAt, record.expiresAt)
			.run();
		return (result.meta.changes ?? 0) === 1 ? "created" : "capacity";
	}

	async bind(
		claimId: string,
		bridgeId: string,
		context: BindClaimRequest,
		boundAt: number,
	): Promise<BindResult> {
		const result = await this.#database
			.prepare(`UPDATE attribution_claims SET
			bridge_id = ?, journey_id = ?, bound_at = ?,
			first_source = ?, first_medium = ?, first_campaign = ?, first_content = ?,
			first_referrer_class = ?, first_landing_content_key = ?, first_touched_at = ?, first_policy_version = ?,
			last_source = ?, last_medium = ?, last_campaign = ?, last_content = ?,
			last_referrer_class = ?, last_landing_content_key = ?, last_touched_at = ?, last_policy_version = ?
			WHERE claim_id = ? AND bridge_id IS NULL AND expires_at > ?`)
			.bind(
				bridgeId,
				context.journey_id,
				boundAt,
				...touchValues(context.first_touch),
				...touchValues(context.last_touch),
				claimId,
				boundAt,
			)
			.run();
		if ((result.meta.changes ?? 0) === 1) return "bound";
		const row = await this.#database
			.prepare("SELECT expires_at, bridge_id FROM attribution_claims WHERE claim_id = ?")
			.bind(claimId)
			.first<{ expires_at: number; bridge_id: string | null }>();
		if (row === null) return "missing";
		if (row.expires_at <= boundAt) return "expired";
		return row.bridge_id === null ? "missing" : "already-bound";
	}

	async findVerified(claimId: string, challenge: string): Promise<ClaimRecord | undefined> {
		const row = await this.#database
			.prepare(
				`SELECT ${returnedColumns} FROM attribution_claims WHERE claim_id = ? AND challenge = ?`,
			)
			.bind(claimId, challenge)
			.first<ClaimRow>();
		return row === null ? undefined : recordFromRow(row);
	}

	async redeemVerified(
		claimId: string,
		challenge: string,
		now: number,
	): Promise<(BindClaimRequest & { bridgeId: string }) | undefined> {
		const row = await this.#database
			.prepare(`DELETE FROM attribution_claims
			WHERE claim_id = ? AND challenge = ? AND expires_at > ? AND bridge_id IS NOT NULL
			RETURNING ${returnedColumns}`)
			.bind(claimId, challenge, now)
			.first<ClaimRow>();
		if (row === null) return undefined;
		const record = recordFromRow(row);
		if (record.bridgeId === undefined || record.context === undefined) return undefined;
		return { bridgeId: record.bridgeId, ...record.context };
	}
}
