import { useEffect, useRef, useState } from "react";

/**
 * One-line instruction box anchored at a selection. Enter submits (closing the popup — the edit runs in the
 * background); Esc cancels. `error` shows a rejected create/prompt inline without closing.
 */
export function InstructionPopup({
	rect,
	error,
	onSubmit,
	onCancel,
}: {
	rect: { top: number; left: number };
	error?: string | null;
	onSubmit: (instruction: string) => void;
	onCancel: () => void;
}) {
	const [value, setValue] = useState("");
	const ref = useRef<HTMLTextAreaElement>(null);
	useEffect(() => ref.current?.focus(), []);

	return (
		<div
			data-testid="inline-edit-popup"
			style={{ position: "fixed", top: rect.top + 8, left: rect.left }}
			className="z-[41] w-[340px] rounded-[var(--radius-md)] border border-border2 bg-elevated p-sm shadow-[var(--shadow-lg)]"
		>
			<textarea
				ref={ref}
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						if (value.trim()) onSubmit(value.trim());
					} else if (e.key === "Escape") {
						e.preventDefault();
						onCancel();
					}
				}}
				rows={2}
				placeholder="Tell the agent what to change…"
				className="w-full resize-none rounded-[var(--radius-sm)] border border-border2 bg-bg px-sm py-xs text-sm text-text placeholder:text-hint focus:outline-none focus:ring-1 focus:ring-primary"
			/>
			<div className="mt-xs flex items-center gap-md text-hint text-[10px]">
				<span>
					<kbd className="rounded-[var(--radius-sm)] border border-border2 px-1">⏎</kbd> send
				</span>
				<span>
					<kbd className="rounded-[var(--radius-sm)] border border-border2 px-1">esc</kbd> cancel
				</span>
				<span className="ml-auto text-primary">✦ background session</span>
			</div>
			{error ? <p className="mt-xs text-red text-xs">{error}</p> : null}
		</div>
	);
}
