import {
	RiFileTextLine as FileText,
	RiPencilLine as Pencil,
	RiAddLine as Plus,
	RiSparkling2Line as Sparkles,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import type { TemplateInfo, TemplateScope } from "@thinkrail/contracts";
import { useEffect, useState } from "react";
import { TemplateEditorDialog } from "@/chat/TemplateEditorDialog";
import { assembleTemplate } from "@/chat/templateText";
import { SkeletonRows } from "@/components/Skeleton";
import { Button } from "@/components/ui/button";
import { PopoverTrigger } from "@/components/ui/popover";
import { IconTooltip } from "@/components/ui/tooltip";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { ConfirmPopover } from "./ConfirmPopover";
import { openFileInTab } from "./openTabs";

const STARTER_TEMPLATES: ReadonlyArray<{
	name: string;
	description: string;
	argumentHint: string;
	body: string;
}> = [
	{
		name: "review",
		description: "Code review of a file or directory",
		argumentHint: "[path] [focus]",
		body: `Review $1 for correctness, clarity, and maintainability, focusing on \${2:-the riskiest parts}.\nList concrete findings with \`file:line\` references, ordered by severity, and propose a fix for each.`,
	},
	{
		name: "explain",
		description: "Explain how something works in this codebase",
		argumentHint: "[path-or-topic]",
		body: "Explain how $1 works in this codebase: its purpose, the key control and data flow, and what depends on it.\nKeep it concise and point to the load-bearing files and `file:line` locations.",
	},
	{
		name: "tests",
		description: "Write tests for a target",
		argumentHint: "[path]",
		body: "Write tests for $1. Cover the main behavior, the important edge cases, and one failure path.\nMatch the project's existing test conventions and runner, then run them and report the result.",
	},
	{
		name: "commit",
		description: "Write a Conventional Commit message from the staged diff",
		argumentHint: "[scope]",
		body: `Read the staged changes (\`git diff --cached\`) and write a Conventional Commits message.\nUse the type that fits (feat/fix/refactor/docs/test/chore) with scope \${1:-infer it from the files},\nan imperative subject under 72 chars, and a short body explaining the why when it isn't obvious.\nReply with only the commit message.`,
	},
	{
		name: "rename",
		description: "Rename a symbol everywhere (demoes repeated-slot mirroring)",
		argumentHint: "[old] [new]",
		body: "Rename `$1` to `$2` across the codebase: update every definition, reference, and import of `$1`,\nplus any docs or comments that mention `$1`. Keep `$2` consistent everywhere and run the type-checker after.",
	},
];

function StarterTemplatesOffer() {
	const [adding, setAdding] = useState(false);

	const addStarters = async () => {
		if (adding) return;
		setAdding(true);
		try {
			for (const t of STARTER_TEMPLATES) {
				await getTransport().request("template.save", {
					scope: "global",
					name: t.name,
					content: assembleTemplate(t.description, t.argumentHint, t.body),
				});
			}
		} catch (err) {
			toast.error(errorText(err), "Couldn't add starter templates");
		} finally {
			useAppStore.getState().bumpTemplatesVersion();
			setAdding(false);
		}
	};

	return (
		<div className="flex flex-col items-start gap-8">
			<p className="text-text-muted tr-text-metadata">
				No templates yet. Add a few common ones to get started.
			</p>
			<Button
				data-testid="template-starters"
				variant="outline"
				size="sm"
				disabled={adding}
				onClick={() => void addStarters()}
			>
				<Sparkles className="size-14" />
				Add starter templates
			</Button>
		</div>
	);
}

function useTemplateList(
	workspaceId: string | undefined,
	scope: TemplateScope,
	enabled: boolean,
): { templates: TemplateInfo[] | null; failed: boolean } {
	const templatesVersion = useAppStore((s) => s.templatesVersion);
	const [fetched, setFetched] = useState<{ version: number; templates: TemplateInfo[] } | null>(
		null,
	);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		if (!enabled) {
			setFetched(null);
			setFailed(false);
			return;
		}
		let cancelled = false;
		getTransport()
			.request("template.list", workspaceId ? { workspaceId } : {})
			.then((res) => {
				if (cancelled) return;
				setFetched({
					version: templatesVersion,
					templates: res.templates.filter((t) => t.scope === scope),
				});
				setFailed(false);
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, [enabled, workspaceId, scope, templatesVersion]);

	return {
		templates: fetched?.version === templatesVersion ? fetched.templates : null,
		failed,
	};
}

export function TemplatesSettings() {
	const workspaceId = useAppStore((s) => s.activeWorkspaceId);
	const [editorOpen, setEditorOpen] = useState(false);
	const [editing, setEditing] = useState<TemplateInfo | null>(null);
	const [newScope, setNewScope] = useState<TemplateScope>("global");

	const { templates: globalTemplates, failed: globalFailed } = useTemplateList(
		undefined,
		"global",
		true,
	);
	const { templates: projectTemplates, failed: projectFailed } = useTemplateList(
		workspaceId ?? undefined,
		"project",
		workspaceId != null,
	);

	const openNew = (scope: TemplateScope) => {
		setEditing(null);
		setNewScope(scope);
		setEditorOpen(true);
	};
	const openEdit = (template: TemplateInfo) => {
		setEditing(template);
		setEditorOpen(true);
	};

	const failed = globalFailed || projectFailed;
	const loading =
		!failed && (globalTemplates == null || (workspaceId != null && projectTemplates == null));

	return (
		<section data-testid="settings-templates" className="flex flex-col gap-16">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Prompt templates</h3>
				<p className="text-text-muted tr-text-metadata">
					Reusable prompts, expanded from the composer's <code className="tr-code-text">/</code>{" "}
					menu. Global templates are available in every workspace; project templates live in this
					worktree's <code className="tr-code-text">.pi/prompts/</code>.
				</p>
			</div>

			{loading ? (
				<SkeletonRows rows={3} />
			) : failed ? (
				<p data-testid="templates-error" className="text-text-muted tr-text-ui">
					Couldn't read templates from the host — reopen Settings to retry.
				</p>
			) : (
				<>
					<TemplateGroup
						title="Global"
						scope="global"
						templates={globalTemplates ?? []}
						workspaceId={workspaceId ?? undefined}
						showOpenAsFile={false}
						onNew={() => openNew("global")}
						onEdit={openEdit}
					/>
					{workspaceId ? (
						<TemplateGroup
							title="This project"
							scope="project"
							templates={projectTemplates ?? []}
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
		<section className="flex flex-col gap-8">
			<div className="flex items-center justify-between">
				<h4 className="tr-text-eyebrow text-text-muted">{title}</h4>
				<button
					type="button"
					data-testid={`template-new-${scope}`}
					onClick={onNew}
					className="flex items-center gap-4 rounded-[var(--radius-sm)] px-8 py-4 text-text-muted tr-text-metadata transition-colors hover:bg-control-bg-hovered hover:text-text-default"
				>
					<Plus className="size-14" />
					New
				</button>
			</div>
			{templates.length === 0 ? (
				scope === "global" ? (
					<StarterTemplatesOffer />
				) : (
					<p className="text-text-muted tr-text-metadata">No templates yet.</p>
				)
			) : (
				<div className="flex flex-col gap-4">
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
			useAppStore.getState().bumpTemplatesVersion();
		} catch (err) {
			toast.error(errorText(err), "Couldn't delete the template");
		}
	};

	const openAsFile = () => {
		if (!workspaceId) return;
		void openFileInTab(workspaceId, `.pi/prompts/${template.name}.md`, "keep");
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
			<div
				data-testid="template-row"
				data-name={template.name}
				data-scope={template.scope}
				className="group flex items-center gap-8 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8"
			>
				<div className="flex min-w-0 flex-1 flex-col">
					<span className="truncate tr-text-ui text-text-default">{template.name}</span>
					{template.description ? (
						<span className="truncate text-text-muted tr-text-metadata">
							{template.description}
						</span>
					) : null}
				</div>
				<div className="flex shrink-0 items-center gap-4">
					{showOpenAsFile ? (
						<IconTooltip label="Open as file">
							<button
								type="button"
								data-testid="template-open-file"
								aria-label="Open as file"
								onClick={openAsFile}
								className="flex size-24 items-center justify-center rounded-[var(--radius-sm)] text-text-muted transition hover:bg-control-bg-hovered hover:text-text-default"
							>
								<FileText className="size-14" />
							</button>
						</IconTooltip>
					) : null}
					<IconTooltip label="Edit">
						<button
							type="button"
							data-testid="template-edit"
							aria-label="Edit"
							onClick={onEdit}
							className="flex size-24 items-center justify-center rounded-[var(--radius-sm)] text-text-muted transition hover:bg-control-bg-hovered hover:text-text-default"
						>
							<Pencil className="size-14" />
						</button>
					</IconTooltip>
					<IconTooltip label="Delete" wrapTrigger>
						<PopoverTrigger asChild>
							<button
								type="button"
								data-testid="template-delete"
								aria-label="Delete"
								className="flex size-24 items-center justify-center rounded-[var(--radius-sm)] text-text-muted transition hover:bg-control-bg-hovered hover:text-feedback-error"
							>
								<Trash2 className="size-14" />
							</button>
						</PopoverTrigger>
					</IconTooltip>
				</div>
			</div>
		</ConfirmPopover>
	);
}
