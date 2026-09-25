import { cn, openSurface, remixicon } from "@thinkrail/ext/view";
import { useNotes } from "./hooks";
import { EXT_NAME } from "./model";

const { RiPushpinLine } = remixicon;

const Badge = () => {
	const { notes, plan } = useNotes();
	const active = notes?.filter((note) => note.enabled).length ?? 0;
	if (active === 0) return null;
	const over = plan.skipped.length > 0;
	return (
		<button
			type="button"
			data-testid="project-notes-status"
			data-over-cap={over}
			title={
				over
					? `${plan.skipped.length} active notes are past the size cap and not sent`
					: "Project notes sent with every agent run"
			}
			onClick={() => openSurface(EXT_NAME, "notes")}
			className="flex items-center gap-4 rounded-sm px-4 tr-text-ui text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
		>
			<RiPushpinLine className={cn("size-14", over ? "text-feedback-warning" : "text-primary")} />
			<span className="tabular-nums">
				{active} {active === 1 ? "note" : "notes"}
			</span>
		</button>
	);
};

export default Badge;
