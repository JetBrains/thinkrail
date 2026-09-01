import { afterEach, expect, test } from "bun:test";
import { ghSetupProblem, ghSetupProblemFrom, githubAuthStatus, parseGhAuthStatus } from "./github";

const saved = process.env.THINKRAIL_GH_OFFLINE;
afterEach(() => {
	if (saved === undefined) delete process.env.THINKRAIL_GH_OFFLINE;
	else process.env.THINKRAIL_GH_OFFLINE = saved;
});

test("THINKRAIL_GH_OFFLINE forces a disconnected status without shelling out", async () => {
	process.env.THINKRAIL_GH_OFFLINE = "1";
	expect(await githubAuthStatus()).toEqual({ connected: false });
});

test("ghSetupProblemFrom names the missing piece: no binary, then a failed auth probe, then nothing", () => {
	expect(ghSetupProblemFrom(null, false)).toBe("missing");
	expect(ghSetupProblemFrom("/usr/local/bin/gh", false)).toBe("unauthenticated");
	expect(ghSetupProblemFrom("/usr/local/bin/gh", true)).toBeNull();
});

test("THINKRAIL_GH_OFFLINE suppresses the gh setup probe entirely", async () => {
	process.env.THINKRAIL_GH_OFFLINE = "1";
	expect(await ghSetupProblem()).toBeNull();
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
