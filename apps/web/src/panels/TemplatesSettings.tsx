import type { TemplateInfo, TemplateScope } from "@thinkrail/contracts";
import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { TemplateEditorDialog } from "@/chat/TemplateEditorDialog";
import { PopoverTrigger } from "@/components/ui/popover";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { ConfirmPopover } from "./ConfirmPopover";
import { openFileInTab } from "./openFile";

/**
 * The Settings → Templates panel: two groups — **Global** (always) and **This project** (only with an
 * active workspace) — each listing its prompt-template files with New/Edit/Delete, and (project rows
 * only) an Open-as-file shortcut. One `template.list { workspaceId }` fetch, refetched whenever the
 * store's `templatesVersion` bumps (a save or delete from anywhere — this panel or `HistoryOverlay`'s
 * save-as-template — invalidates it). New/Edit open the shared `chat/TemplateEditorDialog` (see
 * `chat/SPEC.md`'s Save-as-template bullet for why it lives in `chat/`, not here). Delete never touches
 * the dialog — it's a `ConfirmPopover` directly on the row.
 */
export function TemplatesSettings() {
	const workspaceId = useAppStore((s) => s.activeWorkspaceId);
	const templatesVersion = useAppStore((s) => s.templatesVersion);
	const [templates, setTemplates] = useState<TemplateInfo[] | null>(null);
	const [failed, setFailed] = useState(false);
	const [editorOpen, setEditorOpen] = useState(false);
	const [editing, setEditing] = useState<TemplateInfo | null>(null);
	const [newScope, setNewScope] = useState<TemplateScope>("global");

	// biome-ignore lint/correctness/useExhaustiveDependencies: templatesVersion is the invalidation trigger, not a body input
	useEffect(() => {
		let cancelled = false;
		getTransport()
			.request("template.list", workspaceId ? { workspaceId } : {})
			.then((res) => {
				if (!cancelled) {
					setTemplates(res.templates);
					setFailed(false);
				}
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, [workspaceId, templatesVersion]);

	const openNew = (scope: TemplateScope) => {
		setEditing(null);
		setNewScope(scope);
		setEditorOpen(true);
	};
	const openEdit = (template: TemplateInfo) => {
		setEditing(template);
		setEditorOpen(true);
	};

	const globalTemplates = (templates ?? []).filter((t) => t.scope === "global");
	const projectTemplates = (templates ?? []).filter((t) => t.scope === "project");

	return (
		<section data-testid="settings-templates" className="flex flex-col gap-lg">
			<div className="flex flex-col gap-xs">
				<h3 className="font-medium text-md text-text">Prompt templates</h3>
				<p className="text-hint text-xs">
					Reusable prompts, expanded from the composer's <code>/</code> menu. Global templates are
					available in every workspace; project templates live in this worktree's{" "}
					<code>.pi/prompts/</code>.
				</p>
			</div>

			{templates == null && !failed ? (
				<p className="text-hint text-sm">Loading templates…</p>
			) : failed ? (
				<p data-testid="templates-error" className="text-hint text-sm">
					Couldn't read templates from the host — reopen Settings to retry.
				</p>
			) : (
				<>
					<TemplateGroup
						title="Global"
						scope="global"
						templates={globalTemplates}
						workspaceId={workspaceId ?? undefined}
						showOpenAsFile={false}
						onNew={() => openNew("global")}
						onEdit={openEdit}
					/>
					{workspaceId ? (
						<TemplateGroup
							title="This project"
							scope="project"
							templates={projectTemplates}
							workspaceId={workspaceId}
							showOpenAsFile
							onNew={() => openNew("project")}
							onEdit={openEdit}
						/>
					) : null}
				</>
			)}

			<TemplateEditorDialog
				open={editorOpen}
				onOpenChange={setEditorOpen}
				workspaceId={workspaceId ?? undefined}
				template={editing}
				initialScope={newScope}
			/>
		</section>
	);
}

function TemplateGroup({
	title,
	scope,
	templates,
	workspaceId,
	showOpenAsFile,
	onNew,
	onEdit,
}: {
	title: string;
	scope: TemplateScope;
	templates: TemplateInfo[];
	workspaceId: string | undefined;
	showOpenAsFile: boolean;
	onNew: () => void;
	onEdit: (template: TemplateInfo) => void;
}) {
	return (
		<section className="flex flex-col gap-sm">
			<div className="flex items-center justify-between">
				<h4 className="font-medium text-muted text-xs uppercase tracking-wider">{title}</h4>
				<button
					type="button"
					data-testid={`template-new-${scope}`}
					onClick={onNew}
					className="flex items-center gap-xs rounded-[var(--radius-sm)] px-sm py-xs text-muted text-xs transition-colors hover:bg-hover hover:text-text"
				>
					<Plus className="size-3.5" />
					New
				</button>
			</div>
			{templates.length === 0 ? (
				<p className="text-hint text-xs">No templates yet.</p>
			) : (
				<div className="flex flex-col gap-xs">
					{templates.map((t) => (
						<TemplateRow
							key={t.name}
							template={t}
							workspaceId={workspaceId}
							showOpenAsFile={showOpenAsFile}
							onEdit={() => onEdit(t)}
						/>
					))}
				</div>
			)}
		</section>
	);
}

function TemplateRow({
	template,
	workspaceId,
	showOpenAsFile,
	onEdit,
}: {
	template: TemplateInfo;
	workspaceId: string | undefined;
	showOpenAsFile: boolean;
	onEdit: () => void;
}) {
	const [confirmOpen, setConfirmOpen] = useState(false);

	const del = async () => {
		try {
			await getTransport().request("template.delete", {
				...(workspaceId ? { workspaceId } : {}),
				scope: template.scope,
				name: template.name,
			});
			// The list re-fetches itself off this bump (see TemplatesSettings's effect) — no local state to update.
			useAppStore.getState().bumpTemplatesVersion();
		} catch (err) {
			toast.error(errorText(err), "Couldn't delete the template");
		}
	};

	const openAsFile = () => {
		if (!workspaceId) return;
		void openFileInTab(workspaceId, `.pi/prompts/${template.name}.md`);
		useAppStore.getState().closeSettings();
	};

	return (
		<ConfirmPopover
			open={confirmOpen}
			onOpenChange={setConfirmOpen}
			title={`Delete ${template.name}?`}
			description="Removes the template file. This can't be undone."
			confirmLabel="Delete"
			destructive
			confirmTestId="template-confirm-delete"
			onConfirm={() => void del()}
			align="end"
		>
			{/* Anchored to the Delete button (the PopoverTrigger below), mirroring ProjectTree.tsx's
			    workspace-remove row. */}
			<div
				data-testid="template-row"
				data-name={template.name}
				data-scope={template.scope}
				className="group flex items-center gap-sm rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-md py-sm"
			>
				<div className="flex min-w-0 flex-1 flex-col">
					<span className="truncate font-medium text-sm text-text">{template.name}</span>
					{template.description ? (
						<span className="truncate text-hint text-xs">{template.description}</span>
					) : null}
				</div>
				<div className="flex shrink-0 items-center gap-xs">
					{showOpenAsFile ? (
						<button
							type="button"
							data-testid="template-open-file"
							aria-label="Open as file"
							title="Open as file"
							onClick={openAsFile}
							className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-muted transition hover:bg-elevated hover:text-text"
						>
							<FileText className="size-3.5" />
						</button>
					) : null}
					<button
						type="button"
						data-testid="template-edit"
						aria-label="Edit"
						title="Edit"
						onClick={onEdit}
						className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-muted transition hover:bg-elevated hover:text-text"
					>
						<Pencil className="size-3.5" />
					</button>
					<PopoverTrigger asChild>
						<button
							type="button"
							data-testid="template-delete"
							aria-label="Delete"
							title="Delete"
							className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-muted transition hover:bg-elevated hover:text-red"
						>
							<Trash2 className="size-3.5" />
						</button>
					</PopoverTrigger>
				</div>
			</div>
		</ConfirmPopover>
	);
}
