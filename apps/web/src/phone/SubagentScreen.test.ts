import { expect, test } from "bun:test";
import { transcriptIsLive } from "./SubagentScreen";

test("a subagent transcript is re-read only while its run can still grow", () => {
	expect(transcriptIsLive("queued")).toBe(true);
	expect(transcriptIsLive("running")).toBe(true);
	for (const status of ["completed", "error", "aborted"] as const) {
		expect(transcriptIsLive(status)).toBe(false);
	}
	expect(transcriptIsLive(undefined)).toBe(false);
});
