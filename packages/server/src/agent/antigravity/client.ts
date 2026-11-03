import { createHash } from "node:crypto";

export const DEFAULT_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
export const ENDPOINT_FALLBACKS = [
	DEFAULT_ENDPOINT,
	"https://daily-cloudcode-pa.sandbox.googleapis.com",
	"https://cloudcode-pa.googleapis.com",
];

export function endpointCandidates(): string[] {
	const explicit = process.env.ANTIGRAVITY_BASE_URL?.trim();
	return explicit ? [explicit] : ENDPOINT_FALLBACKS;
}

export const DEFAULT_USER_AGENT =
	"antigravity/cli/1.4.0 (aidev_client; os_type=linux; arch=amd64; cl=982146307; auth_method=consumer)";

export function antigravityHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
		"User-Agent": process.env.ANTIGRAVITY_USER_AGENT || DEFAULT_USER_AGENT,
	};
}

export interface AntigravityApiKeyPayload {
	token: string;
	projectId: string;
}

export function parseAntigravityApiKey(apiKeyRaw: string | undefined): AntigravityApiKeyPayload {
	if (!apiKeyRaw) {
		throw new Error("No Antigravity credentials available. Please sign in to Antigravity.");
	}
	try {
		const parsed = JSON.parse(apiKeyRaw) as Partial<AntigravityApiKeyPayload>;
		if (!parsed.token || !parsed.projectId) {
			throw new Error("missing token or projectId");
		}
		return { token: parsed.token, projectId: parsed.projectId };
	} catch (error) {
		throw new Error(
			`Invalid Antigravity credentials: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

const DIRECT_PROJECT_KEYS = [
	"antigravityProjectId",
	"projectId",
	"backendProjectId",
	"userDefinedCloudaicompanionProject",
	"cloudaicompanionProject",
	"project",
] as const;

const PROJECT_ARRAY_KEYS = ["projects", "projectIds", "cloudaicompanionProjects"] as const;

function readProjectCandidate(value: unknown): string | undefined {
	if (typeof value === "string" && value.trim()) return value.trim();
	if (!value || typeof value !== "object") return undefined;
	const rec = value as Record<string, unknown>;
	if (typeof rec.id === "string" && rec.id.trim()) return rec.id.trim();
	for (const key of DIRECT_PROJECT_KEYS) {
		const candidate = rec[key];
		if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
		if (
			candidate &&
			typeof candidate === "object" &&
			"id" in candidate &&
			typeof (candidate as { id?: unknown }).id === "string" &&
			(candidate as { id: string }).id.trim()
		) {
			return (candidate as { id: string }).id.trim();
		}
	}
	return undefined;
}

export function extractProjectId(data: unknown): string | undefined {
	const direct = readProjectCandidate(data);
	if (direct) return direct;
	if (!data || typeof data !== "object") return undefined;
	const rec = data as Record<string, unknown>;
	for (const key of PROJECT_ARRAY_KEYS) {
		const items = rec[key];
		if (Array.isArray(items)) {
			for (const item of items) {
				const candidate = readProjectCandidate(item);
				if (candidate) return candidate;
			}
		}
	}
	return undefined;
}

export function stableProjectId(seed: string): string {
	const bytes = createHash("sha1").update(`antigravity:${seed}`).digest().subarray(0, 16);
	const b6 = bytes[6];
	if (b6 !== undefined) bytes[6] = (b6 & 0x0f) | 0x50;
	const b8 = bytes[8];
	if (b8 !== undefined) bytes[8] = (b8 & 0x3f) | 0x80;
	const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function defaultProjectId(seed = "antigravity-default"): string {
	return process.env.ANTIGRAVITY_PROJECT_ID?.trim() || stableProjectId(seed);
}

const DISCOVERY_TIMEOUT_MS = 8000;

export async function loadCodeAssist(token: string): Promise<string | undefined> {
	const body = JSON.stringify({
		metadata: {
			ideType: "ANTIGRAVITY",
		},
	});

	for (const endpoint of endpointCandidates()) {
		try {
			const res = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
				method: "POST",
				headers: antigravityHeaders(token),
				body,
				signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
			});
			if (!res.ok) continue;
			const data = await res.json();
			const project = extractProjectId(data);
			if (project) return project;
		} catch {}
	}
	return undefined;
}

export function resolveProjectId(opts: {
	token: string;
	credentialProjectId?: string;
	email?: string;
}): string {
	return (
		process.env.ANTIGRAVITY_PROJECT_ID?.trim() ||
		opts.credentialProjectId ||
		defaultProjectId(opts.email || "antigravity-default")
	);
}
