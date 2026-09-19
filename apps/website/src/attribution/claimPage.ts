import { readStoredAttributionContext } from "./browserStorage";
import { type BindClaimRequest, claimIdPattern } from "./protocol";

const bindTimeoutMs = 1_500;

type ClaimPageDependencies = {
	readContext(): BindClaimRequest | undefined;
	request(url: string, init: RequestInit): Promise<Response>;
	replace(url: string): void;
	search: string;
	requestTimeoutMs: number;
};

function claimIdFromSearch(search: string): string | undefined {
	const parameters = new URLSearchParams(search);
	if (parameters.size !== 1) return undefined;
	const values = parameters.getAll("id");
	return values.length === 1 && claimIdPattern.test(values[0] ?? "") ? values[0] : undefined;
}

export async function runClaimPage(
	dependencies: ClaimPageDependencies = {
		readContext() {
			try {
				return readStoredAttributionContext(window.localStorage);
			} catch {
				return undefined;
			}
		},
		request: window.fetch.bind(window),
		replace: window.location.replace.bind(window.location),
		search: window.location.search,
		requestTimeoutMs: bindTimeoutMs,
	},
): Promise<void> {
	try {
		const claimId = claimIdFromSearch(dependencies.search);
		if (claimId === undefined) return;
		const context = dependencies.readContext();
		if (context === undefined) return;

		const abortController = new AbortController();
		const requestTimer = setTimeout(() => abortController.abort(), dependencies.requestTimeoutMs);
		try {
			await dependencies.request(`/api/attribution/claims/${claimId}/bind`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(context),
				credentials: "same-origin",
				redirect: "error",
				signal: abortController.signal,
			});
		} finally {
			clearTimeout(requestTimer);
		}
	} catch {
		// The claim page deliberately has one indistinguishable destination for every outcome.
	} finally {
		dependencies.replace("/blog/");
	}
}
