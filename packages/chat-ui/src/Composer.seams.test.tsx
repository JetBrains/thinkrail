import { afterAll, beforeAll, expect, test } from "bun:test";
import type { LocalKeyCommand } from "@thinkrail/ui/keyboard";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { parseHTML } from "linkedom";
import { act, type ComponentProps, useState } from "react";
import type { Root } from "react-dom/client";
import type { SubmitBehavior } from "./Composer";
import type { ModelEffortPickerHandle } from "./ModelEffortPicker";
import type { ModelPreferences } from "./modelPreferences";

const { window: dom, document } = parseHTML("<!doctype html><html><body></body></html>");
const fakeGlobals = {
	IS_REACT_ACT_ENVIRONMENT: true,
	window: dom,
	document,
	CustomEvent: dom.CustomEvent,
	getComputedStyle: () => ({ lineHeight: "20", paddingTop: "0", paddingBottom: "0" }),
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
	cancelAnimationFrame: (frame: ReturnType<typeof setTimeout>) => clearTimeout(frame),
};
const globals = globalThis as Record<string, unknown>;
const saved = Object.fromEntries(Object.keys(fakeGlobals).map((key) => [key, globals[key]]));

let createRoot: (container: Element) => Root;
let Composer: typeof import("./Composer").Composer;

beforeAll(async () => {
	Object.assign(globals, fakeGlobals);
	// React DOM may load here with this DOM, or already have loaded DOM-less in another file (its old-IE input path).
	Object.assign(document, { oninput: null });
	Object.assign(Reflect.get(dom, "HTMLTextAreaElement").prototype, {
		setSelectionRange() {},
		attachEvent() {},
		detachEvent() {},
	});
	({ createRoot } = await import("react-dom/client"));
	({ Composer } = await import("./Composer"));
});
afterAll(() => {
	Object.assign(globals, saved);
});

const preferences: ModelPreferences = {
	supported: false,
	favorites: [],
	recents: [],
	defaultEffort: undefined,
	isFavorite: () => false,
	toggleFavorite: () => {},
	isDefault: () => false,
	setDefault: () => {},
};

type Overrides = Partial<ComponentProps<typeof Composer>> & { initial?: string };

async function mount({ initial = "", ...overrides }: Overrides) {
	const sent: { text: string; behavior: SubmitBehavior }[] = [];
	function Harness() {
		const [value, setValue] = useState(initial);
		return (
			<TooltipProvider>
				<Composer
					value={value}
					onChange={setValue}
					readDraft={() => value}
					acceptsFiles={false}
					onAttachmentNotice={() => {}}
					isStreaming={false}
					awaitingResponse={false}
					growthLimit="half-chat"
					commands={[]}
					templatePending={false}
					mentionCandidates={[]}
					recentPrompts={[]}
					models={[]}
					modelsRefreshing={false}
					onRefreshModels={() => {}}
					currentModel={null}
					thinkingLevel="off"
					modelPreferences={preferences}
					onMentionQuery={() => {}}
					onSlashActive={() => {}}
					onSelectModel={() => {}}
					onSelectThinking={() => {}}
					onSubmit={(text, _attachments, behavior) => {
						sent.push({ text, behavior });
						return { accepted: true };
					}}
					onAbort={() => {}}
					{...overrides}
				/>
			</TooltipProvider>
		);
	}
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container as unknown as Element);
	await act(async () => root.render(<Harness />));
	const input = container.querySelector("textarea");
	if (!input) throw new Error("composer rendered no input");
	await act(async () => input.dispatchEvent(new dom.Event("focusin", { bubbles: true })));
	return {
		container,
		sent,
		async press(key: "Enter", modifiers: { ctrlKey?: boolean; altKey?: boolean } = {}) {
			const event = new dom.Event("keydown", { bubbles: true, cancelable: true });
			Object.assign(event, {
				key,
				code: key,
				keyCode: 13,
				shiftKey: false,
				ctrlKey: false,
				altKey: false,
				metaKey: false,
				isComposing: false,
				...modifiers,
			});
			await act(async () => input.dispatchEvent(event));
		},
		async dispatch(type: string, listening: boolean) {
			await act(async () =>
				input.dispatchEvent(new dom.CustomEvent(type, { detail: { listening }, bubbles: true })),
			);
		},
		unmount: () => act(async () => root.unmount()),
	};
}

test("/model opens the host's external picker with its query instead of sending", async () => {
	const opened: (string | undefined)[] = [];
	const picker: ModelEffortPickerHandle = { open: (query) => opened.push(query), focus: () => {} };
	const composer = await mount({ initial: "/model sonnet", externalModelPicker: picker });
	expect(composer.container.querySelector('[data-testid="model-selector"]')).toBeNull();
	await composer.press("Enter");
	expect(opened).toEqual(["sonnet"]);
	expect(composer.sent).toEqual([]);
	await composer.unmount();
});

test("dictation holds sending while it listens and releases it when it ends", async () => {
	const composer = await mount({ initial: "hello", dictationEvent: "test:dictation" });
	await composer.dispatch("test:dictation", true);
	await composer.press("Enter");
	expect(composer.sent).toEqual([]);
	await composer.dispatch("test:dictation", false);
	await composer.press("Enter");
	expect(composer.sent).toEqual([{ text: "hello", behavior: "send" }]);
	await composer.unmount();
});

test("without a dictation event the composer never waits for dictation", async () => {
	const composer = await mount({ initial: "hello" });
	await composer.dispatch("test:dictation", true);
	await composer.press("Enter");
	expect(composer.sent).toEqual([{ text: "hello", behavior: "send" }]);
	await composer.unmount();
});

const SHORTCUTS: readonly LocalKeyCommand[] = [
	{ id: "composer.followUp", chords: [{ code: "Enter", key: "Enter", ctrl: true }] },
	{ id: "composer.interrupt", chords: [{ code: "Enter", key: "Enter", alt: true }] },
];

test("the host's composer shortcuts route a streaming send to follow-up or interrupt", async () => {
	const composer = await mount({ initial: "next", isStreaming: true, localKeyDefaults: SHORTCUTS });
	await composer.press("Enter", { ctrlKey: true });
	expect(composer.sent.at(-1)).toEqual({ text: "next", behavior: "followUp" });
	await composer.unmount();
	const interrupting = await mount({
		initial: "stop",
		isStreaming: true,
		localKeyDefaults: SHORTCUTS,
	});
	await interrupting.press("Enter", { altKey: true });
	expect(interrupting.sent).toEqual([{ text: "stop", behavior: "interrupt" }]);
	await interrupting.unmount();
});

test("with no composer shortcuts Enter still sends, and steers while streaming", async () => {
	const idle = await mount({ initial: "hi" });
	await idle.press("Enter");
	expect(idle.sent).toEqual([{ text: "hi", behavior: "send" }]);
	await idle.unmount();
	const streaming = await mount({ initial: "more", isStreaming: true });
	await streaming.press("Enter");
	expect(streaming.sent).toEqual([{ text: "more", behavior: "steer" }]);
	await streaming.unmount();
});
