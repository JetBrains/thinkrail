import type { GitFileChange } from "@thinkrail/contracts";
import { statusLetter } from "../chat/planView";
import { statusNameClass } from "./changesModel";
import { DiffStatBadge } from "./DiffStatBadge";

function FileStatusLetter({ status }: { status: GitFileChange["status"] }) {
	return (
		<span className={`w-16 shrink-0 text-center tr-text-metadata ${statusNameClass(status)}`}>
			{statusLetter(status)}
		</span>
	);
}

export function FileRow({ file, onOpen }: { file: GitFileChange; onOpen: () => void }) {
	return (
		<li>
			<button
				type="button"
				data-testid="plan-file-row"
				onClick={onOpen}
				title={file.path}
				className="flex min-h-8 w-full min-w-0 items-center gap-8 rounded-[var(--radius-sm)] px-4 py-4 text-left hover:bg-control-bg-hovered"
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
