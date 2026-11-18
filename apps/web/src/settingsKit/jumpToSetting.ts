import { createContext, use } from "react";
import { SETTING_ATTR, SETTING_SELECTOR, settingIdSelector } from "./settingsMarkup";
import { rowsOf, stopOf, topRow, type WalkElement } from "./settingsWalk";

export const SETTING_FLASH_MS = 1600;
const JUMP_FRAMES = 60;

export interface SettingsJump {
	readonly id: string;
	readonly seq: number;
}

export const SettingsJumpContext = createContext<SettingsJump | null>(null);

export function useSettingsJump(): SettingsJump | null {
	return use(SettingsJumpContext);
}

export function useSettingsJumpTarget(): string | null {
	return use(SettingsJumpContext)?.id ?? null;
}

export interface JumpElement<E> extends WalkElement<E> {
	readonly ownerDocument: { readonly activeElement: unknown } | null;
	querySelector(selector: string): E | null;
	scrollIntoView(options?: { block?: "center" | "nearest" }): void;
	setAttribute(name: string, value: string): void;
	removeAttribute(name: string): void;
}

const flashTimers = new WeakMap<object, ReturnType<typeof setTimeout>>();

function flash<E extends JumpElement<E>>(element: E): void {
	clearTimeout(flashTimers.get(element));
	element.setAttribute(SETTING_ATTR.flash, "");
	flashTimers.set(
		element,
		setTimeout(() => {
			flashTimers.delete(element);
			element.removeAttribute(SETTING_ATTR.flash);
		}, SETTING_FLASH_MS),
	);
}

function landingOf<E extends JumpElement<E>>(target: E): E | null {
	if (target.matches(SETTING_SELECTOR.treeItem)) return target;
	if (target.matches(SETTING_SELECTOR.row)) return stopOf(target);
	const inner = rowsOf(target)[0];
	return stopOf(inner ?? topRow(target) ?? target);
}

export function revealSetting<E extends JumpElement<E>>(root: E, id: string): E | null {
	const target = root.querySelector(settingIdSelector(id));
	const landing = target ? landingOf(target) : null;
	if (!target || !landing) return null;
	landing.focus({ preventScroll: true });
	if (landing.ownerDocument?.activeElement !== landing) return null;
	landing.scrollIntoView({ block: "center" });
	flash(target);
	return target;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export async function jumpToSetting(
	root: HTMLElement,
	id: string,
	signal?: AbortSignal,
): Promise<boolean> {
	for (let frame = 0; frame < JUMP_FRAMES; frame += 1) {
		if (!root.isConnected || signal?.aborted) return false;
		if (revealSetting(root, id)) return true;
		await nextFrame();
	}
	return false;
}
