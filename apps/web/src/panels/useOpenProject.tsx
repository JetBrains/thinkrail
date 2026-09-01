import type { Project } from "@thinkrail/contracts";
import { type ReactNode, useState } from "react";
import { useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { ConfirmDialog } from "./ConfirmDialog";
import { createLatestOperation } from "./latestOperation";
import { NoticeDialog } from "./NoticeDialog";
import { OpenProjectPathDialog } from "./OpenProjectPathDialog";

const PICK_TIMEOUT_MS = 30 * 60_000;
const projectOpenIntents = createLatestOperation();

export function useOpenProject(onOpened: (project: Project) => void | Promise<void>): {
	openProject: (rawPath: string) => Promise<void>;
	pickAndOpen: () => Promise<void>;
	enterHostPath: () => void;
	dialogs: ReactNode;
} {
	const [initTarget, setInitTarget] = useState<string | null>(null);
	const [openError, setOpenError] = useState<string | null>(null);
	const [pathEntry, setPathEntry] = useState<{ reason: string | null } | null>(null);

	const adopt = async (project: Project, isCurrent: () => boolean) => {
		if (!isCurrent()) return;
		useAppStore.getState().applyProjectUpdated(project);
		if (!isCurrent()) return;
		await onOpened(project);
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
				setOpenError(`This folder no longer exists:\n${trimmed}`);
			else if (status?.kind === "notDirectory") setOpenError(`This isn't a folder:\n${trimmed}`);
			else setOpenError(errorText(err, `Couldn't open ${trimmed}.`));
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
			setOpenError(errorText(err, `Couldn't initialise a git repository in ${path}.`));
		}
	};

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
			setPathEntry({ reason: errorText(err, "Couldn't open the folder picker on the host.") });
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
				title="Initialize a git repository?"
				description={
					<>
						<span className="tr-text-emphasis text-text-default">{initTarget}</span> isn't a git
						repository. ThinkRail works on git worktrees, so it needs one. Initialize a repo here
						and commit the folder's current contents?
					</>
				}
				confirmLabel="Initialize & open"
				confirmTestId="confirm-init-repo"
				onConfirm={() => {
					if (initTarget) void initProject(initTarget);
				}}
			/>
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
				title="Couldn't open project"
				description={<span className="whitespace-pre-line">{openError}</span>}
				testId="open-error-dialog"
			/>
		</>
	);

	return { openProject, pickAndOpen, enterHostPath, dialogs };
}
