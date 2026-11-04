export type InteractionStep =
	| { op: "click"; selector: string; hasText?: string; double?: boolean }
	| { op: "wait"; selector: string; hasText?: string }
	| { op: "clickEach"; selector: string; count: number; stride?: number }
	| { op: "openChat"; title: string }
	| { op: "type"; selector: string; text: string; pauseMs: number }
	| {
			op: "key";
			selector?: string;
			key: string;
			count?: number;
			code?: string;
			ctrlKey?: boolean;
	  };

export interface InteractionSpec {
	setup: InteractionStep[];
	measured: InteractionStep[];
}

export async function driveInteraction(spec: InteractionSpec): Promise<string> {
	const TIMEOUT_MS = 30_000;
	const nextFrames = async (count = 2) => {
		for (let frame = 0; frame < count; frame += 1) await new Promise(requestAnimationFrame);
	};
	const candidates = (selector: string, hasText?: string) =>
		[...document.querySelectorAll<HTMLElement>(selector)].filter(
			(element) => hasText === undefined || element.textContent?.includes(hasText),
		);
	const find = async (selector: string, hasText?: string, nth = 0) => {
		const deadline = performance.now() + TIMEOUT_MS;
		while (performance.now() < deadline) {
			const element = candidates(selector, hasText)[nth];
			if (element) return element;
			await nextFrames(1);
		}
		throw new Error(`no element #${nth} for ${selector} ${hasText ?? ""}`);
	};
	const press = (element: HTMLElement, double = false) => {
		element.scrollIntoView({ block: "nearest" });
		const box = element.getBoundingClientRect();
		const init = {
			bubbles: true,
			cancelable: true,
			composed: true,
			button: 0,
			clientX: box.x + box.width / 2,
			clientY: box.y + box.height / 2,
		};
		const pointer = { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true };
		element.dispatchEvent(new PointerEvent("pointerdown", pointer));
		element.dispatchEvent(new MouseEvent("mousedown", init));
		element.focus({ preventScroll: true });
		element.dispatchEvent(new PointerEvent("pointerup", pointer));
		element.dispatchEvent(new MouseEvent("mouseup", init));
		element.dispatchEvent(new MouseEvent("click", { ...init, detail: 1 }));
		if (double) {
			element.dispatchEvent(new MouseEvent("click", { ...init, detail: 2 }));
			element.dispatchEvent(new MouseEvent("dblclick", { ...init, detail: 2 }));
		}
	};
	const setValue = (element: HTMLElement, value: string) => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
		element.dispatchEvent(new Event("input", { bubbles: true }));
	};
	const run = async (step: InteractionStep) => {
		if (step.op === "wait") {
			await find(step.selector, step.hasText);
		} else if (step.op === "click") {
			press(await find(step.selector, step.hasText), step.double);
			await nextFrames();
		} else if (step.op === "clickEach") {
			for (let index = 0; index < step.count; index += 1) {
				const total = candidates(step.selector).length;
				const nth = total === 0 ? 0 : (index * (step.stride ?? 1)) % total;
				press(await find(step.selector, undefined, nth));
				await nextFrames();
			}
		} else if (step.op === "openChat") {
			const tab = '[data-testid="editor-tab"][data-kind="chat"]';
			const history = '[data-testid="chat-history"]';
			const deadline = performance.now() + TIMEOUT_MS;
			while (performance.now() < deadline) {
				if (candidates(tab, step.title).length > 0) return;
				const item = candidates('[data-testid="closed-chat-item"]', step.title)[0];
				if (item) press(item);
				else {
					const button = candidates(history)[0];
					if (button) press(button);
				}
				await new Promise((resolve) => setTimeout(resolve, 300));
			}
			throw new Error(`chat ${step.title} did not open`);
		} else if (step.op === "type") {
			const element = await find(step.selector);
			element.focus();
			for (let length = 1; length <= step.text.length; length += 1) {
				setValue(element, step.text.slice(0, length));
				await new Promise((resolve) => setTimeout(resolve, step.pauseMs));
				await nextFrames();
			}
		} else {
			for (let index = 0; index < (step.count ?? 1); index += 1) {
				const element = step.selector ? await find(step.selector) : document.activeElement;
				if (!element) throw new Error(`no key target for ${step.key}`);
				element.dispatchEvent(
					new KeyboardEvent("keydown", {
						key: step.key,
						code: step.code ?? "",
						ctrlKey: step.ctrlKey ?? false,
						bubbles: true,
						cancelable: true,
						composed: true,
					}),
				);
				await nextFrames();
			}
		}
	};

	await find('[data-testid="connection-status"][data-status="connected"]');
	for (const step of spec.setup) await run(step);
	if (spec.setup.length > 0) await new Promise((resolve) => setTimeout(resolve, 1_000));
	await nextFrames();
	const profiler = window.__thinkrailRenderProfiler;
	if (!profiler) throw new Error("render profiler is not installed");
	profiler.reset();
	const startedAt = performance.now();
	for (const step of spec.measured) await run(step);
	await nextFrames();
	const wallMs = performance.now() - startedAt;
	return JSON.stringify({ wallMs, profile: profiler.snapshot() });
}

export function stubResourceWire(subagents: number): void {
	const send = WebSocket.prototype.send;
	WebSocket.prototype.send = function (data) {
		const frame =
			typeof data === "string"
				? (JSON.parse(data) as {
						id?: unknown;
						method?: string;
						params?: { workspaceId?: string; sessionId?: string };
					})
				: null;
		const respond = (result: unknown) =>
			queueMicrotask(() =>
				this.dispatchEvent(
					new MessageEvent("message", {
						data: JSON.stringify({ id: frame?.id, ok: true, result }),
					}),
				),
			);
		if (frame?.method === "session.resources") {
			respond({
				workspaceId: frame.params?.workspaceId,
				sessionId: frame.params?.sessionId,
				commands: [],
				subagents: Array.from({ length: subagents }, (_, index) => ({
					childSessionId: `perf-child-${index}`,
					parentSessionId: frame.params?.sessionId,
					task: `Inspect module ${index}`,
					status: "running",
					createdAt: "2026-01-01T00:00:00.000Z",
				})),
			});
			return;
		}
		if (frame?.method === "subagent.getTranscript") {
			respond({ messages: [], status: "running" });
			return;
		}
		send.call(this, data);
	};
}
