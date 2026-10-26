import type { WindowsFileIdentity } from "@thinkrail/shared/windowsIdentity";
import * as ResEdit from "resedit";

type ResourceEntry = Parameters<typeof ResEdit.Resource.IconGroupEntry.fromEntries>[0][number];

const RT_ICON = 3;
const NAMED = 0x80000000;

export interface WindowsExecutableIdentity {
	defaultIconFrames: Uint8Array[];
	strings: Record<string, string>;
	fileVersion: string;
}

function resourceEntries(executable: Uint8Array): ResourceEntry[] {
	const exe = ResEdit.NtExecutable.from(executable, { ignoreCert: true });
	const resourceIndex = ResEdit.Format.ImageDirectoryEntry.Resource;
	const section = exe.getSectionByEntry(resourceIndex);
	if (!section?.data) return [];
	const data = section.data;
	const view = new DataView(data);
	const sectionRva = section.info.virtualAddress;
	const base =
		exe.newHeader.optionalHeaderDataDirectory.get(resourceIndex).virtualAddress - sectionRva;
	const children = (directory: number): { key: string | number; target: number }[] => {
		const count =
			view.getUint16(base + directory + 12, true) + view.getUint16(base + directory + 14, true);
		return Array.from({ length: count }, (_, index) => {
			const at = base + directory + 16 + index * 8;
			const name = view.getUint32(at, true);
			const key =
				name & NAMED
					? new TextDecoder("utf-16le").decode(
							new Uint8Array(
								data,
								base + (name & ~NAMED) + 2,
								view.getUint16(base + (name & ~NAMED), true) * 2,
							),
						)
					: name;
			return { key, target: view.getUint32(at + 4, true) & ~NAMED };
		});
	};
	const entries: ResourceEntry[] = [];
	for (const type of children(0)) {
		for (const id of children(type.target)) {
			for (const lang of children(id.target)) {
				const rva = view.getUint32(base + lang.target, true);
				const size = view.getUint32(base + lang.target + 4, true);
				entries.push({
					type: type.key,
					id: id.key,
					lang: lang.key,
					codepage: view.getUint32(base + lang.target + 8, true),
					bin: data.slice(rva - sectionRva, rva - sectionRva + size),
				});
			}
		}
	}
	return entries;
}

export function readWindowsExecutableIdentity(executable: Uint8Array): WindowsExecutableIdentity {
	const entries = resourceEntries(executable);
	const shellGroup = ResEdit.Resource.IconGroupEntry.fromEntries(entries)[0];
	const defaultIconFrames = (shellGroup?.icons ?? []).map((icon) => {
		const frame = entries.find((entry) => entry.type === RT_ICON && entry.id === icon.iconID);
		return new Uint8Array(frame?.bin ?? new ArrayBuffer(0));
	});
	const versionInfo = ResEdit.Resource.VersionInfo.fromEntries(entries)[0];
	const language = versionInfo?.getAllLanguagesForStringValues()[0];
	const fixed = versionInfo?.fixedInfo;
	return {
		defaultIconFrames,
		strings: versionInfo && language ? { ...versionInfo.getStringValues(language) } : {},
		fileVersion: fixed
			? [
					fixed.fileVersionMS >>> 16,
					fixed.fileVersionMS & 0xffff,
					fixed.fileVersionLS >>> 16,
					fixed.fileVersionLS & 0xffff,
				].join(".")
			: "",
	};
}

function iconFrames(icon: Uint8Array): { size: number; bytes: Uint8Array }[] {
	return ResEdit.Data.IconFile.from(icon).icons.map(({ width, data }) => ({
		size: width || 256,
		bytes: new Uint8Array(data.isRaw() ? data.bin : data.generate()),
	}));
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	return Buffer.from(left).equals(Buffer.from(right));
}

export function windowsIdentityMismatches(
	executable: Uint8Array,
	expected: WindowsFileIdentity,
	icon: Uint8Array,
): string[] {
	const actual = readWindowsExecutableIdentity(executable);
	const mismatches: string[] = [];
	const frames = iconFrames(icon);
	const [first] = frames;
	if (!first) return ["the reference ICO contains no frames"];
	const largest = frames.reduce((best, frame) => (frame.size > best.size ? frame : best), first);
	if (!actual.defaultIconFrames.some((frame) => sameBytes(frame, largest.bytes))) {
		mismatches.push("the shell's default icon group lacks the ICO's largest frame");
	}
	if (
		!actual.defaultIconFrames.every((frame) => frames.some((own) => sameBytes(frame, own.bytes)))
	) {
		mismatches.push("the shell's default icon group holds frames that are not ThinkRail's");
	}
	const strings: Record<string, string> = {
		FileDescription: expected.productName,
		ProductName: expected.productName,
		CompanyName: expected.companyName,
		LegalCopyright: expected.copyright,
		FileVersion: expected.fileVersion,
		ProductVersion: expected.fileVersion,
	};
	for (const [key, value] of Object.entries(strings)) {
		if (actual.strings[key] !== value) {
			mismatches.push(
				`${key} is ${JSON.stringify(actual.strings[key])}, expected ${JSON.stringify(value)}`,
			);
		}
	}
	if (actual.fileVersion !== expected.fileVersion) {
		mismatches.push(
			`fixed file version is ${actual.fileVersion || "missing"}, expected ${expected.fileVersion}`,
		);
	}
	return mismatches;
}
