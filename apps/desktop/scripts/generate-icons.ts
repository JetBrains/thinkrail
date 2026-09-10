#!/usr/bin/env bun
// Generated from icon.svg — never hand-edit these outputs; see apps/desktop/SPEC.md's icon paragraph.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import * as ResEdit from "resedit";

const assetsDir = join(import.meta.dir, "..", "assets");
const svg = readFileSync(join(assetsDir, "icon.svg"));

function renderPng(size: number): Buffer {
	const resvg = new Resvg(svg, { fitTo: { mode: "width", value: size } });
	return resvg.render().asPng();
}

const pngCache = new Map<number, Buffer>();
function pngAt(size: number): Buffer {
	const cached = pngCache.get(size);
	if (cached) return cached;
	const rendered = renderPng(size);
	pngCache.set(size, rendered);
	return rendered;
}

const MACOS_ICONSET_FILES: readonly [name: string, size: number][] = [
	["icon_16x16.png", 16],
	["icon_16x16@2x.png", 32],
	["icon_32x32.png", 32],
	["icon_32x32@2x.png", 64],
	["icon_128x128.png", 128],
	["icon_128x128@2x.png", 256],
	["icon_256x256.png", 256],
	["icon_256x256@2x.png", 512],
	["icon_512x512.png", 512],
	["icon_512x512@2x.png", 1024],
];
for (const [name, size] of MACOS_ICONSET_FILES) {
	writeFileSync(join(assetsDir, "icon.iconset", name), pngAt(size));
}

const WINDOWS_ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const iconFile = new ResEdit.Data.IconFile();
for (const size of WINDOWS_ICO_SIZES) {
	iconFile.icons.push({ data: ResEdit.Data.RawIconItem.from(pngAt(size), size, size, 32) });
}
writeFileSync(join(assetsDir, "icon.ico"), Buffer.from(iconFile.generate()));

const LINUX_ICON_SIZE = 512;
writeFileSync(join(assetsDir, "icon.png"), pngAt(LINUX_ICON_SIZE));

console.log(
	`generated ${MACOS_ICONSET_FILES.length} iconset frames, a ${WINDOWS_ICO_SIZES.length}-frame icon.ico, and icon.png from icon.svg`,
);
