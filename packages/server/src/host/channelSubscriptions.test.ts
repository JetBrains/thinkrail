import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

async function sourceFiles(): Promise<string[]> {
	const files: string[] = [];
	for await (const path of new Bun.Glob("**/*.ts").scan({ cwd: root })) {
		if (!path.endsWith(".test.ts")) files.push(join(root, path));
	}
	return files;
}

test("every channel the host broadcasts is one every socket subscribes to at open", async () => {
	const published = new Set<string>();
	for (const file of await sourceFiles()) {
		for (const match of readFileSync(file, "utf8").matchAll(/\.publish\(\s*WS_CHANNELS\.(\w+)/g)) {
			published.add(match[1] ?? "");
		}
	}
	const subscribed = new Set(
		[
			...readFileSync(join(root, "host/server.ts"), "utf8").matchAll(
				/ws\.subscribe\(WS_CHANNELS\.(\w+)\)/g,
			),
		].map((match) => match[1] ?? ""),
	);
	expect(published.size).toBeGreaterThan(10);
	expect([...published].filter((channel) => !subscribed.has(channel))).toEqual([]);
});
