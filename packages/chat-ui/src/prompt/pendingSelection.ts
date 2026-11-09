import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react";

// Restore focus and a caret/selection to a prompt textarea after a React-driven value change (a
// template insertion, slash completion, or slot step): the consumer requests a selection and it is
// applied in a layout effect once the new value has rendered. `onApply` (optional) receives the
// caret start so a caller that mirrors the caret in its own state stays in sync — it runs whether or
// not the element is currently mounted, matching a direct setState in the same effect.
export function usePendingSelection(
	ref: RefObject<HTMLTextAreaElement | null>,
	onApply?: (start: number) => void,
): (start: number, end?: number) => void {
	const [pending, setPending] = useState<{ start: number; end: number } | null>(null);
	const onApplyRef = useRef(onApply);
	onApplyRef.current = onApply;

	useLayoutEffect(() => {
		if (pending === null) return;
		const el = ref.current;
		if (el) {
			el.focus();
			el.setSelectionRange(pending.start, pending.end);
		}
		onApplyRef.current?.(pending.start);
		setPending(null);
	}, [pending, ref]);

	return useCallback((start: number, end: number = start) => {
		setPending({ start, end });
	}, []);
}
