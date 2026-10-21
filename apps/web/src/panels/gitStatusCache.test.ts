import { expect, test } from "bun:test";
import { forgetGitStatus, peekGitStatus, rememberGitStatus } from "./gitStatusCache";

const status = { branch: "feature", changes: [] };

test("a remembered status is returned only for the same workspace, scope and target ref", () => {
	rememberGitStatus("ws-a", { kind: "branch" }, "main", status);
	expect(peekGitStatus("ws-a", { kind: "branch" }, "main")).toBe(status);
	expect(peekGitStatus("ws-a", { kind: "branch" }, "develop")).toBeNull();
	expect(peekGitStatus("ws-a", { kind: "uncommitted" }, "")).toBeNull();
	expect(peekGitStatus("ws-b", { kind: "branch" }, "main")).toBeNull();
});

test("commit scopes are keyed by sha and can be forgotten once the commit is gone", () => {
	rememberGitStatus("ws-a", { kind: "commit", sha: "abc" }, "", status);
	expect(peekGitStatus("ws-a", { kind: "commit", sha: "def" }, "")).toBeNull();
	forgetGitStatus("ws-a", { kind: "commit", sha: "abc" }, "");
	expect(peekGitStatus("ws-a", { kind: "commit", sha: "abc" }, "")).toBeNull();
});
