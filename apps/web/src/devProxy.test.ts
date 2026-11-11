import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SPEECH_SOCKET_ROUTE, USER_FONTS_ROUTE } from "@thinkrail/contracts";
import { BLOB_ROUTE, FILES_ROUTE } from "./panels/resourcePane";

test("every host route the app composes is proxied by the Vite dev server", () => {
	const config = readFileSync(fileURLToPath(new URL("../vite.config.ts", import.meta.url)), "utf8");
	for (const route of [
		"/ws",
		SPEECH_SOCKET_ROUTE,
		FILES_ROUTE,
		BLOB_ROUTE,
		USER_FONTS_ROUTE.replace(/\/$/, ""),
	]) {
		expect(config).toContain(`"${route}"`);
	}
});
