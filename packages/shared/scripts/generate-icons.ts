#!/usr/bin/env bun
// Generated from icon.svg — never hand-edit these outputs; see packages/shared/SPEC.md's /assets entry.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const WINDOWS_ICO_SIZES = [256, 128, 80, 72, 64, 56, 48, 40, 36, 32, 28, 24, 20, 16];
const iconFile = new ResEdit.Data.IconFile();
for (const size of WINDOWS_ICO_SIZES) {
	iconFile.icons.push({ data: ResEdit.Data.RawIconItem.from(pngAt(size), size, size, 32) });
}
writeFileSync(join(assetsDir, "icon.ico"), Buffer.from(iconFile.generate()));

const LINUX_ICON_SIZE = 512;
writeFileSync(join(assetsDir, "icon.png"), pngAt(LINUX_ICON_SIZE));

const IOS_ICON_SIZE = 1024;
const fullBleedSvg = svg.toString("utf8").replace(/<rect([^>]*?) rx="\d+"/, "<rect$1");
if (fullBleedSvg === svg.toString("utf8"))
	throw new Error("icon.svg tile rect lost its rx; update the iOS render");
writeFileSync(
	join(assetsDir, "icon-ios.png"),
	new Resvg(fullBleedSvg, { fitTo: { mode: "width", value: IOS_ICON_SIZE } }).render().asPng(),
);

const source = svg.toString("utf8");
const tile = /<rect width="1024" height="1024" rx="\d+" fill="(#[0-9a-fA-F]{6})"\/>/.exec(source);
if (!tile) throw new Error("icon.svg tile rect changed; update the Android render");
const [tileRect, tileFill] = tile;
const renderSvg = (markup: string, size: number): Buffer =>
	new Resvg(markup, { fitTo: { mode: "width", value: size } }).render().asPng();
const roundSvg = source.replace(tileRect, `<circle cx="512" cy="512" r="512" fill="${tileFill}"/>`);
const ANDROID_FOREGROUND_VIEW = 1700;
const foregroundOffset = (1024 - ANDROID_FOREGROUND_VIEW) / 2;
const foregroundSvg = source
	.replace(tileRect, "")
	.replace(
		'viewBox="0 0 1024 1024"',
		`viewBox="${foregroundOffset} ${foregroundOffset} ${ANDROID_FOREGROUND_VIEW} ${ANDROID_FOREGROUND_VIEW}"`,
	);
const ANDROID_DENSITIES: readonly [bucket: string, scale: number][] = [
	["mdpi", 1],
	["hdpi", 1.5],
	["xhdpi", 2],
	["xxhdpi", 3],
	["xxxhdpi", 4],
];
const androidDir = join(assetsDir, "android");
for (const [bucket, scale] of ANDROID_DENSITIES) {
	const dir = join(androidDir, `mipmap-${bucket}`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "ic_launcher.png"), renderSvg(source, 48 * scale));
	writeFileSync(join(dir, "ic_launcher_round.png"), renderSvg(roundSvg, 48 * scale));
	writeFileSync(join(dir, "ic_launcher_foreground.png"), renderSvg(foregroundSvg, 108 * scale));
}
mkdirSync(join(androidDir, "values"), { recursive: true });
writeFileSync(
	join(androidDir, "values", "ic_launcher_background.xml"),
	`<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${tileFill}</color>\n</resources>\n`,
);

console.log(
	`generated ${MACOS_ICONSET_FILES.length} iconset frames, a ${WINDOWS_ICO_SIZES.length}-frame icon.ico, icon.png, icon-ios.png and the Android launcher set from icon.svg`,
);
