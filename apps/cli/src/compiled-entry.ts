#!/usr/bin/env bun
// Entry point for the COMPILED single-file binary (`bun run build:binary`). Bun's `--compile` bundles the
// host *and* transparently embeds the `bun-pty` native lib — the one thing it can't serve from inside the
// binary is the web UI (a directory of files). So we embed those files (`web-assets.generated`) and, on
// startup, stage them to a per-build cache dir, then point the host at it via `THINKRAIL_PI_STATIC_DIR`
// before handing off to the normal bootstrap (`index.ts`).
//
// Run-from-source uses `index.ts` directly and never touches this file. (Image-read needs no photon wasm
// here: the agent's read tool is configured to send images raw — see server `buildSessionSettings`.)

import { existsSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { embeddedWebAssets, webAssetsVersion } from "./web-assets.generated";

/** A writable cache root: `$XDG_CACHE_HOME`, else `~/.cache`, else the OS temp dir. */
function cacheRoot(): string {
	const xdg = process.env.XDG_CACHE_HOME;
	if (xdg) return xdg;
	const home = homedir();
	return home ? join(home, ".cache") : tmpdir();
}

/** Stage the embedded web UI to a per-build dir (idempotent — skip if already extracted). Returns the dir. */
async function stageWebUi(): Promise<string> {
	const dir = join(cacheRoot(), "thinkrail-pi", "web", webAssetsVersion);
	if (!existsSync(join(dir, "index.html"))) {
		await Promise.all(
			embeddedWebAssets.map(async (asset) => {
				const dest = join(dir, asset.route);
				mkdirSync(dirname(dest), { recursive: true });
				await Bun.write(dest, Bun.file(asset.data));
			}),
		);
	}
	return dir;
}

const staticDir = await stageWebUi();
// Respect an explicit override (e.g. pointing at a dev build); otherwise serve the staged UI.
process.env.THINKRAIL_PI_STATIC_DIR ??= staticDir;
await import("./index");
