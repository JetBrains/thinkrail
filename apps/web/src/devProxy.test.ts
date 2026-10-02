import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BLOB_ROUTE, FILES_ROUTE } from "./panels/resourcePane";

test("every host HTTP route the app composes is proxied by the Vite dev server", () => {
	const config = readFileSync(fileURLToPath(new URL("../vite.config.ts", import.meta.url)), "utf8");
	for (const route of ["/ws", FILES_ROUTE, BLOB_ROUTE]) {
		expect(config).toContain(`"${route}"`);
	}
});
