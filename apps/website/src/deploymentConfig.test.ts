import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")) as {
	d1_databases: Array<{ binding: string }>;
	env: { preview: { d1_databases: unknown[] } };
};

describe("Wrangler deployment configuration", () => {
	it("keeps ATTRIBUTION_DB in production and removes D1 from previews", () => {
		expect(config.d1_databases.map(({ binding }) => binding)).toContain("ATTRIBUTION_DB");
		expect(config.env.preview.d1_databases).toEqual([]);
	});
});
