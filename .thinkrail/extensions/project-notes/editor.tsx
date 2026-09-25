import { remixicon, ui, useAction } from "@thinkrail/ext/view";
import { type FormEvent, useState } from "react";
import { BODY_LIMIT, isSaveResult, type Note, noteText, TITLE_LIMIT } from "./model";
import { formatCount, sizeText } from "./parts";

const { RiArrowLeftLine, RiDeleteBinLine, RiSaveLine } = remixicon;

export const NoteEditor = ({ note, onDone }: { note: Note | undefined; onDone: () => void }) => {
	const save = useAction("save");
	const remove = useAction("remove");
	const [title, setTitle] = useState(note?.title ?? "");
	const [body, setBody] = useState(note?.body ?? "");
	const [enabled, setEnabled] = useState(note?.enabled ?? true);
	const [confirming, setConfirming] = useState(false);
	const [error, setError] = useState<string>();
	const size = noteText({ title, body }).length;
	const tooLong = body.trim().length > BODY_LIMIT;

	const submit = (event: FormEvent) => {
		event.preventDefault();
		void save({ ...(note ? { id: note.id } : {}), title, body, enabled })
			.then((result) => {
				if (!isSaveResult(result)) return setError("Unexpected reply.");
				if (!result.ok) return setError(result.error);
				onDone();
			})
			.catch((reason: unknown) => setError(String(reason)));
	};

	const destroy = () => {
		if (!note) return;
		if (!confirming) return setConfirming(true);
		void remove({ id: note.id })
			.then(onDone)
			.catch((reason: unknown) => setError(String(reason)));
	};

	return (
		<form
			data-testid="project-notes-editor"
			onSubmit={submit}
			className="flex min-h-0 flex-1 flex-col gap-8 px-12 py-12"
		>
			<div className="flex items-center gap-8">
				<ui.IconTooltip label="Back to notes">
					<ui.Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label="Back to notes"
						data-testid="project-notes-back"
						onClick={onDone}
					>
						<RiArrowLeftLine className="size-14" />
					</ui.Button>
				</ui.IconTooltip>
				<span className="tr-title-compact text-text-default">
					{note ? "Edit note" : "New note"}
				</span>
				<span className="ml-auto" />
				<span className="flex items-center gap-8 tr-text-metadata text-text-muted">
					Send to agent
					<ui.Switch
						checked={enabled}
						aria-label="Send to agent"
						data-testid="project-notes-editor-enabled"
						onCheckedChange={setEnabled}
					/>
				</span>
			</div>
			<ui.Input
				data-testid="project-notes-title"
				aria-label="Title"
				placeholder="Title (optional)"
				maxLength={TITLE_LIMIT}
				value={title}
				onChange={(event) => setTitle(event.target.value)}
			/>
			<ui.Textarea
				data-testid="project-notes-body"
				aria-label="Note"
				placeholder={
					"Markdown. For example:\n- Use bun, never npm.\n- API handlers live in packages/server/src/api."
				}
				className="min-h-0 flex-1 tr-code-text"
				rows={12}
				value={body}
				onChange={(event) => setBody(event.target.value)}
			/>
			<div className="flex flex-wrap items-center gap-8">
				<span
					data-testid="project-notes-size"
					className={
						tooLong ? "tr-text-metadata text-feedback-error" : "tr-text-metadata text-text-muted"
					}
				>
					{sizeText(size)}
					{tooLong && ` · max ${formatCount(BODY_LIMIT)}`}
				</span>
				<span className="ml-auto" />
				{note && (
					<ui.Button
						type="button"
						variant={confirming ? "destructive" : "ghost"}
						size="sm"
						data-testid="project-notes-delete"
						onClick={destroy}
					>
						<RiDeleteBinLine className="size-14" /> {confirming ? "Delete for good" : "Delete"}
					</ui.Button>
				)}
				<ui.Button
					type="submit"
					size="sm"
					data-testid="project-notes-save"
					disabled={!body.trim() || tooLong}
				>
					<RiSaveLine className="size-14" /> Save
				</ui.Button>
			</div>
			{error && (
				<p data-testid="project-notes-error" className="tr-text-metadata text-feedback-error">
					{error}
				</p>
			)}
		</form>
	);
};
