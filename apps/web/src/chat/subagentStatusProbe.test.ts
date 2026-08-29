import { expect, test } from "bun:test";
import { RequestError } from "@/transport";
import { probeSubagentRunStatus, type SubagentTranscriptKey } from "./subagentStatusProbe";

const KEY: SubagentTranscriptKey = {
	workspaceId: "ws-1",
	parentSessionId: "parent-1",
	childSessionId: "child-1",
};

test("passes the registry status through, including its absence", async () => {
	const seen: SubagentTranscriptKey[] = [];
	expect(
		await probeSubagentRunStatus(async (params) => {
			seen.push(params);
			return { messages: [], status: "running" as const };
		}, KEY),
	).toBe("running");
	expect(seen).toEqual([KEY]);
	expect(await probeSubagentRunStatus(async () => ({ messages: [] }), KEY)).toBeUndefined();
});

test("a permanent transcript miss reads as run-unknown, not a failure", async () => {
	expect(
		await probeSubagentRunStatus(
			() => Promise.reject(new RequestError("SUBAGENT_TRANSCRIPT_NOT_FOUND", "missing")),
			KEY,
		),
	).toBeUndefined();
});

test("transient transport failures propagate to the caller", async () => {
	await expect(
		probeSubagentRunStatus(() => Promise.reject(new Error("offline")), KEY),
	).rejects.toThrow("offline");
});
