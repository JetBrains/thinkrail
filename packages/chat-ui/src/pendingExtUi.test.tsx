import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { act, type ReactNode, StrictMode, useRef } from "react";
import { createRoot } from "react-dom/client";
import { type PendingExtUi, useArrivalReveal } from "./ExtUiPrompt";
import { usePendingExtUi } from "./pendingExtUi";
import type { ExtUiDialogRequest } from "./types";

type TestGlobals = {
	IS_REACT_ACT_ENVIRONMENT?: boolean | undefined;
	window?: unknown;
	requestAnimationFrame?: unknown;
	cancelAnimationFrame?: unknown;
};
const globals = globalThis as TestGlobals;
const saved = {
	IS_REACT_ACT_ENVIRONMENT: globals.IS_REACT_ACT_ENVIRONMENT,
	window: globals.window,
	requestAnimationFrame: globals.requestAnimationFrame,
	cancelAnimationFrame: globals.cancelAnimationFrame,
};
const queuedFrames = new Map<number, () => void>();
let nextFrame = 0;

beforeAll(() => {
	const noop = () => {};
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	globals.window = {
		event: undefined,
		HTMLIFrameElement: class {},
		document: { activeElement: null },
		addEventListener: noop,
		removeEventListener: noop,
	};
	globals.requestAnimationFrame = (callback: () => void) => {
		nextFrame += 1;
		queuedFrames.set(nextFrame, callback);
		return nextFrame;
	};
	globals.cancelAnimationFrame = (frame: number) => queuedFrames.delete(frame);
});
afterAll(() => {
	Object.assign(globals, saved);
});

const revealed: HTMLElement[] = [];
beforeEach(() => {
	revealed.length = 0;
	queuedFrames.clear();
});

const actions = {
	cancelAutomaticReveal: () => {},
	revealChatElement: (element: HTMLElement) => {
		revealed.push(element);
	},
};
const CARD = { tagName: "SECTION" } as unknown as HTMLElement;

function headlessContainer() {
	const noop = () => {};
	return {
		nodeType: 1,
		nodeName: "DIV",
		tagName: "DIV",
		namespaceURI: "http://www.w3.org/1999/xhtml",
		textContent: "",
		addEventListener: noop,
		removeEventListener: noop,
		ownerDocument: { nodeType: 9, addEventListener: noop, removeEventListener: noop },
	} as unknown as Element;
}

async function mount(node: ReactNode) {
	const root = createRoot(headlessContainer());
	await act(async () => root.render(<StrictMode>{node}</StrictMode>));
	return {
		rerender: (next: ReactNode) => act(async () => root.render(<StrictMode>{next}</StrictMode>)),
		unmount: () => act(async () => root.unmount()),
	};
}

const runFrame = () =>
	act(async () => {
		const due = [...queuedFrames.values()];
		queuedFrames.clear();
		for (const callback of due) callback();
	});

async function runFrames() {
	while (queuedFrames.size > 0) await runFrame();
}

function AnchoredPrompt({ pending }: { pending: PendingExtUi }) {
	const rootRef = useRef(CARD);
	const anchored = pending.request.toolCallId !== undefined;
	useArrivalReveal(rootRef, anchored, pending.revealOpen, pending.closeReveal, actions);
	return null;
}

function ChatView(props: {
	request: ExtUiDialogRequest | null;
	cardMounted: boolean;
	mount?: number;
}) {
	const pending = usePendingExtUi(props.request, () => {});
	return pending && props.cardMounted ? (
		<AnchoredPrompt key={props.mount} pending={pending} />
	) : null;
}

const approval = (id: string): ExtUiDialogRequest => ({
	id,
	sessionId: "s",
	kind: "confirm",
	title: "Allow linear/create_issue?",
	message: "Sure?",
	toolCallId: "call-linear",
});

test("an anchored prompt that mounts with its request reveals itself once, also under StrictMode", async () => {
	const first = approval("first");
	const view = await mount(<ChatView request={null} cardMounted mount={1} />);
	await view.rerender(<ChatView request={first} cardMounted mount={1} />);
	await runFrame();
	expect(revealed).toEqual([CARD]);
	await view.rerender(<ChatView request={first} cardMounted mount={2} />);
	await runFrames();
	await view.rerender(<ChatView request={first} cardMounted mount={3} />);
	await runFrames();
	expect(revealed).toEqual([CARD]);

	await view.rerender(<ChatView request={approval("second")} cardMounted mount={4} />);
	await runFrames();
	expect(revealed).toEqual([CARD, CARD]);
	await view.unmount();
});

test("a card drawn a frame after its request still reveals itself", async () => {
	const request = approval("drawn-late");
	const view = await mount(<ChatView request={null} cardMounted={false} />);
	await view.rerender(<ChatView request={request} cardMounted={false} />);
	await runFrame();
	await view.rerender(<ChatView request={request} cardMounted />);
	await runFrames();
	expect(revealed).toEqual([CARD]);
	await view.unmount();
});

test("a card that mounts after its request's first two frames does not reveal itself", async () => {
	const request = approval("late");
	const view = await mount(<ChatView request={null} cardMounted={false} />);
	await view.rerender(<ChatView request={request} cardMounted={false} />);
	await runFrame();
	await runFrame();
	await view.rerender(<ChatView request={request} cardMounted />);
	await runFrames();
	expect(revealed).toEqual([]);
	await view.unmount();
});

test("a chat view that opens with the request already pending does not reveal it", async () => {
	const view = await mount(<ChatView request={approval("pending")} cardMounted />);
	await runFrames();
	expect(revealed).toEqual([]);
	await view.unmount();
});
