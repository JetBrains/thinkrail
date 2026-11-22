import { afterEach, expect, spyOn, test } from "bun:test";
import * as transport from "../transport";
import { setInstanceTokenForTests } from "../transport";
import { resourceBytesUrl } from "./resourcePane";

const base = spyOn(transport, "getTransport").mockReturnValue({
	httpBase: () => "http://127.0.0.1:24242",
} as ReturnType<typeof transport.getTransport>);

afterEach(() => setInstanceTokenForTests(undefined));

test("a file URL carries the per-instance token", () => {
	setInstanceTokenForTests("tok-123");
	expect(resourceBytesUrl("ws", "src/a.ts")).toBe(
		"http://127.0.0.1:24242/files/ws/src/a.ts?token=tok-123",
	);
});

test("a blob URL carries the per-instance token", () => {
	setInstanceTokenForTests("tok-123");
	expect(resourceBytesUrl("ws", "src/a.ts", "a".repeat(40))).toBe(
		`http://127.0.0.1:24242/blob/ws/${"a".repeat(40)}/src/a.ts?token=tok-123`,
	);
});

test("without a token the URL is left unchanged", () => {
	setInstanceTokenForTests(null);
	expect(resourceBytesUrl("ws", "src/a.ts")).toBe("http://127.0.0.1:24242/files/ws/src/a.ts");
	base.mockRestore();
});
