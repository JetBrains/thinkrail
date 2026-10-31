import { expect, test } from "bun:test";
import {
	WORKSPACE_CREATE_CLEANUP_TIMEOUT_MS,
	WORKSPACE_CREATE_GIT_TIMEOUT_MS,
	WORKSPACE_CREATE_REQUEST_TIMEOUT_MS,
} from "./workspaceTimeouts";

test("workspace.create request budget leaves room for checkout, cleanup, fetch, and reply", () => {
	expect(WORKSPACE_CREATE_REQUEST_TIMEOUT_MS).toBeGreaterThan(
		WORKSPACE_CREATE_GIT_TIMEOUT_MS + WORKSPACE_CREATE_CLEANUP_TIMEOUT_MS + 2 * 60_000,
	);
});
