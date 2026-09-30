import { readStoredAttributionContext } from "./browserStorage";
import { type BindClaimRequest, claimIdPattern } from "./protocol";

const bindTimeoutMs = 1_500;

export function marketingGrantedFromCookie(cookieHeader: string): boolean {
	const cookie = cookieHeader
		.split(";")
		.map((pair) => pair.trim())
		.find((pair) => {
			const separator = pair.indexOf("=");
			return separator >= 0 && pair.slice(0, separator).trim() === "CookieConsent";
		});
	if (cookie === undefined) return false;

	const separator = cookie.indexOf("=");
	let value: string;
	try {
		value = decodeURIComponent(cookie.slice(separator + 1));
	} catch {
		return false;
	}
	if (value === "-1") return true;
	return /(?:^|[{,])\s*marketing\s*:\s*true\s*(?:[,}]|$)/.test(value);
}

type ClaimPageDependencies = {
	marketingGranted(): boolean;
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
		marketingGranted() {
			return marketingGrantedFromCookie(typeof document === "undefined" ? "" : document.cookie);
		},
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
		if (claimId === undefined || !dependencies.marketingGranted()) return;
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
				referrerPolicy: "no-referrer",
				signal: abortController.signal,
			});
		} finally {
			clearTimeout(requestTimer);
		}
	} catch {
		return;
	} finally {
		dependencies.replace("/blog/");
	}
}
