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

import { existsSync, mkdirSync } from "node:fs";
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
 * Stage embedded files to `<cacheRoot>/thinkrail/<kind>/<version>` (idempotent). Files are written
 * straight into the versioned dir and a sibling `<dir>.complete` marker is written **last**; readiness
 * is gated on the marker, not mere dir existence — so an interrupted extraction (partial dir, no marker)
 * is simply re-extracted on the next launch instead of being trusted. Returns the dir.
 *
 * We deliberately do **not** stage-to-temp-then-rename: Bun's `renameSync` of a freshly-written,
 * non-empty directory fails deterministically with `EPERM` on Windows (it retains a handle on a written
 * file), so a directory rename can't be the publish step. The dir is keyed by content hash, so a
 * concurrent launch of the same build writes byte-identical files — interleaving is benign.
 */
async function stage(
	kind: string,
	version: string,
	files: { route: string; data: string }[],
): Promise<string> {
	const dir = join(cacheRoot(), "thinkrail", kind, version);
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
// Respect an explicit override (e.g. pointing at a dev build); otherwise serve the staged UI.
process.env.THINKRAIL_STATIC_DIR ??= staticDir;
const { setBundledExtensions } = await import("@thinkrail/server");
setBundledExtensions({ factories: bundledExtensionFactories, skillsDir });
await import("./index");
