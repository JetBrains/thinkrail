#!/usr/bin/env bun

// Desktop sidecar entry (Tauri migration). Mirrors
// `apps/cli/src/compiled-entry.ts`: stages the embedded web/skills/runtime
// payloads out of the single-file binary, registers the bundled runtime and
// boots the ThinkRail host on a free loopback port. The bound port is reported
// on stdout for the Tauri shell plugin to consume; no browser is opened — the
// native window loads the sidecar origin through Tauri.

import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bootHost, registerBundledRuntime } from "@thinkrail/server";
import { version as appVersion } from "@thinkrail/shared/version";
import {
	bundledExtensionFactories,
	bundledSkillsVersion,
	embeddedSkillFiles,
} from "./bundled-extensions.generated";
import { embeddedRuntimeAssets, runtimeAssetsVersion } from "./runtime-assets.generated";
import { embeddedWebAssets, webAssetsVersion } from "./web-assets.generated";

function stagingRoot(): string {
	const xdg = process.env.XDG_CACHE_HOME;
	return join(xdg ?? homedir() ?? tmpdir(), "thinkrail");
}

async function stage(
	kind: string,
	version: string,
	files: { route: string; data: string }[],
): Promise<string> {
	const dir = join(stagingRoot(), kind, version);
	const marker = `${dir}.complete`;
	if (existsSync(marker)) return dir;
	await Promise.all(
		files.map(async (file) => {
			const dest = join(dir, file.route);
			mkdirSync(dirname(dest), { recursive: true });
			await Bun.write(dest, Bun.file(file.data));
		}),
	);
	await Bun.write(marker, version);
	return dir;
}

const staticDir = await stage("web", webAssetsVersion, embeddedWebAssets);
const skillsDir = await stage("skills", bundledSkillsVersion, embeddedSkillFiles);
const runtimeDir = await stage("runtime", runtimeAssetsVersion, embeddedRuntimeAssets);
const macosTrash = join(runtimeDir, "macos-trash");
const windowsTrash = join(runtimeDir, "windows-trash.exe");
if (process.platform !== "win32") chmodSync(macosTrash, 0o755);
process.env.THINKRAIL_STATIC_DIR ??= staticDir;
await registerBundledRuntime({
	factories: bundledExtensionFactories,
	skillsDir,
	trashHelpers: { macos: macosTrash, windows: windowsTrash },
});

const { port, server } = await bootHost({
	port: 0,
	host: "127.0.0.1",
	portMode: "free",
	resolveShellEnv: true,
	staticDir,
	appVersion,
});

// bootHost() already shuts the server down on SIGINT/SIGTERM; these handlers
// keep that contract explicit at the entry point.
process.on("SIGINT", () => void server.shutdown());
process.on("SIGTERM", () => void server.shutdown());

console.log(`THINKRAIL_SIDECAR_READY ${JSON.stringify({ port })}`);
