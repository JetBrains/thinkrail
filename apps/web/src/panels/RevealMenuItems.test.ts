import { expect, test } from "bun:test";
import { FS_REVEAL_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { supportsFsReveal } from "./fileTreeActions";
import { revealInFileManagerLabel } from "./RevealMenuItems";

test("the OS reveal is named after the host's file manager", () => {
	expect(revealInFileManagerLabel("darwin")).toBe("panels.reveal.finder");
	expect(revealInFileManagerLabel("win32")).toBe("panels.reveal.explorer");
	expect(revealInFileManagerLabel("linux")).toBe("panels.reveal.fileManager");
	expect(revealInFileManagerLabel(null)).toBe("panels.reveal.fileManager");
});

test("the OS reveal is offered only by a host that answers fs.reveal", () => {
	expect(supportsFsReveal(null)).toBe(false);
	expect(supportsFsReveal(FS_REVEAL_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsFsReveal(FS_REVEAL_PROTOCOL_VERSION)).toBe(true);
});
