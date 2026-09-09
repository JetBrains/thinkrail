import { afterEach, expect, test } from "bun:test";
import {
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

const actionPath = resolve(import.meta.dir, "../../../.github/actions/build-binary/action.yml");
const action = Bun.YAML.parse(readFileSync(actionPath, "utf8")) as {
	inputs: Record<string, { default?: string }>;
	outputs: Record<string, { value: string }>;
	runs: {
		steps: {
			id?: string;
			name?: string;
			run?: string;
			if?: string;
			env?: Record<string, string>;
		}[];
	};
};
const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const targets = [
	{
		target: "bun-darwin-arm64",
		stable: "macos-arm64-ThinkRail.dmg",
		nightly: "canary-macos-arm64-ThinkRail-canary.dmg",
		published: "thinkrail-desktop-darwin-arm64.dmg",
		updates: {
			stable: {
				manifest: "stable-macos-arm64-update.json",
				archive: "stable-macos-arm64-ThinkRail.app.tar.zst",
			},
			nightly: {
				manifest: "canary-macos-arm64-update.json",
				archive: "canary-macos-arm64-ThinkRail-canary.app.tar.zst",
			},
		},
	},
	{
		target: "bun-windows-x64",
		stable: "win-x64-ThinkRail-Setup.zip",
		nightly: "canary-win-x64-ThinkRail-Setup-canary.zip",
		published: "thinkrail-desktop-windows-x64.zip",
		updates: {
			stable: {
				manifest: "stable-win-x64-update.json",
				archive: "stable-win-x64-ThinkRail.tar.zst",
			},
			nightly: {
				manifest: "canary-win-x64-update.json",
				archive: "canary-win-x64-ThinkRail-canary.tar.zst",
			},
		},
	},
	{
		target: "bun-linux-x64",
		stable: "linux-x64-ThinkRail-Setup.tar.gz",
		nightly: "canary-linux-x64-ThinkRail-canary-Setup.tar.gz",
		published: "thinkrail-desktop-linux-x64.tar.gz",
		updates: {
			stable: {
				manifest: "stable-linux-x64-update.json",
				archive: "stable-linux-x64-ThinkRail.tar.zst",
			},
			nightly: {
				manifest: "canary-linux-x64-update.json",
				archive: "canary-linux-x64-ThinkRail-canary.tar.zst",
			},
		},
	},
	{
		target: "bun-linux-arm64",
		stable: "linux-arm64-ThinkRail-Setup.tar.gz",
		nightly: "canary-linux-arm64-ThinkRail-canary-Setup.tar.gz",
		published: "thinkrail-desktop-linux-arm64.tar.gz",
		updates: {
			stable: {
				manifest: "stable-linux-arm64-update.json",
				archive: "stable-linux-arm64-ThinkRail.tar.zst",
			},
			nightly: {
				manifest: "canary-linux-arm64-update.json",
				archive: "canary-linux-arm64-ThinkRail-canary.tar.zst",
			},
		},
	},
] as const;

function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-release-collector-"));
	roots.push(root);
	const artifacts = join(root, "apps/desktop/artifacts");
	mkdirSync(artifacts, { recursive: true });
	for (const target of targets) {
		writeFileSync(join(artifacts, target.nightly), `nightly:${target.target}`);
		writeFileSync(join(artifacts, target.stable), `stable:${target.target}`);
		for (const channel of ["stable", "nightly"] as const) {
			const update = target.updates[channel];
			writeFileSync(join(artifacts, update.manifest), `${channel}:${target.target}:manifest`);
			writeFileSync(join(artifacts, update.archive), `${channel}:${target.target}:archive`);
		}
	}
	writeFileSync(join(artifacts, "macos-arm64-ThinkRail.app.tar.zst"), "wrong stable prefix");
	writeFileSync(join(artifacts, "stable-win-x64-update-old.json"), "stale manifest");
	writeFileSync(join(artifacts, "old-setup.zip"), "unrelated");
	return root;
}

function validateSigningInput(root: string, target: string, macosSigningInputOnly: string) {
	const script = action.runs.steps.find(
		(step) => step.name === "Validate macOS signing input mode",
	)?.run;
	if (!script) throw new Error("macOS signing input validation script is missing");
	return Bun.spawnSync(["bash", "-c", script], {
		cwd: root,
		env: {
			...process.env,
			TARGET: target,
			MACOS_SIGNING_INPUT_ONLY: macosSigningInputOnly,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
}

function packageDesktop(
	root: string,
	target: string,
	channel: string,
	macosSigningInputOnly = "false",
) {
	const script = action.runs.steps.find((step) => step.name === "Package desktop installer")?.run;
	if (!script) throw new Error("desktop package script is missing");
	return Bun.spawnSync(["bash", "-c", script], {
		cwd: root,
		env: {
			...process.env,
			PATH: `${join(root, "bin")}:${process.env.PATH}`,
			SYSTEMROOT: "C:\\Windows",
			TARGET: target,
			CHANNEL: channel,
			THINKRAIL_MACOS_SIGNING_INPUT_ONLY: macosSigningInputOnly,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
}

function collect(root: string, target: string, channel: string, macosSigningInputOnly = "false") {
	const collector = action.runs.steps.find((step) => step.id === "resolve-desktop")?.run;
	if (!collector) throw new Error("desktop artifact collector is missing");
	return Bun.spawnSync(["bash", "-c", collector], {
		cwd: root,
		env: {
			...process.env,
			TARGET: target,
			CHANNEL: channel,
			MACOS_SIGNING_INPUT_ONLY: macosSigningInputOnly,
			GITHUB_OUTPUT: join(root, "outputs"),
		},
		stdout: "pipe",
		stderr: "pipe",
	});
}

test("Windows packaging places System32 tar ahead of Git tar", () => {
	const root = fixture();
	const bin = join(root, "bin");
	const system32 = join(root, "windows", "System32");
	mkdirSync(bin, { recursive: true });
	mkdirSync(system32, { recursive: true });
	writeFileSync(
		join(bin, "cygpath"),
		`#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(join(root, "windows"))}\n`,
		{ mode: 0o755 },
	);
	writeFileSync(join(system32, "tar"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	writeFileSync(
		join(bin, "bun"),
		`#!/bin/sh\nprintf '%s\\n%s\\n%s\\n' "$PATH" "$*" "\${THINKRAIL_MACOS_SIGNING_INPUT_ONLY-}" > ${JSON.stringify(join(root, "package-call"))}\n`,
		{ mode: 0o755 },
	);
	const result = packageDesktop(root, "bun-windows-x64", "nightly");
	expect(result.exitCode).toBe(0);
	const [path, args, signingInputOnly] = readFileSync(join(root, "package-call"), "utf8").split(
		"\n",
	);
	expect(path?.split(":")[0]).toBe(system32);
	expect(args).toBe("run --cwd apps/desktop package:canary");
	expect(signingInputOnly).toBe("false");
});

test("non-Windows packaging does not require cygpath or rewrite PATH", () => {
	const root = fixture();
	const bin = join(root, "bin");
	mkdirSync(bin, { recursive: true });
	writeFileSync(
		join(bin, "bun"),
		`#!/bin/sh\nprintf '%s\\n%s\\n%s\\n' "$PATH" "$*" "\${THINKRAIL_MACOS_SIGNING_INPUT_ONLY-}" > ${JSON.stringify(join(root, "package-call"))}\n`,
		{ mode: 0o755 },
	);
	expect(packageDesktop(root, "bun-linux-x64", "stable").exitCode).toBe(0);
	const [path, args, signingInputOnly] = readFileSync(join(root, "package-call"), "utf8").split(
		"\n",
	);
	expect(path?.split(":")[0]).toBe(bin);
	expect(args).toBe("run --cwd apps/desktop package:stable");
	expect(signingInputOnly).toBe("false");
});

test("macOS signing-input packaging keeps the stable command and selects the build-only config mode", () => {
	const root = fixture();
	const bin = join(root, "bin");
	mkdirSync(bin, { recursive: true });
	writeFileSync(
		join(bin, "bun"),
		`#!/bin/sh\nprintf '%s\\n%s\\n' "$*" "$THINKRAIL_MACOS_SIGNING_INPUT_ONLY" > ${JSON.stringify(join(root, "package-call"))}\n`,
		{ mode: 0o755 },
	);
	expect(validateSigningInput(root, "bun-darwin-arm64", "true").exitCode).toBe(0);
	expect(packageDesktop(root, "bun-darwin-arm64", "stable", "true").exitCode).toBe(0);
	expect(readFileSync(join(root, "package-call"), "utf8")).toBe(
		"run --cwd apps/desktop package:stable\ntrue\n",
	);
});

test("declares signing-input-only as an opt-in and skips installer smoke only for its valid target", () => {
	expect(action.inputs["macos-signing-input-only"]?.default).toBe("false");
	for (const name of ["Build and smoke desktop app", "Package desktop installer"]) {
		expect(
			action.runs.steps.find((step) => step.name === name)?.env?.THINKRAIL_MACOS_SIGNING_INPUT_ONLY,
		).toBe(`\${{ inputs.macos-signing-input-only }}`);
	}
	expect(
		action.runs.steps.find((step) => step.name === "Smoke desktop first-install artifact")?.if,
	).toBe(
		`\${{ inputs.macos-signing-input-only != 'true' || inputs.target != 'bun-darwin-arm64' }}`,
	);
});

test("preserves existing public outputs and adds both update artifact paths", () => {
	expect(
		Object.fromEntries(Object.entries(action.outputs).map(([key, { value }]) => [key, value])),
	).toEqual({
		"artifact-name": `\${{ steps.resolve-cli.outputs.name }}`,
		"artifact-path": `\${{ steps.resolve-cli.outputs.path }}`,
		"desktop-artifact-name": `\${{ steps.resolve-desktop.outputs.name }}`,
		"desktop-artifact-path": `\${{ steps.resolve-desktop.outputs.path }}`,
		"desktop-app-archive-path": `\${{ steps.resolve-desktop.outputs.app-archive-path }}`,
		"desktop-update-manifest-path": `\${{ steps.resolve-desktop.outputs.update-manifest-path }}`,
		"desktop-update-archive-path": `\${{ steps.resolve-desktop.outputs.update-archive-path }}`,
	});
});

for (const target of targets) {
	for (const channel of ["stable", "nightly"] as const) {
		test(`collects the exact ${channel} ${target.target} installer and updater outputs among stale and sibling artifacts`, () => {
			const root = fixture();
			const result = collect(root, target.target, channel);
			expect(result.exitCode).toBe(0);
			expect(readFileSync(join(root, "apps/desktop/dist", target.published), "utf8")).toBe(
				`${channel}:${target.target}`,
			);
			const update = target.updates[channel];
			const updateManifestPath = `apps/desktop/artifacts/${update.manifest}`;
			const updateArchivePath = `apps/desktop/artifacts/${update.archive}`;
			const appArchivePath = target.target === "bun-darwin-arm64" ? updateArchivePath : "";
			expect(readFileSync(join(root, "outputs"), "utf8")).toBe(
				`name=${target.published}\npath=apps/desktop/dist/${target.published}\napp-archive-path=${appArchivePath}\nupdate-manifest-path=${updateManifestPath}\nupdate-archive-path=${updateArchivePath}\n`,
			);
			expect(readdirSync(join(root, "apps/desktop/dist"))).toEqual([target.published]);
			expect(readFileSync(join(root, updateManifestPath), "utf8")).toBe(
				`${channel}:${target.target}:manifest`,
			);
			expect(readFileSync(join(root, updateArchivePath), "utf8")).toBe(
				`${channel}:${target.target}:archive`,
			);
		});
	}
}

for (const channel of ["stable", "nightly"] as const) {
	test(`collects exact ${channel} macOS signing inputs without requiring or emitting an installer`, () => {
		const root = fixture();
		const target = targets[0];
		rmSync(join(root, "apps/desktop/artifacts", target[channel]));
		const result = collect(root, target.target, channel, "true");
		expect(result.exitCode).toBe(0);
		const update = target.updates[channel];
		const appArchivePath = `apps/desktop/artifacts/${update.archive}`;
		const updateManifestPath = `apps/desktop/artifacts/${update.manifest}`;
		expect(readFileSync(join(root, "outputs"), "utf8")).toBe(
			`name=\npath=\napp-archive-path=${appArchivePath}\nupdate-manifest-path=${updateManifestPath}\nupdate-archive-path=${appArchivePath}\n`,
		);
		expect(readdirSync(join(root, "apps/desktop/dist"))).toEqual([]);
		expect(readFileSync(join(root, updateManifestPath), "utf8")).toBe(
			`${channel}:${target.target}:manifest`,
		);
		expect(readFileSync(join(root, appArchivePath), "utf8")).toBe(
			`${channel}:${target.target}:archive`,
		);
	});
}

test("refuses a missing requested installer instead of collecting a stale channel", () => {
	const root = fixture();
	rmSync(join(root, "apps/desktop/artifacts/macos-arm64-ThinkRail.dmg"));
	expect(collect(root, "bun-darwin-arm64", "stable").exitCode).not.toBe(0);
});

test.each([
	["stable", "false"],
	["nightly", "false"],
	["stable", "true"],
	["nightly", "true"],
] as const)("refuses a missing %s macOS app archive (signing-input-only=%s)", (channel, signingInputOnly) => {
	const root = fixture();
	const appArchivePath = `apps/desktop/artifacts/${targets[0].updates[channel].archive}`;
	rmSync(join(root, appArchivePath));
	const result = collect(root, targets[0].target, channel, signingInputOnly);
	expect(result.exitCode).not.toBe(0);
	expect(result.stdout.toString()).toContain(
		`::error::desktop app archive not found at ${appArchivePath}`,
	);
	expect(existsSync(join(root, "outputs"))).toBe(false);
});

test("refuses missing macOS signing-input metadata", () => {
	const root = fixture();
	const manifestPath = `apps/desktop/artifacts/${targets[0].updates.stable.manifest}`;
	rmSync(join(root, manifestPath));
	const result = collect(root, targets[0].target, "stable", "true");
	expect(result.exitCode).not.toBe(0);
	expect(result.stdout.toString()).toContain(
		`::error::desktop update manifest not found at ${manifestPath}`,
	);
	expect(existsSync(join(root, "outputs"))).toBe(false);
});

test.each([
	["manifest", "manifest"],
	["archive", "archive"],
] as const)("refuses a missing requested update %s instead of falling back to another artifact", (kind, field) => {
	const root = fixture();
	const expected = targets[1].updates.nightly[field];
	const expectedPath = `apps/desktop/artifacts/${expected}`;
	rmSync(join(root, expectedPath));
	const result = collect(root, targets[1].target, "nightly");
	expect(result.exitCode).not.toBe(0);
	expect(result.stdout.toString()).toContain(
		`::error::desktop update ${kind} not found at ${expectedPath}`,
	);
	expect(existsSync(join(root, "outputs"))).toBe(false);
});

test("validates explicit signing-input mode values before building", () => {
	for (const [target, mode] of [
		["bun-darwin-arm64", "true"],
		["bun-darwin-arm64", "false"],
		["bun-windows-x64", "false"],
	] as const) {
		expect(validateSigningInput(fixture(), target, mode).exitCode).toBe(0);
	}
	for (const mode of ["", "yes", "1"]) {
		const result = validateSigningInput(fixture(), "bun-darwin-arm64", mode);
		expect(result.exitCode).not.toBe(0);
		expect(result.stdout.toString()).toContain("macos-signing-input-only must be true or false");
	}
});

test.each([
	"bun-darwin-x64",
	"bun-windows-x64",
	"bun-linux-x64",
	"bun-linux-arm64",
])("rejects macOS signing-input-only mode for target %s", (target) => {
	const result = validateSigningInput(fixture(), target, "true");
	expect(result.exitCode).not.toBe(0);
	expect(result.stdout.toString()).toContain(
		`::error::macos-signing-input-only is unsupported for target ${target}`,
	);
});

test.each([
	["bun-darwin-x64", "stable"],
	["bun-darwin-arm64", "production"],
])("refuses an unsupported target/channel: %s %s", (target, channel) => {
	expect(collect(fixture(), target, channel).exitCode).not.toBe(0);
});
