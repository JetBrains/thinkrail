import type { ExistingWorktreeCandidate, Workspace } from "@thinkrail/contracts";
import { FolderOpen, GitBranch, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { errorText, getTransport } from "../transport";

/** Choose one checkout from Git's registry and attach it without mutating or taking ownership of it. */
export function ExistingWorktreeDialog({
	open,
	projectId,
	onOpenChange,
	onOpened,
}: {
	open: boolean;
	projectId: string;
	onOpenChange: (open: boolean) => void;
	onOpened: (workspace: Workspace) => Promise<void>;
}) {
	const [candidates, setCandidates] = useState<ExistingWorktreeCandidate[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [openError, setOpenError] = useState<string | null>(null);
	const [openingPath, setOpeningPath] = useState<string | null>(null);
	const requestRef = useRef(0);
	const firstAvailableRef = useRef<HTMLButtonElement>(null);

	const loadCandidates = useCallback(() => {
		const request = requestRef.current + 1;
		requestRef.current = request;
		setCandidates(null);
		setLoadError(null);
		setOpenError(null);
		void getTransport()
			.request("workspace.listExisting", { projectId })
			.then((rows) => {
				if (requestRef.current === request) setCandidates(rows);
			})
			.catch((error) => {
				if (requestRef.current === request) {
					setLoadError(errorText(error, "Couldn't list existing worktrees"));
				}
			});
	}, [projectId]);

	useEffect(() => {
		if (!open) return;
		loadCandidates();
		return () => {
			requestRef.current += 1;
		};
	}, [loadCandidates, open]);

	useEffect(() => {
		if (candidates?.some((candidate) => candidate.status === "available")) {
			firstAvailableRef.current?.focus();
		}
	}, [candidates]);

	const firstAvailablePath = candidates?.find(
		(candidate) => candidate.status === "available",
	)?.path;

	const openCandidate = async (candidate: ExistingWorktreeCandidate) => {
		if (candidate.status !== "available" || openingPath) return;
		setOpeningPath(candidate.path);
		setOpenError(null);
		try {
			const workspace = await getTransport().request("workspace.openExisting", {
				projectId,
				path: candidate.path,
			});
			await onOpened(workspace);
			onOpenChange(false);
		} catch (error) {
			setOpenError(errorText(error, "Couldn't finish opening the existing worktree"));
			setOpeningPath(null);
		}
	};

	// Selecting a row commits a server mutation that cannot be rolled back safely. Keep the modal in place
	// until that request settles rather than accepting a dismissal that a late success would contradict.
	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen && openingPath !== null) return;
		onOpenChange(nextOpen);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="max-w-[36rem]" data-testid="existing-worktree-dialog">
				<DialogHeader>
					<div className="flex items-center gap-sm">
						<FolderOpen className="size-4 shrink-0 text-primary" />
						<DialogTitle>Open existing worktree</DialogTitle>
					</div>
					<DialogDescription>
						Choose a checkout already registered with this Git repository. ThinkRail will use it in
						place without moving, renaming, or taking ownership of it.
					</DialogDescription>
				</DialogHeader>

				{candidates === null && loadError === null ? (
					<div
						className="flex min-h-28 items-center justify-center gap-sm text-text-muted tr-text-ui"
						data-testid="existing-worktree-loading"
					>
						<Loader2 className="size-4 animate-spin" />
						Reading Git worktrees…
					</div>
				) : null}

				{loadError ? (
					<div className="flex flex-col items-start gap-sm rounded-[var(--radius-sm)] bg-feedback-error-subtle p-md text-feedback-error tr-text-ui">
						<p>{loadError}</p>
						<Button
							variant="outline"
							size="sm"
							data-testid="existing-worktree-retry"
							onClick={loadCandidates}
						>
							<RefreshCw className="size-3.5" />
							Retry
						</Button>
					</div>
				) : null}

				{candidates?.length === 0 ? (
					<div
						className="rounded-[var(--radius-sm)] border border-border-default bg-control-bg p-md text-text-muted tr-text-ui"
						data-testid="existing-worktree-empty"
					>
						No unattached worktrees found. Create one with Git, then reopen this chooser.
					</div>
				) : null}

				{candidates && candidates.length > 0 ? (
					<div
						className="flex max-h-[min(50vh,24rem)] flex-col gap-xs overflow-y-auto pr-xs"
						data-testid="existing-worktree-list"
					>
						{candidates.map((candidate) => {
							const available = candidate.status === "available";
							const opening = openingPath === candidate.path;
							return (
								<button
									key={candidate.path}
									ref={candidate.path === firstAvailablePath ? firstAvailableRef : undefined}
									type="button"
									disabled={!available || openingPath !== null}
									data-testid="existing-worktree-candidate"
									data-status={candidate.status}
									onClick={() => void openCandidate(candidate)}
									className="flex w-full items-start gap-md rounded-[var(--radius-sm)] border border-border-default bg-control-bg p-md text-left outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:border-control-disabled-border disabled:bg-control-disabled-bg disabled:text-control-disabled-text"
								>
									<div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-container-elevated-bg text-text-muted">
										{opening ? (
											<Loader2 className="size-4 animate-spin" />
										) : (
											<GitBranch className="size-4" />
										)}
									</div>
									<span className="flex min-w-0 flex-1 flex-col gap-0.5">
										<span className="truncate text-text-default tr-text-ui">
											{available ? candidate.branch : "Detached HEAD"}
										</span>
										<span className="truncate text-text-subtle tr-text-metadata">
											{candidate.path}
										</span>
										{available ? null : (
											<span className="text-feedback-warning tr-text-metadata">
												Create a branch in this worktree before opening it.
											</span>
										)}
									</span>
								</button>
							);
						})}
					</div>
				) : null}

				{openError ? (
					<p
						className="rounded-[var(--radius-sm)] bg-feedback-error-subtle px-md py-sm text-feedback-error tr-text-ui"
						data-testid="existing-worktree-error"
					>
						{openError}
					</p>
				) : null}

				<DialogFooter>
					<Button
						variant="outline"
						disabled={openingPath !== null}
						onClick={() => handleOpenChange(false)}
					>
						Cancel
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
