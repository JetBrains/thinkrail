import type { TemplateInfo, TemplateScope } from "@thinkrail/contracts";
import { FileText, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { TemplateEditorDialog } from "@/chat/TemplateEditorDialog";
import { assembleTemplate } from "@/chat/templateText";
import { Button } from "@/components/ui/button";
import { PopoverTrigger } from "@/components/ui/popover";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { ConfirmPopover } from "./ConfirmPopover";
import { openFileInTab } from "./openFile";

/**
 * R4: verbatim starter-template content offered by `StarterTemplatesOffer` below (design doc "Amendments
 * (2026-07-22)" item 4). Bodies use pi's own `$1`/`${N:-default}` placeholder grammar — not a JS template
 * literal — so `${2:-the riskiest parts}` / `${1:-mine}` need a lint escape (see the two biome-ignores
 * below); `explain`/`tests` only ever use bare `$1`, which doesn't trip the rule.
 */
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
		// biome-ignore lint/suspicious/noTemplateCurlyInString: literal pi prompt-template syntax, not a JS placeholder
		body: "Review $1 for correctness, clarity, and maintainability, focusing on ${2:-the riskiest parts}.\nList concrete findings with file:line references, ordered by severity, then suggest fixes.",
	},
	{
		name: "explain",
		description: "Explain how something works",
		argumentHint: "[path-or-topic]",
		body: "Explain how $1 works in this codebase: its purpose, the key control/data flow, and what depends on\nit. Keep it concise and point to the load-bearing files and lines.",
	},
	{
		name: "tests",
		description: "Write tests for a target",
		argumentHint: "[path]",
		body: "Write tests for $1. Cover the main behavior, the edge cases, and one failure path. Match the\nproject's existing test conventions and runner, and run the tests after writing them.",
	},
	{
		name: "standup",
		description: "One-line standup update",
		argumentHint: "[team]",
		// biome-ignore lint/suspicious/noTemplateCurlyInString: literal pi prompt-template syntax, not a JS placeholder
		body: "Write a one-line standup update for team ${1:-mine} based on this workspace's recent changes.\nReply with just that line.",
	},
];

/**
 * R4: the Global group's empty-state nudge — one click seeds the four `STARTER_TEMPLATES` above via the
 * same `template.save` wire call `TemplateEditorDialog` uses (scope `"global"`, body assembled by the same
 * `assembleTemplate` helper), sequentially, then bumps `templatesVersion` once so both this panel and the
 * composer's `/` menu cache pick them up. No dismiss state to track: once the list is non-empty,
 * `TemplateGroup` renders the normal row list instead and this component never mounts again.
 */
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
			// Bump even on a partial failure (e.g. the 3rd of 4 saves throws): `template.save` is an
			// idempotent overwrite, so whichever starters landed before the throw are real rows the
			// list refetch should pick up — without the bump they'd exist on disk but never appear, and
			// the offer would linger since the (still-empty, per its stale fetch) list never re-renders.
			useAppStore.getState().bumpTemplatesVersion();
			setAdding(false);
		}
	};

	return (
		<div className="flex flex-col items-start gap-sm">
			<p className="text-hint text-xs">No templates yet. Add a few common ones to get started.</p>
			<Button
				data-testid="template-starters"
				variant="outline"
				size="sm"
				disabled={adding}
				onClick={() => void addStarters()}
			>
				<Sparkles className="size-3.5" />
				Add starter templates
			</Button>
		</div>
	);
}

/**
 * The Settings → Templates panel: two groups — **Global** (always) and **This project** (only with an
 * active workspace) — each listing its prompt-template files with New/Edit/Delete, and (project rows
 * only) an Open-as-file shortcut. Fetches `template.list` **twice**, both refetched whenever the store's
 * `templatesVersion` bumps (a save or delete from anywhere — this panel or `HistoryOverlay`'s
 * save-as-template — invalidates it):
 *  - unscoped (`{}`) for the **Global** group — the server's shadow-merge (`templates.ts`'s
 *    `listTemplates`: a project template wins over a same-named global one, by design — see that
 *    module's own doc) means a *workspace-scoped* list would silently drop a shadowed global template
 *    from view entirely. That's the right behavior for the composer's `/` menu (one name expands to one
 *    thing), but wrong here: Settings must still let the user find, edit, or delete it.
 *  - `{ workspaceId }`, filtered to `scope === "project"`, for the **This project** group — exactly the
 *    templates that exist in this worktree's `.pi/prompts/`, whether or not a same-named global template
 *    also exists.
 * New/Edit open the shared `chat/TemplateEditorDialog` (see `chat/SPEC.md`'s Save-as-template bullet for
 * why it lives in `chat/`, not here). Delete never touches the dialog — it's a `ConfirmPopover` directly
 * on the row.
 */
export function TemplatesSettings() {
	const workspaceId = useAppStore((s) => s.activeWorkspaceId);
	const templatesVersion = useAppStore((s) => s.templatesVersion);
	const [globalTemplates, setGlobalTemplates] = useState<TemplateInfo[] | null>(null);
	const [projectTemplates, setProjectTemplates] = useState<TemplateInfo[] | null>(null);
	const [globalFailed, setGlobalFailed] = useState(false);
	const [projectFailed, setProjectFailed] = useState(false);
	const [editorOpen, setEditorOpen] = useState(false);
	const [editing, setEditing] = useState<TemplateInfo | null>(null);
	const [newScope, setNewScope] = useState<TemplateScope>("global");

	// Global group: always unscoped — never the shadow-merged `{ workspaceId }` response (see doc above).
	// biome-ignore lint/correctness/useExhaustiveDependencies: templatesVersion is the invalidation trigger, not a body input
	useEffect(() => {
		let cancelled = false;
		getTransport()
			.request("template.list", {})
			.then((res) => {
				if (!cancelled) {
					setGlobalTemplates(res.templates.filter((t) => t.scope === "global"));
					setGlobalFailed(false);
				}
			})
			.catch(() => {
				if (!cancelled) setGlobalFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, [templatesVersion]);

	// Project group: the workspace-scoped (shadow-merged) list, filtered down to the project-scoped
	// entries. A separate failure flag from the global fetch above — two independent in-flight requests
	// must never let one's success silently clear the other's already-reported failure.
	// biome-ignore lint/correctness/useExhaustiveDependencies: templatesVersion is the invalidation trigger, not a body input
	useEffect(() => {
		if (!workspaceId) {
			setProjectTemplates(null);
			setProjectFailed(false);
			return;
		}
		let cancelled = false;
		getTransport()
			.request("template.list", { workspaceId })
			.then((res) => {
				if (!cancelled) {
					setProjectTemplates(res.templates.filter((t) => t.scope === "project"));
					setProjectFailed(false);
				}
			})
			.catch(() => {
				if (!cancelled) setProjectFailed(true);
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

	const failed = globalFailed || projectFailed;
	const loading =
		!failed && (globalTemplates == null || (workspaceId != null && projectTemplates == null));

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

			{loading ? (
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
				scope === "global" ? (
					<StarterTemplatesOffer />
				) : (
					<p className="text-hint text-xs">No templates yet.</p>
				)
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
