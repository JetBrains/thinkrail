import { afterAll, afterEach, expect, jest, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { GhSetupProblem, GithubAuthStatus } from "@thinkrail/contracts";
import {
	ghAuthFromJson,
	ghAuthFromText,
	ghSetupProblem,
	githubAuthStatus,
	parseGhAuthStatus,
} from "./github";

const ENV_KEYS = ["THINKRAIL_GH_OFFLINE", "PATH", "CLICOLOR_FORCE", "GH_FORCE_TTY"];
const savedEnv = ENV_KEYS.map((key) => [key, process.env[key]] as const);
const savedPath = process.env.PATH;
afterEach(() => {
	for (const [key, value] of savedEnv) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const hostEntry = (fields: Record<string, unknown>) =>
	JSON.stringify({
		hosts: {
			"github.com": [
				{
					active: true,
					host: "github.com",
					login: "octocat",
					tokenSource: "keyring",
					gitProtocol: "https",
					...fields,
				},
			],
		},
	});
const SIGNED_IN_JSON = hostEntry({ state: "success", scopes: "gist, read:org, repo, workflow" });
const OFFLINE_JSON = hostEntry({
	state: "error",
	error:
		'Get "https://api.github.com/": proxyconnect tcp: dial tcp 127.0.0.1:9: connect: connection refused',
});
const REVOKED_JSON = hostEntry({
	state: "error",
	error: "HTTP 401: Bad credentials (https://api.github.com/)",
});
const NO_ACCOUNT_JSON = '{"hosts":{}}';
const NOT_LOGGED_IN = "You are not logged into any GitHub hosts. To log in, run: gh auth login\n";
const TOKEN_INVALID = [
	"github.com",
	"  X Failed to log in to github.com account octocat (keyring)",
	"  - Active account: true",
	"  - The token in keyring is invalid.",
	"",
].join("\n");
const SIGNED_IN: GithubAuthStatus = {
	connected: true,
	login: "octocat",
	scopes: ["gist", "read:org", "repo", "workflow"],
};
const SIGNED_OUT: GithubAuthStatus = { connected: false };
const UNVERIFIED: GithubAuthStatus = { connected: false, unverified: true };

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

test("ghAuthFromJson: a refused token refresh signs out; gh's timeout, a 5xx, a GH_TOKEN 401, no active account or non-JSON is unverified", () => {
	expect(ghAuthFromJson(hostEntry({ state: "refresh_expired" }))).toEqual(SIGNED_OUT);
	expect(
		ghAuthFromJson(hostEntry({ state: "timeout", error: "context deadline exceeded" })),
	).toEqual(UNVERIFIED);
	expect(
		ghAuthFromJson(
			hostEntry({ state: "error", error: "HTTP 502: Bad Gateway (https://api.github.com/)" }),
		),
	).toEqual(UNVERIFIED);
	expect(
		ghAuthFromJson(
			hostEntry({
				state: "error",
				tokenSource: "GH_TOKEN",
				error: "non-200 OK status code: 401 Unauthorized",
			}),
		),
	).toEqual(UNVERIFIED);
	expect(ghAuthFromJson(hostEntry({ state: "success", active: false }))).toEqual(UNVERIFIED);
	expect(ghAuthFromJson("not json")).toEqual(UNVERIFIED);
});

test("ghAuthFromText reads every gh wording of 'no github.com account' as signed out", () => {
	for (const err of [
		NOT_LOGGED_IN,
		'Hostname "github.com" not found among authenticated GitHub hosts\n',
		"You are not logged into any accounts on github.com\n",
	]) {
		expect(ghAuthFromText({ ok: false, out: "", err })).toEqual(SIGNED_OUT);
	}
});

test("ghAuthFromText: on exit 0 the first account line, the active one, decides", () => {
	const okLine =
		"  ✓ Logged in to github.com account octocat (keyring)\n  - Active account: true\n";
	const failedLine =
		"  X Failed to log in to github.com account other (keyring)\n  - Active account: false\n";
	expect(ghAuthFromText({ ok: true, out: `github.com\n${okLine}${failedLine}`, err: "" })).toEqual({
		connected: true,
		login: "octocat",
	});
	expect(
		ghAuthFromText({
			ok: true,
			out: `${TOKEN_INVALID}  ✓ Logged in to github.com account other (keyring)\n`,
			err: "",
		}),
	).toEqual(UNVERIFIED);
	expect(
		ghAuthFromText({
			ok: true,
			out: `github.com\n  X Timeout trying to log in to github.com account octocat (keyring)\n${okLine}`,
			err: "",
		}),
	).toEqual(UNVERIFIED);
});

type GhReply = { code: number; out?: string; err?: string };

const CAT = Bun.which("cat");
const COLOR_WHEN_FORCED = `{ [ -n "$GH_FORCE_TTY" ] || { [ -n "$CLICOLOR_FORCE" ] && [ "$CLICOLOR_FORCE" != 0 ]; }; } && printf '\\033[1;38m'; `;

function writeFakeGh(dir: string, json: GhReply, text: GhReply, githubOnly?: GhReply): void {
	const reply = (name: string, { code, out = "", err = "" }: GhReply) => {
		writeFileSync(join(dir, `${name}.out`), out);
		writeFileSync(join(dir, `${name}.err`), err);
		return `${COLOR_WHEN_FORCED}"${CAT}" "${dir}/${name}.out"; "${CAT}" "${dir}/${name}.err" >&2; exit ${code}`;
	};
	writeFileSync(
		join(dir, "gh"),
		`#!/bin/sh\ncase " $* " in *" --json "*) ${reply("json", json)};;${githubOnly ? ` *" --hostname github.com "*) ${reply("host", githubOnly)};;` : ""} esac\n${reply("text", text)}\n`,
	);
	chmodSync(join(dir, "gh"), 0o755);
}

function fakeGhDir(json: GhReply, text: GhReply, githubOnly?: GhReply): string {
	const dir = mkdtempSync(join(tmpdir(), "trpi-gh-"));
	dirs.push(dir);
	writeFakeGh(dir, json, text, githubOnly);
	return dir;
}

const UNKNOWN_JSON_FLAG = {
	code: 1,
	err: "unknown flag: --json\n\nUsage:  gh auth status [flags]\n",
};
const SHIM_WITHOUT_VERSION = {
	code: 126,
	err: "No version is set for command gh\nConsider adding one of the following versions in your config file at /home/u/.tool-versions\ngh 2.83.1\n",
};

const OLD_SIGNED_IN = "github.com\n  ✓ Logged in to github.com as octocat (oauth_token)\n";
const OLD_STALE_HOST = "ghe.example.com\n  X ghe.example.com: authentication failed\n";

const PROBE_CASES: [string, GhReply, GhReply, GhSetupProblem | null, GithubAuthStatus, GhReply?][] =
	[
		[
			"gh can't reach GitHub",
			{ code: 0, out: OFFLINE_JSON },
			{ code: 1, err: TOKEN_INVALID },
			null,
			UNVERIFIED,
		],
		[
			"gh has no github.com account",
			{ code: 0, out: NO_ACCOUNT_JSON, err: NOT_LOGGED_IN },
			{ code: 1, err: NOT_LOGGED_IN },
			"unauthenticated",
			SIGNED_OUT,
		],
		[
			"GitHub rejects the stored token",
			{ code: 0, out: REVOKED_JSON },
			{ code: 1, err: TOKEN_INVALID },
			"unauthenticated",
			SIGNED_OUT,
		],
		[
			"only another host's token is stale",
			{ code: 0, out: SIGNED_IN_JSON },
			{
				code: 1,
				err: "ghe.example.com\n  X Failed to log in to ghe.example.com account octocat (keyring)\n",
			},
			null,
			SIGNED_IN,
		],
		[
			"gh before 2.81 can't reach GitHub",
			UNKNOWN_JSON_FLAG,
			{ code: 1, err: TOKEN_INVALID },
			null,
			UNVERIFIED,
		],
		[
			"gh before 2.81 has no account",
			UNKNOWN_JSON_FLAG,
			{
				code: 1,
				err: "You are not logged into any GitHub hosts. Run gh auth login to authenticate.\n",
			},
			"unauthenticated",
			SIGNED_OUT,
		],
		[
			"gh before 2.81 is signed in",
			UNKNOWN_JSON_FLAG,
			{
				code: 0,
				out: "github.com\n  ✓ Logged in to github.com as octocat (oauth_token)\n  ✓ Token scopes: gist, repo\n",
			},
			null,
			{ connected: true, login: "octocat", scopes: ["gist", "repo"] },
		],
		[
			"gh before 2.81 has a stale token only on another host",
			UNKNOWN_JSON_FLAG,
			{ code: 1, err: `${OLD_SIGNED_IN}\n${OLD_STALE_HOST}` },
			null,
			{ connected: true, login: "octocat" },
			{ code: 0, out: OLD_SIGNED_IN },
		],
		[
			"gh 2.40 to 2.53 exits 0 after a failed check",
			UNKNOWN_JSON_FLAG,
			{ code: 0, out: TOKEN_INVALID },
			null,
			UNVERIFIED,
		],
		[
			"a version manager shim has no gh version set",
			SHIM_WITHOUT_VERSION,
			SHIM_WITHOUT_VERSION,
			null,
			UNVERIFIED,
		],
	];

for (const [name, json, text, problem, status, githubOnly] of PROBE_CASES) {
	test.skipIf(process.platform === "win32")(
		`${name}: Open PR gets ${problem}, Settings gets ${JSON.stringify(status)}`,
		async () => {
			delete process.env.THINKRAIL_GH_OFFLINE;
			process.env.PATH = `${fakeGhDir(json, text, githubOnly)}${delimiter}${savedPath}`;
			expect(await ghSetupProblem()).toBe(problem);
			expect(await githubAuthStatus()).toEqual(status);
		},
	);
}

for (const name of ["CLICOLOR_FORCE", "GH_FORCE_TTY"]) {
	test.skipIf(process.platform === "win32")(
		`${name}=1 in the host env doesn't color gh's JSON into an unverified answer`,
		async () => {
			delete process.env.THINKRAIL_GH_OFFLINE;
			process.env[name] = "1";
			process.env.PATH = `${fakeGhDir({ code: 0, out: SIGNED_IN_JSON }, { code: 1, err: TOKEN_INVALID })}${delimiter}${savedPath}`;
			expect(await githubAuthStatus()).toEqual(SIGNED_IN);
		},
	);
}

test.skipIf(process.platform === "win32")(
	"a JSON probe that runs out of budget is unverified and not retried in text form",
	async () => {
		const dir = mkdtempSync(join(tmpdir(), "trpi-gh-"));
		dirs.push(dir);
		writeFileSync(
			join(dir, "gh"),
			`#!/bin/sh\ncase " $* " in *" --json "*) exec sleep 30;; esac\necho "${NOT_LOGGED_IN.trim()}" >&2; exit 1\n`,
		);
		chmodSync(join(dir, "gh"), 0o755);
		delete process.env.THINKRAIL_GH_OFFLINE;
		process.env.PATH = `${dir}${delimiter}${savedPath}`;
		jest.useFakeTimers();
		try {
			const status = githubAuthStatus();
			jest.runOnlyPendingTimers();
			jest.useRealTimers();
			expect(await status).toEqual(UNVERIFIED);
		} finally {
			jest.useRealTimers();
		}
	},
);

test("a gh that can't launch: Open PR gets missing, Settings gets a plain sign-out", async () => {
	const empty = mkdtempSync(join(tmpdir(), "trpi-gh-"));
	dirs.push(empty);
	delete process.env.THINKRAIL_GH_OFFLINE;
	process.env.PATH = empty;
	expect(await ghSetupProblem()).toBe("missing");
	expect(await githubAuthStatus()).toEqual(SIGNED_OUT);
});

async function setupProblemAfterPathRepair(
	gh: readonly [GhReply, GhReply] | null,
): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), "trpi-gh-"));
	dirs.push(dir);
	const launchPath = join(dir, "launch-bin");
	const loginPath = join(dir, "login-bin");
	mkdirSync(launchPath);
	mkdirSync(loginPath);
	if (gh !== null) writeFakeGh(loginPath, ...gh);
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

for (const [name, gh, problem] of [
	[
		"signed in",
		[
			{ code: 0, out: SIGNED_IN_JSON },
			{ code: 0, out: "github.com\n  ✓ Logged in to github.com account octocat (keyring)\n" },
		],
		"null",
	],
	[
		"signed out",
		[
			{ code: 0, out: NO_ACCOUNT_JSON },
			{ code: 1, err: NOT_LOGGED_IN },
		],
		"unauthenticated",
	],
	["absent", null, "missing"],
] as const) {
	test.skipIf(process.platform === "win32")(
		`ghSetupProblem reads the PATH repaired after launch: gh ${name} -> ${problem}`,
		async () => {
			expect(await setupProblemAfterPathRepair(gh)).toBe(problem);
		},
	);
}
