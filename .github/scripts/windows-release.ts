import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const upstreamRepository = "JetBrains/thinkrail";
const fullSha = /^[0-9a-fA-F]{40}$/;
const stableTag = /^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

type Metadata = {
	version: string;
	tag: string;
	sha: string;
	channel: "stable";
	upstreamRepository: string;
	upstreamTag: string;
	upstreamSha: string;
};

export function releaseMetadata(latest: unknown, sha: string, upstreamSha: string): Metadata {
	const release = latest as { tag_name?: unknown; draft?: unknown; prerelease?: unknown } | null;
	if (
		release?.draft !== false ||
		release.prerelease !== false ||
		typeof release.tag_name !== "string" ||
		!stableTag.test(release.tag_name) ||
		/\s/.test(release.tag_name)
	) {
		throw new Error("Upstream latest release must have a strict stable X.Y.Z tag (optional v)");
	}
	if (
		sha.length !== 40 ||
		upstreamSha.length !== 40 ||
		!fullSha.test(sha) ||
		!fullSha.test(upstreamSha)
	) {
		throw new Error("Release commits must be full 40-digit hexadecimal SHAs");
	}
	const version = `${release.tag_name.replace(/^v/, "")}.${sha.slice(0, 8)}`;
	return {
		version,
		tag: `v${version}`,
		sha,
		channel: "stable",
		upstreamRepository,
		upstreamTag: release.tag_name,
		upstreamSha,
	};
}

export function stampVersion(metadata: Metadata): string {
	return `export const version = "${metadata.version}";\nexport const channel = "stable";\nexport const commit = "${metadata.sha}";\nexport const posthogProjectKey = "";\n`;
}

export function collectAssets(metadata: Metadata, source: string, output: string): string {
	const name = `oh-my-thinkrail-${metadata.version}-windows-x64.zip`;
	mkdirSync(output, { recursive: true });
	copyFileSync(source, join(output, name));
	const sha256 = createHash("sha256")
		.update(readFileSync(join(output, name)))
		.digest("hex");
	writeFileSync(join(output, "SHA256SUMS"), `${sha256}  ${name}\n`);
	writeFileSync(
		join(output, "build-info.json"),
		`${JSON.stringify({ ...metadata, artifact: name, sha256 }, null, 2)}\n`,
	);
	return name;
}

function run(command: string[]): string {
	const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
	if (!result.success) throw new Error(`${command[0]} failed: ${result.stderr.toString()}`);
	return result.stdout.toString().trim();
}

function api(endpoint: string): unknown {
	return JSON.parse(run(["gh", "api", endpoint]));
}

function assertAbsent(repository: string, tag: string): void {
	for (const endpoint of [`releases/tags/${tag}`, `git/ref/tags/${tag}`]) {
		const result = Bun.spawnSync(["gh", "api", `repos/${repository}/${endpoint}`], {
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.success) throw new Error(`Refusing existing release or tag: ${tag}`);
		if (!result.stderr.toString().includes("(HTTP 404)")) {
			throw new Error(`Cannot check release/tag absence: ${result.stderr.toString()}`);
		}
	}
}

function repository(): string {
	const value = process.argv[3];
	if (!value || !/^[\w.-]+\/[\w.-]+$/.test(value)) throw new Error("GITHUB_REPOSITORY required");
	return value;
}

if (import.meta.main) {
	const command = process.argv[2];
	if (command === "prepare") {
		const latest = api(`repos/${upstreamRepository}/releases/latest`) as { tag_name: string };
		const upstream = api(
			`repos/${upstreamRepository}/commits/${encodeURIComponent(latest.tag_name)}`,
		) as { sha: string };
		const metadata = releaseMetadata(latest, run(["git", "rev-parse", "HEAD"]), upstream.sha);
		assertAbsent(repository(), metadata.tag);
		writeFileSync(".windows-release.json", `${JSON.stringify(metadata, null, 2)}\n`);
		writeFileSync("packages/shared/src/version.ts", stampVersion(metadata));
	} else if (command === "collect") {
		const metadata = JSON.parse(readFileSync(".windows-release.json", "utf8")) as Metadata;
		collectAssets(metadata, "apps/desktop/artifacts/win-x64-ThinkRail-Setup.zip", "release-assets");
	} else if (command === "publish") {
		const info = JSON.parse(readFileSync("release-assets/build-info.json", "utf8"));
		const metadata = releaseMetadata(
			{ tag_name: info.upstreamTag, draft: false, prerelease: false },
			info.sha,
			info.upstreamSha,
		);
		if (metadata.sha !== run(["git", "rev-parse", "HEAD"])) throw new Error("Checkout mismatch");
		const name = `oh-my-thinkrail-${metadata.version}-windows-x64.zip`;
		const digest = createHash("sha256")
			.update(readFileSync(join("release-assets", name)))
			.digest("hex");
		if (
			info.tag !== metadata.tag ||
			info.version !== metadata.version ||
			info.sha256 !== digest ||
			readFileSync("release-assets/SHA256SUMS", "utf8") !== `${digest}  ${name}\n`
		)
			throw new Error("Release asset identity/checksum mismatch");
		assertAbsent(repository(), metadata.tag);
		console.log(
			run([
				"gh",
				"release",
				"create",
				metadata.tag,
				"--repo",
				repository(),
				"--target",
				metadata.sha,
				"--title",
				`oh-my-thinkrail ${metadata.version} (Windows x64)`,
				"--notes",
				`Independent oh-my-thinkrail fork. Unsigned Windows x64 desktop installer; Windows SmartScreen may warn. Extract the ZIP and keep the setup EXE beside its payload before running setup. Automatic updates are disabled. Upstream ${metadata.upstreamTag} (${metadata.upstreamSha}); fork commit ${metadata.sha}.`,
				join("release-assets", name),
				"release-assets/SHA256SUMS",
				"release-assets/build-info.json",
			]),
		);
	} else {
		throw new Error("Expected prepare, collect or publish");
	}
}
