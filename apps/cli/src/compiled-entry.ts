#!/usr/bin/env bun
// Entry point for the COMPILED single-file binary (`bun run build:binary`). Bun's `--compile` bundles the
// host *and* transparently embeds the `bun-pty` native lib — two things it can't serve from inside the
// binary are the web UI (a directory of files) and the bundled pi extensions' skills (pi reads SKILL.md
// via plain fs). So we embed both (`web-assets.generated`, `bundled-extensions.generated`) and, on
// startup, stage them to per-build cache dirs, point the host at them (`THINKRAIL_STATIC_DIR` + the
// server's `registerBundledRuntime` seam — which also injects the extensions themselves as value-imported
// factories, since a binary has no `node_modules` to path-load them from, and registers pi's statically-
// bundled provider flows: OAuth sign-in + Bedrock reach Node-only code through dynamic imports a compiled
// binary can't resolve), then hand off to the shared launch sequence (`bootstrap.ts`) declaring the
// `binary` provenance. An install-management subcommand skips all of that and hands off straight away —
// see the branch at the bottom.
//
// Run-from-source enters through `index.ts` and never touches this file. (Image-read needs no photon wasm
// here: the agent's read tool is configured to send images raw — see server `buildSessionSettings`.)

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseSubcommand } from "./args";
import {
	bundledExtensionFactories,
	bundledSkillsVersion,
	embeddedSkillFiles,
} from "./bundled-extensions.generated";
import { stagingRoot } from "./paths";
import { embeddedWebAssets, webAssetsVersion } from "./web-assets.generated";

/**
 * Stage embedded files to `<stagingRoot>/<kind>/<version>` (idempotent). Files are written
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

// An install-management subcommand (`update` / `uninstall`) never boots a host or a session, so it needs
// neither the staged assets nor the pi registrations — and `uninstall` would otherwise re-extract the very
// cache dir it is about to delete. Hand straight off to the normal bootstrap.
if (parseSubcommand(Bun.argv.slice(2)) === undefined) {
	const staticDir = await stage("web", webAssetsVersion, embeddedWebAssets);
	const skillsDir = await stage("skills", bundledSkillsVersion, embeddedSkillFiles);
	// Respect an explicit override (e.g. pointing at a dev build); otherwise serve the staged UI.
	process.env.THINKRAIL_STATIC_DIR ??= staticDir;
	const { registerBundledRuntime } = await import("@thinkrail/server");
	await registerBundledRuntime({ factories: bundledExtensionFactories, skillsDir });
}
const { launch } = await import("./bootstrap");
await launch("binary");
