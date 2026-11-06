import { expect, test } from "bun:test";
import { windowsFileIdentity } from "./windowsIdentity";

test("names each channel and maps its version to four numeric parts", () => {
	expect(windowsFileIdentity({ version: "0.2.0", channel: "stable" })).toEqual({
		productName: "ThinkRail",
		companyName: "JetBrains s.r.o.",
		copyright: "Copyright © 2026 JetBrains s.r.o.",
		fileVersion: "0.2.0.0",
		fileVersionParts: [0, 2, 0, 0],
	});
	expect(windowsFileIdentity({ version: "0.3.0-nightly.6", channel: "nightly" })).toMatchObject({
		productName: "ThinkRail Nightly",
		fileVersion: "0.3.0.6",
		fileVersionParts: [0, 3, 0, 6],
	});
	expect(windowsFileIdentity({ version: "0.0.0-dev", channel: "dev" })).toMatchObject({
		productName: "ThinkRail Dev",
		fileVersion: "0.0.0.0",
	});
});

test("maps fork commit versions to the upstream numeric file version", () => {
	for (const commit of ["4d6586d8", "12345678"]) {
		expect(windowsFileIdentity({ version: `0.3.2.${commit}`, channel: "stable" })).toMatchObject({
			fileVersion: `0.3.2.${commit}`,
			fileVersionParts: [0, 3, 2, 0],
		});
	}
	expect(() => windowsFileIdentity({ version: "0.3.2.notasha", channel: "stable" })).toThrow();
	expect(() => windowsFileIdentity({ version: "65536.3.2.abcdef12", channel: "stable" })).toThrow();
});

test("rejects an unknown channel and versions Windows cannot carry", () => {
	expect(() => windowsFileIdentity({ version: "0.2.0", channel: "beta" })).toThrow(
		'unknown release channel "beta"',
	);
	expect(() => windowsFileIdentity({ version: "v0.2", channel: "stable" })).toThrow(
		'version "v0.2" is not major.minor.patch[-prerelease]',
	);
	expect(() => windowsFileIdentity({ version: "0.3.0-nightly.65536", channel: "nightly" })).toThrow(
		'version "0.3.0-nightly.65536" has a part above 65535',
	);
});
