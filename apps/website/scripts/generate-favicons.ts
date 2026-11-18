#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import * as ResEdit from "resedit";

const publicDir = join(import.meta.dir, "..", "public");
const favicon = readFileSync(join(publicDir, "favicon.svg"), "utf8");
const tileColor = /<rect[^>]*\sfill="([^"]+)"/.exec(favicon)?.[1];
if (!tileColor) throw new Error("public/favicon.svg has no tile rect");

function png(size: number, background?: string): Buffer {
	return new Resvg(favicon, {
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
writeFileSync(join(publicDir, "apple-touch-icon.png"), png(180, tileColor));
console.log("generated public/favicon.ico and public/apple-touch-icon.png from public/favicon.svg");
