import { remixicon, ui, useAction } from "@thinkrail/ext/view";
import { useState } from "react";
import { NoteEditor } from "./editor";
import { useNotes } from "./hooks";
import { NOTES_LIMIT } from "./model";
import { Budget, Empty, NoteRow } from "./parts";

const { RiAddLine, RiPushpinLine } = remixicon;

type Editing = { kind: "list" } | { kind: "new" } | { kind: "edit"; id: string };

const Notes = () => {
	const { projectId, notes, plan } = useNotes();
	const toggle = useAction("toggle");
	const [editing, setEditing] = useState<Editing>({ kind: "list" });
	const list = notes ?? [];
	const active = list.filter((note) => note.enabled).length;
	const current = editing.kind === "edit" ? list.find((note) => note.id === editing.id) : undefined;
	const back = () => setEditing({ kind: "list" });

	return (
		<div
			data-testid="project-notes"
			className="flex h-full min-h-0 flex-col bg-container-workspace-bg"
		>
			<header className="flex shrink-0 items-center gap-8 border-b border-border-muted px-12 py-8">
				<RiPushpinLine className="size-16 shrink-0 text-primary" />
				<h2 className="tr-title-compact text-text-default">Project notes</h2>
				<span data-testid="project-notes-active" className="tr-text-metadata text-text-muted">
					{active} active
				</span>
				<span className="ml-auto" />
				{projectId && editing.kind === "list" && (
					<ui.Button
						variant="outline"
						size="sm"
						data-testid="project-notes-new"
						disabled={list.length >= NOTES_LIMIT}
						onClick={() => setEditing({ kind: "new" })}
					>
						<RiAddLine className="size-14" /> New note
					</ui.Button>
				)}
			</header>
			{!projectId ? (
				<Empty title="No project open" detail="Open a project to pin notes for its agent runs." />
			) : editing.kind === "new" || current ? (
				<NoteEditor key={current?.id ?? "new"} note={current} onDone={back} />
			) : (
				<>
					<div className="shrink-0 border-b border-border-muted px-12 py-12">
						<Budget plan={plan} />
					</div>
					{notes === undefined ? null : list.length === 0 ? (
						<Empty
							title="No notes yet"
							detail="Pin rules the agent should always follow here, or tell the agent: “remember that we use bun, not npm”."
						/>
					) : (
						<ul className="min-h-0 flex-1 overflow-y-auto">
							{list.map((note) => (
								<NoteRow
									key={note.id}
									note={note}
									skipped={plan.skipped.includes(note.id)}
									onToggle={() => void toggle({ id: note.id }).catch(() => {})}
									onEdit={() => setEditing({ kind: "edit", id: note.id })}
								/>
							))}
						</ul>
					)}
				</>
			)}
		</div>
	);
};

export default Notes;
