import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { windowsFileIdentity, windowsIconPath } from "@thinkrail/shared/windowsIdentity";
import * as ResEdit from "resedit";
import { brandWindowsExecutable } from "./windowsExecutableIdentity";

const icon = readFileSync(windowsIconPath);
const iconSizes = ResEdit.Data.IconFile.from(icon).icons.map(({ width }) => width || 256);
const identity = windowsFileIdentity({ version: "0.3.0-nightly.6", channel: "nightly" });
const manifest = new TextEncoder().encode("<assembly/>").buffer;
const { BaseRelocation, Certificate } = ResEdit.Format.ImageDirectoryEntry;

function bunLikeExecutable({ signed = false } = {}): Uint8Array {
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
	if (!signed) return new Uint8Array(exe.generate());

	exe.setSectionByEntry(BaseRelocation, {
		info: {
			name: ".reloc",
			virtualSize: 8,
			virtualAddress: 0,
			sizeOfRawData: 0x200,
			pointerToRawData: 0,
			pointerToRelocations: 0,
			pointerToLineNumbers: 0,
			numberOfRelocations: 0,
			numberOfLineNumbers: 0,
			characteristics: 0x42000040,
		},
		data: new Uint8Array([0, 0, 0, 0, 8, 0, 0, 0]).buffer,
	});
	const unsigned = new Uint8Array(exe.generate());
	const certificate = new Uint8Array(16).fill(0xab);
	const bytes = new Uint8Array(unsigned.length + certificate.length);
	bytes.set(unsigned);
	bytes.set(certificate, unsigned.length);
	const dos = ResEdit.Format.getImageDosHeader(bytes.buffer);
	const nt = ResEdit.Format.getImageNtHeadersByDosHeader(bytes.buffer, dos);
	ResEdit.Format.ImageDataDirectoryArray.from(
		bytes.buffer,
		dos.newHeaderAddress + nt.getDataDirectoryOffset(),
	).set(Certificate, { virtualAddress: unsigned.length, size: certificate.length });
	return bytes;
}

function resourcesOf(executable: Uint8Array) {
	return ResEdit.NtExecutableResource.from(ResEdit.NtExecutable.from(executable)).entries;
}

test("the ICO lists its largest frame first", () => {
	expect(iconSizes[0]).toBe(256);
	expect(iconSizes).toEqual(iconSizes.toSorted((left, right) => right - left));
});

for (const [label, executable] of [
	["replaces Bun's own icon group and file properties", bunLikeExecutable()],
	["rebrands a signed executable whose .reloc follows .rsrc", bunLikeExecutable({ signed: true })],
	[
		"brands an executable that has no resources",
		new Uint8Array(ResEdit.NtExecutable.createEmpty(true, true).generate()),
	],
] as const) {
	test(label, () => {
		const entries = resourcesOf(brandWindowsExecutable(executable, icon, identity, "bun.exe"));
		const groups = ResEdit.Resource.IconGroupEntry.fromEntries(entries);

		expect(groups.map(({ id, lang }) => ({ id, lang }))).toEqual([{ id: 1, lang: 1033 }]);
		expect(groups[0]?.icons.map(({ width }) => width || 256)).toEqual(iconSizes);
		expect(entries.filter(({ type }) => type === 3)).toHaveLength(iconSizes.length);
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
			fileOS: 0x40004,
			fileType: 1,
			fileFlagsMask: 0x3f,
		});
	});
}

test("drops the stale signature and keeps the relocations after the resources", () => {
	const signed = bunLikeExecutable({ signed: true });
	expect(() => ResEdit.NtExecutable.from(signed)).toThrow("Parsing signed executable");

	const branded = ResEdit.NtExecutable.from(
		brandWindowsExecutable(signed, icon, identity, "bun.exe"),
	);
	expect(branded.newHeader.optionalHeaderDataDirectory.get(Certificate)).toEqual({
		virtualAddress: 0,
		size: 0,
	});
	const resources = branded.getSectionByEntry(ResEdit.Format.ImageDirectoryEntry.Resource);
	const relocations = branded.getSectionByEntry(BaseRelocation);
	expect(relocations?.info.virtualAddress).toBeGreaterThan(resources?.info.virtualAddress ?? 0);
});

test("keeps resources it does not brand", () => {
	const entries = resourcesOf(
		brandWindowsExecutable(bunLikeExecutable(), icon, identity, "bun.exe"),
	);
	expect(entries.find(({ type }) => type === 24)?.bin).toEqual(manifest);
});
