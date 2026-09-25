import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const shellInstaller = join(repositoryRoot, "install.sh");
const powershellInstaller = join(repositoryRoot, "install.ps1");
const roots: string[] = [];
const binaryBody = "controlled thinkrail artifact\n";
const binaryHash = createHash("sha256").update(binaryBody).digest("hex");
const powershell = Bun.which("powershell.exe") ?? Bun.which("pwsh");

interface Fixture {
	root: string;
	home: string;
	prefix: string;
	fakeBin: string;
	curlLog: string;
}

interface ScriptResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

function shellPath(path: string): string {
	const slash = path.replace(/\\/g, "/");
	const drive = slash.match(/^([A-Za-z]):\/(.*)$/);
	return drive ? `/${drive[1]?.toLowerCase()}/${drive[2]}` : slash;
}

function makeFixture(): Fixture {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-installer-test-"));
	roots.push(root);
	const home = join(root, "home");
	const prefix = join(root, "prefix");
	const fakeBin = join(root, "fake-bin");
	mkdirSync(home, { recursive: true });
	mkdirSync(fakeBin, { recursive: true });
	writeTool(
		fakeBin,
		"uname",
		`if [ "\${1:-}" = "-m" ]; then printf '%s\\n' "\${FAKE_UNAME_M:-x86_64}"; else printf '%s\\n' "\${FAKE_UNAME_S:-Linux}"; fi\n`,
	);
	writeTool(
		fakeBin,
		"mktemp",
		`last=""
for arg in "$@"; do last="$arg"; done
case "$last" in
    *X) ;;
    *X*) printf 'BSD mktemp requires trailing Xs: %s\\n' "$last" >&2; exit 91 ;;
esac
exec /usr/bin/mktemp "$@"
`,
	);
	writeTool(
		fakeBin,
		"curl",
		`out=""
url=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        -o) out="$2"; shift 2 ;;
        *) url="$1"; shift ;;
    esac
done
printf '%s\\n' "$url" >> "$FAKE_CURL_LOG"
case "$url" in
    https://api.github.com/*)
        printf '%s\\n' "$FAKE_API_BODY"
        ;;
    */SHA256SUMS)
        printf '%s  %s\\n' "$FAKE_BINARY_HASH" "$FAKE_ASSET_NAME" > "$out"
        ;;
    https://github.com/*/releases/download/*)
        printf '%s' "$FAKE_BINARY_BODY" > "$out"
        ;;
    *)
        printf 'unexpected URL: %s\\n' "$url" >&2
        exit 97
        ;;
esac
`,
	);
	writeTool(
		fakeBin,
		"cygpath",
		`mode="$1"
shift
[ "\${1:-}" = "--" ] && shift
value="$1"
case "$mode" in
    -u)
        if [ "$value" = "$USERPROFILE" ]; then
            printf '%s\\n' "$FAKE_USERPROFILE_POSIX"
        else
            printf '%s\\n' "$value"
        fi
        ;;
    -m) printf '%s\\n' "$FAKE_NATIVE_PREFIX" ;;
    *) exit 2 ;;
esac
`,
	);
	return { root, home, prefix, fakeBin, curlLog: join(root, "curl.log") };
}

function writeTool(directory: string, name: string, body: string): void {
	const path = join(directory, name);
	writeFileSync(path, `#!/usr/bin/env bash\n${body}`);
	chmodSync(path, 0o755);
}

function runInstaller(
	fixture: Fixture,
	args: readonly string[],
	overrides: Record<string, string | undefined> = {},
): ScriptResult {
	const fakeBin = shellPath(fixture.fakeBin);
	const home = shellPath(fixture.home);
	const assetName = overrides.FAKE_ASSET_NAME ?? "thinkrail-linux-x64";
	const child = Bun.spawnSync(
		[
			"bash",
			"-c",
			'export PATH="$1:$PATH"; shift; exec bash "$@"',
			"installer-test",
			fakeBin,
			shellPath(shellInstaller),
			...args,
		],
		{
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				HOME: home,
				SHELL: "/bin/bash",
				FAKE_UNAME_S: "Linux",
				FAKE_UNAME_M: "x86_64",
				FAKE_API_BODY: '{"tag_name":"v1.2.3"}',
				FAKE_ASSET_NAME: assetName,
				FAKE_BINARY_BODY: binaryBody,
				FAKE_BINARY_HASH: binaryHash,
				FAKE_CURL_LOG: shellPath(fixture.curlLog),
				...overrides,
			},
		},
	);
	return {
		exitCode: child.exitCode,
		stdout: child.stdout.toString(),
		stderr: child.stderr.toString(),
	};
}

function curlRequests(fixture: Fixture): string[] {
	if (!existsSync(fixture.curlLog)) return [];
	return readFileSync(fixture.curlLog, "utf8").trim().split("\n").filter(Boolean);
}

function runPowerShellInstaller(
	fixture: Fixture,
	channel: string,
	version: string,
	tag = "v1.2.3",
	prefix = "C:/isolated/thinkrail",
): ScriptResult {
	if (!powershell) throw new Error("PowerShell is unavailable");
	const wrapper = join(fixture.root, "invoke-installer.ps1");
	const networkLog = join(fixture.root, "powershell-network.log");
	writeFileSync(
		wrapper,
		`function global:Invoke-RestMethod {
    Add-Content -LiteralPath $env:FAKE_NETWORK_LOG -Value "api"
    return [pscustomobject]@{ tag_name = $env:FAKE_TAG }
}
function global:Invoke-WebRequest {
    param([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile)
    Add-Content -LiteralPath $env:FAKE_NETWORK_LOG -Value ("artifact:" + $Uri)
    throw "controlled artifact stop"
}
& $env:THINKRAIL_INSTALLER -Channel $env:TEST_CHANNEL -Version $env:TEST_VERSION -Prefix $env:TEST_PREFIX -NoModifyPath
`,
	);
	const child = Bun.spawnSync(
		[powershell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", wrapper],
		{
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				OS: "Windows_NT",
				THINKRAIL_INSTALLER: powershellInstaller,
				TEST_CHANNEL: channel,
				TEST_VERSION: version,
				TEST_PREFIX: prefix,
				FAKE_TAG: tag,
				FAKE_NETWORK_LOG: networkLog,
			},
		},
	);
	return {
		exitCode: child.exitCode,
		stdout: child.stdout.toString(),
		stderr: child.stderr.toString(),
	};
}

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("install.sh validation", () => {
	test.each([
		[["--channel"], "requires a value"],
		[["--prefix="], "requires a value"],
		[["--version", "v1.2.3"], "Invalid version"],
		[
			["--channel", "stable", "--version", "1.2.3-nightly.4"],
			"does not belong to the stable channel",
		],
		[["--channel", "nightly", "--version", "1.2.3"], "does not belong to the nightly channel"],
	])("rejects %j before network access", (args, message) => {
		const fixture = makeFixture();
		const result = runInstaller(fixture, args);
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain(message);
		expect(curlRequests(fixture)).toEqual([]);
	});

	test("reports a release response without a usable tag before artifact download", () => {
		const fixture = makeFixture();
		const result = runInstaller(fixture, ["--channel", "nightly"], {
			FAKE_API_BODY: '{"tag_name":"v1.2.3"}',
		});
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("Failed to resolve a nightly release");
		expect(curlRequests(fixture)).toHaveLength(1);
		expect(curlRequests(fixture)[0]).toContain("api.github.com");
	});

	test("rejects a resolved tag from the wrong channel before artifact download", () => {
		const fixture = makeFixture();
		const result = runInstaller(fixture, ["--channel", "stable"], {
			FAKE_API_BODY: '{"tag_name":"v1.2.3-nightly.4"}',
		});
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("Invalid resolved tag for the stable channel");
		expect(curlRequests(fixture)).toHaveLength(1);
		expect(curlRequests(fixture)[0]).toContain("api.github.com");
	});

	test("requires an absolute prefix and expands current-user tilde", () => {
		const relative = makeFixture();
		const refused = runInstaller(relative, ["--version", "1.2.3", "--prefix", "tools"]);
		expect(refused.exitCode).not.toBe(0);
		expect(refused.stderr).toContain("must be an absolute path");
		expect(curlRequests(relative)).toEqual([]);

		const expanded = makeFixture();
		const installed = runInstaller(expanded, [
			"--version",
			"1.2.3",
			"--prefix",
			"~/tools",
			"--no-modify-path",
		]);
		expect(installed.exitCode).toBe(0);
		expect(readFileSync(join(expanded.home, "tools", "bin", "thinkrail"), "utf8")).toBe(binaryBody);
	});
});

describe.skipIf(process.platform !== "win32" || !powershell)("install.ps1 validation", () => {
	test.each([
		["stable", "v1.2.3", "Invalid version"],
		["stable", "1.2.3-nightly.4", "does not belong to the stable channel"],
		["nightly", "1.2.3", "does not belong to the nightly channel"],
	])("rejects %s/%s before network access", (channel, requested, message) => {
		const fixture = makeFixture();
		const result = runPowerShellInstaller(fixture, channel, requested);
		expect(result.exitCode).not.toBe(0);
		expect(`${result.stdout}\n${result.stderr}`).toContain(message);
		expect(existsSync(join(fixture.root, "powershell-network.log"))).toBe(false);
	});

	test.each([
		"C:/isolated/100%",
		"C:/isolated/unsafe!prefix",
	])("rejects the cmd-unsafe prefix %s before network access", (prefix) => {
		const fixture = makeFixture();
		const result = runPowerShellInstaller(fixture, "stable", "1.2.3", "v1.2.3", prefix);
		expect(result.exitCode).not.toBe(0);
		expect(`${result.stdout}\n${result.stderr}`).toContain("Invalid prefix");
		expect(existsSync(join(fixture.root, "powershell-network.log"))).toBe(false);
	});

	test("rejects a resolved stable tag before constructing an artifact URL", () => {
		const fixture = makeFixture();
		const result = runPowerShellInstaller(fixture, "stable", "latest", "v1.2.3-nightly.4");
		expect(result.exitCode).not.toBe(0);
		expect(`${result.stdout}\n${result.stderr}`).toContain(
			"Invalid resolved tag for the stable channel",
		);
		expect(readFileSync(join(fixture.root, "powershell-network.log"), "utf8").trim()).toBe("api");
	});

	test.each([
		["stable", "1.2.3", "v1.2.3"],
		["nightly", "1.2.3-nightly.7", "v1.2.3-nightly.7"],
	])("constructs the exact %s artifact target", (channel, requested, tag) => {
		const fixture = makeFixture();
		const result = runPowerShellInstaller(fixture, channel, requested);
		expect(result.exitCode).not.toBe(0);
		const requests = readFileSync(join(fixture.root, "powershell-network.log"), "utf8")
			.trim()
			.split(/\r?\n/);
		expect(requests).toHaveLength(1);
		expect(requests[0]).toContain(`/releases/download/${tag}/thinkrail-windows-x64.exe`);
	});
});

describe("install.sh controlled installation", () => {
	test.each([
		["stable", "1.2.3", "v1.2.3", "Linux", "x86_64", "thinkrail-linux-x64"],
		["nightly", "1.2.3-nightly.7", "v1.2.3-nightly.7", "Linux", "x86_64", "thinkrail-linux-x64"],
		["stable", "1.2.3", "v1.2.3", "Linux", "aarch64", "thinkrail-linux-arm64"],
		["nightly", "1.2.3-nightly.7", "v1.2.3-nightly.7", "Linux", "aarch64", "thinkrail-linux-arm64"],
		["stable", "1.2.3", "v1.2.3", "Darwin", "arm64", "thinkrail-darwin-arm64"],
		["nightly", "1.2.3-nightly.7", "v1.2.3-nightly.7", "Darwin", "arm64", "thinkrail-darwin-arm64"],
	])("selects the exact %s %s target (%s, %s/%s, %s)", (channel, version, tag, unameS, unameM, assetName) => {
		const fixture = makeFixture();
		const result = runInstaller(
			fixture,
			[
				"--channel",
				channel,
				"--version",
				version,
				"--prefix",
				shellPath(fixture.prefix),
				"--no-modify-path",
			],
			{ FAKE_UNAME_S: unameS, FAKE_UNAME_M: unameM, FAKE_ASSET_NAME: assetName },
		);
		expect(result.exitCode).toBe(0);
		const requests = curlRequests(fixture);
		expect(requests).toHaveLength(2);
		expect(requests[0]).toContain(`/releases/download/${tag}/${assetName}`);
		expect(requests[1]).toContain(`/releases/download/${tag}/SHA256SUMS`);
		const metadata = JSON.parse(
			readFileSync(join(fixture.home, ".config", "thinkrail", "install.json"), "utf8"),
		);
		expect(metadata).toMatchObject({ channel, version, tag, path_entry_added: false });
		expect(
			readdirSync(join(fixture.home, ".config", "thinkrail")).filter((name) =>
				name.includes(".tmp."),
			),
		).toEqual([]);
	});

	test("records Git Bash installs under USERPROFILE with a native prefix", () => {
		const fixture = makeFixture();
		const profile = join(fixture.root, "native-profile");
		mkdirSync(profile, { recursive: true });
		const result = runInstaller(
			fixture,
			["--version", "1.2.3", "--prefix", shellPath(fixture.prefix), "--no-modify-path"],
			{
				FAKE_UNAME_S: "MINGW64_NT-10.0",
				FAKE_ASSET_NAME: "thinkrail-windows-x64.exe",
				USERPROFILE: "C:/isolated/profile",
				FAKE_USERPROFILE_POSIX: shellPath(profile),
				FAKE_NATIVE_PREFIX: "C:/isolated/thinkrail",
			},
		);
		expect(result.exitCode).toBe(0);
		expect(existsSync(join(fixture.prefix, "bin", "thinkrail.exe"))).toBe(true);
		const metadata = JSON.parse(
			readFileSync(join(profile, ".config", "thinkrail", "install.json"), "utf8"),
		);
		expect(metadata).toMatchObject({
			prefix: "C:/isolated/thinkrail",
			path_entry_added: false,
		});
		expect(existsSync(join(fixture.home, ".config", "thinkrail", "install.json"))).toBe(false);
	});

	test.each([
		"# >>> thinkrail PATH >>>\nexport PATH=broken\n",
		"# <<< thinkrail PATH <<<\nexport KEEP=1\n",
		"# >>> thinkrail PATH >>>\n# >>> thinkrail PATH >>>\n# <<< thinkrail PATH <<<\n# <<< thinkrail PATH <<<\n",
	])("preserves malformed shell profile markers byte-for-byte", (profileBody) => {
		const fixture = makeFixture();
		const rcFile = join(fixture.home, ".bashrc");
		writeFileSync(rcFile, profileBody);
		const result = runInstaller(fixture, [
			"--version",
			"1.2.3",
			"--prefix",
			shellPath(fixture.prefix),
		]);
		expect(result.exitCode).toBe(0);
		expect(readFileSync(rcFile, "utf8")).toBe(profileBody);
		expect(result.stderr).toContain("malformed ThinkRail PATH markers");
		expect(result.stdout).toContain("Add to PATH:");
	});

	test("final rename failure preserves the old binary and removes the destination temp", () => {
		const fixture = makeFixture();
		const binDir = join(fixture.prefix, "bin");
		const destination = join(binDir, "thinkrail");
		mkdirSync(binDir, { recursive: true });
		writeFileSync(destination, "old binary\n");
		writeTool(
			fixture.fakeBin,
			"mv",
			`printf 'injected rename failure\\n' >&2
exit 88
`,
		);
		const result = runInstaller(fixture, [
			"--version",
			"1.2.3",
			"--prefix",
			shellPath(fixture.prefix),
			"--no-modify-path",
		]);
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("previous executable was left unchanged");
		expect(readFileSync(destination, "utf8")).toBe("old binary\n");
		expect(readdirSync(binDir).filter((name) => name.startsWith(".thinkrail.new."))).toEqual([]);
		expect(existsSync(join(fixture.home, ".config", "thinkrail", "install.json"))).toBe(false);
	});
});
