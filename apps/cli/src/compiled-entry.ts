#!/usr/bin/env bun
// Entry point for the COMPILED single-file binary (`bun run build:binary`). Bun's `--compile` bundles the
// host *and* transparently embeds the `bun-pty` native lib — two things it can't serve from inside the
// binary are the web UI (a directory of files) and the bundled pi extensions' skills (pi reads SKILL.md
// via plain fs). So we embed both (`web-assets.generated`, `bundled-extensions.generated`) and, on
// startup, stage them to per-build cache dirs, point the host at them (`THINKRAIL_STATIC_DIR` + the
// server's `setBundledExtensions` seam — which also injects the extensions themselves as value-imported
// factories, since a binary has no `node_modules` to path-load them from), then hand off to the normal
// bootstrap (`index.ts`).
//
// Run-from-source uses `index.ts` directly and never touches this file. (Image-read needs no photon wasm
// here: the agent's read tool is configured to send images raw — see server `buildSessionSettings`.)

import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	bundledExtensionFactories,
	bundledSkillsVersion,
	embeddedSkillFiles,
} from "./bundled-extensions.generated";
import { embeddedWebAssets, webAssetsVersion } from "./web-assets.generated";

/** A writable cache root: `$XDG_CACHE_HOME`, else `~/.cache`, else the OS temp dir. */
function cacheRoot(): string {
	const xdg = process.env.XDG_CACHE_HOME;
	if (xdg) return xdg;
	const home = homedir();
	return home ? join(home, ".cache") : tmpdir();
}

/**
 * Stage embedded files to `<cacheRoot>/thinkrail/<kind>/<version>` (idempotent). Extraction is
 * atomic — written to a temp dir, then renamed into place — so the final dir either exists complete or
 * not at all (a killed first run can't poison the per-version cache). Returns the dir.
 */
async function stage(
	kind: string,
	version: string,
	files: { route: string; data: string }[],
): Promise<string> {
	const dir = join(cacheRoot(), "thinkrail", kind, version);
	if (existsSync(dir)) return dir;
	const staging = `${dir}.staging-${process.pid}`;
	await Promise.all(
		files.map(async (file) => {
			const dest = join(staging, file.route);
			mkdirSync(dirname(dest), { recursive: true });
			await Bun.write(dest, Bun.file(file.data));
		}),
	);
	try {
		renameSync(staging, dir);
	} catch (err) {
		rmSync(staging, { recursive: true, force: true });
		// A concurrent launch winning the rename is success; anything else is a real failure.
		if (!existsSync(dir)) throw err;
	}
	return dir;
}

const staticDir = await stage("web", webAssetsVersion, embeddedWebAssets);
const skillsDir = await stage("skills", bundledSkillsVersion, embeddedSkillFiles);
// Respect an explicit override (e.g. pointing at a dev build); otherwise serve the staged UI.
process.env.THINKRAIL_STATIC_DIR ??= staticDir;
const { setBundledExtensions } = await import("@thinkrail/server");
setBundledExtensions({ factories: bundledExtensionFactories, skillsDir });
await import("./index");
