import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STORE_DIR } from "pi-todos/core";
import { listStoredPlans } from "./plans";

const root = mkdtempSync(join(tmpdir(), "thinkrail-plans-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function writePlan(sessionId: string, title: string, mtime: number): void {
	const dir = join(root, STORE_DIR);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${sessionId}.json`);
	writeFileSync(
		file,
		JSON.stringify({
			todos: [
				{ id: "t1", title, status: "pending", origin: "agent", createdAt: "", updatedAt: "" },
			],
			groups: [],
		}),
	);
	utimesSync(file, mtime, mtime);
}

describe("listStoredPlans", () => {
	test("lists a root's plans, skips sidecars, and parses a plan again only when it changed", () => {
		writePlan("s1", "first", 1_000);
		writeFileSync(join(root, STORE_DIR, "s1.baselines.json"), "{}");
		const [plan] = listStoredPlans(root);
		expect(listStoredPlans(root).map((stored) => stored.sessionId)).toEqual(["s1"]);
		const read = plan?.read();
		expect(read?.todos[0]?.title).toBe("first");
		expect(listStoredPlans(root)[0]?.read()).toBe(read);

		writePlan("s1", "second", 2_000);
		expect(listStoredPlans(root)[0]?.read().todos[0]?.title).toBe("second");
	});

	test("a root without plans lists none", () => {
		expect(listStoredPlans(join(root, "missing"))).toEqual([]);
	});
});
