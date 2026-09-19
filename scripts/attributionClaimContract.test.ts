import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AttributionStorage,
	readStoredAttributionContext,
	recordAttributionTouch,
	storeLatestAttributionBridge,
} from "../apps/website/src/attribution/browserStorage";
import { runClaimPage } from "../apps/website/src/attribution/claimPage";
import type { BindClaimRequest } from "../apps/website/src/attribution/protocol";
import {
	type AttributionEnvironment,
	handleBindClaim,
	handleClaimStatus,
	handleCreateClaim,
	handleRedeemClaim,
} from "../apps/website/src/attribution/server";
import {
	type BindResult,
	type ClaimRecord,
	type ClaimRepository,
	ClaimService,
	type CreateResult,
} from "../apps/website/src/attribution/service";
import { runAttributionClaim } from "../packages/server/src/analytics/attribution";
import {
	readAcquisitionIn,
	saveAcquisitionIn,
} from "../packages/server/src/persistence/attribution";
import type { RedeemedAttribution } from "../packages/server/src/persistence/attributionProtocol";

const claimId = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const bridgeId = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA";
const journeyId = "01890f47-75a3-4d8f-9a72-4f0e35be292b";
const endpoint = "https://thinkrail.ai";
const host = "thinkrail.ai";

class MemoryClaimRepository implements ClaimRepository {
	record: ClaimRecord | undefined;

	async consumeCreateQuota(): Promise<boolean> {
		return true;
	}

	async deleteExpired(): Promise<void> {}

	async create(record: ClaimRecord): Promise<CreateResult> {
		this.record = structuredClone(record);
		return "created";
	}

	async bind(id: string, bridgeId: string, context: BindClaimRequest): Promise<BindResult> {
		if (this.record?.claimId !== id) return "missing";
		this.record.bridgeId = bridgeId;
		this.record.context = structuredClone(context);
		return "bound";
	}

	async findVerified(id: string, challenge: string): Promise<ClaimRecord | undefined> {
		return this.record?.claimId === id && this.record.challenge === challenge
			? structuredClone(this.record)
			: undefined;
	}

	async redeemVerified(
		id: string,
		challenge: string,
	): Promise<(BindClaimRequest & { bridgeId: string }) | undefined> {
		const record = await this.findVerified(id, challenge);
		return record?.bridgeId !== undefined && record.context !== undefined
			? { ...record.context, bridgeId: record.bridgeId }
			: undefined;
	}
}

function memoryStorage(): AttributionStorage {
	const values = new Map<string, string>();
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
		removeItem: (key) => values.delete(key),
	};
}

test("website HTTP, browser claim, server client, and product persistence share one contract", async () => {
	const directory = mkdtempSync(join(tmpdir(), "thinkrail-attribution-contract-"));
	try {
		const now = Date.now();
		const repository = new MemoryClaimRepository();
		const claimService = new ClaimService({
			repository,
			now: () => now,
			randomId: () => claimId,
			challengeForVerifier: async (verifier) =>
				createHash("sha256").update(verifier, "utf8").digest("base64url"),
		});
		const serviceFactory = () => claimService;
		const environment: AttributionEnvironment = {
			ATTRIBUTION_DB: {} as AttributionEnvironment["ATTRIBUTION_DB"],
		};

		const storage = memoryStorage();
		recordAttributionTouch(
			journeyId,
			"landing",
			"https://thinkrail.ai/?utm_source=google&utm_medium=cpc&utm_campaign=agentic-launch&utm_content=hero",
			"https://www.google.com/search?q=thinkrail",
			storage,
			now - 5_000,
		);
		recordAttributionTouch(
			journeyId,
			"blog/introducing-thinkrail",
			"https://thinkrail.ai/blog/introducing-thinkrail/?utm_source=newsletter&utm_medium=email&utm_campaign=agentic-launch&utm_content=article",
			"https://www.linkedin.com/company/thinkrail",
			storage,
			now - 1_000,
		);
		expect(storeLatestAttributionBridge(journeyId, storage, () => bridgeId, now)).toBe(bridgeId);
		const websiteContext = readStoredAttributionContext(storage, now);
		if (websiteContext === undefined) throw new Error("expected a consented website context");

		const exchanges: Array<
			[path: string, host: string | null, origin: string | null, status: number]
		> = [];
		async function dispatch(request: Request): Promise<Response> {
			const path = new URL(request.url).pathname;
			let response: Response;
			if (path === "/api/attribution/claims") {
				response = await handleCreateClaim(request, environment, serviceFactory);
			} else {
				const match = path.match(/^\/api\/attribution\/claims\/([^/]+)\/(bind|status|redeem)$/);
				if (match === null) throw new Error(`unexpected attribution request: ${path}`);
				const [, id = "", operation = ""] = match;
				switch (operation) {
					case "bind":
						response = await handleBindClaim(request, environment, id, serviceFactory);
						break;
					case "status":
						response = await handleClaimStatus(request, environment, id, serviceFactory);
						break;
					case "redeem":
						response = await handleRedeemClaim(request, environment, id, serviceFactory);
						break;
					default:
						throw new Error(`unexpected attribution operation: ${operation}`);
				}
			}
			exchanges.push([
				path,
				request.headers.get("Host"),
				request.headers.get("Origin"),
				response.status,
			]);
			return response;
		}

		const productFetch: typeof fetch = (async (
			input: Parameters<typeof fetch>[0],
			init?: RequestInit,
		) => {
			const headers = new Headers(init?.headers);
			headers.set("Host", host);
			return dispatch(new Request(String(input), { ...init, headers }));
		}) as typeof fetch;

		const opened: string[] = [];
		const replacements: string[] = [];
		const linked: RedeemedAttribution[] = [];
		let browserTask: Promise<void> | undefined;

		await runAttributionClaim({
			endpoint,
			fetchImpl: productFetch,
			openExternal(url) {
				opened.push(url);
				const claimUrl = new URL(url);
				browserTask = runClaimPage({
					readContext: () => readStoredAttributionContext(storage, now),
					search: claimUrl.search,
					requestTimeoutMs: 1_000,
					request(path, init) {
						const headers = new Headers(init.headers);
						headers.set("Host", host);
						headers.set("Origin", endpoint);
						return dispatch(
							new Request(new URL(path, endpoint), {
								...init,
								headers,
							}),
						);
					},
					replace(path) {
						replacements.push(path);
					},
				});
				return browserTask;
			},
			async sleep() {
				await browserTask;
			},
			maxPolls: 1,
			active: () => true,
			persist({ first_touch, last_touch }) {
				saveAcquisitionIn(directory, { first_touch, last_touch });
			},
			linked(record) {
				linked.push(record);
			},
		});
		await browserTask;

		expect(opened).toEqual([`${endpoint}/attribution/claim/?id=${claimId}`]);
		expect(replacements).toEqual(["/blog/"]);
		expect(exchanges).toEqual([
			["/api/attribution/claims", host, null, 201],
			[`/api/attribution/claims/${claimId}/bind`, host, endpoint, 200],
			[`/api/attribution/claims/${claimId}/status`, host, null, 200],
			[`/api/attribution/claims/${claimId}/redeem`, host, null, 200],
		]);

		const persisted = readAcquisitionIn(directory, now);
		expect(persisted).toEqual({
			first_touch: websiteContext.first_touch,
			last_touch: websiteContext.last_touch,
		});
		expect(linked).toEqual([{ ...websiteContext, bridge_id: bridgeId }]);
		expect(persisted?.last_touch.campaign).toBe("agentic-launch");
		expect(linked[0]?.last_touch.campaign).toBe(persisted?.last_touch.campaign);
		expect(linked[0]?.bridge_id).toBe(bridgeId);
		expect(linked[0]?.journey_id).toBe(journeyId);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
