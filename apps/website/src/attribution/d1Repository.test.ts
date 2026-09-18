import { describe, expect, test } from "bun:test";
import {
	D1ClaimRepository,
	type D1Database,
	type D1PreparedStatement,
	type D1Result,
} from "./d1Repository";
import type { ClaimRecord } from "./service";

const record: ClaimRecord = {
	claimId: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
	challenge: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA",
	createdAt: 2_000_000_000_000,
	expiresAt: 2_000_000_600_000,
};

class StatementDatabase implements D1Database {
	readonly calls: Array<{ query: string; values: unknown[] }> = [];
	changes = 1;
	quotaPermitted = true;

	prepare(query: string): D1PreparedStatement {
		const database = this;
		let values: unknown[] = [];
		return {
			bind(...boundValues: unknown[]) {
				values = boundValues;
				return this;
			},
			async run(): Promise<D1Result> {
				database.calls.push({ query, values });
				return { meta: { changes: database.changes } };
			},
			async first<T>(): Promise<T | null> {
				database.calls.push({ query, values });
				if (query.includes("INSERT INTO attribution_create_quota") && database.quotaPermitted) {
					return { create_count: 1 } as T;
				}
				return null;
			},
		};
	}
}

describe("D1 claim repository create bounds", () => {
	test("atomically consumes the UTC minute quota and opportunistically deletes older buckets", async () => {
		const database = new StatementDatabase();
		const repository = new D1ClaimRepository(database);

		expect(await repository.consumeCreateQuota(2_000_000_059_999)).toBeTrue();
		expect(database.calls[0]?.query).toContain(
			"ON CONFLICT (minute_bucket) DO UPDATE SET create_count = create_count + 1",
		);
		expect(database.calls[0]?.query).toContain("WHERE create_count < 1000");
		expect(database.calls[0]?.query).toContain("RETURNING create_count");
		expect(database.calls[0]?.values).toEqual([Math.floor(2_000_000_059_999 / 60_000)]);
		expect(database.calls[1]).toEqual({
			query: "DELETE FROM attribution_create_quota WHERE minute_bucket < ?",
			values: [Math.floor(2_000_000_059_999 / 60_000)],
		});

		database.quotaPermitted = false;
		expect(await repository.consumeCreateQuota(2_000_000_060_000)).toBeFalse();
	});

	test("deletes every expired row without a cleanup limit", async () => {
		const database = new StatementDatabase();
		await new D1ClaimRepository(database).deleteExpired(record.createdAt);

		expect(database.calls).toEqual([
			{
				query: "DELETE FROM attribution_claims WHERE expires_at <= ?",
				values: [record.createdAt],
			},
		]);
	});

	test("atomically inserts only below the 50,000-row cap", async () => {
		const database = new StatementDatabase();
		const repository = new D1ClaimRepository(database);
		expect(await repository.create(record)).toBe("created");
		expect(database.calls[0]?.query).toContain(
			"WHERE (SELECT COUNT(*) FROM attribution_claims) < 50000",
		);
		expect(database.calls[0]?.values).toEqual([
			record.claimId,
			record.challenge,
			record.createdAt,
			record.expiresAt,
		]);

		database.changes = 0;
		expect(await repository.create(record)).toBe("capacity");
	});
});
