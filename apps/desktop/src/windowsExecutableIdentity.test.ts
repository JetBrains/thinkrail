import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { windowsFileIdentity } from "@thinkrail/shared/windowsIdentity";
import * as ResEdit from "resedit";
import { brandWindowsExecutable } from "./windowsExecutableIdentity";

const icon = readFileSync(resolve(import.meta.dir, "..", "assets", "icon.ico"));
const identity = windowsFileIdentity({ version: "0.3.0-nightly.6", channel: "nightly" });
const manifest = new TextEncoder().encode("<assembly/>").buffer;

function bunLikeExecutable(): Uint8Array {
	const exe = ResEdit.NtExecutable.createEmpty(true, true);
	const resources = ResEdit.NtExecutableResource.from(exe);
	const bunIcon = ResEdit.Data.RawIconItem.from(new Uint8Array([1, 2, 3]), 256, 256, 32);
	ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, "IDI_MYICON", 1033, [
		bunIcon,
	]);
	const version = ResEdit.Resource.VersionInfo.createEmpty();
	version.lang = 1033;
	version.setFileVersion(1, 4, 4, 0, 1033);
	version.setStringValues(
		{ lang: 1033, codepage: 1200 },
		{ FileDescription: "Bun", ProductName: "Bun", CompanyName: "Oven" },
	);
	version.outputToResourceEntries(resources.entries);
	resources.entries.push({ type: 24, id: 1, lang: 1033, codepage: 0, bin: manifest });
	resources.outputResource(exe);
	return new Uint8Array(exe.generate());
}

function resourcesOf(executable: Uint8Array) {
	return ResEdit.NtExecutableResource.from(ResEdit.NtExecutable.from(executable)).entries;
}

for (const [label, executable] of [
	["replaces Bun's own icon group and file properties", bunLikeExecutable()],
	[
		"brands an executable that has no resources",
		new Uint8Array(ResEdit.NtExecutable.createEmpty(true, true).generate()),
	],
] as const) {
	test(label, () => {
		const entries = resourcesOf(brandWindowsExecutable(executable, icon, identity, "bun.exe"));
		const groups = ResEdit.Resource.IconGroupEntry.fromEntries(entries);

		expect(groups.map(({ id, lang }) => ({ id, lang }))).toEqual([{ id: 1, lang: 1033 }]);
		expect(groups[0]?.icons.map(({ width }) => width || 256)).toEqual([
			256, 128, 64, 48, 32, 24, 16,
		]);
		expect(entries.filter(({ type }) => type === 3)).toHaveLength(7);
		const [version] = ResEdit.Resource.VersionInfo.fromEntries(entries);
		expect(version?.getStringValues({ lang: 1033, codepage: 1200 })).toEqual({
			CompanyName: "JetBrains s.r.o.",
			FileDescription: "ThinkRail Nightly",
			ProductName: "ThinkRail Nightly",
			LegalCopyright: "Copyright © 2026 JetBrains s.r.o.",
			FileVersion: "0.3.0.6",
			ProductVersion: "0.3.0.6",
			OriginalFilename: "bun.exe",
			InternalName: "bun",
		});
		expect(version?.fixedInfo).toMatchObject({
			fileVersionMS: 3,
			fileVersionLS: 6,
			productVersionMS: 3,
			productVersionLS: 6,
		});
	});
}

test("keeps resources it does not brand", () => {
	const entries = resourcesOf(
		brandWindowsExecutable(bunLikeExecutable(), icon, identity, "bun.exe"),
	);
	expect(entries.find(({ type }) => type === 24)?.bin).toEqual(manifest);
});
