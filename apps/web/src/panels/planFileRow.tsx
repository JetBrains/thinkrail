import type { GitFileChange } from "@thinkrail/contracts";
import { statusLetter } from "../chat/planView";
import { statusNameClass } from "./changesModel";
import { DiffStatBadge } from "./DiffStatBadge";

// The plan page's changed-file row, shared by the Plan view (`PlanPane`) and the inline/summary review
// surfaces (`PlanReview`) so every change set's file rows read identically. Its own module (not a
// `PlanPane` export) so PlanPane → PlanReview stays a one-way import, never a cycle.

/** `git status`-style one-letter marker (`planView.statusLetter`), colored like the Changes tree. */
function FileStatusLetter({ status }: { status: GitFileChange["status"] }) {
	return (
		<span className={`w-4 shrink-0 text-center tr-text-metadata ${statusNameClass(status)}`}>
			{statusLetter(status)}
		</span>
	);
}

/** One changed file: status letter + path + `+/−`, clicking opens its diff tab at the caller's scope. */
export function FileRow({ file, onOpen }: { file: GitFileChange; onOpen: () => void }) {
	return (
		<li>
			<button
				type="button"
				data-testid="plan-file-row"
				onClick={onOpen}
				title={file.path}
				className="flex w-full min-w-0 items-center gap-sm rounded-[var(--radius-sm)] px-xs py-xs text-left hover:bg-control-bg-hovered"
			>
				<FileStatusLetter status={file.status} />
				<span
					className={`min-w-0 flex-1 truncate tr-text-ui text-text-muted ${statusNameClass(file.status)}`}
				>
					{file.path}
				</span>
				<DiffStatBadge added={file.added ?? 0} removed={file.removed ?? 0} />
			</button>
		</li>
	);
}
