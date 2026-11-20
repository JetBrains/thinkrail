import { ARROW_TWIN_COMMANDS, type LocalKeyCommand } from "@thinkrail/ui/keyboard";
import { type LocalKeys, useLocalKeys } from "@thinkrail/ui/local-keys";
import {
	READING_COMMANDS,
	type ReadingSpan,
	readingCommand,
	scrollReading,
} from "@thinkrail/ui/reading";
import type { KeyboardEvent } from "react";
import { useFocusHome } from "../host";

export const READER_SCOPE = "reader";

const READER_KEYS: readonly LocalKeyCommand[] = [...ARROW_TWIN_COMMANDS, ...READING_COMMANDS];

export const READING_SURFACE_CLASS = "focus-visible:focus-ring-inset";

export function useReaderKeys(): LocalKeys {
	return useLocalKeys(READER_SCOPE, READER_KEYS);
}

export function viewportSpan(scroller: Element): ReadingSpan {
	const top = scroller.getBoundingClientRect().top + scroller.clientTop;
	return { top, bottom: top + scroller.clientHeight };
}

export interface ReadingSurfaceProps {
	readonly role?: "document";
	readonly "aria-label"?: string;
	readonly tabIndex?: 0;
	readonly "data-focus-default"?: "";
	readonly "data-key-scope"?: typeof READER_SCOPE;
	readonly onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}

export function useReadingSurface({
	label,
	sideways = false,
}: {
	label: string;
	sideways?: boolean;
}): ReadingSurfaceProps {
	const home = useFocusHome();
	const keys = useReaderKeys();
	if (!home) return {};
	return {
		role: "document",
		"aria-label": label,
		tabIndex: 0,
		"data-focus-default": "",
		"data-key-scope": READER_SCOPE,
		onKeyDown: (event) => {
			if (event.defaultPrevented || event.target !== event.currentTarget) return;
			const command = readingCommand(event.nativeEvent, keys);
			if (!command || (command.kind === "side" && !sideways)) return;
			event.preventDefault();
			scrollReading(event.currentTarget, command);
		},
	};
}
