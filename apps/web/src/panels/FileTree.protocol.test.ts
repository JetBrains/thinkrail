import { expect, test } from "bun:test";
import { FS_MUTATIONS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { supportsFileMutations } from "./FileTree";

test("file mutation actions remain hidden until the host advertises their protocol", () => {
	expect(supportsFileMutations(null)).toBe(false);
	expect(supportsFileMutations(FS_MUTATIONS_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsFileMutations(FS_MUTATIONS_PROTOCOL_VERSION)).toBe(true);
});
