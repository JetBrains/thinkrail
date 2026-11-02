import { expect, test } from "bun:test";
import { spawnSupervised } from "./supervised";

const bun = process.execPath;

test("a supervised child reports its exit code and keeps a stderr tail", async () => {
	const child = spawnSupervised([bun, "-e", "console.error('boom'); process.exit(4)"]);
	expect(await child.exited).toBe(4);
	await Bun.sleep(20);
	expect(child.stderrTail()).toContain("boom");
});

test("stop kills a long-lived child and resolves on its exit", async () => {
	const child = spawnSupervised([bun, "-e", "setInterval(() => {}, 1000)"]);
	expect(child.pid).toBeGreaterThan(0);
	await child.stop();
	expect(await child.exited).toBeNull();
	await child.stop();
});

test("a failed launch is a null exit, never a throw", async () => {
	const child = spawnSupervised(["/definitely/not/a/binary"]);
	expect(await child.exited).toBeNull();
	expect(child.stderrTail().length).toBeGreaterThan(0);
	await child.stop();
});
