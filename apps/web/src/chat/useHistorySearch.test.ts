import { expect, test } from "bun:test";
import type { PromptHit } from "@thinkrail/contracts";
import { jumpTarget } from "./useHistorySearch";

const hit: PromptHit = {
	text: "deploy the docs",
	timestamp: 10,
	sessionId: "session-1",
	workspaceId: "workspace-1",
	projectId: "project-1",
	cwd: "/project/worktree",
	messageIndex: 3,
	anchorText: "deploy the docs",
};

test("history hits produce only the reveal-message location variant", () => {
	expect(jumpTarget(hit)).toEqual({
		kind: "reveal-message",
		workspaceId: "workspace-1",
		projectId: "project-1",
		sessionId: "session-1",
		messageIndex: 3,
		anchorText: "deploy the docs",
	});
});

test("history hits without a complete durable location do not navigate", () => {
	expect(jumpTarget({ ...hit, workspaceId: undefined })).toBeNull();
	expect(jumpTarget({ ...hit, messageIndex: undefined })).toBeNull();
});
