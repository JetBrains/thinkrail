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

type ClickTarget = {
	addEventListener(
		type: "click",
		listener: (event: Pick<Event, "isTrusted" | "preventDefault">) => void | Promise<void>,
	): void;
};

type ClaimPageControls = {
	confirmButton: (ClickTarget & { disabled: boolean }) | null;
	notNowLink: ClickTarget | null;
};

function claimIdFromSearch(search: string): string | undefined {
	const parameters = new URLSearchParams(search);
	if (parameters.size !== 1) return undefined;
	const values = parameters.getAll("id");
	return values.length === 1 && claimIdPattern.test(values[0] ?? "") ? values[0] : undefined;
}

export function mountClaimPage(
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
	controls: ClaimPageControls = {
		confirmButton: document.querySelector<HTMLButtonElement>("[data-claim-confirm]"),
		notNowLink: document.querySelector<HTMLAnchorElement>("[data-claim-decline]"),
	},
): void {
	let actionTaken = false;

	async function confirm(): Promise<void> {
		if (actionTaken) return;
		actionTaken = true;
		if (controls.confirmButton) controls.confirmButton.disabled = true;

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

	function decline(): void {
		if (actionTaken) return;
		actionTaken = true;
		dependencies.replace("/blog/");
	}

	controls.confirmButton?.addEventListener("click", async (event) => {
		event.preventDefault();
		if (!event.isTrusted) return;
		await confirm();
	});
	controls.notNowLink?.addEventListener("click", (event) => {
		event.preventDefault();
		decline();
	});
}
