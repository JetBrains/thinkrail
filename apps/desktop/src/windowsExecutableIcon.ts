import * as PeLibrary from "pe-library";
import * as ResEdit from "resedit";

export function embedWindowsExecutableIcon(
	executableData: Uint8Array,
	iconData: Uint8Array,
): Uint8Array {
	const executable = PeLibrary.NtExecutable.from(executableData);
	const resources = PeLibrary.NtExecutableResource.from(executable);
	const icon = ResEdit.Data.IconFile.from(iconData);
	if (icon.icons.length === 0) throw new Error("ThinkRail Windows icon contains no images");

	ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
		resources.entries,
		1,
		1033,
		icon.icons.map((item) => item.data),
	);
	resources.outputResource(executable);
	return new Uint8Array(executable.generate());
}
