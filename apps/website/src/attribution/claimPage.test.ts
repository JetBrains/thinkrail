import { describe, expect, test } from "bun:test";
import { runClaimPage } from "./claimPage";
import type { BindClaimRequest } from "./protocol";

const claimId = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const journeyId = "01890f47-75a3-4d8f-9a72-4f0e35be292b";
const context: BindClaimRequest = {
	journey_id: journeyId,
	first_touch: {
		referrer_class: "direct",
		landing_content_key: "landing",
		touched_at: 1,
		policy_version: 1,
	},
	last_touch: {
		referrer_class: "internal",
		landing_content_key: "blog/index",
		touched_at: 2,
		policy_version: 1,
	},
};

function fixture(
	options: { claimSearch?: string; context?: BindClaimRequest; response?: Response } = {},
) {
	const requests: Array<{ url: string; init: RequestInit }> = [];
	const replacements: string[] = [];
	return {
		requests,
		replacements,
		dependencies: {
			readContext: () => options.context,
			async request(url: string, init: RequestInit) {
				requests.push({ url, init });
				return options.response ?? new Response(null, { status: 200 });
			},
			replace(url: string) {
				replacements.push(url);
			},
			search: options.claimSearch ?? `?id=${claimId}`,
			requestTimeoutMs: 20,
		},
	};
}

describe("attribution claim page", () => {
	test("reads stored context directly, binds at most once, and replaces without identifiers", async () => {
		const page = fixture({ context });
		await runClaimPage(page.dependencies);
		expect(page.requests).toHaveLength(1);
		expect(page.requests[0]).toEqual({
			url: `/api/attribution/claims/${claimId}/bind`,
			init: {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(context),
				credentials: "same-origin",
				redirect: "error",
				signal: expect.any(AbortSignal),
			},
		});
		expect(page.replacements).toEqual(["/blog/"]);
	});

	test.each([
		{ name: "missing acquisition context", options: {} },
		{ name: "invalid claim id", options: { context, claimSearch: "?id=bad" } },
		{
			name: "duplicate query keys",
			options: { context, claimSearch: `?id=${claimId}&id=${claimId}` },
		},
	])("does not bind with $name and still replaces", async ({ options }) => {
		const page = fixture(options);
		await runClaimPage(page.dependencies);
		expect(page.requests).toHaveLength(0);
		expect(page.replacements).toEqual(["/blog/"]);
	});

	test("never retries a failed bind", async () => {
		const page = fixture({ context, response: new Response(null, { status: 409 }) });
		await runClaimPage(page.dependencies);
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
		await runClaimPage(page.dependencies);
		expect(page.requests).toHaveLength(1);
		expect(page.replacements).toEqual(["/blog/"]);
	});
});
