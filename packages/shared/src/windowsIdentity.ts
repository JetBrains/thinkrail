import { resolve } from "node:path";

export const windowsIconPath = resolve(import.meta.dir, "..", "assets", "icon.ico");

export interface WindowsFileIdentity {
	productName: string;
	companyName: string;
	copyright: string;
	fileVersion: string;
	fileVersionParts: readonly [number, number, number, number];
}

const CHANNEL_SUFFIXES: Readonly<Record<string, string>> = {
	stable: "",
	nightly: " Nightly",
	dev: " Dev",
};

const MAX_VERSION_PART = 0xffff;

export function windowsFileIdentity(release: {
	version: string;
	channel: string;
}): WindowsFileIdentity {
	const suffix = CHANNEL_SUFFIXES[release.channel];
	if (suffix === undefined) throw new Error(`unknown release channel "${release.channel}"`);
	const fileVersionParts = windowsVersionParts(release.version);
	return {
		productName: `ThinkRail${suffix}`,
		companyName: "JetBrains s.r.o.",
		copyright: "Copyright © 2026 JetBrains s.r.o.",
		fileVersion: fileVersionParts.join("."),
		fileVersionParts,
	};
}

function windowsVersionParts(version: string): [number, number, number, number] {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
	if (!match) throw new Error(`version "${version}" is not major.minor.patch[-prerelease]`);
	const build = match[4]?.split(".").at(-1);
	const parts: [number, number, number, number] = [
		Number(match[1]),
		Number(match[2]),
		Number(match[3]),
		build && /^\d+$/.test(build) ? Number(build) : 0,
	];
	if (parts.some((part) => part > MAX_VERSION_PART)) {
		throw new Error(`version "${version}" has a part above ${MAX_VERSION_PART}`);
	}
	return parts;
}
