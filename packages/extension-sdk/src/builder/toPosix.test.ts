import { describe, expect, test } from "bun:test";
import { toPosix } from "./paths";

describe("toPosix", () => {
	test("turns the Windows separator into a slash", () => {
		expect(toPosix("web\\index.tsx", "\\")).toBe("web/index.tsx");
		expect(toPosix("dist\\web.js", "\\")).toBe("dist/web.js");
	});

	test("leaves a POSIX path alone, including a literal backslash in a name", () => {
		expect(toPosix("web/index.tsx", "/")).toBe("web/index.tsx");
		expect(toPosix("web/a\\b.ts", "/")).toBe("web/a\\b.ts");
	});
});
