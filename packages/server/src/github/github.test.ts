import { afterAll, afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { ghSetupProblem, githubAuthStatus, parseGhAuthStatus } from "./github";

const saved = process.env.THINKRAIL_GH_OFFLINE;
afterEach(() => {
	if (saved === undefined) delete process.env.THINKRAIL_GH_OFFLINE;
	else process.env.THINKRAIL_GH_OFFLINE = saved;
});

const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

test("THINKRAIL_GH_OFFLINE forces a disconnected status without shelling out", async () => {
	process.env.THINKRAIL_GH_OFFLINE = "1";
	expect(await githubAuthStatus()).toEqual({ connected: false });
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

async function setupProblemAfterPathRepair(ghScript: string | null): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), "trpi-gh-"));
	dirs.push(dir);
	const launchPath = join(dir, "launch-bin");
	const loginPath = join(dir, "login-bin");
	mkdirSync(launchPath);
	mkdirSync(loginPath);
	if (ghScript !== null) {
		writeFileSync(join(loginPath, "gh"), `#!/bin/sh\n${ghScript}\n`);
		chmodSync(join(loginPath, "gh"), 0o755);
	}
	const probe = join(dir, "probe.ts");
	writeFileSync(
		probe,
		`import { ghSetupProblem } from ${JSON.stringify(join(import.meta.dir, "github.ts"))};\n` +
			`process.env.PATH = ${JSON.stringify(`${loginPath}${delimiter}${launchPath}`)};\n` +
			`process.stdout.write(String(await ghSetupProblem()));\n`,
	);
	const env: Record<string, string | undefined> = { ...process.env, PATH: launchPath };
	delete env.THINKRAIL_GH_OFFLINE;
	const child = Bun.spawn([process.execPath, probe], { env, stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	expect({ code, err }).toEqual({ code: 0, err: "" });
	return out;
}

for (const [gh, problem] of [
	["exit 0", "null"],
	["exit 1", "unauthenticated"],
	[null, "missing"],
] as const) {
	test.skipIf(process.platform === "win32")(
		`ghSetupProblem reads the PATH repaired after launch: gh ${gh ?? "absent"} -> ${problem}`,
		async () => {
			expect(await setupProblemAfterPathRepair(gh)).toBe(problem);
		},
	);
}
