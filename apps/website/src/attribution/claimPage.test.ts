import { describe, expect, test } from "bun:test";
import { mountClaimPage } from "./claimPage";
import type { BindClaimRequest } from "./protocol";

const claimId = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const journeyId = "01890f47-75a3-4d8f-9a72-4f0e35be292b";
const context: BindClaimRequest = {
	journey_id: journeyId,
	first_touch: {
		referrer_class: "direct",
		touched_at: 1,
		policy_version: 1,
	},
	last_touch: {
		referrer_class: "internal",
		touched_at: 2,
		policy_version: 1,
	},
};

type ClickEvent = Pick<Event, "isTrusted" | "preventDefault">;
type ClickListener = (event: ClickEvent) => void | Promise<void>;

class FakeClickTarget {
	private listeners: ClickListener[] = [];

	addEventListener(type: "click", listener: ClickListener): void {
		if (type !== "click") throw new Error(`Unexpected event: ${type}`);
		this.listeners.push(listener);
	}

	async activate(isTrusted = true): Promise<void> {
		let defaultPrevented = false;
		const event: ClickEvent = {
			isTrusted,
			preventDefault() {
				defaultPrevented = true;
			},
		};
		await Promise.all(this.listeners.map((listener) => listener(event)));
		expect(defaultPrevented).toBe(true);
	}
}

class FakeConfirmButton extends FakeClickTarget {
	disabled = false;

	override async activate(isTrusted = true): Promise<void> {
		if (this.disabled) return;
		await super.activate(isTrusted);
	}
}

function fixture(
	options: { claimSearch?: string; context?: BindClaimRequest; response?: Response } = {},
) {
	const requests: Array<{ url: string; init: RequestInit }> = [];
	const replacements: string[] = [];
	let contextReads = 0;
	const confirmation = new FakeConfirmButton();
	const notNow = new FakeClickTarget();
	const dependencies = {
		readContext() {
			contextReads += 1;
			return options.context;
		},
		async request(url: string, init: RequestInit) {
			requests.push({ url, init });
			return options.response ?? new Response(null, { status: 200 });
		},
		replace(url: string) {
			replacements.push(url);
		},
		search: options.claimSearch ?? `?id=${claimId}`,
		requestTimeoutMs: 20,
	};
	mountClaimPage(dependencies, { confirmButton: confirmation, notNowLink: notNow });
	return {
		requests,
		replacements,
		dependencies,
		confirmation,
		notNow,
		contextReads: () => contextReads,
	};
}

describe("attribution claim page", () => {
	test("mounting does not read context or bind", () => {
		const page = fixture({ context });
		expect(page.contextReads()).toBe(0);
		expect(page.requests).toHaveLength(0);
		expect(page.replacements).toHaveLength(0);
	});

	test("synthetic activation does not read context or bind", async () => {
		const page = fixture({ context });
		await page.confirmation.activate(false);
		expect(page.contextReads()).toBe(0);
		expect(page.requests).toHaveLength(0);
		expect(page.replacements).toHaveLength(0);
	});

	test("confirmation reads context and binds at most once before replacing without identifiers", async () => {
		const page = fixture({ context });
		await Promise.all([page.confirmation.activate(), page.confirmation.activate()]);
		expect(page.contextReads()).toBe(1);
		expect(page.requests).toHaveLength(1);
		expect(page.requests[0]).toEqual({
			url: `/api/attribution/claims/${claimId}/bind`,
			init: {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(context),
				credentials: "same-origin",
				redirect: "error",
				referrerPolicy: "no-referrer",
				signal: expect.any(AbortSignal),
			},
		});
		expect(page.confirmation.disabled).toBe(true);
		expect(page.replacements).toEqual(["/blog/"]);
	});

	test("Not now never reads context or binds and replaces the location", async () => {
		const page = fixture({ context });
		await page.notNow.activate();
		expect(page.contextReads()).toBe(0);
		expect(page.requests).toHaveLength(0);
		expect(page.replacements).toEqual(["/blog/"]);
		await page.confirmation.activate();
		expect(page.requests).toHaveLength(0);
		expect(page.replacements).toEqual(["/blog/"]);
	});

	test.each([
		{ name: "missing acquisition context", options: {}, expectedContextReads: 1 },
		{
			name: "invalid claim id",
			options: { context, claimSearch: "?id=bad" },
			expectedContextReads: 0,
		},
		{
			name: "duplicate query keys",
			options: { context, claimSearch: `?id=${claimId}&id=${claimId}` },
			expectedContextReads: 0,
		},
	])("does not bind with $name and replaces after confirmation", async ({
		options,
		expectedContextReads,
	}) => {
		const page = fixture(options);
		await page.confirmation.activate();
		expect(page.contextReads()).toBe(expectedContextReads);
		expect(page.requests).toHaveLength(0);
		expect(page.replacements).toEqual(["/blog/"]);
	});

	test("never retries a failed bind", async () => {
		const page = fixture({ context, response: new Response(null, { status: 409 }) });
		await page.confirmation.activate();
		expect(page.requests).toHaveLength(1);
		expect(page.replacements).toEqual(["/blog/"]);
	});

	test("bounds a stalled bind before replacing", async () => {
		const page = fixture({ context });
		page.dependencies.request = async (_url, init) => {
			page.requests.push({ url: _url, init });
			return await new Promise<Response>((_resolve, reject) => {
				init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
			});
		};
		await page.confirmation.activate();
		expect(page.requests).toHaveLength(1);
		expect(page.replacements).toEqual(["/blog/"]);
	});
});
