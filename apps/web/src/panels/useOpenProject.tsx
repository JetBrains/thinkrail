import type { Project } from "@thinkrail/contracts";
import { T, useT } from "@thinkrail/locales/react";
import { type ReactNode, useEffect, useState } from "react";
import {
	IssueAssociationDialog,
	notifyIssueAssociation,
	type ProjectOpenGesture,
	shouldPromptAssociation,
	supportsIssueAuth,
} from "../issues";
import { selectSupportsProjectClone, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { CloneProjectDialog } from "./CloneProjectDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { createLatestOperation } from "./latestOperation";
import { NoticeDialog } from "./NoticeDialog";
import { OpenProjectPathDialog } from "./OpenProjectPathDialog";
import { explainOpenFailure } from "./openProjectFailure";

const PICK_TIMEOUT_MS = 30 * 60_000;
const projectOpenIntents = createLatestOperation();
/** Every mounted opener renders this node, so a new open gesture must close any open prompt. */
const associationClosers = new Set<() => void>();

/** One pending association prompt: the project and the host-read `origin` hint, if any. */
interface AssociationPrompt {
	projectId: string;
	repositoryUrl: string | null;
	isCurrent: () => boolean;
}

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
	const supportsAssociation = supportsIssueAuth(useAppStore((s) => s.protocolVersion));
	const [association, setAssociation] = useState<AssociationPrompt | null>(null);
	const [cloneIntent, setCloneIntent] = useState<{ isCurrent: () => boolean } | null>(null);
	const [initTarget, setInitTarget] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [openError, setOpenError] = useState<string | null>(null);
	const [pathEntry, setPathEntry] = useState<{ reason: string | null } | null>(null);

	useEffect(() => {
		const close = () => setAssociation(null);
		associationClosers.add(close);
		return () => {
			associationClosers.delete(close);
		};
	}, []);

	const beginIntent = () => {
		for (const close of associationClosers) close();
		return projectOpenIntents.begin();
	};

	/**
	 * Ask the host for the project's `origin` hint and open the skippable association prompt.
	 * Every failure is silent: the project stays open, the setup intent is untouched, and
	 * `explainOpenFailure` never sees an association error.
	 */
	const offerAssociation = async (project: Project, isCurrent: () => boolean) => {
		if (!supportsAssociation || !isCurrent()) return;
		let repositoryUrl: string | null = null;
		try {
			({ repositoryUrl } = await getTransport().request("issues.repositoryAddress", {
				projectId: project.id,
			}));
		} catch {
			repositoryUrl = null;
		}
		if (!supportsAssociation || !isCurrent()) return;
		setAssociation({ projectId: project.id, repositoryUrl, isCurrent });
	};

	const adopt = async (
		project: Project,
		isCurrent: () => boolean,
		intent: OpenedProjectIntent = { setup: false },
		gesture: ProjectOpenGesture = "open",
	) => {
		if (!isCurrent()) return;
		useAppStore.getState().applyProjectUpdated(project);
		if (!isCurrent()) return;
		await onOpened(project, intent);
		if (!isCurrent() || !shouldPromptAssociation(gesture)) return;
		await offerAssociation(project, isCurrent);
	};

	const openProjectForIntent = async (rawPath: string, isCurrent: () => boolean) => {
		const trimmed = rawPath.trim();
		if (!trimmed || !isCurrent()) return;
		try {
			const project = await getTransport().request("project.open", { path: trimmed });
			if (!isCurrent()) return;
			await adopt(project, isCurrent, { setup: false }, "open");
			if (!isCurrent()) return;
		} catch (err) {
			if (!isCurrent()) return;
			const failure = await explainOpenFailure(err, trimmed, t);
			if (!isCurrent()) return;
			if (failure.kind === "initable") setInitTarget(trimmed);
			else setOpenError(failure.text);
		}
	};

	const openProject = (rawPath: string) => openProjectForIntent(rawPath, beginIntent());

	const initProject = async (path: string) => {
		const isCurrent = beginIntent();
		try {
			const project = await getTransport().request("project.init", { path });
			if (!isCurrent()) return;
			await adopt(project, isCurrent, { setup: false }, "init");
			if (!isCurrent()) return;
		} catch (err) {
			if (!isCurrent()) return;
			setOpenError(errorText(err, t("panels.openProject.initFailed", { path })));
		}
	};

	const startNewProject = () => {
		beginIntent();
		setCreating(true);
	};

	const cloneRepository = supportsClone
		? () => {
				setCloneIntent({ isCurrent: beginIntent() });
			}
		: undefined;

	const enterHostPath = () => {
		beginIntent();
		setPathEntry({ reason: null });
	};

	const pickAndOpen = async () => {
		const isCurrent = beginIntent();
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
					onCloned={(project) =>
						void adopt(project, cloneIntent.isCurrent, { setup: false }, "clone")
					}
				/>
			) : null}
			{creating ? (
				<CreateProjectDialog
					onClose={() => setCreating(false)}
					onCreated={(project, setup) => void adopt(project, beginIntent(), { setup }, "create")}
				/>
			) : null}
			{association?.isCurrent() ? (
				<IssueAssociationDialog
					projectId={association.projectId}
					initialRepositoryUrl={association.repositoryUrl}
					onClose={() => setAssociation(null)}
					onAssociated={(connection) => notifyIssueAssociation(connection.projectId)}
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
