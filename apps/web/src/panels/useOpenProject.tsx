import type { Project } from "@thinkrail/contracts";
import { type ReactNode, useState } from "react";
import { useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { ConfirmDialog } from "./ConfirmDialog";
import { NoticeDialog } from "./NoticeDialog";

// The host answers `dialog.selectDirectory` only once the user has picked a folder or dismissed the
// dialog, so it needs far more than the transport's 60s default: that would reject (and drop the reply)
// while the picker is still on screen. Generous but finite, so a dead host still releases the request.
const PICK_TIMEOUT_MS = 30 * 60_000;

/**
 * The shared "open a project" flow, reused by the projects rail (`ProjectTree`) and the Welcome screen
 * (`WelcomePanel`) so the non-git handling is identical in both. Opens a folder as a project; when it
 * isn't a git repo it asks the host what the path is and either **offers to `git init`** it (a
 * `ConfirmDialog`) or surfaces a **legible error** (a `NoticeDialog`) — never fails silently.
 *
 * `onOpened(project)` is the caller's adopt step (select / expand) after the project list is refreshed.
 * The caller must render the returned **`dialogs`** node (the init offer + error notice).
 */
export function useOpenProject(onOpened: (project: Project) => void | Promise<void>): {
	openProject: (rawPath: string) => Promise<void>;
	pickAndOpen: () => Promise<void>;
	dialogs: ReactNode;
} {
	// A plain folder we've offered to `git init` (null = closed) — set when `project.open` fails and the
	// host reports the path is `initable`.
	const [initTarget, setInitTarget] = useState<string | null>(null);
	// A non-actionable open failure to surface (a stale recent, a broken path). null = no notice.
	const [openError, setOpenError] = useState<string | null>(null);

	// Refresh the store's project list, then let the caller adopt (select/expand) the opened project.
	// Deliberately NO auto-enter into any workspace: opening lands on the project's Welcome — the fork
	// where the two working modes (isolated worktree vs the project folder's Default workspace) are an
	// explicit choice (see task-workspace-mode-clarity).
	const adopt = async (project: Project) => {
		useAppStore.getState().setProjects(await getTransport().request("project.list", {}));
		await onOpened(project);
	};

	const openProject = async (rawPath: string) => {
		const trimmed = rawPath.trim();
		if (!trimmed) return;
		try {
			await adopt(await getTransport().request("project.open", { path: trimmed }));
		} catch (err) {
			// Open failed — the common case is a plain (non-git) folder. Ask the host what the path is so we
			// either offer to initialise a repo or surface a legible error, instead of failing silently.
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

	// Confirmed the init offer: `git init` + commit the folder, then open it as a project.
	const initProject = async (path: string) => {
		try {
			await adopt(await getTransport().request("project.init", { path }));
		} catch (err) {
			setOpenError(errorText(err, `Couldn't initialise a git repository in ${path}.`));
		}
	};

	/** Ask the host for a directory via its native picker, then open it. */
	const pickAndOpen = async () => {
		let path: string | null;
		try {
			({ path } = await getTransport().request(
				"dialog.selectDirectory",
				{},
				{ timeoutMs: PICK_TIMEOUT_MS },
			));
		} catch (err) {
			// A cancel is a null path; a throw means the host couldn't *show* a dialog — surface it, or the
			// only way to add a project reads as a dead button.
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
