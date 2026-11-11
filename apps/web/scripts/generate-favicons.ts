#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import * as ResEdit from "resedit";

const publicDir = join(import.meta.dir, "..", "public");
const mark = /<path[^>]*\sd="([^"]+)"/.exec(
	readFileSync(join(publicDir, "favicon.svg"), "utf8"),
)?.[1];
if (!mark) throw new Error("public/favicon.svg has no mark path");

const TILE = "#000000";
const GLYPH = "#8dff4f";
const tile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="224" fill="${TILE}"/><g transform="translate(136 209) scale(1.35)" fill="${GLYPH}"><path d="${mark}"/></g></svg>`;

function png(size: number, background?: string): Buffer {
	return new Resvg(tile, {
		fitTo: { mode: "width", value: size },
		...(background ? { background } : {}),
	})
		.render()
		.asPng();
}

const ico = new ResEdit.Data.IconFile();
for (const size of [48, 32, 16]) {
	ico.icons.push({ data: ResEdit.Data.RawIconItem.from(png(size), size, size, 32) });
}
writeFileSync(join(publicDir, "favicon.ico"), Buffer.from(ico.generate()));
writeFileSync(join(publicDir, "apple-touch-icon.png"), png(180, TILE));
console.log("generated public/favicon.ico and public/apple-touch-icon.png from public/favicon.svg");
