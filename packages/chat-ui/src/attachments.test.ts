import { describe, expect, test } from "bun:test";
import { CHAT_ATTACHMENT_MAX_BYTES } from "@thinkrail/contracts";
import {
	base64ToBytes,
	chipKeyAction,
	dragMayCarryFiles,
	dropHidesFiles,
	fileAttachmentRefusal,
	formatFileSize,
	getNativeClipboardBridge,
	pasteMayHideFiles,
	withoutSentDraft,
	withRestoredDraft,
} from "./attachments";

describe("a draft held by an upload", () => {
	test("text restored meanwhile goes above the held draft", () => {
		expect(withRestoredDraft("queued", "held")).toBe("queued\n\nheld");
		expect(withRestoredDraft("queued", "")).toBe("queued");
		expect(withRestoredDraft("queued", "  ")).toBe("queued");
		expect(withRestoredDraft("second", withRestoredDraft("first", "held"))).toBe(
			"second\n\nfirst\n\nheld",
		);
	});

	test("an accepted send removes only the text it sent", () => {
		expect(withoutSentDraft("held", "held")).toBe("");
		expect(withoutSentDraft("queued\n\nheld", "held")).toBe("queued");
		expect(withoutSentDraft("second\n\nfirst\n\nheld", "held")).toBe("second\n\nfirst");
		expect(withoutSentDraft("queued", "")).toBe("queued");
		expect(withoutSentDraft("replaced", "held")).toBe("replaced");
		expect(withoutSentDraft("", "")).toBe("");
	});
});

test("file attachments are refused over 100 MB and on a host that cannot take them", () => {
	expect(fileAttachmentRefusal(CHAT_ATTACHMENT_MAX_BYTES, true)).toBeNull();
	expect(fileAttachmentRefusal(CHAT_ATTACHMENT_MAX_BYTES + 1, true)).toBe("larger than 100 MB");
	expect(fileAttachmentRefusal(10, false)).toBe("this host can't take files — update ThinkRail");
});

test("sizes read in binary steps with one decimal", () => {
	expect(formatFileSize(512, "en")).toBe("512B");
	expect(formatFileSize(2.4 * 1024 * 1024, "en")).toBe("2.4 MB");
	expect(formatFileSize(1536, "en")).toBe("1.5 kB");
	expect(formatFileSize(3 * 1024 ** 3, "en")).toBe("3 GB");
});

describe("chipKeyAction", () => {
	test("arrows, Home and End move within the strip and stop at its ends", () => {
		expect(chipKeyAction("ArrowRight", 0, 3)).toEqual({ kind: "focus", index: 1 });
		expect(chipKeyAction("ArrowRight", 2, 3)).toEqual({ kind: "focus", index: 2 });
		expect(chipKeyAction("ArrowLeft", 0, 3)).toEqual({ kind: "focus", index: 0 });
		expect(chipKeyAction("ArrowUp", 2, 3)).toEqual({ kind: "focus", index: 1 });
		expect(chipKeyAction("Home", 2, 3)).toEqual({ kind: "focus", index: 0 });
		expect(chipKeyAction("End", 0, 3)).toEqual({ kind: "focus", index: 2 });
	});

	test("Delete lands on the chip that takes the removed one's place, Backspace on the one before", () => {
		expect(chipKeyAction("Delete", 0, 3)).toEqual({ kind: "remove", index: 0, next: 0 });
		expect(chipKeyAction("Delete", 2, 3)).toEqual({ kind: "remove", index: 2, next: 1 });
		expect(chipKeyAction("Backspace", 1, 3)).toEqual({ kind: "remove", index: 1, next: 0 });
		expect(chipKeyAction("Backspace", 0, 3)).toEqual({ kind: "remove", index: 0, next: 0 });
	});

	test("removing the last chip, or Esc, returns to the field", () => {
		expect(chipKeyAction("Delete", 0, 1)).toEqual({ kind: "remove", index: 0, next: null });
		expect(chipKeyAction("Backspace", 0, 1)).toEqual({ kind: "remove", index: 0, next: null });
		expect(chipKeyAction("Escape", 1, 2)).toEqual({ kind: "field" });
	});

	test("other keys and an empty strip do nothing", () => {
		expect(chipKeyAction("Enter", 0, 2)).toBeNull();
		expect(chipKeyAction("a", 0, 2)).toBeNull();
		expect(chipKeyAction("Delete", 0, 0)).toBeNull();
	});
});

describe("pasteMayHideFiles", () => {
	test("asks the native clipboard for announced files, images, URI lists and empty pastes", () => {
		expect(pasteMayHideFiles(["Files"], "")).toBe(true);
		expect(pasteMayHideFiles(["image/png"], "")).toBe(true);
		expect(pasteMayHideFiles(["text/uri-list", "text/plain"], "file:///a.pdf")).toBe(true);
		expect(pasteMayHideFiles([], "")).toBe(true);
	});

	test("asks it for a file manager's text-only copy: GNOME's copied-files text or file:// URIs", () => {
		expect(
			pasteMayHideFiles(
				["text/plain"],
				"x-special/nautilus-clipboard\ncopy\nfile:///home/me/a.pdf\n",
			),
		).toBe(true);
		expect(pasteMayHideFiles(["text/plain"], "cut\nfile:///home/me/a.pdf")).toBe(true);
		expect(pasteMayHideFiles(["text/plain"], "file:///home/me/a.pdf\nfile:///home/me/b.png")).toBe(
			true,
		);
	});

	test("leaves ordinary text and copied bare paths to the native paste", () => {
		expect(pasteMayHideFiles(["text/plain"], "hello")).toBe(false);
		expect(pasteMayHideFiles(["text/plain", "text/html"], "see /etc/hosts")).toBe(false);
		expect(pasteMayHideFiles(["text/plain"], "/home/me/design.pdf\n/home/me/a.txt")).toBe(false);
		expect(pasteMayHideFiles(["text/plain"], "/etc/hosts")).toBe(false);
	});
});

test("a drop is hidden when it announces files or a URI list and carries neither", () => {
	expect(dropHidesFiles(["Files"], 0, "")).toBe(true);
	expect(dropHidesFiles(["text/uri-list", "text/html"], 0, "")).toBe(true);
	expect(dropHidesFiles(["Files"], 2, "")).toBe(false);
	expect(dropHidesFiles(["text/uri-list"], 0, "https://example.com")).toBe(false);
	expect(dropHidesFiles(["text/plain"], 0, "")).toBe(false);
	expect(dragMayCarryFiles(["text/uri-list", "text/html"])).toBe(true);
	expect(dragMayCarryFiles(["Files"])).toBe(true);
	expect(dragMayCarryFiles(["text/plain"])).toBe(false);
});

test("the native clipboard bridge is shape-guarded", () => {
	const bridge = { read: async () => ({ kind: "none" as const }) };
	expect(getNativeClipboardBridge(bridge)).toBe(bridge);
	expect(getNativeClipboardBridge({ read: 1 })).toBeNull();
	expect(getNativeClipboardBridge(undefined)).toBeNull();
});

test("base64ToBytes decodes clipboard image data", () => {
	expect([...base64ToBytes("AQID")]).toEqual([1, 2, 3]);
});
