import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const windows = test.skipIf(process.platform !== "win32");
const fixture = fileURLToPath(new URL("./windowsConsole.fixture.ts", import.meta.url));

function scenario(mode: string): unknown {
	const result = Bun.spawnSync([process.execPath, fixture, mode], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		windowsHide: true,
		timeout: 10_000,
	});
	expect(result.stderr.toString()).toBe("");
	expect(result.exitCode).toBe(0);
	return JSON.parse(result.stdout.toString());
}

windows("detached control gives an ordinary grandchild its own console", () => {
	expect(scenario("detached-control")).toMatchObject({
		driver: { window: null, codePage: 0, visible: false },
		child: {
			self: { window: null, codePage: 0, visible: false },
			grandchild: { window: expect.any(Number), codePage: expect.any(Number) },
		},
	});
});

windows("bounded children preserve a nonvisual console for ordinary grandchildren", () => {
	const result = scenario("bounded");
	expect(result).toMatchObject({
		driver: { window: null, codePage: 0, visible: false },
		child: {
			self: { window: null, visible: false },
			grandchild: { window: null, visible: false },
		},
	});
	expect(result).not.toMatchObject({ child: { self: { codePage: 0 } } });
	expect(result).not.toMatchObject({ child: { grandchild: { codePage: 0 } } });
});
