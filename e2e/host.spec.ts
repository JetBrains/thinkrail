import { expect, test } from "@playwright/test";

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
