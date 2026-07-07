import { afterEach, expect, test } from "bun:test";
import { githubAuthStatus, parseGhAuthStatus } from "./github";

const saved = process.env.THINKRAIL_GH_OFFLINE;
afterEach(() => {
	if (saved === undefined) delete process.env.THINKRAIL_GH_OFFLINE;
	else process.env.THINKRAIL_GH_OFFLINE = saved;
});

test("THINKRAIL_GH_OFFLINE forces a disconnected status without shelling out", () => {
	process.env.THINKRAIL_GH_OFFLINE = "1";
	expect(githubAuthStatus()).toEqual({ connected: false });
});

test("parseGhAuthStatus extracts the account login and token scopes", () => {
	const report = [
		"github.com",
		"  ✓ Logged in to github.com account octocat (keyring)",
		"  - Active account: true",
		"  - Git operations protocol: https",
		"  - Token: gho_************************************",
		"  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'",
	].join("\n");
	expect(parseGhAuthStatus(report)).toEqual({
		connected: true,
		login: "octocat",
		scopes: ["gist", "read:org", "repo", "workflow"],
	});
});

test("parseGhAuthStatus tolerates the older 'Logged in to … as <user>' phrasing", () => {
	expect(parseGhAuthStatus("✓ Logged in to github.com as octocat (oauth_token)")).toEqual({
		connected: true,
		login: "octocat",
	});
});
