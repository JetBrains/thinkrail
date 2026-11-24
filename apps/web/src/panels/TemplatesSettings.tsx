import {
	RiFileTextLine as FileText,
	RiMagicLine as MagicWand,
	RiAddLine as Plus,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import { assembleTemplate } from "@thinkrail/chat-ui/prompt";
import type { TemplateInfo, TemplateScope } from "@thinkrail/contracts";
import { t as translate, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { SkeletonRows } from "@thinkrail/ui/skeleton";
import { useEffect, useState } from "react";
import { TemplateEditorDialog } from "@/chat/TemplateEditorDialog";
import {
	SETTINGS_LIST_PRIMARY,
	SETTINGS_LIST_ROW,
	SettingsGroup,
	type SettingsGroupAction,
	SettingsLine,
	SettingsList,
	SettingsNotice,
	SettingsPage,
	useSettingsListRow,
} from "@/settingsKit";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { ConfirmDialog } from "./ConfirmDialog";
import { openFileInTab } from "./openTabs";
import { SETTING } from "./settingsCatalog";

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

export function splitTemplates(templates: readonly TemplateInfo[]): {
	project: TemplateInfo[];
	global: TemplateInfo[];
} {
	return {
		project: templates.filter((template) => template.scope === "project"),
		global: templates.filter((template) => template.scope === "global"),
	};
}

function useTemplateList(
	workspaceId: string | undefined,
	attempt: number,
): { templates: TemplateInfo[] | null; failed: boolean } {
	const templatesVersion = useAppStore((s) => s.templatesVersion);
	const [fetched, setFetched] = useState<{
		key: string;
		templates: TemplateInfo[];
	} | null>(null);
	const [failed, setFailed] = useState(false);
	const key = `${workspaceId ?? ""}\0${templatesVersion}`;

	useEffect(() => {
		let cancelled = false;
		setFailed(false);
		const list = (params: { workspaceId?: string }) =>
			getTransport()
				.request("template.list", params)
				.then((res) => res.templates);
		Promise.all([list({}), workspaceId ? list({ workspaceId }) : Promise.resolve([])])
			.then(([global, project]) => {
				if (cancelled) return;
				setFetched({
					key,
					templates: [
						...project.filter((template) => template.scope === "project"),
						...global.filter((template) => template.scope === "global"),
					],
				});
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, [workspaceId, key, attempt]);

	return { templates: fetched?.key === key ? fetched.templates : null, failed };
}

async function deleteTemplate(template: TemplateInfo, workspaceId: string | undefined) {
	const params = {
		...(template.scope === "project" && workspaceId ? { workspaceId } : {}),
		scope: template.scope,
		name: template.name,
	};
	try {
		await getTransport().request("template.delete", params);
		useAppStore.getState().bumpTemplatesVersion();
	} catch (err) {
		toast.error(errorText(err), translate("settings.templates.deleteFailed"));
	}
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

export function TemplatesSettings() {
	const t = useT();
	const workspaceId = useAppStore((s) => s.activeWorkspaceId) ?? undefined;
	const [attempt, setAttempt] = useState(0);
	const [editorOpen, setEditorOpen] = useState(false);
	const [editing, setEditing] = useState<TemplateInfo | null>(null);
	const [newScope, setNewScope] = useState<TemplateScope>("global");
	const [deleting, setDeleting] = useState<TemplateInfo | null>(null);
	const { templates, failed } = useTemplateList(workspaceId, attempt);

	const openNew = (scope: TemplateScope) => {
		setEditing(null);
		setNewScope(scope);
		setEditorOpen(true);
	};
	const openEdit = (template: TemplateInfo) => {
		setEditing(template);
		setEditorOpen(true);
	};
	const openAsFile = (template: TemplateInfo) => {
		if (!workspaceId) return;
		void openFileInTab(workspaceId, `.pi/prompts/${template.name}.md`, "keep");
		useAppStore.getState().closeSettings();
	};

	const split = templates ? splitTemplates(templates) : null;
	return (
		<>
			<TemplatesPage
				workspaceId={workspaceId}
				split={split}
				failed={failed}
				onRetry={() => setAttempt((value) => value + 1)}
				onNew={openNew}
				onEdit={openEdit}
				onOpenFile={openAsFile}
				onDelete={setDeleting}
			/>
			<TemplateEditorDialog
				open={editorOpen}
				onOpenChange={setEditorOpen}
				workspaceId={workspaceId}
				template={editing}
				initialScope={newScope}
			/>
			<ConfirmDialog
				open={deleting !== null}
				onOpenChange={(open) => {
					if (!open) setDeleting(null);
				}}
				title={t("settings.templates.deleteTitle", { name: deleting?.name ?? "" })}
				description={t("settings.templates.deleteDescription")}
				confirmLabel={t("common.delete")}
				destructive
				confirmTestId="template-confirm-delete"
				onConfirm={() => {
					if (deleting) void deleteTemplate(deleting, workspaceId);
				}}
			/>
		</>
	);
}

export function TemplatesPage({
	workspaceId,
	split,
	failed,
	onRetry,
	onNew,
	onEdit,
	onOpenFile,
	onDelete,
}: {
	workspaceId: string | undefined;
	split: { project: TemplateInfo[]; global: TemplateInfo[] } | null;
	failed: boolean;
	onRetry: () => void;
	onNew: (scope: TemplateScope) => void;
	onEdit: (template: TemplateInfo) => void;
	onOpenFile: (template: TemplateInfo) => void;
	onDelete: (template: TemplateInfo) => void;
}) {
	const t = useT();
	const title = t("settings.nav.templates");
	const description = t("settings.templates.pageDescription");
	if (failed) {
		return (
			<SettingsPage testId="settings-templates" title={title} description={description}>
				<SettingsLine
					rowId="templates-load-failed"
					className="flex flex-col items-start gap-8 py-8"
				>
					<p role="alert" data-testid="templates-error" className="text-text-muted tr-text-ui">
						{t("settings.templates.loadFailed")}
					</p>
					<Button
						variant="outline"
						size="m"
						tabIndex={0}
						data-testid="templates-retry"
						onClick={onRetry}
					>
						{t("common.retry")}
					</Button>
				</SettingsLine>
			</SettingsPage>
		);
	}
	if (!split) {
		return (
			<SettingsPage testId="settings-templates" title={title} description={description}>
				<SkeletonRows rows={3} />
			</SettingsPage>
		);
	}
	return (
		<SettingsPage testId="settings-templates" title={title} description={description}>
			{workspaceId ? (
				<SettingsGroup
					testId="templates-project"
					title={t("settings.templates.projectTitle")}
					scope="project"
					description={t("settings.templates.projectDescription")}
					action={newTemplateAction("project", onNew)}
				>
					{split.project.length === 0 ? (
						<p
							data-testid="project-templates-empty"
							data-setting-id={SETTING.projectTemplates.id}
							className="px-8 py-8 text-text-muted tr-text-metadata"
						>
							{t("settings.templates.projectEmpty")}
						</p>
					) : (
						<TemplateList
							scope="project"
							templates={split.project}
							onEdit={onEdit}
							onOpenFile={onOpenFile}
							onDelete={onDelete}
						/>
					)}
				</SettingsGroup>
			) : null}
			<SettingsGroup
				testId="templates-global"
				title={t("settings.templates.globalTitle")}
				scope="allProjects"
				description={t("settings.templates.globalDescription")}
				action={newTemplateAction("global", onNew)}
			>
				{split.global.length === 0 ? (
					<div data-setting-id={SETTING.globalTemplates.id} className="py-8">
						<GlobalTemplatesEmpty />
					</div>
				) : (
					<TemplateList
						scope="global"
						templates={split.global}
						onEdit={onEdit}
						onDelete={onDelete}
					/>
				)}
				{workspaceId ? null : (
					<p
						data-testid="project-templates-hint"
						className="px-8 pt-8 text-text-muted tr-text-metadata"
					>
						{t("settings.templates.projectHint")}
					</p>
				)}
			</SettingsGroup>
		</SettingsPage>
	);
}

function newTemplateAction(
	scope: TemplateScope,
	onNew: (scope: TemplateScope) => void,
): SettingsGroupAction {
	return {
		rowId: `template-new-${scope}`,
		control: <NewTemplateButton scope={scope} onNew={onNew} />,
	};
}

function NewTemplateButton({
	scope,
	onNew,
}: {
	scope: TemplateScope;
	onNew: (scope: TemplateScope) => void;
}) {
	const t = useT();
	return (
		<Button
			variant="soft-primary"
			size="m"
			iconLeft={Plus}
			tabIndex={0}
			data-testid={`template-new-${scope}`}
			data-focus-fallback={`templates:${scope}`}
			onClick={() => onNew(scope)}
		>
			{t("settings.templates.new")}
		</Button>
	);
}

function TemplateList({
	scope,
	templates,
	onEdit,
	onOpenFile,
	onDelete,
}: {
	scope: TemplateScope;
	templates: readonly TemplateInfo[];
	onEdit: (template: TemplateInfo) => void;
	onOpenFile?: (template: TemplateInfo) => void;
	onDelete: (template: TemplateInfo) => void;
}) {
	const t = useT();
	const byName = (name: string) => templates.find((template) => template.name === name);
	return (
		<SettingsList
			focusList={`templates:${scope}`}
			label={
				scope === "project"
					? t("settings.templates.projectTitle")
					: t("settings.templates.globalTitle")
			}
			rowIds={templates.map((template) => template.name)}
			settingId={scope === "project" ? SETTING.projectTemplates.id : SETTING.globalTemplates.id}
			testId={`templates-${scope}-list`}
			onRemove={(name) => {
				const template = byName(name);
				if (template) onDelete(template);
			}}
		>
			{templates.map((template) => (
				<TemplateRow
					key={template.name}
					template={template}
					onEdit={() => onEdit(template)}
					onOpenFile={onOpenFile ? () => onOpenFile(template) : undefined}
					onDelete={() => onDelete(template)}
				/>
			))}
		</SettingsList>
	);
}

function GlobalTemplatesEmpty() {
	const t = useT();
	const [adding, setAdding] = useState(false);
	const addStarters = () => {
		if (adding) return;
		setAdding(true);
		void addStarterTemplates().then(() => setAdding(false));
	};
	return (
		<SettingsNotice
			variant="info"
			icon={<MagicWand className="size-14" />}
			rowId="templates-starters"
			testId="global-templates-empty"
			action={
				<Button
					data-testid="template-starters"
					variant="outline"
					size="m"
					iconLeft={MagicWand}
					tabIndex={0}
					disabled={adding}
					onClick={addStarters}
				>
					{t("settings.templates.addStarters")}
				</Button>
			}
		>
			<p className="tr-text-ui text-text-default">{t("settings.templates.globalEmpty")}</p>
			<p className="tr-text-metadata text-text-muted">
				{t("settings.templates.globalEmptyDescription")}
			</p>
		</SettingsNotice>
	);
}

function TemplateRow({
	template,
	onEdit,
	onOpenFile,
	onDelete,
}: {
	template: TemplateInfo;
	onEdit: () => void;
	onOpenFile: (() => void) | undefined;
	onDelete: () => void;
}) {
	const t = useT();
	const { rowProps, primaryProps, sideProps } = useSettingsListRow(template.name);
	return (
		<li
			{...rowProps}
			data-testid="template-row"
			data-name={template.name}
			data-scope={template.scope}
			className={SETTINGS_LIST_ROW}
		>
			<button
				type="button"
				{...primaryProps}
				data-testid="template-edit"
				className={SETTINGS_LIST_PRIMARY}
				onClick={onEdit}
			>
				<span className="wrap-anywhere tr-text-ui text-text-default">{template.name}</span>
				{template.description ? (
					<span className="wrap-break-word text-text-muted tr-text-metadata">
						{template.description}
					</span>
				) : null}
			</button>
			{onOpenFile ? (
				<IconButton
					icon={FileText}
					label={t("settings.templates.openAsFile")}
					{...sideProps}
					data-testid="template-open-file"
					onClick={onOpenFile}
				/>
			) : null}
			<IconButton
				icon={Trash2}
				label={t("common.delete")}
				{...sideProps}
				data-testid="template-delete"
				onClick={onDelete}
			/>
		</li>
	);
}
