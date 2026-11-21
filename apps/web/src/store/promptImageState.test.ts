import { expect, test } from "bun:test";
import {
	newPromptImagesState,
	type PromptImagesState,
	withCopiedPromptFile,
	withoutPromptChips,
} from "./promptImageState";

function draft(): PromptImagesState {
	return {
		...newPromptImagesState(),
		images: [
			{
				id: "sent-image",
				name: "a.png",
				content: { type: "image", mimeType: "image/png", data: "" },
			},
			{
				id: "restored-image",
				name: "queued-image-1",
				content: { type: "image", mimeType: "image/png", data: "" },
			},
		],
		files: [
			{ id: "sent-file", name: "a.pdf", size: 1, source: { kind: "local", path: "/a.pdf" } },
			{ id: "other-file", name: "b.pdf", size: 1, source: { kind: "local", path: "/b.pdf" } },
		],
		errors: [{ id: "sent-error", name: "c.heic", reason: "unsupported" }],
	};
}

test("an accepted send removes the chips it sent and keeps what arrived meanwhile", () => {
	const state = draft();
	const after = withoutPromptChips(state, ["sent-image", "sent-file", "sent-error"]);
	expect(after.images.map((image) => image.id)).toEqual(["restored-image"]);
	expect(after.files.map((file) => file.id)).toEqual(["other-file"]);
	expect(after.errors).toEqual([]);
	expect(after.generation).toBe(state.generation);
});

test("a copied file remembers its path; an unknown id changes nothing", () => {
	const state = draft();
	const after = withCopiedPromptFile(state, "sent-file", ".thinkrail/context/attachments/a.pdf");
	expect(after.files[0]?.copied).toBe(".thinkrail/context/attachments/a.pdf");
	expect(after.files[1]?.copied).toBeUndefined();
	expect(withCopiedPromptFile(state, "gone", "x")).toBe(state);
});
