import { openSurface, remixicon, type SurfaceProps, ui } from "@thinkrail/ext/view";
import { EXT_NAME, isAddNoteDetails, isRecord, titleOf } from "./model";
import { Tag } from "./parts";

const { RiPushpinLine, RiLoader4Line, RiExternalLinkLine } = remixicon;

const detailsOf = (value: unknown) => {
	const details = isRecord(value) && "details" in value ? value.details : value;
	return isAddNoteDetails(details) ? details : undefined;
};

const errorText = (value: unknown) => {
	if (!isRecord(value) || !Array.isArray(value.content)) return undefined;
	const block: unknown = value.content[0];
	return isRecord(block) && typeof block.text === "string" ? block.text : undefined;
};

const argText = (args: Record<string, unknown>, key: string) =>
	typeof args[key] === "string" ? args[key] : "";

const AddProjectNoteCard = ({ toolCall }: SurfaceProps) => {
	if (!toolCall) return null;
	const details = toolCall.status === "done" ? detailsOf(toolCall.result) : undefined;
	const title = details
		? titleOf(details.note)
		: titleOf({ title: argText(toolCall.args, "title"), body: argText(toolCall.args, "body") });
	const body = details?.note.body ?? argText(toolCall.args, "body");
	const state = toolCall.status === "running" ? "running" : details ? "saved" : "error";
	return (
		<div
			data-testid="project-notes-tool"
			data-state={state}
			className="flex flex-col gap-8 rounded-md border border-border-muted bg-container-elevated-bg px-12 py-8"
		>
			<div className="flex min-w-0 items-center gap-8 tr-text-ui">
				{state === "running" ? (
					<RiLoader4Line className="size-14 shrink-0 animate-spin text-primary" />
				) : (
					<RiPushpinLine className="size-14 shrink-0 text-primary" />
				)}
				<span className="shrink-0 text-text-muted">
					{state === "running"
						? "Pinning note"
						: state === "saved"
							? "Pinned note"
							: "Note not saved"}
				</span>
				<span className="min-w-0 truncate text-text-default">{title}</span>
				<span className="ml-auto" />
				{details &&
					(details.sent ? (
						<Tag>sent with every run</Tag>
					) : (
						<Tag tone="warning">over cap, not sent</Tag>
					))}
				<ui.IconTooltip label="Open project notes">
					<ui.Button
						variant="ghost"
						size="icon"
						aria-label="Open project notes"
						data-testid="project-notes-tool-open"
						onClick={() => openSurface(EXT_NAME, "notes")}
					>
						<RiExternalLinkLine className="size-14" />
					</ui.Button>
				</ui.IconTooltip>
			</div>
			{body && (
				<p className="line-clamp-3 whitespace-pre-wrap break-words tr-code-text text-text-muted">
					{body}
				</p>
			)}
			{state === "error" && (
				<p className="tr-text-metadata text-feedback-error">
					{errorText(toolCall.result) ?? "add_project_note failed."}
				</p>
			)}
		</div>
	);
};

export default AddProjectNoteCard;
