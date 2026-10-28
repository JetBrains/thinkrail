import type { Project } from "@thinkrail/contracts";
import { T, useT } from "@thinkrail/locales/react";
import { type ReactNode, useState } from "react";
import { selectSupportsProjectClone, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { CloneProjectDialog } from "./CloneProjectDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { createLatestOperation } from "./latestOperation";
import { NoticeDialog } from "./NoticeDialog";
import { OpenProjectPathDialog } from "./OpenProjectPathDialog";

const PICK_TIMEOUT_MS = 30 * 60_000;
const projectOpenIntents = createLatestOperation();

export type OpenedProjectIntent = { setup: boolean };

export function useOpenProject(
	onOpened: (project: Project, intent: OpenedProjectIntent) => void | Promise<void>,
): {
	openProject: (rawPath: string) => Promise<void>;
	pickAndOpen: () => Promise<void>;
	enterHostPath: () => void;
	startNewProject: () => void;
	cloneRepository: (() => void) | undefined;
	dialogs: ReactNode;
} {
	const t = useT();
	const supportsClone = useAppStore(selectSupportsProjectClone);
	const [cloneIntent, setCloneIntent] = useState<{ isCurrent: () => boolean } | null>(null);
	const [initTarget, setInitTarget] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [openError, setOpenError] = useState<string | null>(null);
	const [pathEntry, setPathEntry] = useState<{ reason: string | null } | null>(null);

	const adopt = async (
		project: Project,
		isCurrent: () => boolean,
		intent: OpenedProjectIntent = { setup: false },
	) => {
		if (!isCurrent()) return;
		useAppStore.getState().applyProjectUpdated(project);
		if (!isCurrent()) return;
		await onOpened(project, intent);
	};

	const openProjectForIntent = async (rawPath: string, isCurrent: () => boolean) => {
		const trimmed = rawPath.trim();
		if (!trimmed || !isCurrent()) return;
		try {
			const project = await getTransport().request("project.open", { path: trimmed });
			if (!isCurrent()) return;
			await adopt(project, isCurrent);
			if (!isCurrent()) return;
		} catch (err) {
			if (!isCurrent()) return;
			const status = await getTransport()
				.request("project.inspect", { path: trimmed })
				.catch(() => null);
			if (!isCurrent()) return;
			if (status?.kind === "initable") setInitTarget(trimmed);
			else if (status?.kind === "missing")
				setOpenError(t("panels.openProject.missing", { path: trimmed }));
			else if (status?.kind === "notDirectory")
				setOpenError(t("panels.openProject.notDirectory", { path: trimmed }));
			else setOpenError(errorText(err, t("panels.openProject.openPathFailed", { path: trimmed })));
		}
	};

	const openProject = (rawPath: string) =>
		openProjectForIntent(rawPath, projectOpenIntents.begin());

	const initProject = async (path: string) => {
		const isCurrent = projectOpenIntents.begin();
		try {
			const project = await getTransport().request("project.init", { path });
			if (!isCurrent()) return;
			await adopt(project, isCurrent);
			if (!isCurrent()) return;
		} catch (err) {
			if (!isCurrent()) return;
			setOpenError(errorText(err, t("panels.openProject.initFailed", { path })));
		}
	};

	const startNewProject = () => {
		projectOpenIntents.begin();
		setCreating(true);
	};

	const cloneRepository = supportsClone
		? () => {
				setCloneIntent({ isCurrent: projectOpenIntents.begin() });
			}
		: undefined;

	const enterHostPath = () => {
		projectOpenIntents.begin();
		setPathEntry({ reason: null });
	};

	const pickAndOpen = async () => {
		const isCurrent = projectOpenIntents.begin();
		let path: string | null;
		try {
			({ path } = await getTransport().request(
				"dialog.selectDirectory",
				{},
				{ timeoutMs: PICK_TIMEOUT_MS },
			));
		} catch (err) {
			if (!isCurrent()) return;
			setPathEntry({ reason: errorText(err, t("panels.openProject.pickerFailed")) });
			return;
		}
		if (!isCurrent()) return;
		if (path) await openProjectForIntent(path, isCurrent);
	};

	const dialogs = (
		<>
			<ConfirmDialog
				open={initTarget !== null}
				onOpenChange={(o) => {
					if (!o) setInitTarget(null);
				}}
				title={t("panels.openProject.initTitle")}
				description={
					<T
						i18nKey="panels.openProject.initDescription"
						values={{ path: initTarget }}
						components={[<span key="path" className="tr-text-emphasis text-text-default" />]}
					/>
				}
				confirmLabel={t("panels.openProject.initConfirm")}
				confirmTestId="confirm-init-repo"
				onConfirm={() => {
					if (initTarget) void initProject(initTarget);
				}}
			/>
			{cloneIntent ? (
				<CloneProjectDialog
					onClose={() => setCloneIntent(null)}
					onCloned={(project) => void adopt(project, cloneIntent.isCurrent)}
				/>
			) : null}
			{creating ? (
				<CreateProjectDialog
					onClose={() => setCreating(false)}
					onCreated={(project, setup) => void adopt(project, projectOpenIntents.begin(), { setup })}
				/>
			) : null}
			<OpenProjectPathDialog
				open={pathEntry !== null}
				reason={pathEntry?.reason ?? null}
				onOpenChange={(open) => {
					if (!open) setPathEntry(null);
				}}
				onSubmit={(path) => void openProject(path)}
			/>
			<NoticeDialog
				open={openError !== null}
				onOpenChange={(o) => {
					if (!o) setOpenError(null);
				}}
				title={t("panels.openProject.openFailed")}
				description={<span className="whitespace-pre-line">{openError}</span>}
				testId="open-error-dialog"
			/>
		</>
	);

	return { openProject, pickAndOpen, enterHostPath, startNewProject, cloneRepository, dialogs };
}
