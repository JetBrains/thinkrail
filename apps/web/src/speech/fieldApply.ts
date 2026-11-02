import { type RefObject, useCallback } from "react";

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
