import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as PeLibrary from "pe-library";
import * as ResEdit from "resedit";
import { embedWindowsExecutableIcon } from "./windowsExecutableIcon";

const iconPath = resolve(import.meta.dir, "..", "assets", "icon.ico");

test("adds the complete ThinkRail icon group to an executable with no icon", () => {
	const emptyExecutable = PeLibrary.NtExecutable.createEmpty(true, true).generate();
	const branded = embedWindowsExecutableIcon(
		new Uint8Array(emptyExecutable),
		readFileSync(iconPath),
	);
	const executable = PeLibrary.NtExecutable.from(branded);
	const resources = PeLibrary.NtExecutableResource.from(executable);
	const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);

	expect(groups).toHaveLength(1);
	expect({ id: groups[0]?.id, lang: groups[0]?.lang }).toEqual({ id: 1, lang: 1033 });
	expect(
		groups[0]?.icons.map(({ width, height, bitCount }) => [width || 256, height || 256, bitCount]),
	).toEqual([
		[16, 16, 32],
		[24, 24, 32],
		[32, 32, 32],
		[48, 48, 32],
		[64, 64, 32],
		[128, 128, 32],
		[256, 256, 32],
	]);
});
