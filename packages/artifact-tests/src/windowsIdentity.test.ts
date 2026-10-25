import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { binaryWindowsIconPath } from "@thinkrail/cli/artifact";
import { type WindowsFileIdentity, windowsFileIdentity } from "@thinkrail/shared/windowsIdentity";
import * as ResEdit from "resedit";
import { readWindowsExecutableIdentity, windowsIdentityMismatches } from "./windowsIdentity";

type ResourceEntry = Parameters<typeof ResEdit.Resource.IconGroupEntry.fromEntries>[0][number];

const icon = new Uint8Array(readFileSync(binaryWindowsIconPath));
const frames = ResEdit.Data.IconFile.from(icon).icons.map(({ width, data }) => ({
	size: width || 256,
	bytes: new Uint8Array(data.isRaw() ? data.bin : data.generate()),
}));
const identity = windowsFileIdentity({ version: "0.3.0-nightly.6", channel: "nightly" });

function iconGroup(
	id: string | number,
	members: { size: number; iconID: number }[],
): ResourceEntry {
	const view = new DataView(new ArrayBuffer(6 + members.length * 14));
	view.setUint16(2, 1, true);
	view.setUint16(4, members.length, true);
	members.forEach(({ size, iconID }, index) => {
		const at = 6 + index * 14;
		view.setUint8(at, size % 256);
		view.setUint8(at + 1, size % 256);
		view.setUint16(at + 4, 1, true);
		view.setUint16(at + 6, 32, true);
		view.setUint32(at + 8, 270_600, true);
		view.setUint16(at + 12, iconID, true);
	});
	return { type: 14, id, lang: 1033, codepage: 0, bin: view.buffer };
}

function executable(
	icons: Uint8Array[],
	groups: ResourceEntry[],
	strings: WindowsFileIdentity = identity,
): Uint8Array {
	const exe = ResEdit.NtExecutable.createEmpty(true, true);
	const resources = ResEdit.NtExecutableResource.from(exe);
	resources.entries = [
		...icons.map((bytes, index) => ({
			type: 3,
			id: index + 1,
			lang: 1033,
			codepage: 0,
			bin: bytes.slice().buffer,
		})),
		...groups,
	];
	const version = ResEdit.Resource.VersionInfo.createEmpty();
	version.lang = 1033;
	version.setFileVersion(...strings.fileVersionParts, 1033);
	version.setProductVersion(...strings.fileVersionParts, 1033);
	version.setStringValues(
		{ lang: 1033, codepage: 1200 },
		{
			FileDescription: strings.productName,
			ProductName: strings.productName,
			CompanyName: strings.companyName,
			LegalCopyright: strings.copyright,
			FileVersion: strings.fileVersion,
			ProductVersion: strings.fileVersion,
		},
	);
	version.outputToResourceEntries(resources.entries);
	resources.outputResource(exe);
	return new Uint8Array(exe.generate());
}

const bunLayout = (icons: { size: number; bytes: Uint8Array }[]) =>
	executable(
		icons.map(({ bytes }) => bytes),
		[
			iconGroup("IDI_MYICON", [{ size: 256, iconID: 1 }]),
			iconGroup(
				1,
				icons.map(({ size }, index) => ({ size, iconID: index + 1 })),
			),
		],
	);

test("reads the group the shell picks first: Bun's named group before numbered ones", () => {
	const read = readWindowsExecutableIdentity(bunLayout(frames));
	expect(read.defaultIconFrames).toHaveLength(1);
	expect(read.defaultIconFrames[0]).toEqual(frames[0]?.bytes);
	expect(read.strings.FileDescription).toBe("ThinkRail Nightly");
	expect(read.fileVersion).toBe("0.3.0.6");
});

test("accepts an executable whose default group shows ThinkRail's largest frame", () => {
	expect(windowsIdentityMismatches(bunLayout(frames), identity, icon)).toEqual([]);
	const allFrames = executable(
		frames.map(({ bytes }) => bytes),
		[
			iconGroup(
				1,
				frames.map(({ size }, index) => ({ size, iconID: index + 1 })),
			),
		],
	);
	expect(windowsIdentityMismatches(allFrames, identity, icon)).toEqual([]);
});

test("names a stretched small frame, a foreign icon and wrong properties", () => {
	expect(windowsIdentityMismatches(bunLayout(frames.toReversed()), identity, icon)).toEqual([
		"the shell's default icon group lacks the ICO's largest frame",
	]);
	const foreign = executable(
		[new Uint8Array([1, 2, 3])],
		[iconGroup("IDI_MYICON", [{ size: 256, iconID: 1 }])],
	);
	expect(windowsIdentityMismatches(foreign, identity, icon)).toEqual([
		"the shell's default icon group lacks the ICO's largest frame",
		"the shell's default icon group holds frames that are not ThinkRail's",
	]);
	const stable = windowsFileIdentity({ version: "0.3.0", channel: "stable" });
	expect(windowsIdentityMismatches(bunLayout(frames), stable, icon)).toEqual([
		'FileDescription is "ThinkRail Nightly", expected "ThinkRail"',
		'ProductName is "ThinkRail Nightly", expected "ThinkRail"',
		'FileVersion is "0.3.0.6", expected "0.3.0.0"',
		'ProductVersion is "0.3.0.6", expected "0.3.0.0"',
		"fixed file version is 0.3.0.6, expected 0.3.0.0",
	]);
});
