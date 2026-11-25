import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface PagesDeployment {
	id: string;
	url?: string;
	environment?: string;
	created_on?: string;
	is_skipped?: boolean;
	latest_stage?: { name?: string; status?: string } | null;
	deployment_trigger?: { metadata?: { branch?: string; commit_hash?: string } } | null;
}

export interface GateInput {
	event: string;
	headCommit: string;
	live: PagesDeployment | null;
	production: readonly PagesDeployment[];
	builtCatalog: unknown;
	liveCatalog: unknown;
}

export interface GateDecision {
	deploy: boolean;
	reason: string;
}

const API = "https://api.cloudflare.com/client/v4";
const fetchAttempts = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function succeeded(deployment: PagesDeployment): boolean {
	return (
		deployment.environment === "production" &&
		deployment.is_skipped !== true &&
		deployment.latest_stage?.status === "success"
	);
}

export function newestSuccessful(
	deployments: readonly PagesDeployment[],
): PagesDeployment | undefined {
	return deployments
		.filter(succeeded)
		.toSorted((a, b) => Date.parse(b.created_on ?? "") - Date.parse(a.created_on ?? ""))[0];
}

function withoutTimestamp(catalog: unknown): string | undefined {
	if (!isRecord(catalog) || !Array.isArray(catalog.extensions)) return undefined;
	const { generatedAt: _generatedAt, ...rest } = catalog;
	return JSON.stringify(rest);
}

const label = (deployment: PagesDeployment) =>
	`${deployment.id} (${deployment.deployment_trigger?.metadata?.commit_hash?.slice(0, 9) ?? "no commit"})`;

export function decide(input: GateInput): GateDecision {
	if (input.event !== "schedule") {
		return { deploy: true, reason: `a ${input.event} run always deploys` };
	}
	if (input.live === null) {
		return { deploy: true, reason: "no production deployment is live yet" };
	}
	const newest = newestSuccessful(input.production);
	if (newest !== undefined && newest.id !== input.live.id) {
		return {
			deploy: false,
			reason: `production is rolled back: ${label(input.live)} is live, but the newest successful production deployment is ${label(newest)}. A scheduled run never replaces a rollback; run this workflow manually to end it.`,
		};
	}
	const built = withoutTimestamp(input.builtCatalog);
	if (built === undefined) throw new Error("the built extensions/catalog.json is not a catalog");
	const liveCommit = input.live.deployment_trigger?.metadata?.commit_hash;
	if (liveCommit === input.headCommit && withoutTimestamp(input.liveCatalog) === built) {
		return {
			deploy: false,
			reason: `nothing changed: ${label(input.live)} already serves this commit and the same extension catalog.`,
		};
	}
	return {
		deploy: true,
		reason:
			liveCommit === input.headCommit
				? "the extension catalog changed"
				: `main moved from ${liveCommit?.slice(0, 9) ?? "an unknown commit"} to ${input.headCommit.slice(0, 9)}`,
	};
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

async function cloudflare(
	fetcher: Fetch,
	path: string,
	token: string,
	retryDelayMs: number,
): Promise<unknown> {
	let failure = "";
	for (let attempt = 1; attempt <= fetchAttempts; attempt++) {
		try {
			const response = await fetcher(`${API}${path}`, {
				headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
				signal: AbortSignal.timeout(30_000),
			});
			const body: unknown = await response.json().catch(() => undefined);
			if (response.ok && isRecord(body) && body.success === true) return body.result;
			failure = `HTTP ${response.status}`;
			if (response.status < 500 && response.status !== 429) break;
		} catch (error) {
			failure = error instanceof Error ? error.name : "network error";
		}
		if (attempt < fetchAttempts) {
			await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
		}
	}
	throw new Error(`Cloudflare API request failed (${failure}): ${path}`);
}

async function liveCatalog(fetcher: Fetch, live: PagesDeployment | null): Promise<unknown> {
	if (!live?.url) return undefined;
	try {
		const response = await fetcher(new URL("/extensions/catalog.json", live.url).href, {
			signal: AbortSignal.timeout(30_000),
		});
		return response.ok ? await response.json() : undefined;
	} catch {
		return undefined;
	}
}

export interface GateEnvironment {
	event: string;
	headCommit: string;
	accountId?: string | undefined;
	token?: string | undefined;
	project: string;
	catalogPath: string;
	fetch: Fetch;
	retryDelayMs?: number;
}

export async function gate(env: GateEnvironment): Promise<GateDecision> {
	if (env.event !== "schedule") {
		const idle = { live: null, production: [], builtCatalog: null, liveCatalog: null };
		return decide({ event: env.event, headCommit: env.headCommit, ...idle });
	}
	if (!env.accountId || !env.token) {
		throw new Error(
			"CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required for a scheduled run",
		);
	}
	const base = `/accounts/${env.accountId}/pages/projects/${env.project}`;
	const delay = env.retryDelayMs ?? 2000;
	const project = await cloudflare(env.fetch, base, env.token, delay);
	const deployments = await cloudflare(
		env.fetch,
		`${base}/deployments?env=production&per_page=25`,
		env.token,
		delay,
	);
	if (!isRecord(project) || !Array.isArray(deployments)) {
		throw new Error("Cloudflare API returned an unexpected body");
	}
	const live = isRecord(project.canonical_deployment)
		? (project.canonical_deployment as unknown as PagesDeployment)
		: null;
	return decide({
		event: env.event,
		headCommit: env.headCommit,
		live,
		production: deployments as PagesDeployment[],
		builtCatalog: JSON.parse(readFileSync(env.catalogPath, "utf8")),
		liveCatalog: await liveCatalog(env.fetch, live),
	});
}

if (import.meta.main) {
	const decision = await gate({
		event: process.env.GITHUB_EVENT_NAME ?? "workflow_dispatch",
		headCommit: process.env.GITHUB_SHA ?? "",
		accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
		token: process.env.CLOUDFLARE_API_TOKEN,
		project: "thinkrail-website",
		catalogPath: fileURLToPath(new URL("../dist/extensions/catalog.json", import.meta.url)),
		fetch,
	});
	console.log(
		decision.deploy
			? `Deploying: ${decision.reason}`
			: `::notice title=Deploy skipped::${decision.reason}`,
	);
	if (process.env.GITHUB_OUTPUT)
		appendFileSync(process.env.GITHUB_OUTPUT, `deploy=${decision.deploy}\n`);
}
