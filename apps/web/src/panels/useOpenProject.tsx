import type { Project } from "@thinkrail/contracts";
import { type ReactNode, useState } from "react";
import { useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { ConfirmDialog } from "./ConfirmDialog";
import { NoticeDialog } from "./NoticeDialog";

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

	// Refresh the store's project list, then let the caller adopt (select/expand) the opened project,
	// then auto-enter the project's built-in **Default workspace** (the project folder itself) so opening
	// a project lands in the IDE view — files, changes, terminals — not on Welcome. The list also ensures
	// the Default exists host-side. Best-effort: no Default row (an older host) or a failed list degrades
	// to the caller's select-project behavior (Welcome) — the open itself already succeeded.
	const adopt = async (project: Project) => {
		useAppStore.getState().setProjects(await getTransport().request("project.list", {}));
		await onOpened(project);
		try {
			const workspaces = await getTransport().request("workspace.list", { projectId: project.id });
			useAppStore.getState().setWorkspaces(project.id, workspaces);
			const def = workspaces.find((w) => w.kind === "default");
			if (def) useAppStore.getState().activateWorkspace(def);
		} catch {
			// Entering Default is additive — a failure leaves the caller's selection (Welcome) in place.
		}
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
		try {
			const { path } = await getTransport().request("dialog.selectDirectory", {});
			if (path) await openProject(path);
		} catch {
			// Cancelled / unavailable — nothing to do.
		}
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
						<span className="font-medium text-text">{initTarget}</span> isn't a git repository.
						ThinkRail works on git worktrees, so it needs one. Initialize a repo here and commit the
						folder's current contents?
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
