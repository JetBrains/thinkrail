import { describe, expect, test } from "bun:test";
import type { D1Database, D1PreparedStatement, D1Result } from "./d1Repository";
import { handleBindClaim, handleCreateClaim, handleRedeemClaim } from "./http";

const validId = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

class TrackingDatabase implements D1Database {
	prepareCalls = 0;
	runCalls = 0;
	changes = 1;
	quotaAvailable = true;
	readonly queries: string[] = [];

	prepare(query: string): D1PreparedStatement {
		this.prepareCalls += 1;
		this.queries.push(query);
		const database = this;
		return {
			bind() {
				return this;
			},
			async run(): Promise<D1Result> {
				database.runCalls += 1;
				return { meta: { changes: database.changes } };
			},
			async first<T>(): Promise<T | null> {
				if (query.includes("INSERT INTO attribution_create_quota") && database.quotaAvailable) {
					return { create_count: 1 } as T;
				}
				return null;
			},
		};
	}
}

function environment(database: TrackingDatabase) {
	return { ATTRIBUTION_DB: database };
}

function post(url: string, body: unknown, origin?: string): Request {
	const headers = new Headers({ "Content-Type": "application/json" });
	if (origin !== undefined) headers.set("Origin", origin);
	return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("claim HTTP guards and validation", () => {
	test.each([
		"https://thinkrail-website.pages.dev/api/attribution/claims",
		"https://pr-42.thinkrail-website.pages.dev/api/attribution/claims",
		"https://www.thinkrail.ai/api/attribution/claims",
		"http://thinkrail.ai/api/attribution/claims",
		"https://thinkrail.ai:8443/api/attribution/claims",
	])("returns generic 404 without touching D1 on %s", async (url) => {
		const database = new TrackingDatabase();
		const response = await handleCreateClaim(
			post(url, { challenge: validId }),
			environment(database),
		);
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "not_found" });
		expect(database.prepareCalls).toBe(0);
		expect(response.headers.has("Access-Control-Allow-Origin")).toBeFalse();
	});

	test("requires exact browser Origin before bind can read or mutate D1", async () => {
		for (const origin of [undefined, "https://www.thinkrail.ai", "https://thinkrail.ai/"]) {
			const database = new TrackingDatabase();
			const response = await handleBindClaim(
				post("https://thinkrail.ai/api/attribution/claims/id/bind", {}, origin),
				environment(database),
				validId,
			);
			expect(response.status).toBe(404);
			expect(database.prepareCalls).toBe(0);
		}
	});

	test.each([
		[{ challenge: validId, extra: true }],
		[{ challenge: "short" }],
		[{ verifier: validId }],
	])("rejects strict create bodies before D1", async (body) => {
		const database = new TrackingDatabase();
		const response = await handleCreateClaim(
			post("https://thinkrail.ai/api/attribution/claims", body),
			environment(database),
		);
		expect(response.status).toBe(400);
		expect(database.prepareCalls).toBe(0);
	});

	test("rejects oversized and malformed verifier bodies before D1", async () => {
		const database = new TrackingDatabase();
		const oversized = post("https://thinkrail.ai/api/attribution/claims/x/redeem", {
			verifier: "A".repeat(200),
		});
		const response = await handleRedeemClaim(oversized, environment(database), validId);
		expect(response.status).toBe(400);
		expect(database.prepareCalls).toBe(0);
	});

	test("returns 429 when the aggregate D1 create quota is exhausted", async () => {
		const database = new TrackingDatabase();
		database.quotaAvailable = false;
		const response = await handleCreateClaim(
			post("https://thinkrail.ai/api/attribution/claims", { challenge: validId }),
			environment(database),
		);
		expect(response.status).toBe(429);
		expect(response.headers.get("Retry-After")).toBe("60");
		expect(database.queries.some((query) => query.includes("attribution_create_quota"))).toBeTrue();
		expect(database.queries.some((query) => query.includes("attribution_claims"))).toBeFalse();
	});

	test("returns 503 capacity without an insert when the repository cap is reached", async () => {
		const database = new TrackingDatabase();
		database.changes = 0;
		const response = await handleCreateClaim(
			post("https://thinkrail.ai/api/attribution/claims", { challenge: validId }),
			environment(database),
		);
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ error: "capacity" });
	});

	test("creates only on the apex host with no-store and no CORS response headers", async () => {
		const database = new TrackingDatabase();
		const response = await handleCreateClaim(
			post("https://thinkrail.ai/api/attribution/claims", { challenge: validId }),
			environment(database),
		);
		expect(response.status).toBe(201);
		expect(database.runCalls).toBe(3);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(response.headers.has("Access-Control-Allow-Origin")).toBeFalse();
		const body = (await response.json()) as Record<string, unknown>;
		expect(body.claim_url).toBe(`/attribution/claim/?id=${body.claim_id}`);
		expect(typeof body.expires_at).toBe("number");
	});
});
