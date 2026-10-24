import {
	RiFileTextLine as FileText,
	RiMagicLine as MagicWand,
	RiPencilLine as Pencil,
	RiAddLine as Plus,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import type { TemplateInfo, TemplateScope } from "@thinkrail/contracts";
import { T, t as translate, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { PopoverTrigger } from "@thinkrail/ui/popover";
import { SkeletonRows } from "@thinkrail/ui/skeleton";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { useEffect, useState } from "react";
import { TemplateEditorDialog } from "@/chat/TemplateEditorDialog";
import { assembleTemplate } from "@/prompt";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { ConfirmPopover } from "./ConfirmPopover";
import { openFileInTab } from "./openTabs";
import { SettingsPageContainer } from "./SettingsGroup";
import { SettingsNotice } from "./SettingsNotice";

interface StarterTemplate {
	name: string;
	description: string;
	argumentHint: string;
	body: string;
}

function starter(
	name: string,
	description: string,
	argumentHint: string,
	body: string,
): StarterTemplate {
	return { name, description, argumentHint, body };
}

const STARTER_TEMPLATES: readonly StarterTemplate[] = [
	starter(
		"review",
		"Code review of a file or directory",
		"[path] [focus]",
		`Review $1 for correctness, clarity, and maintainability, focusing on \${2:-the riskiest parts}.\nList concrete findings with \`file:line\` references, ordered by severity, and propose a fix for each.`,
	),
	starter(
		"explain",
		"Explain how something works in this codebase",
		"[path-or-topic]",
		"Explain how $1 works in this codebase: its purpose, the key control and data flow, and what depends on it.\nKeep it concise and point to the load-bearing files and `file:line` locations.",
	),
	starter(
		"tests",
		"Write tests for a target",
		"[path]",
		"Write tests for $1. Cover the main behavior, the important edge cases, and one failure path.\nMatch the project's existing test conventions and runner, then run them and report the result.",
	),
	starter(
		"commit",
		"Write a Conventional Commit message from the staged diff",
		"[scope]",
		`Read the staged changes (\`git diff --cached\`) and write a Conventional Commits message.\nUse the type that fits (feat/fix/refactor/docs/test/chore) with scope \${1:-infer it from the files},\nan imperative subject under 72 chars, and a short body explaining the why when it isn't obvious.\nReply with only the commit message.`,
	),
	starter(
		"rename",
		"Rename a symbol everywhere (demoes repeated-slot mirroring)",
		"[old] [new]",
		"Rename `$1` to `$2` across the codebase: update every definition, reference, and import of `$1`,\nplus any docs or comments that mention `$1`. Keep `$2` consistent everywhere and run the type-checker after.",
	),
];

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
					templates: res.templates.filter((template) => template.scope === scope),
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
	const t = useT();
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

	if (loading) {
		return (
			<div data-testid="settings-templates">
				<SkeletonRows rows={3} />
			</div>
		);
	}

	if (failed) {
		return (
			<div data-testid="settings-templates">
				<p data-testid="templates-error" className="text-text-muted tr-text-ui">
					{t("settings.templates.loadFailed")}
				</p>
			</div>
		);
	}

	return (
		<>
			<SettingsPageContainer testId="settings-templates">
				<ProjectTemplatesSection
					workspaceId={workspaceId ?? undefined}
					templates={projectTemplates}
					onNew={() => openNew("project")}
					onEdit={openEdit}
				/>

				<GlobalTemplatesSection
					templates={globalTemplates ?? []}
					onNew={() => openNew("global")}
					onEdit={openEdit}
				/>
			</SettingsPageContainer>

			<TemplateEditorDialog
				open={editorOpen}
				onOpenChange={setEditorOpen}
				workspaceId={workspaceId ?? undefined}
				template={editing}
				initialScope={newScope}
			/>
		</>
	);
}

function ProjectTemplatesSection({
	workspaceId,
	templates,
	onNew,
	onEdit,
}: {
	workspaceId: string | undefined;
	templates: TemplateInfo[] | null;
	onNew: () => void;
	onEdit: (template: TemplateInfo) => void;
}) {
	const t = useT();
	const hasProject = workspaceId != null;

	return (
		<section className="flex flex-col gap-12">
			<div className="flex items-center justify-between">
				<h4 className="tr-text-label-pill text-text-subtle">
					{t("settings.templates.projectTitle")}
				</h4>
				{hasProject ? (
					<Button variant="soft" size="sm" data-testid="template-new-project" onClick={onNew}>
						<Plus className="size-14" />
						{t("settings.templates.new")}
					</Button>
				) : null}
			</div>

			{!hasProject ? (
				<SettingsNotice variant="info" testId="project-templates-unavailable">
					<p className="tr-text-ui text-text-default">{t("settings.templates.openProject")}</p>
					<p className="tr-text-metadata text-text-muted">
						<T
							i18nKey="settings.templates.projectLocation"
							components={[<code key="path" className="tr-code-text" />]}
						/>
					</p>
				</SettingsNotice>
			) : templates && templates.length === 0 ? (
				<SettingsNotice variant="neutral" hideIcon testId="project-templates-empty">
					<p className="tr-text-ui text-text-default">{t("settings.templates.projectEmpty")}</p>
					<p className="tr-text-metadata text-text-muted">
						<T
							i18nKey="settings.templates.projectEmptyLocation"
							components={[<code key="path" className="tr-code-text" />]}
						/>
					</p>
				</SettingsNotice>
			) : templates ? (
				<div className="flex flex-col gap-8">
					{templates.map((template) => (
						<TemplateRow
							key={template.name}
							template={template}
							workspaceId={workspaceId}
							showOpenAsFile
							onEdit={() => onEdit(template)}
						/>
					))}
				</div>
			) : null}
		</section>
	);
}

async function addStarterTemplates() {
	try {
		for (const template of STARTER_TEMPLATES) {
			await getTransport().request("template.save", {
				scope: "global",
				name: template.name,
				content: assembleTemplate(template.description, template.argumentHint, template.body),
			});
		}
	} catch (err) {
		toast.error(errorText(err), translate("settings.templates.addStartersFailed"));
	} finally {
		useAppStore.getState().bumpTemplatesVersion();
	}
}

function GlobalTemplatesSection({
	templates,
	onNew,
	onEdit,
}: {
	templates: TemplateInfo[];
	onNew: () => void;
	onEdit: (template: TemplateInfo) => void;
}) {
	const t = useT();
	const [adding, setAdding] = useState(false);

	const addStarters = () => {
		if (adding) return;
		setAdding(true);
		void addStarterTemplates().then(() => setAdding(false));
	};

	return (
		<section className="flex flex-col gap-12">
			<div className="flex items-center justify-between">
				<h4 className="tr-text-label-pill text-text-subtle">
					{t("settings.templates.globalTitle")}
				</h4>
				<Button variant="soft" size="sm" data-testid="template-new-global" onClick={onNew}>
					<Plus className="size-14" />
					{t("settings.templates.new")}
				</Button>
			</div>

			{templates.length === 0 ? (
				<SettingsNotice
					variant="info"
					icon={<MagicWand className="size-14" />}
					testId="global-templates-empty"
					action={
						<Button
							data-testid="template-starters"
							variant="outline"
							size="sm"
							disabled={adding}
							onClick={addStarters}
						>
							<MagicWand className="size-14" />
							{t("settings.templates.addStarters")}
						</Button>
					}
				>
					<p className="tr-text-ui text-text-default">{t("settings.templates.globalEmpty")}</p>
					<p className="tr-text-metadata text-text-muted">
						{t("settings.templates.globalEmptyDescription")}
					</p>
				</SettingsNotice>
			) : (
				<div className="flex flex-col gap-8">
					{templates.map((template) => (
						<TemplateRow
							key={template.name}
							template={template}
							workspaceId={undefined}
							showOpenAsFile={false}
							onEdit={() => onEdit(template)}
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
	const t = useT();
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
			toast.error(errorText(err), t("settings.templates.deleteFailed"));
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
			title={t("settings.templates.deleteTitle", { name: template.name })}
			description={t("settings.templates.deleteDescription")}
			confirmLabel={t("common.delete")}
			destructive
			confirmTestId="template-confirm-delete"
			onConfirm={() => void del()}
			align="end"
		>
			<div
				data-testid="template-row"
				data-name={template.name}
				data-scope={template.scope}
				className="group flex items-center gap-8 rounded-sm bg-control-bg px-12 py-8"
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
						<IconTooltip label={t("settings.templates.openAsFile")}>
							<button
								type="button"
								data-testid="template-open-file"
								aria-label={t("settings.templates.openAsFile")}
								onClick={openAsFile}
								className="flex size-24 items-center justify-center rounded-sm text-text-muted transition hover:bg-control-bg-hovered hover:text-text-default"
							>
								<FileText className="size-14" />
							</button>
						</IconTooltip>
					) : null}
					<IconTooltip label={t("common.edit")}>
						<button
							type="button"
							data-testid="template-edit"
							aria-label={t("common.edit")}
							onClick={onEdit}
							className="flex size-24 items-center justify-center rounded-sm text-text-muted transition hover:bg-control-bg-hovered hover:text-text-default"
						>
							<Pencil className="size-14" />
						</button>
					</IconTooltip>
					<IconTooltip label={t("common.delete")} wrapTrigger>
						<PopoverTrigger asChild>
							<button
								type="button"
								data-testid="template-delete"
								aria-label={t("common.delete")}
								className="flex size-24 items-center justify-center rounded-sm text-text-muted transition hover:bg-control-bg-hovered hover:text-feedback-error"
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
