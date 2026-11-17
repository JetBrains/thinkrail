import { createContext, use } from "react";
import { SETTING_ATTR, SETTING_SELECTOR, settingIdSelector } from "./settingsMarkup";
import { rowsOf, stopOf, topRow, type WalkElement } from "./settingsWalk";

export const SETTING_FLASH_MS = 1600;
const JUMP_FRAMES = 60;

export const SettingsJumpContext = createContext<string | null>(null);

export function useSettingsJumpTarget(): string | null {
	return use(SettingsJumpContext);
}

export interface JumpElement<E> extends WalkElement<E> {
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
	if (!target) return null;
	const landing = landingOf(target);
	landing?.focus({ preventScroll: true });
	target.scrollIntoView({ block: "center" });
	flash(target);
	return target;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export async function jumpToSetting(root: HTMLElement, id: string): Promise<boolean> {
	for (let frame = 0; frame < JUMP_FRAMES; frame += 1) {
		if (!root.isConnected) return false;
		if (revealSetting(root, id)) return true;
		await nextFrame();
	}
	return false;
}
