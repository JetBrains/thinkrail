import { Textarea } from "@thinkrail/ui/textarea";
import { cn } from "@thinkrail/ui/utils";
import { type ComponentProps, type RefObject, useLayoutEffect, useRef } from "react";

const HEIGHT = "--ask-field-height";

function measure(field: HTMLTextAreaElement): void {
	field.style.setProperty(HEIGHT, "auto");
	if (field.clientWidth === 0) return;
	const border = field.offsetHeight - field.clientHeight;
	field.style.setProperty(HEIGHT, `${field.scrollHeight + border}px`);
}

function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string): void {
	useLayoutEffect(() => {
		const field = ref.current;
		if (field) measure(field);
	}, [ref, value]);

	useLayoutEffect(() => {
		const field = ref.current;
		if (!field || typeof ResizeObserver === "undefined") return;
		let width = field.clientWidth;
		let frame: number | null = null;
		const observer = new ResizeObserver(() => {
			if (field.clientWidth === width) return;
			width = field.clientWidth;
			if (frame != null) cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				frame = null;
				measure(field);
			});
		});
		observer.observe(field);
		return () => {
			observer.disconnect();
			if (frame != null) cancelAnimationFrame(frame);
		};
	}, [ref]);
}

export function AutosizeField({
	fieldRef,
	value,
	className,
	...rest
}: Omit<ComponentProps<"textarea">, "ref" | "value" | "rows"> & {
	fieldRef?: ((node: HTMLTextAreaElement | null) => void) | undefined;
	value: string;
}) {
	const own = useRef<HTMLTextAreaElement | null>(null);
	useAutosize(own, value);
	return (
		<Textarea
			ref={(node) => {
				own.current = node;
				fieldRef?.(node);
			}}
			rows={2}
			value={value}
			className={cn(
				"block h-[var(--ask-field-height,auto)] max-h-[calc(8lh+10px)] overflow-y-auto px-8 py-4",
				className,
			)}
			{...rest}
		/>
	);
}
