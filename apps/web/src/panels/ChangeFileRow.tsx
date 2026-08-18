import type { MouseEvent, ReactNode } from "react";
import type { TabIntent } from "../store";
import { ChangeRowActions } from "./ChangeRowActions";
import { DiffStatBadge } from "./DiffStatBadge";

/** The wired open gestures + trailing `+/−` badge a changed-file row's body renders. */
export interface ChangeRowBody {
	/** A plain click / the `⌄` View action — preview the diff in the reusable slot. */
	onClick: () => void;
	/** A double click — keep the diff as its own tab. */
	onDoubleClick: () => void;
	/** Right-click — open the row's action menu (from `ChangeRowActions`). */
	onContextMenu: (event: MouseEvent) => void;
	/** The `+N −M` badge for this file, ready to drop into the body's trailing slot. */
	badge: ReactNode;
}

/**
 * One changed file, as a row — the shared shell behind BOTH Changes layouts (the flat list and the folder
 * tree). It owns the `<li>`, the `ChangeRowActions` menu wrapper (hover `⌄` + right-click, which also paints
 * the hover/selected band), the open-gesture triple (click / View = preview, double click = keep) and the
 * `DiffStatBadge`. The caller renders only the body — the flat path button, or a `TreeRow` — wired from the
 * {@link ChangeRowBody} handed to `children`, so the two layouts can never drift on gestures or the badge.
 */
export function ChangeFileRow({
	path,
	active,
	added,
	removed,
	onOpen,
	children,
}: {
	/** Worktree-relative path — the row's identity, what the menu copies, and the diff tab key. */
	path: string;
	/** Whether this row's diff tab is the selected one (drives the band + the body's active state). */
	active: boolean;
	added: number;
	removed: number;
	/** Open (or focus) the file's diff tab at the gesture's intent — the same handler both layouts share. */
	onOpen: (path: string, intent: TabIntent) => void;
	children: (body: ChangeRowBody) => ReactNode;
}) {
	return (
		<li>
			<ChangeRowActions path={path} active={active} onView={() => onOpen(path, "preview")}>
				{({ onContextMenu }) =>
					children({
						onClick: () => onOpen(path, "preview"),
						onDoubleClick: () => onOpen(path, "keep"),
						onContextMenu,
						badge: <DiffStatBadge added={added} removed={removed} />,
					})
				}
			</ChangeRowActions>
		</li>
	);
}
