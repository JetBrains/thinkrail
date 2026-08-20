import type { Project } from "@thinkrail/contracts";
import { type ReactNode, useState } from "react";
import { useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { ConfirmDialog } from "./ConfirmDialog";
import { NoticeDialog } from "./NoticeDialog";

const PICK_TIMEOUT_MS = 30 * 60_000;

export function useOpenProject(onOpened: (project: Project) => void | Promise<void>): {
	openProject: (rawPath: string) => Promise<void>;
	pickAndOpen: () => Promise<void>;
	dialogs: ReactNode;
} {
	const [initTarget, setInitTarget] = useState<string | null>(null);
	const [openError, setOpenError] = useState<string | null>(null);

	const adopt = async (project: Project) => {
		useAppStore.getState().applyProjectUpdated(project);
		await onOpened(project);
	};

	const openProject = async (rawPath: string) => {
		const trimmed = rawPath.trim();
		if (!trimmed) return;
		try {
			await adopt(await getTransport().request("project.open", { path: trimmed }));
		} catch (err) {
			const status = await getTransport()
				.request("project.inspect", { path: trimmed })
				.catch(() => null);
			if (status?.kind === "initable") setInitTarget(trimmed);
			else if (status?.kind === "missing")
				setOpenError(`This folder no longer exists:\n${trimmed}`);
			else if (status?.kind === "notDirectory") setOpenError(`This isn't a folder:\n${trimmed}`);
			else setOpenError(errorText(err, `Couldn't open ${trimmed}.`));
		}
	};

	const initProject = async (path: string) => {
		try {
			await adopt(await getTransport().request("project.init", { path }));
		} catch (err) {
			setOpenError(errorText(err, `Couldn't initialise a git repository in ${path}.`));
		}
	};

	const pickAndOpen = async () => {
		let path: string | null;
		try {
			({ path } = await getTransport().request(
				"dialog.selectDirectory",
				{},
				{ timeoutMs: PICK_TIMEOUT_MS },
			));
		} catch (err) {
			setOpenError(errorText(err, "Couldn't open the folder picker on the host."));
			return;
		}
		if (path) await openProject(path);
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

	return { openProject, pickAndOpen, dialogs };
}
