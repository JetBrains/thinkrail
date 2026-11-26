import { isImeComposing } from "@thinkrail/ui/keyboard";
import type { PaletteItem, RecentWorkspaces } from "../search";

export type SwitcherStep = 1 | -1;

export interface HeldModifiers {
	readonly ctrl: boolean;
	readonly meta: boolean;
	readonly alt: boolean;
}

export interface RecentSwitcherSnapshot {
	readonly open: boolean;
	readonly visible: boolean;
	readonly rows: readonly PaletteItem[];
	readonly currentId: string | null;
	readonly index: number;
}

type SwitcherKeyEvent = Pick<
	KeyboardEvent,
	"code" | "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey" | "isComposing" | "keyCode"
> &
	Pick<Event, "preventDefault" | "stopPropagation">;

export interface RecentSwitcherDeps {
	readonly load: () => RecentWorkspaces;
	/** The step a press of one of the switcher's own chords asks for, else `null`. */
	readonly chordStep: (event: SwitcherKeyEvent) => SwitcherStep | null;
	/** Calls `onChange` while open whenever the rows may have changed; returns the stop function. */
	readonly watch: (onChange: () => void) => () => void;
	readonly claimKeyboard: (active: boolean) => void;
	readonly isInside: (target: EventTarget | null) => boolean;
	readonly target: () => Pick<Window, "addEventListener" | "removeEventListener">;
	readonly schedule: (run: () => void, ms: number) => () => void;
}

export const SHOW_DELAY_MS = 150;

const CLOSED: RecentSwitcherSnapshot = {
	open: false,
	visible: false,
	rows: [],
	currentId: null,
	index: 0,
};

const MODIFIER_KEYS = new Set(["Control", "Meta", "Alt", "Shift", "OS"]);

function keyStep(event: SwitcherKeyEvent): SwitcherStep | null {
	if (event.key === "Tab") return event.shiftKey ? -1 : 1;
	if (event.key === "ArrowDown") return 1;
	if (event.key === "ArrowUp") return -1;
	return null;
}

function firstIndex(recent: RecentWorkspaces, step: SwitcherStep): number {
	const { rows, currentId } = recent;
	const current = currentId !== null && rows[0]?.id === currentId ? 0 : -1;
	if (step === 1) return current + 1;
	return rows.length - 1;
}

export function createRecentSwitcher(deps: RecentSwitcherDeps) {
	let snapshot = CLOSED;
	let held: HeldModifiers = { ctrl: false, meta: false, alt: false };
	let teardown: (() => void)[] = [];
	const listeners = new Set<() => void>();

	const publish = (next: RecentSwitcherSnapshot) => {
		snapshot = next;
		for (const listener of [...listeners]) listener();
	};

	const close = () => {
		for (const stop of teardown) stop();
		teardown = [];
		deps.claimKeyboard(false);
		publish(CLOSED);
	};

	const commit = (index = snapshot.index) => {
		const row = snapshot.rows[index];
		close();
		row?.run?.();
	};

	const move = (step: SwitcherStep) => {
		const count = snapshot.rows.length;
		if (count === 0) return;
		publish({ ...snapshot, index: (snapshot.index + step + count) % count });
	};

	const stillHeld = (event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey">) =>
		(held.ctrl && event.ctrlKey) || (held.meta && event.metaKey) || (held.alt && event.altKey);

	const onKeyDown = (event: KeyboardEvent) => {
		event.preventDefault();
		event.stopPropagation();
		if (isImeComposing(event) || MODIFIER_KEYS.has(event.key)) return;
		if (event.key === "Escape") close();
		else if (event.key === "Enter") commit();
		else {
			const step = deps.chordStep(event) ?? keyStep(event);
			if (step !== null) move(step);
		}
	};

	const onKeyUp = (event: KeyboardEvent) => {
		if (!stillHeld(event)) commit();
	};

	const onPointerDown = (event: PointerEvent) => {
		if (!deps.isInside(event.target)) close();
	};

	const refresh = () => {
		const recent = deps.load();
		const selectedId = snapshot.rows[snapshot.index]?.id;
		const kept = recent.rows.findIndex((row) => row.id === selectedId);
		publish({
			...snapshot,
			rows: recent.rows,
			currentId: recent.currentId,
			index: kept === -1 ? Math.min(snapshot.index, Math.max(0, recent.rows.length - 1)) : kept,
		});
	};

	const listen = <K extends keyof WindowEventMap>(
		type: K,
		handler: (event: WindowEventMap[K]) => void,
		capture = true,
	) => {
		const target = deps.target();
		target.addEventListener(type, handler, capture);
		teardown.push(() => target.removeEventListener(type, handler, capture));
	};

	return {
		getSnapshot: (): RecentSwitcherSnapshot => snapshot,
		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		start(step: SwitcherStep, modifiers: HeldModifiers): void {
			if (snapshot.open) {
				move(step);
				return;
			}
			const recent = deps.load();
			const elsewhere = recent.rows.filter((row) => row.id !== recent.currentId).length;
			if (elsewhere === 0) return;
			const index = firstIndex(recent, step);
			if (!modifiers.ctrl && !modifiers.meta && !modifiers.alt) {
				recent.rows[index]?.run?.();
				return;
			}
			held = modifiers;
			snapshot = {
				open: true,
				visible: false,
				rows: recent.rows,
				currentId: recent.currentId,
				index,
			};
			deps.claimKeyboard(true);
			listen("keydown", onKeyDown);
			listen("keyup", onKeyUp);
			listen("pointerdown", onPointerDown);
			listen("blur", close, false);
			teardown.push(deps.watch(refresh));
			teardown.push(
				deps.schedule(() => {
					if (snapshot.open) publish({ ...snapshot, visible: true });
				}, SHOW_DELAY_MS),
			);
			publish(snapshot);
		},
		hover(index: number): void {
			if (snapshot.open && index !== snapshot.index) publish({ ...snapshot, index });
		},
		activate(index: number): void {
			if (snapshot.open) commit(index);
		},
		cancel: close,
	};
}

export type RecentSwitcher = ReturnType<typeof createRecentSwitcher>;
