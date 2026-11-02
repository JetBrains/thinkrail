import { type RefObject, useCallback } from "react";

/**
 * A `MicButton` `apply` for a plain controlled field: it sets the value and, after React commits it,
 * puts the caret after the spoken text, but only while the field still has focus.
 */
export function useFieldApply(
	fieldRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>,
	setValue: (value: string) => void,
): (text: string, caret: number) => void {
	return useCallback(
		(text: string, caret: number) => {
			setValue(text);
			requestAnimationFrame(() => {
				const element = fieldRef.current;
				if (element && element === document.activeElement) element.setSelectionRange(caret, caret);
			});
		},
		[fieldRef, setValue],
	);
}
