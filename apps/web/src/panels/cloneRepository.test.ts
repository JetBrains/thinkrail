import { expect, test } from "bun:test";
import { PROJECT_CLONE_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { selectSupportsProjectClone } from "../store";
import { cloneDepth, repositoryFolderName } from "./cloneRepository";

test("repository URLs suggest editable folder names across Git hosts and transports", () => {
	for (const url of [
		"https://github.com/owner/repo.git",
		"https://gitlab.example/group/repo/",
		"ssh://git@host:2222/team/repo.git",
		"git@host:team/repo.git",
		"file:///tmp/repo.git",
		"git://host/repo.git",
	]) {
		expect(repositoryFolderName(url)).toBe("repo");
	}
	expect(repositoryFolderName("https://host/%E9%A1%B9%E7%9B%AE.git")).toBe("项目");
	expect(repositoryFolderName("https://host/bad%2Fname.git")).toBe("name");
	expect(repositoryFolderName("https://host/%broken")).toBe("");
	expect(repositoryFolderName("https://")).toBe("");
	expect(repositoryFolderName("")).toBe("");
});

test("clone depth is optional but otherwise a bounded positive integer", () => {
	expect(cloneDepth("")).toBeUndefined();
	expect(cloneDepth("  ")).toBeUndefined();
	expect(cloneDepth("1")).toBe(1);
	expect(cloneDepth(" 20 ")).toBe(20);
	for (const value of ["0", "-1", "1.5", "1e2", "abc", "2147483648"])
		expect(cloneDepth(value)).toBeNull();
});

test("cloning is hidden until a capable host welcomes the client", () => {
	expect(selectSupportsProjectClone({ protocolVersion: null })).toBe(false);
	expect(selectSupportsProjectClone({ protocolVersion: PROJECT_CLONE_PROTOCOL_VERSION - 1 })).toBe(
		false,
	);
	expect(selectSupportsProjectClone({ protocolVersion: PROJECT_CLONE_PROTOCOL_VERSION })).toBe(
		true,
	);
});
