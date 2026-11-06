import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectAssets, releaseMetadata, stampVersion } from "./windows-release";

const sha = "abcdef0123456789abcdef0123456789abcdef01";
const upstreamSha = "1234567890123456789012345678901234567890";
const latest = { tag_name: "v1.2.3", draft: false, prerelease: false };

describe("Windows desktop release identity", () => {
	test("uses stable upstream version and exact checkout identity", () => {
		const metadata = releaseMetadata(latest, sha, upstreamSha);
		expect(metadata).toMatchObject({
			version: "1.2.3.abcdef01",
			tag: "v1.2.3.abcdef01",
			sha,
			channel: "stable",
			upstreamTag: "v1.2.3",
			upstreamSha,
		});
		expect(releaseMetadata({ ...latest, tag_name: "1.2.3" }, sha, upstreamSha).version).toBe(
			metadata.version,
		);
	});

	test("rejects non-stable, malformed tags and incomplete commits", () => {
		for (const tag_name of ["v1.2", "v01.2.3", "v1.2.3-rc.1", "v1.2.3+meta", "v1.2.3\n"]) {
			expect(() => releaseMetadata({ ...latest, tag_name }, sha, upstreamSha)).toThrow();
		}
		for (const release of [{ ...latest, draft: true }, { ...latest, prerelease: true }, {}]) {
			expect(() => releaseMetadata(release, sha, upstreamSha)).toThrow();
		}
		for (const badSha of ["abcdef01", "g".repeat(40), `${sha}\n`]) {
			expect(() => releaseMetadata(latest, badSha, upstreamSha)).toThrow();
			expect(() => releaseMetadata(latest, sha, badSha)).toThrow();
		}
	});

	test("stamps full commit, stable channel and disabled analytics", () => {
		expect(stampVersion(releaseMetadata(latest, sha, upstreamSha))).toBe(
			`export const version = "1.2.3.abcdef01";\nexport const channel = "stable";\nexport const commit = "${sha}";\nexport const posthogProjectKey = "";\n`,
		);
	});

	test("collects only versioned installer, checksum and provenance", () => {
		const root = mkdtempSync(join(tmpdir(), "windows-release-test-"));
		try {
			const source = join(root, "installer.zip");
			writeFileSync(source, "fixture installer");
			const metadata = releaseMetadata(latest, sha, upstreamSha);
			const output = join(root, "assets");
			const name = collectAssets(metadata, source, output);
			expect(name).toBe("oh-my-thinkrail-1.2.3.abcdef01-windows-x64.zip");
			expect(readFileSync(join(output, name), "utf8")).toBe("fixture installer");
			const digest = createHash("sha256").update("fixture installer").digest("hex");
			expect(readFileSync(join(output, "SHA256SUMS"), "utf8")).toBe(`${digest}  ${name}\n`);
			expect(JSON.parse(readFileSync(join(output, "build-info.json"), "utf8"))).toMatchObject({
				...metadata,
				artifact: name,
				sha256: digest,
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
