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
	outputs: Record<string, { value: string }>;
	runs: { steps: { id?: string; run?: string }[] };
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
	},
	{
		target: "bun-windows-x64",
		stable: "win-x64-ThinkRail-Setup.zip",
		nightly: "canary-win-x64-ThinkRail-Setup-canary.zip",
		published: "thinkrail-desktop-windows-x64.zip",
	},
	{
		target: "bun-linux-x64",
		stable: "linux-x64-ThinkRail-Setup.tar.gz",
		nightly: "canary-linux-x64-ThinkRail-canary-Setup.tar.gz",
		published: "thinkrail-desktop-linux-x64.tar.gz",
	},
	{
		target: "bun-linux-arm64",
		stable: "linux-arm64-ThinkRail-Setup.tar.gz",
		nightly: "canary-linux-arm64-ThinkRail-canary-Setup.tar.gz",
		published: "thinkrail-desktop-linux-arm64.tar.gz",
	},
] as const;

const macAppArchives = {
	stable: "stable-macos-arm64-ThinkRail.app.tar.zst",
	nightly: "canary-macos-arm64-ThinkRail-canary.app.tar.zst",
} as const;

function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-release-collector-"));
	roots.push(root);
	const artifacts = join(root, "apps/desktop/artifacts");
	mkdirSync(artifacts, { recursive: true });
	for (const target of targets) {
		writeFileSync(join(artifacts, target.nightly), `nightly:${target.target}`);
		writeFileSync(join(artifacts, target.stable), `stable:${target.target}`);
	}
	for (const [channel, archive] of Object.entries(macAppArchives)) {
		writeFileSync(join(artifacts, archive), `${channel}:expanded-app`);
	}
	writeFileSync(join(artifacts, "macos-arm64-ThinkRail.app.tar.zst"), "wrong stable prefix");
	writeFileSync(join(artifacts, "old-setup.zip"), "unrelated");
	return root;
}

function collect(root: string, target: string, channel: string) {
	const collector = action.runs.steps.find((step) => step.id === "resolve-desktop")?.run;
	if (!collector) throw new Error("desktop artifact collector is missing");
	return Bun.spawnSync(["bash", "-c", collector], {
		cwd: root,
		env: {
			...process.env,
			TARGET: target,
			CHANNEL: channel,
			GITHUB_OUTPUT: join(root, "outputs"),
		},
		stdout: "pipe",
		stderr: "pipe",
	});
}

test("preserves the four public installer/CLI outputs and adds the app archive path", () => {
	expect(
		Object.fromEntries(Object.entries(action.outputs).map(([key, { value }]) => [key, value])),
	).toEqual({
		"artifact-name": `\${{ steps.resolve-cli.outputs.name }}`,
		"artifact-path": `\${{ steps.resolve-cli.outputs.path }}`,
		"desktop-artifact-name": `\${{ steps.resolve-desktop.outputs.name }}`,
		"desktop-artifact-path": `\${{ steps.resolve-desktop.outputs.path }}`,
		"desktop-app-archive-path": `\${{ steps.resolve-desktop.outputs.app-archive-path }}`,
	});
});

for (const target of targets) {
	for (const channel of ["stable", "nightly"] as const) {
		test(`collects the exact ${channel} ${target.target} installer and app archive among stale and sibling outputs`, () => {
			const root = fixture();
			const result = collect(root, target.target, channel);
			expect(result.exitCode).toBe(0);
			expect(readFileSync(join(root, "apps/desktop/dist", target.published), "utf8")).toBe(
				`${channel}:${target.target}`,
			);
			const appArchivePath =
				target.target === "bun-darwin-arm64"
					? `apps/desktop/artifacts/${macAppArchives[channel]}`
					: "";
			expect(readFileSync(join(root, "outputs"), "utf8")).toBe(
				`name=${target.published}\npath=apps/desktop/dist/${target.published}\napp-archive-path=${appArchivePath}\n`,
			);
			expect(readdirSync(join(root, "apps/desktop/dist"))).toEqual([target.published]);
			if (appArchivePath) {
				expect(readFileSync(join(root, appArchivePath), "utf8")).toBe(`${channel}:expanded-app`);
			}
		});
	}
}

test("refuses a missing requested installer instead of collecting a stale channel", () => {
	const root = fixture();
	rmSync(join(root, "apps/desktop/artifacts/macos-arm64-ThinkRail.dmg"));
	expect(collect(root, "bun-darwin-arm64", "stable").exitCode).not.toBe(0);
});

test.each([
	"stable",
	"nightly",
] as const)("refuses a missing requested %s macOS app archive instead of falling back to another artifact", (channel) => {
	const root = fixture();
	const appArchivePath = `apps/desktop/artifacts/${macAppArchives[channel]}`;
	rmSync(join(root, appArchivePath));
	const result = collect(root, "bun-darwin-arm64", channel);
	expect(result.exitCode).not.toBe(0);
	expect(result.stdout.toString()).toContain(
		`::error::desktop app archive not found at ${appArchivePath}`,
	);
	expect(existsSync(join(root, "outputs"))).toBe(false);
});

test.each([
	["bun-darwin-x64", "stable"],
	["bun-darwin-arm64", "production"],
])("refuses an unsupported target/channel: %s %s", (target, channel) => {
	expect(collect(fixture(), target, channel).exitCode).not.toBe(0);
});
