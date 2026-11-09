export function composerTranscriptStep(
	multiline: boolean,
	caretAtStart: boolean,
): "enter" | "caretToStart" {
	return multiline && !caretAtStart ? "caretToStart" : "enter";
}

export function composerShiftTabOut(
	event: Pick<KeyboardEvent, "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey">,
	busy: boolean,
): boolean {
	return (
		event.key === "Tab" &&
		event.shiftKey &&
		!event.altKey &&
		!event.ctrlKey &&
		!event.metaKey &&
		!busy
	);
}
