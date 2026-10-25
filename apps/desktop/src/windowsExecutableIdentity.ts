import type { WindowsFileIdentity } from "@thinkrail/shared/windowsIdentity";
import * as ResEdit from "resedit";

const RT_ICON = 3;
const RT_GROUP_ICON = 14;
const RT_VERSION = 16;
const EN_US = 1033;
const UNICODE = 1200;

export function brandWindowsExecutable(
	executableData: Uint8Array,
	iconData: Uint8Array,
	identity: WindowsFileIdentity,
	originalFilename: string,
): Uint8Array {
	const icon = ResEdit.Data.IconFile.from(iconData);
	if (icon.icons.length === 0) throw new Error("ThinkRail Windows icon contains no images");
	const executable = ResEdit.NtExecutable.from(executableData, { ignoreCert: true });
	const resources = ResEdit.NtExecutableResource.from(executable);
	resources.entries = resources.entries.filter(
		({ type }) => type !== RT_ICON && type !== RT_GROUP_ICON && type !== RT_VERSION,
	);
	ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
		resources.entries,
		1,
		EN_US,
		icon.icons.map((item) => item.data),
	);
	const version = ResEdit.Resource.VersionInfo.createEmpty();
	version.lang = EN_US;
	version.setFileVersion(...identity.fileVersionParts, EN_US);
	version.setProductVersion(...identity.fileVersionParts, EN_US);
	version.setStringValues(
		{ lang: EN_US, codepage: UNICODE },
		{
			CompanyName: identity.companyName,
			FileDescription: identity.productName,
			ProductName: identity.productName,
			LegalCopyright: identity.copyright,
			FileVersion: identity.fileVersion,
			ProductVersion: identity.fileVersion,
			OriginalFilename: originalFilename,
			InternalName: originalFilename.replace(/\.exe$/i, ""),
		},
	);
	version.outputToResourceEntries(resources.entries);
	resources.outputResource(executable);
	return new Uint8Array(executable.generate());
}
