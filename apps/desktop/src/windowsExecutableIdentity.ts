import type { WindowsFileIdentity } from "@thinkrail/shared/windowsIdentity";
import * as ResEdit from "resedit";

const RT_ICON = 3;
const RT_GROUP_ICON = 14;
const RT_VERSION = 16;
const EN_US = 1033;
const UNICODE = 1200;
const VOS_NT_WINDOWS32 = 0x40004;
const VFT_APP = 1;
const VS_FFI_FILEFLAGSMASK = 0x3f;

/** Clears the certificate directory entry, which may point past end of file, and cuts any signature bytes. */
function withoutSignature(executableData: Uint8Array): Uint8Array {
	const bytes = new Uint8Array(executableData);
	const dos = ResEdit.Format.getImageDosHeader(bytes.buffer);
	const nt = ResEdit.Format.getImageNtHeadersByDosHeader(bytes.buffer, dos);
	const directories = ResEdit.Format.ImageDataDirectoryArray.from(
		bytes.buffer,
		dos.newHeaderAddress + nt.getDataDirectoryOffset(),
	);
	const { Certificate } = ResEdit.Format.ImageDirectoryEntry;
	const signature = directories.get(Certificate);
	if (signature.size === 0) return bytes;
	directories.set(Certificate, { virtualAddress: 0, size: 0 });
	return bytes.subarray(0, Math.min(signature.virtualAddress, bytes.length));
}

export function brandWindowsExecutable(
	executableData: Uint8Array,
	iconData: Uint8Array,
	identity: WindowsFileIdentity,
	originalFilename: string,
): Uint8Array {
	const icon = ResEdit.Data.IconFile.from(iconData);
	if (icon.icons.length === 0) throw new Error("ThinkRail Windows icon contains no images");
	const executable = ResEdit.NtExecutable.from(withoutSignature(executableData));
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
	version.fixedInfo.fileOS = VOS_NT_WINDOWS32;
	version.fixedInfo.fileType = VFT_APP;
	version.fixedInfo.fileFlagsMask = VS_FFI_FILEFLAGSMASK;
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
