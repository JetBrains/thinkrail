import { useSyncExternalStore } from "react";
import { dictation } from "./dictation";
import { announceDictation, fieldWriter } from "./field";

const owners = new WeakMap<HTMLElement, string>();
let nextOwner = 0;
let active: { owner: string; element: HTMLElement; release: () => void } | null = null;

function ownerOf(element: HTMLElement): string {
	let owner = owners.get(element);
	if (!owner) {
		nextOwner += 1;
		owner = `field-${nextOwner}`;
		owners.set(element, owner);
	}
	return owner;
}

dictation.subscribe(() => {
	const snapshot = dictation.snapshot();
	if (active && (snapshot.ownerId !== active.owner || snapshot.phase === "idle")) {
		const ended = active;
		active = null;
		ended.release();
	}
});

export function dictatingElement(): HTMLElement | null {
	return active?.element ?? null;
}

/** The field being dictated into, for render; it changes only together with the controller snapshot. */
export function useDictatingElement(): HTMLElement | null {
	return useSyncExternalStore(dictation.subscribe, dictatingElement);
}

/** Dictates into `element`: locks it, writes through its field writer, and stops on blur. */
export function startDictation(element: HTMLElement): void {
	const owner = ownerOf(element);
	element.focus();
	const writer = fieldWriter(element);
	const unlock = writer.lock();
	const onBlur = () =>
		setTimeout(() => {
			if (!document.hasFocus() || !element.contains(document.activeElement)) dictation.stop(owner);
		});
	element.addEventListener("blur", onBlur);
	const release = () => {
		unlock();
		element.removeEventListener("blur", onBlur);
		announceDictation(element, false);
	};
	dictation.start({ ownerId: owner, replace: (spoken) => writer.replace(spoken) });
	active = { owner, element, release };
	announceDictation(element, true);
}

export function stopDictation(): void {
	if (active) dictation.stop(active.owner);
}
