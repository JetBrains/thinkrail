import { expect, test } from "bun:test";
import { hostTarget, loadManifest, parseManifest, SPEECH_MANIFEST_ENV } from "./manifest";
import { backendFromDoctor, compatibleVersion } from "./pathRuntime";

test("each desktop platform maps to one pinned runtime target", () => {
	expect(hostTarget("darwin", "arm64")).toBe("darwin-arm64");
	expect(hostTarget("darwin", "x64")).toBe("darwin-x64");
	expect(hostTarget("linux", "x64")).toBe("linux-x64");
	expect(hostTarget("linux", "arm64")).toBe("linux-arm64");
	expect(hostTarget("win32", "x64")).toBe("win32-x64");
	expect(hostTarget("win32", "arm64")).toBe("win32-x64");
	expect(hostTarget("linux", "ia32")).toBeNull();
	expect(hostTarget("freebsd", "x64")).toBeNull();
});

test("the pinned manifest covers every target and both models", () => {
	const manifest = loadManifest({});
	expect(Object.keys(manifest.runtimes).sort()).toEqual(
		["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"].sort(),
	);
	for (const pin of Object.values(manifest.runtimes)) {
		expect(pin.url).toStartWith(
			"https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.3.0/",
		);
		expect(pin.url).toContain(pin.root);
	}
	expect(manifest.models.multilingual.language).toBe("auto");
	expect(manifest.models.english.language).toBe("en-US");
	expect(parseManifest(manifest)).toEqual(manifest);
	expect(SPEECH_MANIFEST_ENV).toBe("THINKRAIL_SPEECH_MANIFEST");
});

test("a manifest override is validated strictly", () => {
	const good = loadManifest({});
	expect(() =>
		parseManifest({ ...good, runtimes: { "plan9-x64": good.runtimes["linux-x64"] } }),
	).toThrow();
	expect(() =>
		parseManifest({
			...good,
			models: { ...good.models, english: { ...good.models.english, fileName: "../escape" } },
		}),
	).toThrow();
	expect(() =>
		parseManifest({
			...good,
			models: { ...good.models, multilingual: { ...good.models.multilingual, sha256: "abc" } },
		}),
	).toThrow();
	expect(() =>
		parseManifest({ ...good, models: { ...good.models, klingon: good.models.english } }),
	).toThrow();
});

test("a PATH runtime is compatible only within the pinned minor", () => {
	expect(compatibleVersion("nemo-speech 0.3.7\n", "0.3.0")).toBe("0.3.7");
	expect(compatibleVersion("NeMo-Speech.cpp 0.3.0", "0.3.0")).toBe("0.3.0");
	expect(compatibleVersion("nemo-speech 0.4.0", "0.3.0")).toBeNull();
	expect(compatibleVersion("nemo-speech 1.3.0", "0.3.0")).toBeNull();
	expect(compatibleVersion("garbage", "0.3.0")).toBeNull();
});

test("the doctor report names the accelerated backend", () => {
	expect(backendFromDoctor('{"features":{"backend_cuda":true}}')).toBe("cuda");
	expect(backendFromDoctor('{"features":{"backend_metal":true,"backend_cuda":false}}')).toBe(
		"metal",
	);
	expect(backendFromDoctor('{"features":{}}')).toBe("cpu");
	expect(backendFromDoctor("not json")).toBe("cpu");
});
