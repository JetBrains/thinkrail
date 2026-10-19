import { RiFileCopyLine as Copy, RiTerminalBoxLine as Terminal } from "@remixicon/react";
import type { OpenBranchReview, OpenPrResult, PrBodySource, Workspace } from "@thinkrail/contracts";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { type ReactNode, useRef, useState } from "react";
import { copyText, isShellInert } from "../lib";
import { useAppStore } from "../store";
import { errorText, getTransport, wsErrorCode } from "../transport";
import type { BranchFacts } from "./branchStatusState";
import { ConfirmDialog } from "./ConfirmDialog";
import {
	PrComposeDialog,
	type PrComposeSources,
	type PrComposeState,
	type PrSourcing,
} from "./PrComposeDialog";
import { PrSetupDialog, type PrSetupState } from "./PrSetupDialog";
import { RemoveWorkspaceDialog } from "./RemoveWorkspaceDialog";
import type { ShipActionId } from "./shipActions";
import { openReviewLabel } from "./useBranchStatus";
import { settleWorkspace, unsettleWorkspace } from "./workspaceActions";

const PR_OPEN_TIMEOUT_MS = 180_000;

type PrSubmit = {
	draft: boolean;
	title?: string | undefined;
	body?: string | undefined;
	titleEdited: boolean;
	sourcing?: PrSourcing | undefined;
};

type Retry = { kind: "pr"; submit: PrSubmit } | { kind: "push"; confirmBase: boolean };

export interface ShipRunnerOptions {
	workspace: Workspace | null;
	sessionId: string | null;
	title?: string;
	bodySource?: PrBodySource;
	openReview: OpenBranchReview | null;
	status: BranchFacts | null;
	analyticsSource?: "plan_page";
	noteOpenReview: (review: OpenBranchReview, url?: string) => void;
	refresh: () => void;
}

export interface ShipRunner {
	busy: boolean;
	submitting: boolean;
	pending: ShipActionId | null;
	integrateCommand: string | null;
	run: (id: ShipActionId) => void;
	openPr: (draft: boolean) => Promise<void>;
	copyIntegrateCommand: () => void;
	dialogs: ReactNode;
}

function commits(count: number): string {
	return `${count} commit${count === 1 ? "" : "s"}`;
}

export function useShipRunner(options: ShipRunnerOptions): ShipRunner {
	const { workspace, sessionId, openReview, noteOpenReview, refresh } = options;
	const workspaceId = workspace?.id ?? "";
	const branch = workspace?.branch ?? "";
	const pushToast = useAppStore((s) => s.pushToast);
	const hostPlatform = useAppStore((s) => s.hostPlatform);
	const [pending, setPending] = useState<ShipActionId | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [compose, setCompose] = useState<PrComposeState | null>(null);
	const [setup, setSetup] = useState<PrSetupState | null>(null);
	const [confirmPush, setConfirmPush] = useState(false);
	const [syncOpen, setSyncOpen] = useState(false);
	const [removing, setRemoving] = useState<Workspace | null>(null);
	const lastSubmit = useRef<PrSubmit | null>(null);
	const retry = useRef<Retry | null>(null);
	const onBase = options.status?.onBase === true;
	const ahead = options.status?.ahead ?? 0;
	const integrateCommand = isShellInert(branch) ? `git pull --rebase origin ${branch}` : null;
	const busy = pending !== null || submitting;

	const copyIntegrateCommand = () => {
		if (!integrateCommand) return;
		void copyText(integrateCommand).then((ok) =>
			pushToast(
				ok
					? {
							variant: "success",
							title: "Command copied",
							message: "Run it in a terminal to integrate the remote changes, then push.",
						}
					: { variant: "error", title: "Copy failed", message: "Couldn't write to the clipboard." },
			),
		);
	};

	const preview = (params: { title?: string; source?: PrBodySource; template?: string }) =>
		getTransport().request("pr.preview", {
			workspaceId,
			...(sessionId ? { sessionId } : {}),
			...(options.title ? { title: options.title } : {}),
			...params,
		});

	const sources: PrComposeSources = {
		change: (source, template) =>
			preview({ source, ...(template ? { template } : {}) }).then(
				(next) => next.body,
				(err) => {
					pushToast({
						variant: "error",
						title: "Couldn't load that description",
						message: errorText(err),
					});
					return null;
				},
			),
		generate: (template) =>
			getTransport()
				.request(
					"pr.generate",
					{ workspaceId, ...(sessionId ? { sessionId } : {}), ...(template ? { template } : {}) },
					{ timeoutMs: 60_000 },
				)
				.then(
					({ body }) => {
						if (body === null) {
							pushToast({
								variant: "info",
								title: "No description drafted",
								message: "No model answered — the description was left as it was.",
							});
						}
						return body;
					},
					(err) => {
						pushToast({
							variant: "error",
							title: "Couldn't draft a description",
							message: errorText(err),
						});
						return null;
					},
				),
	};

	const toastDirty = (dirtyFiles: number) => {
		if (dirtyFiles === 0) return;
		pushToast({
			variant: "info",
			title: "Uncommitted changes",
			message: `${dirtyFiles} uncommitted ${dirtyFiles === 1 ? "file" : "files"} stayed local.`,
		});
	};

	const onPrOpened = (submit: PrSubmit, result: OpenPrResult): void => {
		setCompose(null);
		if (result.review) noteOpenReview(result.review, result.url);
		refresh();
		toastDirty(result.dirtyFiles);
		if (result.action === "compare" && result.ghProblem) {
			retry.current = { kind: "pr", submit };
			setSetup({
				kind: "gh",
				problem: result.ghProblem,
				...(result.compareUrl ? { compareUrl: result.compareUrl } : {}),
			});
			return;
		}
		lastSubmit.current = null;
		if (result.action === "compare" && result.compareUrl) {
			window.open(result.compareUrl, "_blank", "noopener,noreferrer");
		}
		const label = result.review ? openReviewLabel(result.review) : null;
		const toastByAction = {
			created: { title: "PR opened", message: `${label ?? "The PR"} is open.` },
			updated: {
				title: "PR updated",
				message: `Pushed new commits to ${label ?? "the open PR"}${result.bodyRefreshed === false ? " — refreshing its description failed." : " and refreshed its description."}`,
			},
			pushed: {
				title: "Branch pushed",
				message:
					"The branch is on origin. The remote isn't GitHub — open the review on your forge.",
			},
			compare: {
				title: "Branch pushed",
				message:
					"The review page opened with the description prefilled — finish creating it there.",
			},
		} as const;
		pushToast({ variant: "success", ...toastByAction[result.action] });
	};

	const onPushFailed = (title: string, err: unknown, failed: Retry): void => {
		if (wsErrorCode(err) === "PUSH_AUTH_FAILED") {
			if (failed.kind === "pr") setCompose(null);
			retry.current = failed;
			setSetup({ kind: "push-auth", detail: errorText(err) });
		} else {
			pushToast({ variant: "error", title, message: errorText(err) });
		}
	};

	const submitPr = (submit: PrSubmit): Promise<void> => {
		const { draft, title, body, titleEdited } = submit;
		lastSubmit.current = submit;
		setSubmitting(true);
		return getTransport()
			.request(
				"pr.open",
				{
					workspaceId,
					...(sessionId ? { sessionId } : {}),
					...(title !== undefined ? { title } : {}),
					...(titleEdited ? { titleEdited: true } : {}),
					...(body !== undefined ? { body } : {}),
					...(draft ? { draft: true } : {}),
					...(options.analyticsSource ? { source: options.analyticsSource } : {}),
				},
				{ timeoutMs: PR_OPEN_TIMEOUT_MS },
			)
			.then(
				(result) => onPrOpened(submit, result),
				(err) => onPushFailed("Open PR failed", err, { kind: "pr", submit }),
			)
			.finally(() => setSubmitting(false));
	};

	const openPr = (draft: boolean): Promise<void> => {
		if (openReview) return submitPr({ draft: false, titleEdited: false });
		const edited = lastSubmit.current;
		if (
			edited &&
			edited.title !== undefined &&
			edited.body !== undefined &&
			edited.draft === draft
		) {
			setCompose({
				draft,
				title: edited.title,
				body: edited.body,
				titleEdited: edited.titleEdited,
				...(edited.sourcing ? { sourcing: edited.sourcing } : {}),
			});
			return Promise.resolve();
		}
		setPending(draft ? "openDraftPr" : "openPr");
		return preview(options.bodySource ? { source: options.bodySource } : {})
			.then(
				(draftPreview) =>
					setCompose({
						draft,
						title: draftPreview.title,
						body: draftPreview.body,
						...(draftPreview.source
							? {
									sourcing: {
										source: draftPreview.source,
										templates: draftPreview.templates ?? [],
										planAvailable: draftPreview.planAvailable === true,
									},
								}
							: {}),
					}),
				(err) => {
					pushToast({
						variant: "error",
						title: "Couldn't prepare the PR",
						message: errorText(err),
					});
				},
			)
			.finally(() => setPending(null));
	};

	const push = (confirmBase: boolean): Promise<void> => {
		setPending("push");
		return getTransport()
			.request(
				"workspace.push",
				{ workspaceId, branch, ...(confirmBase ? { confirmBase: true } : {}) },
				{ timeoutMs: PR_OPEN_TIMEOUT_MS },
			)
			.then(
				(result) => {
					refresh();
					pushToast({
						variant: "success",
						title: ahead > 0 ? "Pushed" : "Branch published",
						message:
							ahead > 0
								? `Pushed ${commits(ahead)} to origin/${branch}.`
								: `${branch} is on origin.`,
					});
					toastDirty(result.dirtyFiles);
				},
				(err) => onPushFailed("Push failed", err, { kind: "push", confirmBase }),
			)
			.finally(() => setPending(null));
	};

	const run = (id: ShipActionId): void => {
		if (!workspace || busy) return;
		switch (id) {
			case "publish":
			case "push":
				if (onBase) setConfirmPush(true);
				else void push(false);
				return;
			case "sync":
				setSyncOpen(true);
				return;
			case "openPr":
			case "createMr":
				void openPr(false);
				return;
			case "openDraftPr":
				void openPr(true);
				return;
			case "settle":
				settleWorkspace(workspace.id);
				return;
			case "keepActive":
				unsettleWorkspace(workspace.id);
				return;
			case "remove":
				setRemoving(workspace);
				return;
			case "mergeLocal":
				return;
		}
	};

	const retrySetup = () => {
		setSetup(null);
		const failed = retry.current;
		retry.current = null;
		if (failed?.kind === "pr") void submitPr(failed.submit);
		else if (failed) void push(failed.confirmBase);
	};
	const runSetupCommand = (command: string) => {
		setSetup(null);
		setSyncOpen(false);
		useAppStore.getState().addTerminal(workspaceId, command);
	};

	const dialogs = (
		<>
			<PrComposeDialog
				state={compose}
				busy={submitting}
				sources={sources}
				onClose={() => {
					lastSubmit.current = null;
					setCompose(null);
				}}
				onSubmit={(submit) => {
					if (compose) void submitPr({ draft: compose.draft, ...submit });
				}}
			/>
			<PrSetupDialog
				state={setup}
				platform={hostPlatform}
				onClose={() => {
					retry.current = null;
					setSetup(null);
				}}
				onRetry={retrySetup}
				onRun={runSetupCommand}
				onCompareOpen={() => {
					setSetup(null);
					retry.current = null;
					lastSubmit.current = null;
				}}
			/>
			<ConfirmDialog
				open={confirmPush}
				onOpenChange={setConfirmPush}
				title={`Push to ${branch}?`}
				description={`This pushes ${ahead > 0 ? commits(ahead) : "the branch"} straight to origin/${branch}, the shared branch — no pull request reviews them first.`}
				confirmLabel={`Push to ${branch}`}
				confirmTestId="ship-confirm-base-push"
				onConfirm={() => {
					setConfirmPush(false);
					void push(true);
				}}
			/>
			<Dialog open={syncOpen} onOpenChange={setSyncOpen}>
				<DialogContent data-testid="ship-sync-dialog" className="max-w-[32rem]">
					<DialogHeader>
						<DialogTitle>Branch diverged from origin</DialogTitle>
						<DialogDescription>
							origin/{branch} has commits this checkout lacks, so a plain push can't land, and
							force-pushing would drop them. Integrate the remote changes first, then push.
						</DialogDescription>
					</DialogHeader>
					{integrateCommand ? (
						<code className="rounded-sm border border-border-default bg-container-content-bg px-8 py-4 tr-code-text text-text-default">
							{integrateCommand}
						</code>
					) : (
						<p className="m-0 tr-text-ui text-text-muted">
							Integrate origin/{branch} in a terminal — this branch name can't be quoted safely for
							every shell.
						</p>
					)}
					<DialogFooter>
						{integrateCommand ? (
							<>
								<Button variant="ghost" data-testid="ship-sync-copy" onClick={copyIntegrateCommand}>
									<Copy className="size-14" />
									Copy command
								</Button>
								<Button
									data-testid="ship-sync-run"
									onClick={() => runSetupCommand(integrateCommand)}
								>
									<Terminal className="size-14" />
									Run in terminal
								</Button>
							</>
						) : (
							<Button variant="ghost" onClick={() => setSyncOpen(false)}>
								Close
							</Button>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>
			{removing ? (
				<RemoveWorkspaceDialog
					workspace={removing}
					open
					onOpenChange={(open) => {
						if (!open) setRemoving(null);
					}}
				/>
			) : null}
		</>
	);

	return {
		busy,
		submitting,
		pending,
		integrateCommand,
		run,
		openPr,
		copyIntegrateCommand,
		dialogs,
	};
}
