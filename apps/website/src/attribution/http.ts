import { D1ClaimRepository, type D1Database } from "./d1Repository";
import {
	claimIdPattern,
	parseCreateClaimRequest,
	parseVerifyClaimRequest,
	productionOrigin,
} from "./protocol";
import { ClaimService, type ServiceResult } from "./service";

export type AttributionEnvironment = {
	ATTRIBUTION_DB: D1Database;
};

const responseHeaders = {
	"Cache-Control": "no-store",
	"Content-Type": "application/json; charset=utf-8",
	"Referrer-Policy": "no-referrer",
	"X-Content-Type-Options": "nosniff",
} as const;

function json(value: unknown, status: number): Response {
	return new Response(JSON.stringify(value), { status, headers: responseHeaders });
}

function notFound(): Response {
	return json({ error: "not_found" }, 404);
}

function rateLimited(): Response {
	const response = json({ error: "rate_limited" }, 429);
	response.headers.set("Retry-After", "60");
	return response;
}

function isProductionRequest(request: Request): boolean {
	try {
		return new URL(request.url).origin === productionOrigin;
	} catch {
		return false;
	}
}

async function readJsonBody(request: Request, maximumBytes: number): Promise<unknown | undefined> {
	const mediaType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
	if (mediaType !== "application/json") return undefined;
	const declaredLength = request.headers.get("Content-Length");
	if (declaredLength !== null) {
		const parsedLength = Number(declaredLength);
		if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maximumBytes) {
			return undefined;
		}
	}
	if (request.body === null) return undefined;
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maximumBytes) {
				await reader.cancel();
				return undefined;
			}
			chunks.push(value);
		}
		const body = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			body.set(chunk, offset);
			offset += chunk.byteLength;
		}
		const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	} finally {
		reader.releaseLock();
	}
}

function randomId(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function challengeForVerifier(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	let binary = "";
	for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export type ClaimServiceFactory = (environment: AttributionEnvironment) => ClaimService;

const service: ClaimServiceFactory = (environment) =>
	new ClaimService({
		repository: new D1ClaimRepository(environment.ATTRIBUTION_DB),
		now: Date.now,
		randomId,
		challengeForVerifier,
	});

function responseForResult<Value>(result: ServiceResult<Value>, successStatus = 200): Response {
	switch (result.status) {
		case "ok":
			return json(result.value, successStatus);
		case "invalid":
			return json({ error: "invalid_request" }, 400);
		case "pending":
			return json({ error: "pending" }, 409);
		case "expired":
			return json({ error: "expired" }, 410);
		case "conflict":
			return json({ error: "already_bound" }, 409);
		case "not-found":
			return notFound();
		case "rate-limited":
			return rateLimited();
		case "capacity":
			return json({ error: "capacity" }, 503);
	}
}

export async function handleCreateClaim(
	request: Request,
	environment: AttributionEnvironment,
	serviceFactory: ClaimServiceFactory = service,
): Promise<Response> {
	if (!isProductionRequest(request)) return notFound();
	const body = parseCreateClaimRequest(await readJsonBody(request, 128));
	if (body === undefined) return json({ error: "invalid_request" }, 400);
	try {
		return responseForResult(await serviceFactory(environment).create(body.challenge), 201);
	} catch {
		return json({ error: "service_unavailable" }, 503);
	}
}

export async function handleBindClaim(
	request: Request,
	environment: AttributionEnvironment,
	claimId: string,
	serviceFactory: ClaimServiceFactory = service,
): Promise<Response> {
	if (!isProductionRequest(request) || request.headers.get("Origin") !== productionOrigin) {
		return notFound();
	}
	if (!claimIdPattern.test(claimId)) return notFound();
	const body = await readJsonBody(request, 4096);
	if (body === undefined) return json({ error: "invalid_request" }, 400);
	try {
		return responseForResult(await serviceFactory(environment).bind(claimId, body));
	} catch {
		return json({ error: "service_unavailable" }, 503);
	}
}

async function handleVerifiedClaim(
	request: Request,
	environment: AttributionEnvironment,
	claimId: string,
	operation: "status" | "redeem",
	serviceFactory: ClaimServiceFactory,
): Promise<Response> {
	if (!isProductionRequest(request) || !claimIdPattern.test(claimId)) return notFound();
	const body = parseVerifyClaimRequest(await readJsonBody(request, 128));
	if (body === undefined) return json({ error: "invalid_request" }, 400);
	try {
		const claimService = serviceFactory(environment);
		if (operation === "status") {
			return responseForResult(await claimService.status(claimId, body.verifier));
		}
		return responseForResult(await claimService.redeem(claimId, body.verifier));
	} catch {
		return json({ error: "service_unavailable" }, 503);
	}
}

export function handleClaimStatus(
	request: Request,
	environment: AttributionEnvironment,
	claimId: string,
	serviceFactory: ClaimServiceFactory = service,
): Promise<Response> {
	return handleVerifiedClaim(request, environment, claimId, "status", serviceFactory);
}

export function handleRedeemClaim(
	request: Request,
	environment: AttributionEnvironment,
	claimId: string,
	serviceFactory: ClaimServiceFactory = service,
): Promise<Response> {
	return handleVerifiedClaim(request, environment, claimId, "redeem", serviceFactory);
}
