import { describe, expect, test } from "bun:test";
import { marketingGrantedFromCookie, runClaimPage } from "./claimPage";
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

function fixture(
	options: {
		claimSearch?: string;
		context?: BindClaimRequest;
		readContext?: () => BindClaimRequest | undefined;
		response?: Response;
		cookie?: string;
	} = {},
) {
	const requests: Array<{ url: string; init: RequestInit }> = [];
	const replacements: string[] = [];
	let contextReads = 0;
	const dependencies = {
		marketingGranted: () =>
			marketingGrantedFromCookie(
				options.cookie ?? `CookieConsent=${encodeURIComponent("{marketing:true}")}`,
			),
		readContext() {
			contextReads += 1;
			return options.readContext ? options.readContext() : options.context;
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
	return {
		requests,
		replacements,
		dependencies,
		contextReads: () => contextReads,
	};
}

describe("attribution claim page", () => {
	test("binds on load with a granted Cookiebot cookie and navigates to the blog", async () => {
		const page = fixture({
			context,
			cookie: `CookieConsent=${encodeURIComponent("{stamp:'…',necessary:true,marketing:true,region:'…'}")}`,
		});
		await runClaimPage(page.dependencies);
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
		expect(page.replacements).toEqual(["/blog/"]);
	});

	test.each([
		{ name: "missing context", options: {} },
		{ name: "invalid context", options: { readContext: () => undefined } },
		{ name: "invalid claim id", options: { context, claimSearch: "?id=bad" } },
		{
			name: "duplicate claim ids",
			options: { context, claimSearch: `?id=${claimId}&id=${claimId}` },
		},
	])("does not bind with $name and still navigates to the blog", async ({ options }) => {
		const page = fixture(options);
		await runClaimPage(page.dependencies);
		expect(page.requests).toHaveLength(0);
		expect(page.replacements).toEqual(["/blog/"]);
	});

	test.each([
		{
			name: "marketing denied",
			cookie: `CookieConsent=${encodeURIComponent("{marketing:false}")}`,
		},
		{ name: "missing consent cookie", cookie: "" },
		{ name: "malformed consent cookie", cookie: "CookieConsent=%not-valid%" },
		{
			name: "other cookie name",
			cookie: `XCookieConsent=${encodeURIComponent("{marketing:true}")}`,
		},
		{
			name: "marketing embedded in another field name",
			cookie: `CookieConsent=${encodeURIComponent("{notmarketing:true}")}`,
		},
	])("does not read or bind with $name consent and still navigates to the blog", async ({
		cookie,
	}) => {
		const page = fixture({ context, cookie });
		await runClaimPage(page.dependencies);
		expect(page.contextReads()).toBe(0);
		expect(page.requests).toHaveLength(0);
		expect(page.replacements).toEqual(["/blog/"]);
	});

	test("binds when Cookiebot records that consent is not required", async () => {
		const page = fixture({ context, cookie: "CookieConsent=-1" });
		await runClaimPage(page.dependencies);
		expect(page.contextReads()).toBe(1);
		expect(page.requests).toHaveLength(1);
		expect(page.replacements).toEqual(["/blog/"]);
	});

	test("matches CookieConsent as a complete cookie name", () => {
		expect(
			marketingGrantedFromCookie(
				`Other=1; CookieConsent=${encodeURIComponent("{marketing:true}")}; Final=2`,
			),
		).toBe(true);
		expect(
			marketingGrantedFromCookie(`XCookieConsent=${encodeURIComponent("{marketing:true}")}`),
		).toBe(false);
	});

	test("a context read failure does not bind and still navigates to the blog", async () => {
		const page = fixture({
			readContext() {
				throw new Error("storage unavailable");
			},
		});
		await runClaimPage(page.dependencies);
		expect(page.requests).toHaveLength(0);
		expect(page.replacements).toEqual(["/blog/"]);
	});

	test("a failed bind is attempted once and still navigates to the blog", async () => {
		const page = fixture({ context, response: new Response(null, { status: 409 }) });
		await runClaimPage(page.dependencies);
		expect(page.requests).toHaveLength(1);
		expect(page.replacements).toEqual(["/blog/"]);
	});

	test("a timed-out bind still navigates to the blog", async () => {
		const page = fixture({ context });
		page.dependencies.request = async (url, init) => {
			page.requests.push({ url, init });
			return await new Promise<Response>((_resolve, reject) => {
				init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
			});
		};
		await runClaimPage(page.dependencies);
		expect(page.requests).toHaveLength(1);
		expect(page.replacements).toEqual(["/blog/"]);
	});
});
