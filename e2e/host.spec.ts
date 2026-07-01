import { expect, test } from "@playwright/test";

// The e2e host is booted by `packages/server/src/dev.ts` via `bootHost` (portMode "exact" on the pinned
// port, serving the built SPA from `staticDir`). These hit its HTTP surface directly — no UI driving — so
// the shared boot path is covered against a real build, not just the unit test.
test.describe("host HTTP surface", () => {
	test("/health returns ok", async ({ request }) => {
		const res = await request.get("/health");
		expect(res.status()).toBe(200);
		expect(await res.text()).toBe("ok");
	});

	test("serves the built SPA at the root", async ({ request }) => {
		const res = await request.get("/");
		expect(res.status()).toBe(200);
		expect(res.headers()["content-type"] ?? "").toContain("text/html");
		expect((await res.text()).toLowerCase()).toContain("<!doctype html>");
	});

	test("falls back to index.html for an unknown client-side route", async ({ request }) => {
		const res = await request.get("/deep/client/route");
		expect(res.status()).toBe(200);
		expect((await res.text()).toLowerCase()).toContain("<!doctype html>");
	});
});
