import { expect, test } from "bun:test";
import { pollTranscript, transcriptIsLive } from "./SubagentScreen";

test("a subagent transcript is re-read only while its run can still grow", () => {
	expect(transcriptIsLive("queued")).toBe(true);
	expect(transcriptIsLive("running")).toBe(true);
	for (const status of ["completed", "error", "aborted"] as const) {
		expect(transcriptIsLive(status)).toBe(false);
	}
	expect(transcriptIsLive(undefined)).toBe(false);
});

test("polling keeps re-reading a live run through a failed read, stops once it finishes, and drops late answers after unmount", async () => {
	const answers: Array<() => Promise<{ messages: never[]; status?: "running" | "completed" }>> = [
		async () => ({ messages: [], status: "running" }),
		async () => {
			throw new Error("dropped");
		},
		async () => ({ messages: [], status: "completed" }),
	];
	const seen: string[] = [];
	const queued: Array<() => void> = [];
	const flush = async () => {
		await Promise.resolve();
		await Promise.resolve();
	};
	pollTranscript(
		() => (answers.shift() as () => Promise<{ messages: never[] }>)(),
		{
			result: (_result, live) => seen.push(live ? "live" : "done"),
			error: (reason) => seen.push(`error:${reason}`),
		},
		(next) => {
			queued.push(next);
			return () => {};
		},
	);
	await flush();
	queued.shift()?.();
	await flush();
	queued.shift()?.();
	await flush();
	expect(seen).toEqual(["live", "error:dropped", "done"]);
	expect(queued).toHaveLength(0);

	const late: string[] = [];
	let answer = (): void => {};
	const stop = pollTranscript(
		() => new Promise((resolve) => (answer = () => resolve({ messages: [], status: "running" }))),
		{ result: () => late.push("result"), error: () => late.push("error") },
	);
	stop();
	answer();
	await flush();
	expect(late).toEqual([]);
});
