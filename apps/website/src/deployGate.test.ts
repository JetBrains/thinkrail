import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type GateEnvironment, gate, newestSuccessful, type PagesDeployment } from "./deployGate";
import recorded from "./fixtures/cloudflarePages.json";

const account = "acc123";
const api = `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/thinkrail-website`;
const project = recorded.project;
const deployments = recorded.deployments;
const live = project.result.canonical_deployment;
const older = deployments.result[2] as PagesDeployment;
const headCommit = live.deployment_trigger.metadata.commit_hash;

const catalog = (generatedAt: string, names: string[] = ["thinkrail-ext-weather"]) => ({
	schema: 1,
	generatedAt,
	extensions: names.map((name) => ({ name, version: "1.0.0" })),
});

type Routes = Record<string, { status: number; body: unknown } | "network">;

function server(routes: Routes) {
	const calls: string[] = [];
	const fetch = async (url: string, init?: RequestInit) => {
		calls.push(url);
		if (url.startsWith("https://api.cloudflare.com/")) {
			expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token");
		}
		const route = routes[url];
		if (route === undefined) throw new Error(`unexpected request ${url}`);
		if (route === "network") throw new TypeError("fetch failed");
		return new Response(JSON.stringify(route.body), { status: route.status });
	};
	return { calls, fetch };
}

function routes(overrides: Routes = {}): Routes {
	return {
		[api]: { status: 200, body: project },
		[`${api}/deployments?env=production&per_page=25`]: { status: 200, body: deployments },
		[`${live.url}/extensions/catalog.json`]: {
			status: 200,
			body: catalog("2026-11-19T12:17:00.000Z"),
		},
		...overrides,
	};
}

function environment(
	fetch: GateEnvironment["fetch"],
	built: unknown = catalog("2026-11-19T13:17:00.000Z"),
	overrides: Partial<GateEnvironment> = {},
): GateEnvironment {
	const dir = mkdtempSync(join(tmpdir(), "deploy-gate-"));
	const catalogPath = join(dir, "catalog.json");
	writeFileSync(catalogPath, JSON.stringify(built));
	return {
		event: "schedule",
		headCommit,
		accountId: account,
		token: "token",
		project: "thinkrail-website",
		catalogPath,
		fetch,
		retryDelayMs: 0,
		...overrides,
	};
}

describe("the deploy gate", () => {
	test("a push or a manual run always deploys and asks Cloudflare nothing", async () => {
		for (const event of ["push", "workflow_dispatch"]) {
			const { calls, fetch } = server({});
			const decision = await gate(environment(fetch, undefined, { event, token: undefined }));
			expect(decision).toEqual({ deploy: true, reason: `a ${event} run always deploys` });
			expect(calls).toEqual([]);
		}
	});

	test("the newest successful production deployment ignores a newer failed one", () => {
		expect(newestSuccessful(deployments.result as PagesDeployment[])?.id).toBe(live.id);
	});

	test("a scheduled run skips while production is rolled back", async () => {
		const rolledBack = { ...project, result: { ...project.result, canonical_deployment: older } };
		const { fetch } = server(
			routes({
				[api]: { status: 200, body: rolledBack },
				[`${older.url}/extensions/catalog.json`]: { status: 200, body: catalog("x", []) },
			}),
		);
		const decision = await gate(environment(fetch));
		expect(decision.deploy).toBe(false);
		expect(decision.reason).toStartWith(
			`production is rolled back: ${older.id} (0a1b2c3d4) is live, but the newest successful production deployment is ${live.id} (4f1e2d3c4).`,
		);
		expect(decision.reason).toContain("run this workflow manually to end it");

		const pushedSinceRollback = await gate(
			environment(fetch, undefined, { headCommit: "9".repeat(40) }),
		);
		expect(pushedSinceRollback.deploy).toBe(false);
	});

	test("a scheduled run skips when the live deployment has this commit and the same catalog", async () => {
		const { fetch } = server(routes());
		expect(await gate(environment(fetch))).toEqual({
			deploy: false,
			reason: `nothing changed: ${live.id} (4f1e2d3c4) already serves this commit and the same extension catalog.`,
		});
	});

	test("a scheduled run deploys a changed catalog", async () => {
		const { fetch } = server(routes());
		const built = catalog("2026-11-19T13:17:00.000Z", [
			"thinkrail-ext-jira",
			"thinkrail-ext-weather",
		]);
		expect(await gate(environment(fetch, built))).toEqual({
			deploy: true,
			reason: "the extension catalog changed",
		});
	});

	test("a scheduled run deploys a newer commit even with the same catalog", async () => {
		const { fetch } = server(routes());
		const decision = await gate(environment(fetch, undefined, { headCommit: "9".repeat(40) }));
		expect(decision).toEqual({ deploy: true, reason: "main moved from 4f1e2d3c4 to 999999999" });
	});

	test("a scheduled run deploys when the live catalog cannot be read", async () => {
		for (const route of [{ status: 404, body: {} }, "network"] as const) {
			const { fetch } = server(routes({ [`${live.url}/extensions/catalog.json`]: route }));
			expect((await gate(environment(fetch))).deploy).toBe(true);
		}
	});

	test("a scheduled run deploys when nothing is live yet", async () => {
		const empty = { ...project, result: { ...project.result, canonical_deployment: null } };
		const { fetch } = server(
			routes({
				[api]: { status: 200, body: empty },
				[`${api}/deployments?env=production&per_page=25`]: {
					status: 200,
					body: { ...deployments, result: [] },
				},
			}),
		);
		expect(await gate(environment(fetch))).toEqual({
			deploy: true,
			reason: "no production deployment is live yet",
		});
	});

	test("a Cloudflare failure fails the run, retrying only server errors", async () => {
		const unavailable = server(routes({ [api]: { status: 503, body: { success: false } } }));
		await expect(gate(environment(unavailable.fetch))).rejects.toThrow(
			"Cloudflare API request failed (HTTP 503)",
		);
		expect(unavailable.calls.filter((url) => url === api)).toHaveLength(3);

		const forbidden = server(routes({ [api]: { status: 403, body: { success: false } } }));
		await expect(gate(environment(forbidden.fetch))).rejects.toThrow("HTTP 403");
		expect(forbidden.calls).toEqual([api]);

		const refused = server(
			routes({ [api]: { status: 200, body: { success: false, errors: [], result: null } } }),
		);
		await expect(gate(environment(refused.fetch))).rejects.toThrow("HTTP 200");
	});

	test("a scheduled run needs the Cloudflare credentials and a built catalog", async () => {
		const { fetch } = server(routes());
		await expect(gate(environment(fetch, undefined, { token: undefined }))).rejects.toThrow(
			"CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required",
		);
		await expect(gate(environment(fetch, { schema: 1 }))).rejects.toThrow(
			"the built extensions/catalog.json is not a catalog",
		);
	});
});
