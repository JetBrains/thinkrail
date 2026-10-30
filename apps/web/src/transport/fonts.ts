import { USER_FONT_UPLOAD_HEADER, USER_FONTS_ROUTE, type UserFontFile } from "@thinkrail/contracts";
import { getTransport } from "./wireTransport";

export function hostUrl(path: string): string {
	return `${getTransport().httpBase()}${path}`;
}

function isUserFontFile(value: unknown): value is UserFontFile {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof Reflect.get(value, "fileName") === "string" &&
		typeof Reflect.get(value, "ok") === "boolean"
	);
}

export async function uploadUserFont(file: File): Promise<UserFontFile> {
	const response = await fetch(hostUrl(`${USER_FONTS_ROUTE}${encodeURIComponent(file.name)}`), {
		method: "PUT",
		headers: { [USER_FONT_UPLOAD_HEADER.name]: USER_FONT_UPLOAD_HEADER.value },
		body: file,
	});
	const entry: unknown = await response.json().catch(() => null);
	if (isUserFontFile(entry)) return entry;
	throw new Error(`font upload failed with HTTP ${response.status}`);
}
