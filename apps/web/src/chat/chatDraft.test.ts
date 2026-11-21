import { beforeEach, expect, test } from "bun:test";
import type { ChatAttachment } from "@thinkrail/chat-ui/types";
import { EMPTY_RUNTIME, useAppStore } from "@/store";
import { queuedDraft, restoreQueueToDraft, restoreTextToDraft } from "./chatDraft";

const image = { type: "image" as const, data: "x", mimeType: "image/png" };

beforeEach(() => {
	useAppStore.setState(useAppStore.getInitialState(), true);
	useAppStore.setState({ sessions: { s: { ...EMPTY_RUNTIME, draft: "typed since" } } });
});

test("queued messages become one draft of their non-blank texts, with every image", () => {
	const queued = queuedDraft({
		steering: [{ text: "first", images: [image] }],
		followUp: [{ text: " " }, { text: "second" }],
	});
	expect(queued).toEqual({ text: "first\n\nsecond", images: [image] });
});

test("restored text goes into the chat's stored draft ahead of what was typed since", () => {
	restoreTextToDraft("s", "lost", null);
	expect(useAppStore.getState().sessions.s?.draft).toBe("lost\n\ntyped since");
	restoreTextToDraft("s", "  ", null);
	expect(useAppStore.getState().sessions.s?.draft).toBe("lost\n\ntyped since");
});

test("a restored queue puts its text in the draft and its images back on the composer", () => {
	const attached: ChatAttachment[][] = [];
	let focused = 0;
	const composer = {
		restoreAttachments: (attachments: ChatAttachment[]) => attached.push(attachments),
		refocus: () => {
			focused += 1;
		},
	} as unknown as Parameters<typeof restoreQueueToDraft>[2];
	restoreQueueToDraft(
		"s",
		{ steering: [{ text: "queued", images: [image] }], followUp: [] },
		composer,
	);
	expect(useAppStore.getState().sessions.s?.draft).toBe("queued\n\ntyped since");
	expect(attached).toEqual([[{ name: "queued-image-1", content: image }]]);
	expect(focused).toBe(1);
});
