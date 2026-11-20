import { RiStackLine } from "@remixicon/react";
import type { Workspace } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { Textarea } from "@thinkrail/ui/textarea";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { SettingsChoice, type SettingsChoiceOption } from "../settingsKit";
import {
	type ContainerDialogRequest,
	type ContainerGroup,
	selectAttachableWorkspaces,
	selectContainerGroup,
	selectContainerOfWorkspace,
	selectRepoProjects,
	selectWorkspaceById,
	useAppStore,
	workspaceName,
} from "../store";
import { BranchPicker } from "./BranchPicker";
import { useBranchList } from "./branches";
import {
	attachToContainer,
	groupIntoContainer,
	memberSubtitle,
	removeContainer,
	startWorkspaceInContainer,
} from "./containerActions";
import { PICKER_PILL, ProjectPicker } from "./NewWorkspaceDialog";
import { loadProjectWorkspaces } from "./workspaceActions";

type AddMode = "new" | "stack" | "project" | "attach";

/** The one container dialog of this window: whichever the tree, the topbar or the palette asked for. */
export function ContainerDialogs() {
	const request = useAppStore((s) => s.containerDialog);
	if (!request) return null;
	const close = () => useAppStore.getState().closeContainerDialog();
	if (request.kind === "remove") {
		return (
			<RemoveContainerDialog
				key={`remove:${request.containerId}`}
				containerId={request.containerId}
				onClose={close}
			/>
		);
	}
	return (
		<ContainerWorkspaceDialog
			key={request.kind === "group" ? `group:${request.workspaceId}` : `add:${request.containerId}`}
			request={request}
			onClose={close}
		/>
	);
}

function useContainerTreeState() {
	const containers = useAppStore((s) => s.containers);
	const projects = useAppStore((s) => s.projects);
	const workspaces = useAppStore((s) => s.workspaces);
	return { containers, projects, workspaces };
}

function useProjectNames(): Map<string, string> {
	const projects = useAppStore(useShallow(selectRepoProjects));
	return new Map(projects.map((project) => [project.id, project.name]));
}

function ContainerWorkspaceDialog({
	request,
	onClose,
}: {
	request: Exclude<ContainerDialogRequest, { kind: "remove" }>;
	onClose: () => void;
}) {
	const t = useT();
	const treeState = useContainerTreeState();
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const repoProjects = useAppStore(useShallow(selectRepoProjects));
	const projectNames = useProjectNames();
	const group =
		request.kind === "addWorkspace" ? selectContainerGroup(treeState, request.containerId) : null;
	const anchor =
		request.kind === "group"
			? selectWorkspaceById(
					{ workspaces: treeState.workspaces, activeWorkspaceId },
					request.workspaceId,
				)
			: null;
	const gone =
		request.kind === "addWorkspace"
			? group === null
			: anchor === null || selectContainerOfWorkspace(treeState, anchor.id) !== null;
	useEffect(() => {
		if (gone) onClose();
	}, [gone, onClose]);
	useEffect(() => {
		const state = useAppStore.getState();
		for (const project of selectRepoProjects(state)) {
			if (!state.workspaces[project.id]) void loadProjectWorkspaces(project.id).catch(() => {});
		}
	}, []);

	const members = group?.members ?? [];
	const activeMember = members.find((member) => member.id === activeWorkspaceId);
	const homeProjectId = (activeMember ?? members[0])?.projectId ?? null;
	const otherProjects = repoProjects.filter((project) => project.id !== homeProjectId);
	const attachable = selectAttachableWorkspaces(treeState).filter(
		(workspace) => workspace.id !== anchor?.id,
	);

	const [mode, setMode] = useState<AddMode>(request.kind === "group" ? "attach" : "new");
	const [stackOnId, setStackOnId] = useState(activeMember?.id ?? members[0]?.id ?? "");
	const [otherProjectId, setOtherProjectId] = useState(otherProjects[0]?.id ?? "");
	const [attachId, setAttachId] = useState("");
	const [baseRef, setBaseRef] = useState("");
	const [text, setText] = useState("");
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [dialogEl, setDialogEl] = useState<HTMLElement | null>(null);

	const branchProjectId =
		mode === "new" ? homeProjectId : mode === "project" && otherProjectId ? otherProjectId : null;
	const { branches, failed, refreshing, refresh } = useBranchList(branchProjectId, (list) =>
		setBaseRef(list.defaultBranch),
	);
	const stackOn = members.find((member) => member.id === stackOnId) ?? null;
	const attachTarget = attachable.find((workspace) => workspace.id === attachId) ?? null;
	const ready =
		mode === "attach"
			? attachTarget !== null
			: mode === "stack"
				? stackOn !== null
				: branchProjectId !== null && branches !== null;

	const submit = async () => {
		if (!ready || busy) return;
		setBusy(true);
		let done = false;
		const kickoff = text.trim();
		if (request.kind === "group") {
			if (anchor && attachTarget)
				done = await groupIntoContainer([anchor.id, attachTarget.id], name.trim() || undefined);
		} else if (mode === "attach") {
			if (attachTarget) done = await attachToContainer(request.containerId, attachTarget.id);
		} else if (mode === "stack") {
			if (stackOn)
				done = await startWorkspaceInContainer({
					containerId: request.containerId,
					projectId: stackOn.projectId,
					baseRef: stackOn.branch,
					text: kickoff,
				});
		} else if (branchProjectId) {
			done = await startWorkspaceInContainer({
				containerId: request.containerId,
				projectId: branchProjectId,
				baseRef,
				text: kickoff,
			});
		}
		setBusy(false);
		if (done) onClose();
	};

	const workspaceChoice = (
		workspace: Workspace,
		testId: string,
		withProject: boolean,
	): SettingsChoiceOption<string> => ({
		id: workspace.id,
		label: workspaceName(t, workspace),
		description:
			memberSubtitle(
				t,
				workspace,
				withProject ? projectNames.get(workspace.projectId) : undefined,
			) ?? workspace.branch,
		testId,
	});
	const modeChoices: SettingsChoiceOption<AddMode>[] = [
		{
			id: "new",
			label: t("containers.add.new"),
			description: t("containers.add.newDescription", {
				project: (homeProjectId && projectNames.get(homeProjectId)) ?? "",
			}),
			testId: "container-add-mode-new",
		},
		{
			id: "stack",
			label: t("containers.add.stack"),
			description: t("containers.add.stackDescription"),
			testId: "container-add-mode-stack",
		},
		{
			id: "project",
			label: t("containers.add.project"),
			description: t("containers.add.projectDescription"),
			testId: "container-add-mode-project",
			disabled: otherProjects.length === 0,
		},
		{
			id: "attach",
			label: t("containers.add.attach"),
			description: t("containers.add.attachDescription"),
			testId: "container-add-mode-attach",
		},
	];
	const attachList =
		attachable.length === 0 ? (
			<p data-testid="container-attach-empty" className="tr-text-metadata text-text-subtle">
				{t("containers.add.nothingToAttach")}
			</p>
		) : (
			<div className="max-h-[40vh] overflow-y-auto">
				<SettingsChoice
					layout="cards"
					label={t("containers.add.attachLabel")}
					options={attachable.map((workspace) =>
						workspaceChoice(workspace, "container-attach-option", true),
					)}
					value={attachId}
					onSelect={setAttachId}
				/>
			</div>
		);

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) onClose();
			}}
		>
			<DialogContent
				ref={setDialogEl}
				data-testid="container-workspace-dialog"
				className="max-w-[34rem]"
			>
				<DialogHeader>
					<div className="flex items-center gap-8">
						<RiStackLine className="size-16 shrink-0 text-primary" />
						<DialogTitle>
							{request.kind === "group"
								? t("containers.groupTitle")
								: t("containers.add.title", { name: group?.container.name ?? "" })}
						</DialogTitle>
					</div>
					<DialogDescription>
						{request.kind === "group"
							? t("containers.groupDescription", {
									name: anchor ? workspaceName(t, anchor) : "",
								})
							: t("containers.add.description")}
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex min-h-0 flex-col gap-12"
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					{request.kind === "group" ? (
						<>
							<label className="flex flex-col gap-4">
								<span className="tr-title-compact text-text-default">
									{t("containers.nameLabel")}
								</span>
								<input
									data-testid="container-name-field"
									autoComplete="off"
									spellCheck={false}
									value={name}
									onChange={(event) => setName(event.target.value)}
									placeholder={anchor ? workspaceName(t, anchor) : ""}
									className="w-full rounded-sm border border-control-border-default bg-control-bg px-12 py-8 tr-text-ui text-text-default transition-colors placeholder:text-text-muted focus-visible:border-control-border-active focus-visible:focus-ring"
								/>
							</label>
							{attachList}
						</>
					) : (
						<>
							<SettingsChoice
								layout="cards"
								label={t("containers.add.modeLabel")}
								options={modeChoices}
								value={mode}
								onSelect={setMode}
							/>
							{mode === "new" || mode === "project" ? (
								<div className="flex flex-wrap items-center gap-8">
									{mode === "project" ? (
										<ProjectPicker
											projects={otherProjects}
											current={projectNames.get(otherProjectId) ?? ""}
											container={dialogEl}
											onSelect={setOtherProjectId}
										/>
									) : null}
									<BranchPicker
										branches={branches}
										failed={failed}
										selected={baseRef}
										label={t("containers.add.baseLabel")}
										testid="container-branch-picker"
										triggerClassName={`${PICKER_PILL} max-w-[220px]`}
										refreshing={refreshing}
										container={dialogEl}
										onSelect={setBaseRef}
										onRefresh={refresh}
									/>
								</div>
							) : null}
							{mode === "stack" ? (
								<div className="max-h-[40vh] overflow-y-auto">
									<SettingsChoice
										layout="cards"
										label={t("containers.add.stackLabel")}
										options={members.map((member) =>
											workspaceChoice(member, "container-stack-option", group?.projectId === null),
										)}
										value={stackOnId}
										onSelect={setStackOnId}
									/>
								</div>
							) : null}
							{mode === "attach" ? attachList : null}
							{mode === "attach" ? null : (
								<Textarea
									data-testid="container-first-message"
									value={text}
									onChange={(event) => setText(event.target.value)}
									aria-label={t("containers.add.firstMessage")}
									placeholder={t("containers.add.firstMessage")}
									rows={3}
								/>
							)}
						</>
					)}
					<DialogFooter>
						<Button variant="outline" disabled={busy} onClick={onClose}>
							{t("common.cancel")}
						</Button>
						<Button
							type="submit"
							data-testid="container-workspace-submit"
							disabled={!ready}
							loading={busy}
						>
							{request.kind === "group" ? t("containers.groupSubmit") : t("containers.add.submit")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

type MemberFate = "keep" | "archive";

function RemoveContainerDialog({
	containerId,
	onClose,
}: {
	containerId: string;
	onClose: () => void;
}) {
	const t = useT();
	const treeState = useContainerTreeState();
	const projectNames = useProjectNames();
	const group: ContainerGroup | null = selectContainerGroup(treeState, containerId);
	const [fates, setFates] = useState<Record<string, MemberFate>>({});
	const [busy, setBusy] = useState(false);
	const gone = group === null;
	useEffect(() => {
		if (gone) onClose();
	}, [gone, onClose]);
	if (!group) return null;
	const merged = (workspace: Workspace) => workspace.review?.state === "merged";
	const multiProject = group.projectId === null;
	const subtitle = (member: Workspace) =>
		memberSubtitle(t, member, multiProject ? projectNames.get(member.projectId) : undefined);
	const confirm = async () => {
		if (busy) return;
		setBusy(true);
		const archiveIds = group.members
			.filter((member) => merged(member) || fates[member.id] === "archive")
			.map((member) => member.id);
		const done = await removeContainer(containerId, archiveIds);
		setBusy(false);
		if (done) onClose();
	};
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) onClose();
			}}
		>
			<DialogContent
				role="alertdialog"
				data-testid="remove-container-dialog"
				className="max-w-[34rem]"
			>
				<DialogHeader>
					<DialogTitle>{t("containers.removeTitle", { name: group.container.name })}</DialogTitle>
					<DialogDescription>{t("containers.removeDescription")}</DialogDescription>
				</DialogHeader>
				<ul className="flex max-h-[50vh] flex-col gap-4 overflow-y-auto">
					{group.members.map((member) => (
						<li
							key={member.id}
							data-testid="remove-container-member"
							data-member-id={member.id}
							className="flex min-w-0 items-center gap-12 rounded-sm border border-border-default px-12 py-8"
						>
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="truncate tr-text-ui text-text-default">
									{workspaceName(t, member)}
								</span>
								{subtitle(member) ? (
									<span className="truncate tr-text-metadata text-text-subtle">
										{subtitle(member)}
									</span>
								) : null}
							</span>
							{merged(member) ? (
								<span
									data-testid="remove-container-merged"
									className="shrink-0 rounded-full border border-feedback-info-muted px-8 text-feedback-info tr-text-caption"
								>
									{t("containers.mergedArchived")}
								</span>
							) : (
								<SettingsChoice<MemberFate>
									label={t("containers.fateLabel", { name: workspaceName(t, member) })}
									options={[
										{ id: "keep", label: t("containers.keep"), testId: "remove-container-keep" },
										{
											id: "archive",
											label: t("containers.archive"),
											testId: "remove-container-archive",
										},
									]}
									value={fates[member.id] ?? "keep"}
									onSelect={(fate) => setFates((current) => ({ ...current, [member.id]: fate }))}
									disabled={busy}
								/>
							)}
						</li>
					))}
				</ul>
				<p data-testid="remove-container-trash" className="tr-text-metadata text-text-muted">
					{t("containers.removeTrash")}
				</p>
				<DialogFooter>
					<Button variant="outline" disabled={busy} onClick={onClose}>
						{t("common.cancel")}
					</Button>
					<Button
						variant="destructive"
						data-testid="confirm-remove-container"
						loading={busy}
						onClick={() => void confirm()}
					>
						{t("containers.removeConfirm")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
