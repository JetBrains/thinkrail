import { beforeEach, expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReviewThread } from "../registry";
import { ReviewThreadCard } from "../support/ReviewThreadCard";
import { useStampedComposer } from "./reviewComposerState";
import {
	ReviewDraftContext,
	type ReviewDraftPersistence,
	reviewTextState,
} from "./reviewDraftState";

type Selection = { side: "base" | "worktree"; anchor: string };
type Composer = ReturnType<typeof useStampedComposer<Selection>>;

const sections = new Map<string, Record<string, unknown>>();

beforeEach(() => sections.clear());

function persistence(
	path = "file.ts",
	rendererId = "thinkrail/code",
	workspace = "ws",
	id = "branch",
): ReviewDraftPersistence {
	const section = JSON.stringify([workspace, id, path]);
	return {
		rendererId,
		read: (key) => sections.get(section)?.[key],
		subscribe: () => () => {},
		update: (key, update) => {
			const values = { ...sections.get(section) };
			const next = update(values[key]);
			if (next === undefined) delete values[key];
			else values[key] = next;
			sections.set(section, values);
		},
	};
}

function mount(scope = persistence(), stamp = "content-hash", slot = "selection"): Composer {
	const result: { current: Composer | null } = { current: null };
	function Probe() {
		result.current = useStampedComposer<Selection>(stamp, slot);
		return null;
	}
	renderToStaticMarkup(
		<ReviewDraftContext value={scope}>
			<Probe />
		</ReviewDraftContext>,
	);
	if (!result.current) throw new Error("Composer did not render");
	return result.current;
}

function typeText(composer: Composer, text = "unsaved review") {
	if (!composer.input) throw new Error("Missing scoped input");
	composer.input.onChange({ ...reviewTextState(text), start: 2, end: 6, direction: "backward" });
}

test("selection, side, text, caret and pending submission survive a fresh section mount", () => {
	mount().select({ side: "base", anchor: "L3–6" });
	expect(mount().input?.restored).toBe(true);
	expect(mount().input?.read()).toBeUndefined();
	typeText(mount());
	const restored = mount();
	expect(restored.composing).toBe(true);
	expect(restored.selection).toEqual({ side: "base", anchor: "L3–6" });
	expect(restored.input?.read()).toEqual({
		text: "unsaved review",
		start: 2,
		end: 6,
		direction: "backward",
		busy: false,
	});
	const input = restored.input;
	const typed = input?.read();
	if (!input || !typed) throw new Error("Missing input");
	input.onChange({ ...typed, busy: true });
	expect(mount().input?.read()?.busy).toBe(true);
	input.onChange({ ...typed, busy: false });
	expect(mount().input?.read()?.text).toBe("unsaved review");
	expect(mount().input?.read()?.busy).toBe(false);
});

test("draft scratch is isolated by workspace, tab scope, file, renderer and surface slot", () => {
	mount().select({ side: "worktree", anchor: "L2" });
	typeText(mount());
	for (const scope of [
		persistence("other.ts"),
		persistence("file.ts", "thinkrail/json"),
		persistence("file.ts", "thinkrail/code", "other-ws"),
		persistence("file.ts", "thinkrail/code", "ws", "uncommitted"),
	]) {
		expect(mount(scope).selection).toBeNull();
		expect(mount(scope).input?.read()).toBeUndefined();
	}
	mount(persistence(), "content-hash", "page 1:base").select({ side: "base", anchor: "region" });
	typeText(mount(persistence(), "content-hash", "page 1:base"), "old page region");
	expect(mount(persistence(), "content-hash", "page 1:worktree").selection).toBeNull();
	expect(mount(persistence(), "content-hash", "page 2:base").selection).toBeNull();
	expect(mount().input?.read()?.text).toBe("unsaved review");
});

test("Cancel or completed Save/Send clears scratch after unmount, and cannot close a newer composer", () => {
	for (const outcome of ["Cancel", "Save", "Send"]) {
		mount().select({ side: "worktree", anchor: outcome });
		const beforeUnmount = mount();
		typeText(beforeUnmount);
		expect(mount().composing).toBe(true);
		beforeUnmount.close();
		expect(mount().selection).toBeNull();
		expect(mount().input?.read()).toBeUndefined();
		typeText(beforeUnmount, "late failed request");
		expect(mount().input?.read()).toBeUndefined();
		mount().select({ side: "worktree", anchor: "new selection" });
		typeText(mount(), "new text");
		beforeUnmount.close();
		expect(mount().input?.read()?.text).toBe("new text");
		mount().close();
	}
});

test("typing writes only the composer's text slot, never the selection slot a surface reads", () => {
	mount().select({ side: "worktree", anchor: "L2" });
	const selectionSlot = JSON.stringify(["thinkrail/code", "selection"]);
	const selection = persistence().read(selectionSlot);
	typeText(mount(), "a");
	typeText(mount(), "ab");
	expect(persistence().read(selectionSlot)).toBe(selection);
	expect(mount().input?.read()?.text).toBe("ab");
});

test("a new selection or a close retires the text, while re-opening the same selection keeps it", () => {
	mount().select({ side: "worktree", anchor: "L2" }, false);
	typeText(mount(), "kept");
	mount().open();
	expect(mount().composing).toBe(true);
	expect(mount().input?.read()?.text).toBe("kept");
	mount().select({ side: "worktree", anchor: "L5" });
	expect(mount().input?.read()).toBeUndefined();
	typeText(mount(), "retired by close");
	mount().close();
	expect(mount().input?.read()).toBeUndefined();
});

test("a changed content stamp never restores a selection against a different revision", () => {
	mount().select({ side: "base", anchor: "L2" });
	typeText(mount());
	const refreshed = mount(persistence(), "new-content-hash");
	expect(refreshed.selection).toBeNull();
	expect(refreshed.composing).toBe(false);
	expect(refreshed.stale).toBe(true);
});

test("rich composers retain the same scratch across renderer switches", () => {
	mount(persistence("file.json", "thinkrail/json")).select({ side: "worktree", anchor: "/value" });
	typeText(mount(persistence("file.json", "thinkrail/json")), "structural note");
	expect(mount(persistence("file.json", "thinkrail/code")).selection).toBeNull();
	expect(mount(persistence("file.json", "thinkrail/json")).selection?.anchor).toBe("/value");
	expect(mount(persistence("file.json", "thinkrail/json")).input?.read()?.text).toBe(
		"structural note",
	);
});

test("draft thread scratch restores in rich and source cards without a host write", () => {
	const thread: ReviewThread = {
		id: "comment-1",
		body: "host draft",
		status: "draft",
		anchor: { path: "file.json", side: "worktree", selectors: [] },
		anchorState: "anchored",
		stale: false,
	};
	let writes = 0;
	const actions = {
		onSendComment: async () => {
			writes += 1;
		},
		onDeleteComment: async () => {
			writes += 1;
		},
		onUpdateComment: async () => {
			writes += 1;
		},
	};
	persistence("file.json").update(JSON.stringify([null, "thread:comment-1"]), () =>
		reviewTextState("unsaved thread edit"),
	);
	for (const renderer of ["thinkrail/json", "thinkrail/code"]) {
		const markup = renderToStaticMarkup(
			<ReviewDraftContext value={persistence("file.json", renderer)}>
				<TooltipProvider>
					<ReviewThreadCard thread={thread} actions={actions} />
				</TooltipProvider>
			</ReviewDraftContext>,
		);
		expect(markup).toContain(">unsaved thread edit</textarea>");
	}
	const perFile = renderToStaticMarkup(
		<TooltipProvider>
			<ReviewThreadCard thread={thread} actions={actions} />
		</TooltipProvider>,
	);
	expect(perFile).toContain(">host draft</textarea>");
	expect(writes).toBe(0);
});
