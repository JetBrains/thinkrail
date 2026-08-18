import { X } from "lucide-react";
import type * as React from "react";
import { workspaceTabStateClass } from "./tabState";

/**
 * One tab in a panel tab strip — the single shared look for the right-rail (Specs / All Files / Changes /
 * Review) AND the terminal tabs, so a tab reads the same everywhere: `tr-text-eyebrow`, a `px-4` inset and
 * the shared `workspaceTabStateClass` band, `h-full` so it fills the header row and centres vertically.
 *
 * Two variants, one component (no parallel tab styles):
 *  - **plain** (right-rail): the button itself carries the state band.
 *  - **closable** (terminals): pass `onClose`; the band moves onto a group wrapper so it spans the
 *    trailing × too, and the label truncates. The right-rail rendering is unchanged from before.
 */
export function TabButton({
	testid,
	active,
	onClick,
	children,
	onClose,
	closeTestid,
	closeLabel,
}: {
	testid: string;
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
	/** When set, the tab shows a hover-revealed close (×) — used by the terminal tabs. */
	onClose?: () => void;
	closeTestid?: string;
	closeLabel?: string;
}) {
	if (!onClose) {
		return (
			<button
				type="button"
				data-testid={testid}
				data-active={active}
				onClick={onClick}
				className={`flex h-full items-center px-4 tr-text-eyebrow ${workspaceTabStateClass(active)}`}
			>
				{children}
			</button>
		);
	}
	return (
		<div
			className={`group flex h-full shrink-0 items-center gap-4 pl-4 ${workspaceTabStateClass(active)}`}
		>
			<button
				type="button"
				data-testid={testid}
				data-active={active}
				onClick={onClick}
				className="flex h-full items-center tr-text-eyebrow"
			>
				<span className="max-w-[120px] truncate">{children}</span>
			</button>
			<button
				type="button"
				data-testid={closeTestid}
				aria-label={closeLabel}
				onClick={onClose}
				className="mr-4 rounded-[var(--radius-sm)] p-2 text-text-muted opacity-0 transition-colors hover:bg-container-elevated-bg hover:text-text-default group-hover:opacity-100"
			>
				<X className="size-12" />
			</button>
		</div>
	);
}
