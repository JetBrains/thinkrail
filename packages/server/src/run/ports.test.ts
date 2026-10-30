import { describe, expect, test } from "bun:test";
import { allocatePorts, createSerialQueue } from "./ports";

function freeExcept(occupied: number[]): (port: number) => Promise<boolean> {
	return async (port) => !occupied.includes(port);
}

const NATURAL = { PORT: 5173, API_PORT: 3100 };

describe("allocatePorts", () => {
	test("the Default workspace gets natural ports when free; a worktree scans upward from natural + 1", async () => {
		expect(
			await allocatePorts({
				natural: NATURAL,
				current: {},
				isDefaultWorkspace: true,
				workspaceLive: false,
				taken: new Set(),
				isFree: freeExcept([]),
			}),
		).toEqual({ PORT: 5173, API_PORT: 3100 });
		expect(
			await allocatePorts({
				natural: NATURAL,
				current: {},
				isDefaultWorkspace: false,
				workspaceLive: false,
				taken: new Set(),
				isFree: freeExcept([]),
			}),
		).toEqual({ PORT: 5174, API_PORT: 3101 });
	});

	test("taken ports (live elsewhere, sibling assignments) and occupied ports are skipped", async () => {
		expect(
			await allocatePorts({
				natural: NATURAL,
				current: {},
				isDefaultWorkspace: false,
				workspaceLive: false,
				taken: new Set([5174, 5175]),
				isFree: freeExcept([5176]),
			}),
		).toEqual({ PORT: 5177, API_PORT: 3101 });
		expect(
			await allocatePorts({
				natural: NATURAL,
				current: {},
				isDefaultWorkspace: true,
				workspaceLive: false,
				taken: new Set(),
				isFree: freeExcept([5173]),
			}),
		).toEqual({ PORT: 5174, API_PORT: 3100 });
	});

	test("a kept assignment is stable while the workspace is live and re-probed when idle", async () => {
		const live = await allocatePorts({
			natural: NATURAL,
			current: { PORT: 5180, API_PORT: 3105 },
			isDefaultWorkspace: false,
			workspaceLive: true,
			taken: new Set(),
			isFree: freeExcept([5180, 3105]),
		});
		expect(live).toEqual({ PORT: 5180, API_PORT: 3105 });
		const idle = await allocatePorts({
			natural: NATURAL,
			current: { PORT: 5180, API_PORT: 3105 },
			isDefaultWorkspace: false,
			workspaceLive: false,
			taken: new Set(),
			isFree: freeExcept([5180]),
		});
		expect(idle).toEqual({ PORT: 5174, API_PORT: 3105 });
	});

	test("a kept assignment that a sibling now holds is reassigned, and variables never share a port", async () => {
		expect(
			await allocatePorts({
				natural: { PORT: 5173, OTHER: 5173 },
				current: { PORT: 5180 },
				isDefaultWorkspace: false,
				workspaceLive: true,
				taken: new Set([5180]),
				isFree: freeExcept([]),
			}),
		).toEqual({ PORT: 5174, OTHER: 5175 });
	});

	test("gives up after 64 misses instead of handing out a random port", async () => {
		await expect(
			allocatePorts({
				natural: { PORT: 5173 },
				current: {},
				isDefaultWorkspace: false,
				workspaceLive: false,
				taken: new Set(),
				isFree: async () => false,
			}),
		).rejects.toMatchObject({ code: "RUN_NO_FREE_PORT" });
	});
});

describe("createSerialQueue", () => {
	test("runs tasks strictly one after another, failures included", async () => {
		const queue = createSerialQueue();
		const order: string[] = [];
		const slow = queue(async () => {
			order.push("slow:start");
			await Bun.sleep(20);
			order.push("slow:end");
			return "slow";
		});
		const failing = queue(async () => {
			order.push("failing");
			throw new Error("boom");
		});
		const fast = queue(async () => {
			order.push("fast");
			return "fast";
		});
		expect(await slow).toBe("slow");
		await expect(failing).rejects.toThrow("boom");
		expect(await fast).toBe("fast");
		expect(order).toEqual(["slow:start", "slow:end", "failing", "fast"]);
	});
});
