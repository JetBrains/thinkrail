import type { GlobalOverlayProps } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { isApplePlatform } from "@thinkrail/ui/keyboard";
import { Keycaps } from "@thinkrail/ui/keycaps";
import { useEffect, useInsertionEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { hintKeyAction, SHOW_HINTS, typeLetter } from "./keys";
import { hintLabels } from "./labels";
import { activate } from "./press";
import {
	collectTargets,
	type HintEnv,
	type HintRect,
	type HintTarget,
	measureTargets,
} from "./targets";

interface HintSession {
	readonly targets: readonly HintTarget<HTMLElement>[];
	readonly labels: readonly string[];
	readonly boxes: readonly (HintRect | null)[];
	readonly typed: string;
}

const LABEL_OFFSET = { left: 4, top: 6, edge: 2 };
const REVEAL_ATTRIBUTE = "data-hint-mode";

function createSessionStore() {
	let session: HintSession | null = null;
	const listeners = new Set<() => void>();
	return {
		get: (): HintSession | null => session,
		set(next: HintSession | null) {
			if (next === session) return;
			session = next;
			for (const listener of listeners) listener();
		},
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

function clipsOverflow(element: Element): boolean {
	const style = getComputedStyle(element);
	return style.overflowX !== "visible" || style.overflowY !== "visible";
}

function shownLabels(session: HintSession): string[] {
	return session.labels.map((label, index) => (session.boxes[index] ? label : ""));
}

function HintLabel({ label, typed, box }: { label: string; typed: string; box: HintRect }) {
	const left = Math.max(LABEL_OFFSET.edge, box.left - LABEL_OFFSET.left);
	const top = Math.max(LABEL_OFFSET.edge, box.top - LABEL_OFFSET.top);
	return (
		<span
			ref={(node) => {
				node?.style.setProperty("--hint-left", `${left}px`);
				node?.style.setProperty("--hint-top", `${top}px`);
			}}
			data-testid="hint-label"
			data-hint-label={label}
			className="fixed top-(--hint-top) left-(--hint-left) rounded-xs bg-control-primary-bg px-4 tr-text-label-pill text-control-primary-text shadow-(--shadow-sm)"
		>
			<span className="text-control-primary-disabled-text">{label.slice(0, typed.length)}</span>
			{label.slice(typed.length)}
		</span>
	);
}

function HintBar({ platform }: { platform: string }) {
	const t = useT();
	const apple = isApplePlatform(platform);
	const hints = [
		{ key: apple ? "⇧" : "Shift", text: t("hintMode.bar.focusOnly") },
		{ key: apple ? "⌫" : "Backspace", text: t("hintMode.bar.undo") },
		{ key: "Esc", text: t("hintMode.bar.exit") },
	];
	return (
		<div
			role="status"
			data-testid="hint-mode-bar"
			className="fixed top-48 left-1/2 flex -translate-x-1/2 items-center gap-12 rounded-md border border-border-default bg-container-elevated-bg px-12 py-4 tr-text-metadata text-text-muted shadow-(--shadow-md)"
		>
			<span className="tr-title-compact text-text-default">{t("hintMode.title")}</span>
			<span>{t("hintMode.bar.type")}</span>
			{hints.map((hint) => (
				<span key={hint.key} className="flex items-center gap-4">
					<Keycaps keys={[hint.key]} />
					{hint.text}
				</span>
			))}
		</div>
	);
}

export function HintMode(props: GlobalOverlayProps) {
	const [store] = useState(createSessionStore);
	const host = useRef(props);
	useInsertionEffect(() => {
		host.current = props;
	});
	const session = useSyncExternalStore(store.subscribe, store.get, () => null);

	useEffect(() => {
		const env = (): HintEnv<HTMLElement> => ({
			isTextEntry: (element) => host.current.isTextEntry(element),
			clips: clipsOverflow,
			viewport: { width: window.innerWidth, height: window.innerHeight },
		});
		const root = document.documentElement;
		const leave = () => {
			store.set(null);
			host.current.claimKeyboard(false);
		};
		const exit = () => {
			root.removeAttribute(REVEAL_ATTRIBUTE);
			leave();
		};
		const start = () => {
			root.setAttribute(REVEAL_ATTRIBUTE, "");
			const { targets, boxes } = collectTargets<HTMLElement>(host.current.activeLayer(), env());
			if (targets.length === 0) {
				root.removeAttribute(REVEAL_ATTRIBUTE);
				return;
			}
			host.current.claimKeyboard(true);
			store.set({ targets, boxes, labels: hintLabels(targets.length), typed: "" });
		};
		const choose = (current: HintSession, index: number, focusOnly: boolean) => {
			leave();
			const target = current.targets[index];
			const box = current.boxes[index];
			if (target?.element.isConnected && box) {
				activate(target.element, target.action, focusOnly, box);
			}
			root.removeAttribute(REVEAL_ATTRIBUTE);
		};
		const onCommand = (id: string) => {
			if (id !== SHOW_HINTS.id) return;
			if (store.get() === null) start();
			else exit();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			const current = store.get();
			if (current === null) return;
			const action = hintKeyAction(event, host.current.matchCommand(event));
			event.preventDefault();
			event.stopImmediatePropagation();
			if (action.kind === "exit") exit();
			else if (action.kind === "swallow") return;
			else if (action.kind === "undo") store.set({ ...current, typed: current.typed.slice(0, -1) });
			else {
				const next = typeLetter(shownLabels(current), current.typed, action.letter);
				if (next === null) return;
				if (next.chosen === null) store.set({ ...current, typed: next.typed });
				else choose(current, next.chosen, action.focusOnly);
			}
		};
		const onPointerDown = (event: PointerEvent) => {
			if (event.isTrusted) exit();
		};
		let frame = 0;
		const remeasure = () => {
			if (frame !== 0 || store.get() === null) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				const current = store.get();
				if (current) store.set({ ...current, boxes: measureTargets(current.targets, env()) });
			});
		};
		const unsubscribe = host.current.onCommand(onCommand);
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("blur", exit);
		window.addEventListener("resize", remeasure);
		document.addEventListener("scroll", remeasure, true);
		return () => {
			unsubscribe();
			window.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("blur", exit);
			window.removeEventListener("resize", remeasure);
			document.removeEventListener("scroll", remeasure, true);
			cancelAnimationFrame(frame);
			exit();
		};
	}, [store]);

	if (session === null) return null;
	return createPortal(
		<div data-testid="hint-mode" className="pointer-events-none fixed inset-0 z-200">
			<div aria-hidden="true">
				{session.labels.map((label, index) => {
					const box = session.boxes[index];
					return box && label.startsWith(session.typed) ? (
						<HintLabel key={label} label={label} typed={session.typed} box={box} />
					) : null;
				})}
			</div>
			<HintBar platform={props.platform} />
		</div>,
		document.body,
	);
}
